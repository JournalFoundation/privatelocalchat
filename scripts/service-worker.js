const CACHE=__CACHE_NAME__;
const SHELL=__SHELL_FILES__;
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  let i=0;
  await Promise.all(Array.from({length:6},async()=>{while(i<SHELL.length){const url=SHELL[i++];const response=await fetch(url,{cache:'reload'});if(!response.ok)throw new Error('Offline asset failed: '+url);await cache.put(url,response);}}));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const name of await caches.keys())if(name.startsWith('plc-shell-')&&name!==CACHE)await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==location.origin)return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  if(event.request.mode==='navigate'){
   try{return await fetch(event.request);}catch{return await cache.match('/index.html')||Response.error();}
  }
  return await cache.match(url.pathname)||fetch(event.request);
 })());
});
