import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('dist');
const mime={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.wasm':'application/wasm','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.txt':'text/plain'};
createServer(async(req,res)=>{
 try{
 const name=decodeURIComponent(new URL(req.url,'http://local').pathname);
 const p=path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!p.startsWith(root+path.sep))throw Error('invalid path');
 const bytes=await readFile(p);
 res.writeHead(200,{'Content-Type':mime[path.extname(p)]||'application/octet-stream','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'});res.end(bytes);
 }catch{res.writeHead(404);res.end('Not found');}
}).listen(Number(process.env.PORT||18171),'127.0.0.1',()=>console.log('Serving http://127.0.0.1:'+(process.env.PORT||18171)));
