import {encodeObject} from './conversation-capture.mjs';
const SETTINGS='plc.dev.telemetry.v1';
const LIMIT=2000;
const allowed=new Set(['model','tier','host','load','busy','phase','state','code','reason','durationMs','characters','chunks','online','visibility','memory','deviceMemoryGB','shaderF16','files','filesDone','filesTotal','bytesDone','bytesTotal','outcome','previousPhase','pageRestart','version','commit','browser','received','saved','lost','quota','usage','loadAttempt','source','line','column','errorName','pending','retryInMs','remembered','nativeBuildId','runtimeVariant','runtimeSha256']);
function numbers(value,depth=0){if(depth>5)return null;if(typeof value==='number')return Number.isFinite(value)?value:null;if(!value||typeof value!=='object')return undefined;const result={};for(const [k,v]of Object.entries(value)){const n=numbers(v,depth+1);if(n!==undefined)result[k.slice(0,80)]=n;}return result;}
export function safeData(data={}){
 const result={};for(const [key,value]of Object.entries(data)){
  if(key==='nativeLines'&&Array.isArray(value)){result.nativeLines=value.filter(line=>typeof line==='string'&&!/prompt|messages|authorization|api.key|content|token.text/i.test(line)).slice(-6).map(line=>line.slice(0,180));continue;}
  if(!allowed.has(key))continue;
  if(key==='memory'){result.memory=numbers(value);continue;}
  if(typeof value==='number'||typeof value==='boolean'||value===null)result[key]=value;
  else if(typeof value==='string')result[key]=value.slice(0,180);
 }return result;
}
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('plc-dev-telemetry',2);req.onupgradeneeded=()=>{const s=req.result.objectStoreNames.contains('events')?req.transaction.objectStore('events'):req.result.createObjectStore('events',{keyPath:'id'});if(!s.indexNames.contains('at'))s.createIndex('at','at');if(!s.indexNames.contains('retention')){s.createIndex('retention',['retention','at']);const cursor=s.openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(c){c.update({...c.value,retention:0});c.continue();}};}};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('Diagnostic database upgrade is blocked by another page'));});}
export class DiskJournal{
 constructor({limit=LIMIT}={}){this.limit=limit;}
 async transaction(mode,fn){const db=await openDB();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('events',mode),store=tx.objectStore('events');let value;fn(store,v=>{value=v;});tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Diagnostic storage aborted'));});}finally{db.close();}}
 async add(event){return this.transaction('readwrite',(store,set)=>{store.put({...event,retention:event.type==='conversation-object'?1:0});const count=store.count();count.onsuccess=()=>{let extra=count.result-this.limit,contentLost=0;if(extra<=0){set({contentLost});return;}const cursor=store.index('retention').openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(c&&extra-->0){if(c.value.type==='conversation-object')contentLost++;c.delete();if(extra>0)c.continue();else set({contentLost});}else set({contentLost});};};});}
 async list(limit=100,{includeContent=true}={}){return this.transaction('readonly',(store,set)=>{const r=includeContent?store.index('at').getAll(null,limit):store.index('retention').getAll(IDBKeyRange.bound([0,''],[0,'\uffff']),limit);r.onsuccess=()=>set(r.result);});}
 async remove(ids){return this.transaction('readwrite',store=>ids.forEach(id=>store.delete(id)));}
 async clear(){return this.transaction('readwrite',store=>store.clear());}
 async count(){return this.transaction('readonly',(store,set)=>{const r=store.count();r.onsuccess=()=>set(r.result);});}
}
export class Telemetry{
 constructor({store=new DiskJournal(),settings=globalThis.localStorage,fetchImpl=(...args)=>fetch(...args),now=()=>Date.now(),onStatus=()=>{}}={}){
  this.store=store;this.settings=settings;this.fetch=fetchImpl;this.now=now;this.onStatus=onStatus;this.memory=[];this.sending=false;this.page=crypto.randomUUID();this.objectSequence=0;this.config={enabled:false,disk:false,url:'',captureContent:false,contentConsent:null,contentDropped:0,remoteControl:false,controlConsent:null};
  try{Object.assign(this.config,JSON.parse(settings?.getItem(SETTINGS)||'{}'));}catch{}
  this.config.enabled=Boolean(this.config.url);
 }
 configure(config){const next={...this.config,...config};if(next.url){const u=new URL(next.url);if(u.protocol!=='https:')throw new Error('The diagnostic receiver must use HTTPS.');}next.enabled=Boolean(next.url);const contentStopped=this.config.captureContent&&!next.captureContent;this.config=next;if(!next.enabled||contentStopped)this.controller?.abort();try{this.settings?.setItem(SETTINGS,JSON.stringify(next));}catch{this.onStatus('Settings could not be saved on this device.');}}
 async refreshPolicy(){
  if(!this.config.enabled||(this.config.contentConsent==='local'&&!this.config.captureContent))return;
  const url=this.config.url,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3000);
  try{const r=await this.fetch(url,{method:'GET',credentials:'omit',signal:controller.signal});if(!r.ok)return;const p=await r.json();if(this.config.url!==url||p.format!=='plc-dev-policy/1')return;if(this.config.contentConsent!=='local'&&(p.captureContent===true||this.config.contentConsent==='receiver'))this.configure({captureContent:p.captureContent===true,contentConsent:'receiver'});if(this.config.controlConsent!=='local'&&(p.remoteControl===true||this.config.controlConsent==='receiver'))this.configure({remoteControl:p.remoteControl===true&&this.config.captureContent,controlConsent:'receiver'});}catch{}finally{clearTimeout(timer);}
 }
 event(type,data){return {id:crypto.randomUUID(),page:this.page,at:new Date(this.now()).toISOString(),elapsedMs:Math.round(performance.now()),type,data};}
 async enqueue(event){
  let lost=0;
  if(this.config.disk){try{lost=(await this.store.add(event))?.contentLost||0;}catch{this.memory.push(event);this.onStatus('Local diagnostic storage is unavailable; unsaved events remain in memory.');}}
  else this.memory.push(event);
  while(this.memory.length>300){let i=this.memory.findIndex(e=>e.type!=='conversation-object'&&e.type!=='capture-loss');if(i<0)i=0;if(this.memory.splice(i,1)[0].type==='conversation-object')lost++;}
  if(lost){this.configure({contentDropped:(this.config.contentDropped||0)+lost});this.memory=this.memory.filter(e=>e.type!=='capture-loss');this.memory.push(this.event('capture-loss',{lost:this.config.contentDropped}));this.onStatus('Conversation diagnostic frames were dropped: '+this.config.contentDropped+'. The saved stream contains gaps.');}
  queueMicrotask(()=>this.flush());
 }
 async recordObject(kind,requestId,object){
  if(!this.config.enabled||!this.config.captureContent)return;
  try{const frames=await encodeObject(kind,requestId,object,this.objectSequence++);for(const frame of frames){if(!this.config.enabled||!this.config.captureContent)return;const event=this.event('conversation-object',frame);if(new TextEncoder().encode(JSON.stringify(event)).length>2048)throw new Error('Conversation frame exceeds event limit');await this.enqueue(event);}return {payloadId:frames[0].payloadId,parts:frames.length,bytes:frames[0].bytes,sha256:frames[0].sha256};}
  catch(e){await this.record('capture-error',{code:e.code||e.name,state:'conversation-object-not-saved'});}
 }
 async record(type,data={}){
  if(!this.config.enabled)return;
  const event={id:crypto.randomUUID(),page:this.page,at:new Date(this.now()).toISOString(),elapsedMs:Math.round(performance.now()),type:String(type).slice(0,64),data:safeData(data)};
  if(new TextEncoder().encode(JSON.stringify(event)).length>2048)event.data={state:'event-metadata-too-large'};
  await this.enqueue(event);
 }
 async flush({force=false}={}){
  if(this.sending){if(force)this.forcePending=true;return;}
  if((!this.config.enabled&&!force)||!this.config.url||globalThis.navigator?.onLine===false)return;
  this.sending=true;
  try{
   for(;;){
    const disk=await this.store.list(50,{includeContent:this.config.captureContent});const events=[...disk,...this.memory].filter(e=>this.config.captureContent||e.type!=='conversation-object').slice(0,50);if(!events.length)break;
    const id=events[0].id+'_'+events.at(-1).id;
    const controller=this.controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
    let response;try{response=await this.fetch(this.config.url,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',body:JSON.stringify({format:'plc-dev-telemetry/1',id,events}),signal:controller.signal});}finally{clearTimeout(timer);}
    if(!response.ok)throw new Error('Receiver HTTP '+response.status);
    const ack=await response.json();if(ack.accepted!==events.length)throw new Error('Receiver did not acknowledge the complete batch');
    const ids=new Set(events.map(e=>e.id));await this.store.remove([...ids]);this.memory=this.memory.filter(e=>!ids.has(e.id));this.onStatus('Uploaded '+events.length+' diagnostic events.');
    if(!this.config.url||(!this.config.enabled&&!force))break;
   }
  }catch(error){this.onStatus('Upload pending: '+error.message+'. Saved events will be retried when online.');}
  finally{this.sending=false;if(this.forcePending){this.forcePending=false;queueMicrotask(()=>this.flush({force:true}));}}
 }
 async count(){return (await this.store.count().catch(()=>0))+this.memory.length;}
 async export(){return {format:'plc-dev-telemetry/1',events:[...await this.store.list(LIMIT).catch(()=>[]),...this.memory]};}
 async clear(){await this.store.clear();this.memory=[];}
}
