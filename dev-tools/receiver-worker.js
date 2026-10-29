const HOST='dev.privatelocal.chat';
const uuid=/^[a-f0-9-]{36}$/;
const headers=origin=>({'Content-Type':'application/json','Cache-Control':'no-store',...(origin==='https://'+HOST?{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}:{})});
const json=(value,status=200,origin)=>new Response(JSON.stringify(value),{status,headers:headers(origin)});
const authorized=(request,env)=>Boolean(env.DEBUG_READ_TOKEN)&&request.headers.get('Authorization')==='Bearer '+env.DEBUG_READ_TOKEN;
export default {
 async fetch(request,env){
  const url=new URL(request.url),origin=request.headers.get('Origin');
  if(url.pathname.includes('/dev-tools/'))return url.hostname===HOST?env.ASSETS.fetch(request):json({error:'Not found'},404);
  if(!url.pathname.startsWith('/api/debug/'))return env.ASSETS.fetch(request);
  if(url.hostname!==HOST||!env.DEBUG_LOGS)return json({error:'Not found'},404);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:headers(origin)});
  try{
   if(url.pathname==='/api/debug/admin/sessions'&&request.method==='POST'){
    if(!authorized(request,env))return json({error:'Unauthorized'},401);
    const id=crypto.randomUUID(),createdAt=new Date().toISOString();
    await env.DEBUG_LOGS.put('control/'+id+'.json',JSON.stringify({id,createdAt}));
    return json({id,receiver:'https://'+HOST+'/api/debug/'+id,createdAt});
   }
   const admin=/^\/api\/debug\/admin\/sessions\/([a-f0-9-]+)$/.exec(url.pathname);
   if(admin&&request.method==='DELETE'){if(!authorized(request,env))return json({error:'Unauthorized'},401);await env.DEBUG_LOGS.put('control/'+admin[1]+'.json',JSON.stringify({disabled:true}));return json({disabled:true});}
   if(admin&&request.method==='GET'){
    if(!authorized(request,env))return json({error:'Unauthorized'},401);
    const id=admin[1];if(!uuid.test(id))return json({error:'Invalid session'},400);
    const events=new Map();
    const listed=await env.DEBUG_LOGS.list({prefix:'events/'+id+'/',limit:100,cursor:url.searchParams.get('cursor')||undefined});
    for(let offset=0;offset<listed.objects.length;offset+=10){
     const batches=await Promise.all(listed.objects.slice(offset,offset+10).map(async item=>{const object=await env.DEBUG_LOGS.get(item.key);return object?object.json():null;}));
     for(const batch of batches)for(const event of batch?.events||[])events.set(event.id,event);
    }
    return json({id,events:[...events.values()].sort((a,b)=>a.at.localeCompare(b.at)),cursor:listed.truncated?listed.cursor:null});
   }
   const match=/^\/api\/debug\/([a-f0-9-]+)$/.exec(url.pathname);
   if(!match||request.method!=='POST'||!uuid.test(match[1]))return json({error:'Not found'},404,origin);
   if(origin!=='https://'+HOST)return json({error:'Origin not allowed'},403,origin);
   const control=await env.DEBUG_LOGS.get('control/'+match[1]+'.json');
   if(!control||(await control.json()).disabled===true)return json({error:'Debug session is missing or disabled'},403,origin);
   if(Number(request.headers.get('Content-Length'))>131072)return json({error:'Batch too large'},413,origin);
   const raw=await request.text();if(new TextEncoder().encode(raw).length>131072)return json({error:'Batch too large'},413,origin);
   const batch=JSON.parse(raw);
   if(batch.format!=='plc-dev-telemetry/1'||!Array.isArray(batch.events)||batch.events.length>100||!/^[a-f0-9_-]{20,100}$/.test(batch.id))return json({error:'Invalid batch'},400,origin);
   for(const event of batch.events){if(!uuid.test(event.id)||typeof event.type!=='string'||typeof event.at!=='string'||typeof event.data!=='object')return json({error:'Invalid event'},400,origin);}
   await env.DEBUG_LOGS.put('events/'+match[1]+'/'+batch.id+'.json',JSON.stringify({receivedAt:new Date().toISOString(),...batch}),{httpMetadata:{contentType:'application/json'}});
   return json({accepted:batch.events.length},202,origin);
  }catch{return json({error:'Invalid diagnostic request'},400,origin);}
 }
};
