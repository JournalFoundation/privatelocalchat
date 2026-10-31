const CACHE=__CACHE_NAME__;
const DEVELOPMENT_NATIVE=__DEVELOPMENT_NATIVE__;
const SHELL=__SHELL_FILES__.filter(file=>location.hostname==='dev.privatelocal.chat'||(!file.includes('/dev-tools/')&&(!DEVELOPMENT_NATIVE||!file.includes('/runtime/providers/vendor/wllama/v1q/'))));
__DEV_OFFLINE_FAULT__
// The small files the app needs to start are required; the multi-megabyte model runtimes are cached too, but a phone that cannot finish
// them must not be left running an old version forever, so they never block an update (they are also cached as they are first used).
const isBulk=file=>/\/vendor\/(wllama|webllm)\//.test(file);
async function cacheFile(cache,url){
  const response=await fetch(url,{cache:'reload'});
  if(!response.ok)throw new Error('Offline asset failed: '+url);
  await cache.put(url,new Response(response.body,{status:response.status,statusText:response.statusText,headers:response.headers}));
}
async function cacheAll(cache,files,{strict,workers}){
  let i=0;
  await Promise.all(Array.from({length:workers},async()=>{while(i<files.length){const url=files[i++];try{await cacheFile(cache,url);}catch(error){if(strict)throw error;try{await cacheFile(cache,url);}catch{/* cached when first used */}}}}));
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await cacheAll(cache,SHELL.filter(file=>!isBulk(file)),{strict:true,workers:6});
  self.skipWaiting();
  await cacheAll(cache,SHELL.filter(isBulk),{strict:false,workers:2});
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const previous=(await caches.keys()).filter(name=>name.startsWith('plc-shell-')&&name!==CACHE);
  for(const name of previous.slice(0,-1))await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{if(event.data?.type==='offline-status')event.ports[0]?.postMessage({cache:CACHE});if(event.data?.type==='activate-update')self.skipWaiting();});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 /* DEV_DIAGNOSTICS_START */
 if(location.hostname==='dev.privatelocal.chat'){
  event.respondWith((async()=>await developmentOfflineResponse(event,url)||normalResponse(event,url))());return;
 }
 /* DEV_DIAGNOSTICS_END */
 if(event.request.method!=='GET'||url.origin!==location.origin)return;
 event.respondWith(normalResponse(event,url));
});
async function normalResponse(event,url){
  if(event.request.method!=='GET'||url.origin!==location.origin)return fetch(event.request);
  const cache=await caches.open(CACHE);
  if(event.request.mode==='navigate'){
   try{return await fetch(event.request);}catch{const saved=await cache.match('/index.html');return saved?new Response(saved.body,{status:200,headers:saved.headers}):Response.error();}
  }
  const saved=await cache.match(event.request)||(url.pathname.startsWith('/releases/')?await caches.match(event.request):undefined); // a page from the previous version may still be open
  if(saved)return saved;
  const response=await fetch(event.request);
  if(response.status===200&&response.type==='basic'&&/^\/(releases|brand)\//.test(url.pathname))try{await cache.put(event.request,response.clone());}catch{/* storage full: served from the network */}
  return response;
}
