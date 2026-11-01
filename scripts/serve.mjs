import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('dist');
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.mjs':'application/javascript','.wasm':'application/wasm','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8','.xml':'application/xml'};
// The same way Cloudflare Pages behaves: /help/ serves help/index.html and /help is sent to /help/.
async function isDirectory(file){try{return (await stat(file)).isDirectory();}catch{return false;}}
createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://local');
 const name=decodeURIComponent(url.pathname);
 let p=path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(p!==root&&!p.startsWith(root+path.sep))throw Error('invalid path');
 if(p!==root&&await isDirectory(p)){
  if(!name.endsWith('/')){res.writeHead(308,{Location:name+'/'+url.search});return res.end();}
  p=path.join(p,'index.html');
 }
 const bytes=await readFile(p);
 const type=p===path.join(root,'updates','rss.xml')?'application/rss+xml':mime[path.extname(p)]||'application/octet-stream';
 res.writeHead(200,{'Content-Type':type,'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'});res.end(bytes);
 }catch{res.writeHead(404);res.end('Not found');}
}).listen(Number(process.env.PORT||18171),'127.0.0.1',()=>console.log('Serving http://127.0.0.1:'+(process.env.PORT||18171)));
