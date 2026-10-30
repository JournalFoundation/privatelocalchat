const KEY='plc.downloadIntent.v1';
// A requested download remains pending until inventory proves completion or Cancel.
// Recovery deliberately does not classify the error that interrupted the attempt.
export function createDownloadRecovery({host,storage=localStorage,online=()=>navigator.onLine,onState=()=>{},beforeLoad=async()=>{},schedule=setTimeout,unschedule=clearTimeout,lock=globalThis.navigator?.locks}) {
 let intent=null,timer=null,running=false,failures=0,ready=false;
 try{const saved=JSON.parse(storage.getItem(KEY)||'null');if(saved?.version===1&&['light','default'].includes(saved.tier)&&typeof saved.id==='string')intent=saved;}catch{}
 let remembered=!!intent;
 function persist(value){try{if(value)storage.setItem(KEY,JSON.stringify(value));else storage.removeItem(KEY);remembered=value?JSON.parse(storage.getItem(KEY)||'null')?.id===value.id:storage.getItem(KEY)===null;return remembered;}catch{remembered=false;return false;}}
 let status={pending:!!intent,tier:intent?.tier,phase:intent?'pending':'idle',retryInMs:0,remembered};
 const publish=(phase,retryInMs=0)=>{status={pending:!!intent,tier:intent?.tier,phase,retryInMs,remembered};onState({...status});};
 const clearTimer=()=>{if(timer!==null)unschedule(timer);timer=null;};
 function synchronize(){
  if(!remembered)return;
  try{
   const saved=JSON.parse(storage.getItem(KEY)||'null');
   if(saved?.id===intent?.id)return;
   host.cancelTransfer();clearTimer();
   intent=saved?.version===1&&['light','default'].includes(saved.tier)&&typeof saved.id==='string'?saved:null;
   remembered=!!intent;publish(intent?'pending':'cancelled');
  }catch{} // Keep the in-memory request when the browser cannot read storage.
 }
 function later(ms){clearTimer();if(intent&&ready)timer=schedule(()=>{timer=null;void pump();},ms);}
 async function attempt(){
  synchronize();
  const requested=intent;if(!requested)return;
  const current=()=>intent?.id===requested.id;
  persist(requested);
  let s=host.getState();
  if(s.busy){publish('waiting');later(1000);return;}
  publish('checking');
  try{
   if(s.host.state!=='running')await host.restartHost();
   if(!current())return;
   if(host.getState().selection.tier!==requested.tier)await host.selectTier(requested.tier,{confirmed:true});
   if(!current())return;
   await host.inspect(requested.tier);
   if(!current())return;
   if(!host.getState().tiers[requested.tier].install.ok){
    if(!online()){publish('offline');later(5000);return;}
    publish('downloading');await host.install(requested.tier);
   }
   if(!current())return;
   if(!host.getState().tiers[requested.tier].install.ok)throw Error('Download is still incomplete');
   // Clear durable download intent BEFORE native loading. A load crash must not
   // reconstruct the model repeatedly on subsequent page starts.
   await beforeLoad();
   if(!current())return;
   const cleared=persist(null);intent=null;failures=0;publish('complete');
   if(cleared&&requested.autoLoad!==false){publish('loading');try{await host.load();publish('ready');}catch{publish('load-failed');}}
  }catch(error){
   if(!current())return;
   // Even quota, worker, network and unrecognized failures keep the user's intent.
   // Backoff prevents a tight loop while storage or connectivity is unavailable.
   failures++;const delay=Math.min(60000,1000*2**Math.min(failures-1,6));publish('retrying',delay);later(delay);
  }
 }
 async function pump(){
  if(!ready||!intent||running)return;
  running=true;
  try{
   if(lock?.request)await lock.request('plc:model-download:v1',{ifAvailable:true},async owned=>{if(owned)await attempt();else{publish('another-tab');later(2000);}});
   else await attempt();
  }catch{failures++;const delay=Math.min(60000,1000*2**Math.min(failures-1,6));publish('retrying',delay);later(delay);
  }finally{running=false;if(intent&&timer===null)later(1000);}
 }
 return {
  get state(){return {...status};},
  start(tier){
   if(!['light','default'].includes(tier))throw Error('Unknown model tier');
   if(intent?.tier===tier){persist(intent);failures=0;later(0);return;}
   intent={version:1,id:crypto.randomUUID(),tier,autoLoad:true};persist(intent);failures=0;publish('pending');later(0);
  },
  resume(){ready=true;publish(intent?'pending':'idle');later(0);},
  wake(){if(intent){failures=0;later(0);}},
  synchronize(){synchronize();later(0);},
  cancel(){clearTimer();persist(null);intent=null;failures=0;host.cancelTransfer();publish('cancelled');}
 };
}
