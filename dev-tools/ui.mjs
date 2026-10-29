import {Telemetry} from './telemetry-core.mjs';
export async function startDiagnostics(){
 if(location.hostname!=='dev.privatelocal.chat')return;
 const panel=document.createElement('details');panel.id='devDiagnostics';panel.innerHTML=`<summary>Development diagnostics</summary><p>Optional diagnostics record app state, errors and timing, without conversations or API credentials.</p><label for="debugReceiver">Diagnostic receiver URL</label><input id="debugReceiver" type="url" placeholder="https://your-receiver.example/session" autocomplete="off"><label><input id="debugDisk" type="checkbox"> Save diagnostics on this device, including airplane mode</label><p>Up to about 4 MB is retained. Saved events upload after reconnecting; the queue is cleared only after acknowledgement.</p><div class="model-actions"><button type="button" id="debugStart">Start diagnostics</button><button type="button" id="debugStop">Stop diagnostics</button><button type="button" id="debugSend">Send saved events</button><button type="button" id="debugExport">Export saved events</button><button type="button" id="debugClear">Clear saved events</button></div><p id="debugStatus" role="status">Diagnostics are off.</p>`;
 document.querySelector('#localModelPanel').after(panel);
 const $=id=>document.getElementById(id);let lastStatus='';
 const t=new Telemetry({onStatus:text=>{lastStatus=text;update();}});
 $('debugReceiver').value=t.config.url;$('debugDisk').checked=t.config.disk;
 async function update(){const count=await t.count();$('debugStatus').textContent=(t.config.enabled?'Diagnostics on. ':'Diagnostics off. ')+count+' queued events. '+lastStatus;}
 const record=(type,data)=>t.record(type,{version:window.APP_BUILD.version,commit:window.APP_BUILD.commit,...data});
 $('debugStart').onclick=async()=>{try{t.configure({enabled:true,disk:$('debugDisk').checked,url:$('debugReceiver').value.trim()});await record('diagnostics-start',{online:navigator.onLine,browser:navigator.userAgent});await update();await t.flush();}catch(e){lastStatus=e.message;update();}};
 $('debugStop').onclick=async()=>{await record('diagnostics-stop');t.configure({enabled:false});update();};
 $('debugSend').onclick=()=>t.flush({force:true});
 $('debugExport').onclick=async()=>{const data=await t.export();const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='private-local-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 $('debugClear').onclick=async()=>{if(confirm('Clear saved diagnostic events? Your chats and models will be kept.')){await t.clear();update();}};
 for(const event of ['online','offline','pageshow','pagehide'])window.addEventListener(event,()=>{record(event,{online:navigator.onLine,visibility:document.visibilityState});if(event==='online')t.flush();});
 document.addEventListener('visibilitychange',()=>record('visibility',{visibility:document.visibilityState}));
 window.addEventListener('error',()=>record('page-error',{code:'uncaught-error'}));
 window.addEventListener('unhandledrejection',()=>record('page-error',{code:'unhandled-rejection'}));
 await record('page-start',{online:navigator.onLine,browser:navigator.userAgent,pageRestart:true});
 const waitUntil=Date.now()+20000;while(!window.localModels&&Date.now()<waitUntil)await new Promise(r=>setTimeout(r,100));
 const host=window.__plcDebugModelHost;if(!host){lastStatus='Model controls did not initialize.';await update();return;}
 let previous='',lastProgress=0;
 host.subscribe(s=>{
  const key=[s.host.state,s.load.state,s.busy,s.selection.tier,s.tiers[s.selection.tier].install.state].join('|');
  if(key!==previous){previous=key;record('model-state',{host:s.host.state,load:s.load.state,busy:s.busy,tier:s.selection.tier,state:s.tiers[s.selection.tier].install.state,code:s.lastError?.code});}
  if(s.transfer&&Date.now()-lastProgress>2000){lastProgress=Date.now();record('download-progress',{bytesDone:s.transfer.bytesDone,bytesTotal:s.transfer.bytesTotal,filesDone:s.transfer.filesDone,filesTotal:s.transfer.filesTotal});}
 });
 for(const name of ['load','install','repair','remove','restartHost','selectTier']){
  const original=host[name].bind(host);host[name]=async(...args)=>{await record(name+'-start',{tier:host.getState().selection.tier});const started=performance.now();try{const result=await original(...args);await record(name+'-complete',{durationMs:Math.round(performance.now()-started)});return result;}catch(e){await record(name+'-failed',{code:e.code||e.name,phase:e.phase,reason:e.reason});throw e;}};
 }
 const original=window.localModels.generate.bind(window.localModels);
 window.localModels.generate=async(messages,options={})=>{
  const started=performance.now();await record('generation-start',{model:host.getState().load.info?.modelId,online:navigator.onLine});let chunks=0,last=0;
  try{const result=await original(messages,{...options,onToken:text=>{chunks++;options.onToken?.(text);if(chunks===1||Date.now()-last>1000){last=Date.now();record(chunks===1?'first-token':'generation-progress',{chunks,characters:text.length,durationMs:Math.round(performance.now()-started)});}}});await record('generation-complete',{durationMs:Math.round(performance.now()-started),characters:result.length,chunks});return result;}
  catch(e){await record(e.name==='AbortError'?'generation-cancelled':'generation-failed',{code:e.code||e.name,phase:e.phase,reason:e.reason,durationMs:Math.round(performance.now()-started)});throw e;}
  finally{try{const stats=await host.provider().stats();await record('runtime-memory',{memory:stats.runtimeMemory});}catch{}}
 };
 setInterval(async()=>{if(!t.config.enabled)return;const s=host.getState();await record('heartbeat',{host:s.host.state,load:s.load.state,busy:s.busy,online:navigator.onLine,visibility:document.visibilityState,memory:performance.memory?{jsHeapUsed:performance.memory.usedJSHeapSize,jsHeapTotal:performance.memory.totalJSHeapSize}:undefined});await t.flush();update();},3000);
 await update();if(t.config.enabled)t.flush();
}
