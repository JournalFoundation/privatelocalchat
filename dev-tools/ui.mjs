import {Telemetry} from './telemetry-core.mjs';
import {readCheckpoints} from './native-journal.mjs';
export async function startDiagnostics(){
 if(location.hostname!=='dev.privatelocal.chat')return;
 const panel=document.createElement('details');panel.id='devDiagnostics';panel.innerHTML=`<summary>Development diagnostics</summary><p>Enter a receiver URL to start streaming immediately. It stays on across reloads and restarts. Clear the URL to stop. Conversations and API credentials are excluded.</p><label for="debugReceiver">Diagnostic receiver URL</label><input id="debugReceiver" type="url" placeholder="https://your-receiver.example/session" autocomplete="off"><label><input id="debugDisk" type="checkbox"> Save diagnostics on this device, including airplane mode</label><p>Up to about 5 MB is retained, including native construction checkpoints. Saved events upload after reconnecting and clear only after acknowledgement.</p><div class="model-actions"><button type="button" id="debugSend">Send saved events now</button><button type="button" id="debugExport">Export saved events</button><button type="button" id="debugClear">Clear saved events</button></div><p id="debugStatus" role="status">Enter a receiver URL to enable diagnostics.</p>`;
 document.querySelector('#localModelPanel').after(panel);
 const badge=document.createElement('p');badge.id='debugBadge';badge.setAttribute('role','status');document.querySelector('#modelStatus').after(badge);
 const $=id=>document.getElementById(id);let lastStatus='',generating=false,sampling=false,lastSample=0,lastHeartbeat=0,lastNative='';
 let checkpointTask=null,lastSequence=-1;
 const t=new Telemetry({onStatus:text=>{lastStatus=text;update();}});
 $('debugReceiver').value=t.config.url;$('debugDisk').checked=t.config.disk;
 async function update(){
  const count=await t.count();const mode=t.config.enabled?'ON · '+(t.config.disk?'saving to device':'memory queue only'):'OFF';
  panel.querySelector('summary').textContent='Development diagnostics — '+mode;
  badge.textContent='Diagnostics '+mode+' · '+count+' queued events.';
  $('debugStatus').textContent=lastStatus||'Enter a receiver URL to enable diagnostics.';
 }
 const record=(type,data)=>t.record(type,{version:window.APP_BUILD.version,commit:window.APP_BUILD.commit,...data});
 function applySettings(){
  try{
   const url=$('debugReceiver').value.trim(),changed=url!==t.config.url||$('debugDisk').checked!==t.config.disk;
   t.configure({url,disk:$('debugDisk').checked});
   if(changed&&url){record('diagnostics-configured',{online:navigator.onLine,browser:navigator.userAgent});lastStatus='Streaming is enabled and will resume automatically after reconnecting.';}
   else if(!url)lastStatus='Receiver cleared. Streaming is off; saved events are kept.';
   if(changed&&url&&t.config.disk)checkpoints(true);
   update();
  }catch(e){lastStatus=e.message;update();}
 }
 $('debugReceiver').addEventListener('input',applySettings);
 $('debugReceiver').addEventListener('change',applySettings);
 $('debugDisk').addEventListener('change',applySettings);
 $('debugSend').onclick=()=>{applySettings();t.flush({force:true});};
 $('debugExport').onclick=async()=>{const data=await t.export();const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='private-local-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 $('debugClear').onclick=async()=>{if(confirm('Clear saved diagnostic events? Your chats and models will be kept.')){await t.clear();update();}};
 for(const event of ['online','offline','pageshow','pagehide'])window.addEventListener(event,()=>{record(event,{online:navigator.onLine,visibility:document.visibilityState});if(event==='online')t.flush();});
 document.addEventListener('visibilitychange',()=>record('visibility',{visibility:document.visibilityState}));
 window.addEventListener('error',event=>{let source='';try{source=new URL(event.filename).pathname;}catch{}record('page-error',{errorName:event.error?.name||'Error',source,line:event.lineno,column:event.colno});});
 window.addEventListener('unhandledrejection',event=>record('page-error',{errorName:event.reason?.name||'Error',code:event.reason?.code||'unhandled-rejection'}));
 window.addEventListener('download-recovery',event=>record('download-recovery',event.detail));
 await record('page-start',{online:navigator.onLine,browser:navigator.userAgent,pageRestart:true});
 function checkpoints(recovered=false){
  if(!t.config.enabled||!t.config.disk)return Promise.resolve();
  if(checkpointTask)return checkpointTask;
  checkpointTask=(async()=>{
   try{const records=(await readCheckpoints()).filter(r=>r.sequence>lastSequence).slice(-64);for(const memory of records){await record(recovered?'native-checkpoint-recovered':'native-checkpoint',{memory});lastSequence=memory.sequence;}}
   catch(e){await record('native-journal-unavailable',{code:e.name});}
  })().finally(()=>{checkpointTask=null;});
  return checkpointTask;
 }

 await checkpoints(true);
 const waitUntil=Date.now()+20000;while(!window.localModels&&Date.now()<waitUntil)await new Promise(r=>setTimeout(r,100));
 const host=window.__plcDebugModelHost;if(!host){lastStatus='Model controls did not initialize.';await update();return;}
 const reducedGpuProfile=/iPhone|iPad|iPod/.test(navigator.userAgent);
 if(reducedGpuProfile){const notice=document.createElement('p');notice.textContent='iPhone resource experiment: model layers run on CPU, with some weights still on GPU. Replies may be slower. Existing downloaded files are reused.';panel.querySelector('summary').after(notice);record('compute-profile',{state:'zero-layer-offload',memory:{requestedGpuLayers:0}});}
 const tierConfig=host.tierConfig.bind(host);
 host.tierConfig=(...args)=>{const config=tierConfig(...args);if(config.adapter==='wllama'){config.knobs={...config.knobs,devDiagnostics:t.config.enabled,devDiagnosticsDisk:t.config.enabled&&t.config.disk};if(reducedGpuProfile)config.context={...config.context,n_gpu_layers:0};}return config;};
 async function sample(){
  if(sampling||!t.config.enabled)return;sampling=true;
  try{
   const s=host.getState();await record('runtime-state',{host:s.host.state,load:s.load.state,busy:s.busy,phase:s.load.progress?.phase,loadAttempt:s.load.loadAttempt});
   const stats=await host.provider().stats();await record('runtime-memory',{memory:{runtime:stats.engine?.runtimeMemory,source:stats.engine?.sourceCounters,context:stats.engine?.info?.context,generation:stats.engine?.lastGenerationDiagnostics}});
   if(s.load.state==='loading'){
    const lines=stats.engine?.nativeLinesSample||[],key=JSON.stringify(lines);
    if(key!==lastNative){lastNative=key;await record('native-load-log',{nativeLines:lines});}
   }
  }catch(e){await record('runtime-sample-unavailable',{code:e.code||e.name});}finally{sampling=false;}
 }
 let previous='',lastProgress=0,previousLoadPhase='';
 host.subscribe(s=>{
  if(s.load.progress?.phase!==previousLoadPhase){previousLoadPhase=s.load.progress?.phase;if(previousLoadPhase)record('load-progress',{phase:previousLoadPhase,memory:s.load.progress.memory});}
  const key=[s.host.state,s.load.state,s.busy,s.selection.tier,s.tiers[s.selection.tier].install.state].join('|');
  if(key!==previous){previous=key;record('model-state',{host:s.host.state,load:s.load.state,busy:s.busy,tier:s.selection.tier,state:s.tiers[s.selection.tier].install.state,code:s.lastError?.code});}
  if(s.transfer&&Date.now()-lastProgress>250){lastProgress=Date.now();record('download-progress',{phase:s.transfer.kind,bytesDone:s.transfer.bytesDone,bytesTotal:s.transfer.bytesTotal,filesDone:s.transfer.filesDone,filesTotal:s.transfer.filesTotal});}
 });
 for(const name of ['load','install','repair','remove','restartHost','selectTier']){
  const original=host[name].bind(host);host[name]=async(...args)=>{applySettings();await record(name+'-start',{tier:host.getState().selection.tier});const started=performance.now();try{if(name==='load')await checkpoints(true);const result=await original(...args);if(name==='load')await checkpoints();await record(name+'-complete',{durationMs:Math.round(performance.now()-started)});return result;}catch(e){await record(name+'-failed',{code:e.code||e.name,phase:e.phase,reason:e.reason});throw e;}};
 }
 const original=window.localModels.generate.bind(window.localModels);
 window.localModels.generate=async(messages,options={})=>{
  applySettings();generating=true;const started=performance.now();await record('generation-start',{model:host.getState().load.info?.modelId,online:navigator.onLine});let chunks=0,last=0;
  try{const result=await original(messages,{...options,onToken:text=>{chunks++;options.onToken?.(text);if(chunks===1||Date.now()-last>250){last=Date.now();record(chunks===1?'first-token':'generation-progress',{chunks,characters:text.length,durationMs:Math.round(performance.now()-started)});}}});await record('generation-complete',{durationMs:Math.round(performance.now()-started),characters:result.length,chunks});return result;}
  catch(e){await record(e.name==='AbortError'?'generation-cancelled':'generation-failed',{code:e.code||e.name,phase:e.phase,reason:e.reason,durationMs:Math.round(performance.now()-started)});throw e;}
  finally{generating=false;sample();}
 };
 window.__plcDiagnosticsStarted?.();
 setInterval(async()=>{
  if(!t.config.enabled)return;const s=host.getState(),now=Date.now(),active=Boolean(s.busy)||generating;
  if(now-lastHeartbeat>=(active?250:1000)){lastHeartbeat=now;await record('heartbeat',{host:s.host.state,load:s.load.state,busy:s.busy,phase:generating?'generate':s.busy,online:navigator.onLine,visibility:document.visibilityState,memory:performance.memory?{jsHeapUsed:performance.memory.usedJSHeapSize,jsHeapTotal:performance.memory.totalJSHeapSize}:undefined});}
  if(now-lastSample>=(active?250:1000)){lastSample=now;sample();}
  t.flush();update();
 },250);
 await update();if(t.config.enabled){t.flush();sample();}
}
