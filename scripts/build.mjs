import {cp,readFile,writeFile,readdir,mkdir,rm,rename} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const root=process.cwd(), out=path.join(root,'dist');
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
for(const p of ['index.html','local-models.js','local-models.css','runtime']) await cp(p,path.join(out,p),{recursive:true});
const pkg=JSON.parse(await readFile('package.json','utf8'));
const commit=process.env.GITHUB_SHA || execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const branch=process.env.DEPLOY_BRANCH || process.env.GITHUB_REF_NAME || 'local';
const build={version:pkg.version,commit,branch,environment:branch==='main'?'production':branch==='dev'?'development':'local',builtAt:new Date().toISOString()};
const releasePath='releases/'+commit;
await mkdir(path.join(out,releasePath),{recursive:true});
for(const item of ['local-models.js','local-models.css','runtime']) await rename(path.join(out,item),path.join(out,releasePath,item));
let html=await readFile(path.join(out,'index.html'),'utf8');
html=html.replace('<script src="/build-info.js"></script>','<script>window.APP_BUILD='+JSON.stringify(build)+';</script>');
html=html.replace('href="/local-models.css"','href="/'+releasePath+'/local-models.css"').replace('src="/local-models.js"','src="/'+releasePath+'/local-models.js"');
await writeFile(path.join(out,'index.html'),html);

await writeFile(path.join(out,'404.html'),'<!doctype html><title>Not found</title><h1>Page not found</h1><a href="/">Open Private Local Chat</a>');
await writeFile(path.join(out,'version.json'),JSON.stringify(build,null,2)+'\n');
await writeFile(path.join(out,'manifest.webmanifest'),JSON.stringify({name:'Private Local Chat',short_name:'Private Local',start_url:'/',display:'standalone',background_color:'#ffffff',theme_color:'#1677ff'}));
await writeFile(path.join(out,'_headers'),'/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n\n/sw.js\n  Cache-Control: no-cache\n\n/build-info.js\n  Cache-Control: no-cache\n\n/version.json\n  Cache-Control: no-cache\n');
const shell=[];
async function walk(dir){for(const ent of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,ent.name);if(ent.isDirectory())await walk(p);else if(!ent.name.startsWith('_'))shell.push('/'+path.relative(out,p).split(path.sep).join('/'));}}
await walk(out);
const template=await readFile('scripts/service-worker.js','utf8');
await writeFile(path.join(out,'sw.js'),template.replace('__CACHE_NAME__',JSON.stringify('plc-shell-'+commit)).replace('__SHELL_FILES__',JSON.stringify(shell)));
console.log(JSON.stringify({...build,files:shell.length}));
