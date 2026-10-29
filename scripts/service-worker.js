const CACHE=__CACHE_NAME__;
const SHELL=__SHELL_FILES__;
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  let i=0;
  await Promise.all(Array.from({length:6},async()=>{while(i<SHELL.length){const url=SHELL[i++];const response=await fetch(url,{cache:'reload'});if(!response.ok)throw new Error('Offline asset failed: '+url);await cache.put(url,new Response(response.body,{status:response.status,statusText:response.statusText,headers:response.headers}));}}));
  self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const previous=(await caches.keys()).filter(name=>name.startsWith('plc-shell-')&&name!==CACHE);
  for(const name of previous.slice(0,-1))await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{if(event.data?.type==='offline-status')event.ports[0]?.postMessage({cache:CACHE});if(event.data?.type==='activate-update')self.skipWaiting();});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==location.origin)return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  if(event.request.mode==='navigate'){
   try{return await fetch(event.request);}catch{const saved=await cache.match('/index.html');return saved?new Response(saved.body,{status:200,headers:saved.headers}):Response.error();}
  }
  return await caches.match(event.request)||fetch(event.request);
 })());
});
