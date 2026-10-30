import {cp,readFile,writeFile,readdir,mkdir,rm,rename} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd(), out=path.join(root,'dist');
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
for(const p of ['index.html','local-models.js','local-models.css','conversation-messages.mjs','runtime']) await cp(p,path.join(out,p),{recursive:true});
const pkg=JSON.parse(await readFile('package.json','utf8'));
const commit=process.env.GITHUB_SHA || execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const branch=process.env.DEPLOY_BRANCH || process.env.GITHUB_REF_NAME || 'local';
const build={version:pkg.version,commit,branch,environment:branch==='main'?'production':branch==='dev'?'development':'local',builtAt:new Date().toISOString()};
const developmentNative=branch==='dev'?JSON.parse(await readFile('dev-tools/native-runtime/manifest.json','utf8')):null;
if(developmentNative?.compilerControl)build.developmentRuntime={nativeBuildId:developmentNative.buildId,variant:developmentNative.compilerControl.id,wasmSha256:developmentNative.files['compat.wasm'].sha256};
const releasePath='releases/'+commit;
await mkdir(path.join(out,releasePath),{recursive:true});
for(const item of ['local-models.js','local-models.css','conversation-messages.mjs','runtime']) await rename(path.join(out,item),path.join(out,releasePath,item));
// Both branch builds start from the pinned production runtime. Dev overlays it below.
const productionNative=JSON.parse(await readFile('ops/native/production-runtime.json','utf8'));
if(productionNative.developmentDiagnostics!==false)throw new Error('Production runtime must exclude development instrumentation');
for(const [file,pin] of Object.entries(productionNative.files)){
 const bytes=await readFile(path.join(out,releasePath,'runtime/providers/vendor/wllama/v1q',file));
 if(bytes.length!==pin.bytes||createHash('sha256').update(bytes).digest('hex')!==pin.sha256)throw new Error('Production runtime checksum mismatch: '+file);
}
let html=await readFile(path.join(out,'index.html'),'utf8');
html=html.replace('<script src="/build-info.js"></script>','<script>window.APP_BUILD='+JSON.stringify(build)+';</script>');
html=html.replace('href="/local-models.css"','href="/'+releasePath+'/local-models.css"').replace('src="/local-models.js"','src="/'+releasePath+'/local-models.js"');
if(branch==='dev') {
 const debugRuntime=path.join('dev-tools','native-runtime');
 const native=developmentNative;
 if(native.compilerControl){
  const control=JSON.parse(await readFile(native.compilerControl.receipt,'utf8'));
  if(createHash('sha256').update(await readFile(native.compilerControl.tool)).digest('hex')!==native.compilerControl.toolSha256)throw new Error('Compiler control tool checksum mismatch');
  if(control.output.sha256!==native.files['compat.wasm'].sha256||control.source.sha256!==native.compilerControl.sourceSha256)throw new Error('Compiler control receipt mismatch');
  execFileSync(process.execPath,['ops/native/compiler-control.mjs','verify',path.join(debugRuntime,'compat.wasm'),native.compilerControl.receipt],{stdio:'pipe'});
 }
 for(const [file,pin] of Object.entries(native.files)){const bytes=await readFile(path.join(debugRuntime,file));if(bytes.length!==pin.bytes||createHash('sha256').update(bytes).digest('hex')!==pin.sha256)throw new Error('Diagnostic runtime checksum mismatch: '+file);await writeFile(path.join(out,releasePath,'runtime/providers/vendor/wllama/v1q',file),bytes);}
 const catalogFile=path.join(out,releasePath,'runtime/providers/catalog.mjs');
 await writeFile(catalogFile,(await readFile(catalogFile,'utf8')).replaceAll(native.catalogBaseBuildId||native.baseBuildId,native.buildId));

 await mkdir(path.join(out,releasePath,'dev-tools'),{recursive:true});
 for(const file of ['start.js','ui.mjs','telemetry-core.mjs','native-journal.mjs'])await cp(path.join('dev-tools',file),path.join(out,releasePath,'dev-tools',file));
 await cp('dev-tools/receiver-worker.js',path.join(out,'_worker.js'));
 await writeFile(path.join(out,'_routes.json'),JSON.stringify({version:1,include:['/api/debug/*','/'+releasePath+'/dev-tools/*','/'+releasePath+'/runtime/providers/vendor/wllama/v1q/*'],exclude:[]}));
 html=html.replace('</head>','<script type="module" src="/'+releasePath+'/dev-tools/start.js"></script></head>');
} else {
 for(const relative of ['local-models.js','runtime/providers/adapters/wllama.mjs']){
 const appFile=path.join(out,releasePath,relative);
 const app=await readFile(appFile,'utf8');
 await writeFile(appFile,app.replace(/\/\* DEV_DIAGNOSTICS_START \*\/[\s\S]*?\/\* DEV_DIAGNOSTICS_END \*\//g,''));
 }
}
await writeFile(path.join(out,'index.html'),html);

await writeFile(path.join(out,'404.html'),'<!doctype html><title>Not found</title><h1>Page not found</h1><a href="/">Open Private Local Chat</a>');
await writeFile(path.join(out,'version.json'),JSON.stringify(build,null,2)+'\n');
await writeFile(path.join(out,'manifest.webmanifest'),JSON.stringify({name:'Private Local Chat',short_name:'Private Local',start_url:'/',display:'standalone',background_color:'#ffffff',theme_color:'#1677ff'}));
await writeFile(path.join(out,'_headers'),'/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n\n/sw.js\n  Cache-Control: no-cache\n\n/build-info.js\n  Cache-Control: no-cache\n\n/version.json\n  Cache-Control: no-cache\n');
const shell=[];
async function walk(dir){for(const ent of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,ent.name);if(ent.isDirectory())await walk(p);else if(!ent.name.startsWith('_'))shell.push('/'+path.relative(out,p).split(path.sep).join('/'));}}
await walk(out);
const template=await readFile('scripts/service-worker.js','utf8');
await writeFile(path.join(out,'sw.js'),template.replace('__CACHE_NAME__',JSON.stringify('plc-shell-'+commit)).replace('__SHELL_FILES__',JSON.stringify(shell)).replace('__DEVELOPMENT_NATIVE__',JSON.stringify(branch==='dev')));
console.log(JSON.stringify({...build,files:shell.length}));
