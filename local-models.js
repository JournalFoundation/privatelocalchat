import {createDownloadRecovery} from './runtime/download-recovery.mjs';
import {createOfflineStatusProbe} from './runtime/offline-status.mjs';
import {createModelHost} from './runtime/providers/model-host.mjs';
import {gatherEnv} from './runtime/providers/capability-probe.mjs';

const $ = id => document.getElementById(id);
const base = 'https://assets.privatelocal.chat/models/';
const variants = {q4f16_1:'c7c5d3f5a81e37b8facbb72970940a1b131314a8',q4f32_1:'f8f042bfb68cb88573af4c8e0ef9b1a26bef4ad0'};
const webllm = Object.fromEntries(Object.entries(variants).map(([v,r]) => [v,base+'Qwen3.5-9B-'+v+'-MLC/resolve/'+r+'/']));
const host = createModelHost({sources:{webllmModelBase:webllm,webllmLibBase:webllm,wllamaModelBase:base+'Qwen3.5-2B/15852e8c16360a2fea060d615a32b45270f8a8fc/'}});
/* DEV_DIAGNOSTICS_START */
window.__plcDebugModelHost=host;
let diagnosticsStarted;
const diagnosticsReady=new Promise(resolve=>{diagnosticsStarted=resolve;});
window.__plcDiagnosticsStarted=diagnosticsStarted;
/* DEV_DIAGNOSTICS_END */
let state, env, downloadRecovery, activeGeneration = false;
let resetPromptAfterAbort=false;
const modeKey = 'plc.inferenceMode.v1';
let existingApi = false;
try {existingApi = Boolean(JSON.parse(sessionStorage.getItem('chatConfig') || '{}').endpoint);} catch {}
let mode = existingApi ? 'api' : 'local';
try {mode=localStorage.getItem(modeKey)||mode;} catch(e) {console.warn('Mode storage unavailable:',e.name);}
if (!['local','api'].includes(mode)) mode = 'local';
const gb = n => (n/1e9).toFixed(2)+' GB';
const notify = () => window.dispatchEvent(new Event('local-model-state'));
function showError(error) {
  $('modelStatus').textContent = (error?.message || String(error)) + (error?.advice ? ' '+error.advice : ' Try Verify / repair or reload the model.');
  $('modelStatus').dataset.error = 'true';
}
function render(s) {
  state = s;
  if(s.device) env=s.device;
  const tier=s.selection.tier, item=s.tiers[tier], t=s.transfer;
  $('localModelSelect').value=tier;
  $('modelDetails').textContent=gb(item.info.downloadBytes)+' download · '+gb(item.info.memory.steadyBytes)+' estimated working memory. '+(tier==='default'?'Requires a capable GPU; larger memory use.':'Smaller model; lower memory use.');
  $('modelStatus').dataset.error='false';
  if(s.busy) $('modelStatus').textContent=t ? `${s.busy}: ${gb(t.bytesDone || 0)} / ${gb(t.bytesTotal || item.info.downloadBytes)}${t.bytesKept ? ' · '+gb(t.bytesKept)+' already saved' : ''}` : s.busy+'…';
  else if(s.lastError) showError(s.lastError);
  else if(s.load.state==='ready') $('modelStatus').textContent='Ready — replies run on this device.';
  else $('modelStatus').textContent=item.install.ok?'Model files are downloaded. Load the model into memory for this page session.':`Download: ${item.install.state}. Model: ${s.load.state}.`;
  if(s.busy&&t?.phase==='retry-wait') $('modelStatus').textContent+=` · Retrying download ${t.retryAttempt}/${t.retryLimit} in ${t.retryDelayMs/1000}s. Saved files are kept.`;
  const ready=s.load.state==='ready';
  const supported=!!env?.webgpu.available && (tier!=='light'||env.webgpu.shaderF16);
  if(env&&!supported&&!s.busy) showError(new Error(tier==='light'?'The 2B runtime needs GPU shader-f16 support. This browser does not expose it. Choose the 9B model if this device has enough memory, or explicitly choose API mode.':'WebGPU is unavailable in this browser.'));
  $('modelProgress').hidden=!t;
  if(t) $('modelProgress').value=(t.bytesDone || 0)/Math.max(1,t.bytesTotal || 1);
  $('downloadModel').disabled=!supported||Boolean(s.busy)||activeGeneration||item.install.ok===true;
  $('loadModel').disabled=!supported||Boolean(s.busy)||activeGeneration||item.install.ok!==true||ready;
  $('repairModel').disabled=Boolean(s.busy)||activeGeneration;
  $('restartModel').disabled=Boolean(s.busy)||activeGeneration;
  $('removeModel').disabled=Boolean(s.busy)||activeGeneration;
  $('localModelSelect').disabled=Boolean(s.busy)||activeGeneration;
  $('inferenceMode').disabled=Boolean(s.busy)||activeGeneration;
  $('reloadApp').disabled=Boolean(s.busy)||activeGeneration;
  const recovery=downloadRecovery?.state;
  $('cancelModel').hidden=!['install','repair'].includes(s.busy)&&!recovery?.pending;
  if(recovery?.pending&&!s.busy)$('modelStatus').textContent+=(recovery.phase==='offline'?' · Download will continue when connected.':' · Download will continue automatically; completed files are kept.');
  if(recovery?.pending&&!recovery.remembered)$('modelStatus').textContent+=' Keep this page open: the browser could not save the download request yet.';
  $('localModelSelect').disabled||=!!recovery?.pending;
  $('inferenceMode').disabled||=!!recovery?.pending;
  $('loadModel').disabled||=!!recovery?.pending;
  const quality=$('localModelSelect').querySelector('[value="default"]');
  quality.disabled=!env?.webgpu.available || (env.deviceMemoryGB !== null && env.deviceMemoryGB < 8) || /iPhone|iPad|iPod|Android/.test(navigator.userAgent);
  $('modelDiagnostics').textContent=JSON.stringify({device:env,selection:s.selection,variant:s.variant,storage:s.storage,host:s.host,load:s.load,lastError:s.lastError},null,2);
  notify();
}
function applyMode() {
  $('inferenceMode').value=mode;
  $('localModelPanel').hidden=mode!=='local';
  $('apiSettings').hidden=mode!=='api';
  try {localStorage.setItem(modeKey,mode);} catch(e) {showError(new Error('The browser cannot save settings: '+e.name));}
  notify();
}
async function action(fn) {try {await fn();} catch(e) {showError(e);} }
downloadRecovery=createDownloadRecovery({host,
/* DEV_DIAGNOSTICS_START */
 beforeLoad:()=>new Promise(resolve=>{const timeout=setTimeout(resolve,5000);diagnosticsReady.then(()=>{clearTimeout(timeout);resolve();});}),
/* DEV_DIAGNOSTICS_END */
 onState:detail=>{if(state)render(host.getState());
/* DEV_DIAGNOSTICS_START */
 window.dispatchEvent(new CustomEvent('download-recovery',{detail}));
/* DEV_DIAGNOSTICS_END */
 }});
/* DEV_DIAGNOSTICS_START */
window.__plcDebugDownloadControl = action => {
  if (action === 'cancel-download') {
    const cancelled = downloadRecovery.state.pending;
    if (cancelled) downloadRecovery.cancel();
    return {cancelled,recovery:downloadRecovery.state};
  }
  if (action !== 'download' || mode !== 'local' || activeGeneration) throw new Error('Model downloading is unavailable now');
  const current = host.getState();
  if (current.tiers[current.selection.tier].install.ok) return {requested:false,installed:true,recovery:downloadRecovery.state};
  if (current.busy && !downloadRecovery.state.pending) throw new Error('A model operation is already running');
  downloadRecovery.start(current.selection.tier);
  return {requested:true,installed:false,recovery:downloadRecovery.state};
};
/* DEV_DIAGNOSTICS_END */
window.addEventListener('online',()=>downloadRecovery.wake());
window.addEventListener('pageshow',()=>downloadRecovery.synchronize());
window.addEventListener('storage',event=>{if(event.key==='plc.downloadIntent.v1')downloadRecovery.synchronize();});
window.localModels={
  get downloadRecovery(){return downloadRecovery.state;},
  get mode(){return mode;},
  get ready(){return state?.load.state==='ready';},
  get installed(){return state?.tiers[state.selection.tier].install.ok===true;},
  get state(){return state;},
  async generate(messages,{signal,onToken}={}) {
    if(mode!=='local'||state?.load.state!=='ready') throw new Error('Load an on-device model before sending.');
    activeGeneration=true; render(state);
    try {
      let streamed="";
      const call=host.provider().generate({attemptId:crypto.randomUUID(),messages:messages.filter(m=>m.role!=='system'||m.content).map(m=>({role:m.role,content:m.content})),temperature:0.6,cachePrompt:!resetPromptAfterAbort},{signal,onToken:ev=>{streamed+=ev.text;onToken?.(streamed);}});
      resetPromptAfterAbort=false;
      const end=await call.done;
      if(end.type==='attempt-aborted') throw Object.assign(new DOMException('Generation stopped.','AbortError'),{partialText:streamed});
      if(end.type!=='attempt-completed') throw Object.assign(new Error(end.error?.message || 'Model generation failed.'),end.error);
      return end.text;
    } catch(e) {if(e.name==='AbortError')resetPromptAfterAbort=true;throw e;} finally {activeGeneration=false;render(host.getState());}
  }
};
$('reloadApp').addEventListener('click',()=>{try {sessionStorage.setItem('plc.draft',document.querySelector('#messageInput').value);location.reload();}catch(e){showError(new Error('Copy your message draft before reloading; browser storage is unavailable.'));}});
try {const draft=sessionStorage.getItem('plc.draft');if(draft){document.querySelector('#messageInput').value=draft;sessionStorage.removeItem('plc.draft');}} catch {}
$('inferenceMode').addEventListener('change',()=>{mode=$('inferenceMode').value;applyMode();});
$('localModelSelect').addEventListener('change',()=>action(()=>host.selectTier($('localModelSelect').value,{confirmed:true})));
$('downloadModel').addEventListener('click',()=>action(()=>downloadRecovery.start(host.getState().selection.tier)));
$('loadModel').addEventListener('click',()=>action(()=>host.load()));
$('cancelModel').addEventListener('click',()=>downloadRecovery.cancel());
$('restartModel').addEventListener('click',()=>action(async()=>{await host.restartHost();await host.inspect();}));
$('repairModel').addEventListener('click',()=>{downloadRecovery.cancel();action(()=>host.repair());});
$('removeModel').addEventListener('click',()=>{if(confirm('Remove this downloaded model? Your conversations will be kept.')){downloadRecovery.cancel();action(()=>host.remove(undefined,{confirmed:true}));}});
$('persistModels').addEventListener('click',()=>action(()=>host.requestPersist()));
$('releaseInfo').textContent=`${window.APP_BUILD?.environment || 'local'} · ${window.APP_BUILD?.version || 'development'} · ${window.APP_BUILD?.commit?.slice(0,12) || 'unbuilt'}`;
applyMode();
if('serviceWorker' in navigator) {
  const checkOffline=createOfflineStatusProbe({
    getController:()=>navigator.serviceWorker.controller,
    expectedCache:'plc-shell-'+window.APP_BUILD.commit,
    onResult:current=>{
      $('offlineStatus').textContent=current?'Offline app ready. Downloaded models can be loaded without a connection.':'An updated app is ready. Reload while online before the offline test.';
      $('reloadApp').hidden=current;
    }
  });
  navigator.serviceWorker.addEventListener('controllerchange',checkOffline);
  navigator.serviceWorker.register('/sw.js').then(registration=>{
    const activate = worker=>worker?.postMessage({type:'activate-update'});
    activate(registration.waiting);
    registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed')activate(worker);});});
    checkOffline();
  }).catch(e=>showError(new Error('Offline app setup failed: '+e.message)));
} else $('offlineStatus').textContent='This browser cannot install the app for offline use.';
try {
  env=await gatherEnv();
  host.subscribe(render);
  await host.init({autoLoad:false});
  if(!env.webgpu.available) showError(new Error('This runtime needs WebGPU. Update your browser or explicitly choose API mode.'));
} catch(e){showError(e);} finally {downloadRecovery.resume();}