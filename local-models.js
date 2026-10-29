import {createModelHost} from './runtime/providers/model-host.mjs';
import {gatherEnv} from './runtime/providers/capability-probe.mjs';

const $ = id => document.getElementById(id);
const base = 'https://assets.privatelocal.chat/models/';
const variants = {q4f16_1:'c7c5d3f5a81e37b8facbb72970940a1b131314a8',q4f32_1:'f8f042bfb68cb88573af4c8e0ef9b1a26bef4ad0'};
const webllm = Object.fromEntries(Object.entries(variants).map(([v,r]) => [v,base+'Qwen3.5-9B-'+v+'-MLC/resolve/'+r+'/']));
const host = createModelHost({sources:{webllmModelBase:webllm,webllmLibBase:webllm,wllamaModelBase:base+'Qwen3.5-2B/15852e8c16360a2fea060d615a32b45270f8a8fc/'}});
let state, env, activeGeneration = false;
const reportKey = 'plc.diagnostic.generations.v1';
let generations = [];
try {generations=JSON.parse(localStorage.getItem(reportKey)||'[]');} catch {}
const pageSession = crypto.randomUUID();
const saveGeneration = entry => {generations.push(entry);generations=generations.slice(-10);try {localStorage.setItem(reportKey,JSON.stringify(generations));} catch(e) {console.warn('Diagnostic storage unavailable:',e.name);}};
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
  const tier=s.selection.tier, item=s.tiers[tier], t=s.transfer;
  $('localModelSelect').value=tier;
  $('modelDetails').textContent=gb(item.info.downloadBytes)+' download · '+gb(item.info.memory.steadyBytes)+' estimated working memory. '+(tier==='default'?'Requires a capable GPU; larger memory use.':'Smaller model; lower memory use.');
  $('modelStatus').dataset.error='false';
  if(s.busy) $('modelStatus').textContent=t ? `${s.busy}: ${gb(t.bytesDone || 0)} / ${gb(t.bytesTotal || item.info.downloadBytes)}${t.bytesKept ? ' · '+gb(t.bytesKept)+' already saved' : ''}` : s.busy+'…';
  else if(s.lastError) showError(s.lastError);
  else if(s.load.state==='ready') $('modelStatus').textContent='Ready — replies run on this device.';
  else $('modelStatus').textContent=`Download: ${item.install.state}. Model: ${s.load.state}.`;
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
  $('cancelModel').hidden=!['install','repair'].includes(s.busy);
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
window.localModels={
  get mode(){return mode;},
  get ready(){return state?.load.state==='ready';},
  get state(){return state;},
  async generate(messages,{signal,onToken}={}) {
    if(mode!=='local'||state?.load.state!=='ready') throw new Error('Load an on-device model before sending.');
    activeGeneration=true; render(state);
    const receipt={pageSession,startedAt:new Date().toISOString(),model:state.load.info?.modelId || state.selection.tier,browserReportedOnline:navigator.onLine,build:window.APP_BUILD};
    try {
      let streamed="";
      const call=host.provider().generate({attemptId:crypto.randomUUID(),messages:messages.filter(m=>m.role!=='system'||m.content).map(m=>({role:m.role,content:m.content})),maxTokens:512,temperature:0.6},{signal,onToken:ev=>{streamed+=ev.text;onToken?.(streamed);}});
      const end=await call.done;
      if(end.type==='attempt-aborted') throw new DOMException('Generation stopped.','AbortError');
      if(end.type!=='attempt-completed') throw Object.assign(new Error(end.error?.message || 'Model generation failed.'),end.error);
      saveGeneration({...receipt,completedAt:new Date().toISOString(),result:"completed"});
      return end.text;
    } catch(e) {saveGeneration({...receipt,completedAt:new Date().toISOString(),result:e.name==='AbortError'?'cancelled':'failed',error:e.message});throw e;} finally {activeGeneration=false;render(host.getState());}
  }
};
$('reloadApp').addEventListener('click',()=>{try {sessionStorage.setItem('plc.draft',document.querySelector('#messageInput').value);location.reload();}catch(e){showError(new Error('Copy your message draft before reloading; browser storage is unavailable.'));}});
try {const draft=sessionStorage.getItem('plc.draft');if(draft){document.querySelector('#messageInput').value=draft;sessionStorage.removeItem('plc.draft');}} catch {}
$('copyModelReport').addEventListener('click',()=>{
  const report={format:'privatelocalchat-diagnostic/1',at:new Date().toISOString(),build:window.APP_BUILD,userAgent:navigator.userAgent,capability:env,selection:state?.selection,installation:state?.tiers[state.selection.tier].install,load:state?.load,generations};
  navigator.clipboard.writeText(JSON.stringify(report,null,2)).then(()=>{$('modelStatus').textContent='Diagnostic report copied. It contains no conversations or API credentials.';},()=>showError(new Error('Clipboard unavailable. Open Device and storage details to view diagnostics.')));
});
$('inferenceMode').addEventListener('change',()=>{mode=$('inferenceMode').value;applyMode();});
$('localModelSelect').addEventListener('change',()=>action(()=>host.selectTier($('localModelSelect').value,{confirmed:true})));
$('downloadModel').addEventListener('click',()=>action(()=>host.install()));
$('loadModel').addEventListener('click',()=>action(()=>host.load()));
$('cancelModel').addEventListener('click',()=>host.cancelTransfer());
$('restartModel').addEventListener('click',()=>action(async()=>{await host.restartHost();await host.inspect();}));
$('repairModel').addEventListener('click',()=>action(()=>host.repair()));
$('removeModel').addEventListener('click',()=>{if(confirm('Remove this downloaded model? Your conversations will be kept.'))action(()=>host.remove(undefined,{confirmed:true}));});
$('persistModels').addEventListener('click',()=>action(()=>host.requestPersist()));
$('releaseInfo').textContent=`${window.APP_BUILD?.environment || 'local'} · ${window.APP_BUILD?.version || 'development'} · ${window.APP_BUILD?.commit?.slice(0,12) || 'unbuilt'}`;
applyMode();
try {
  env=await gatherEnv();
  host.subscribe(render);
  await host.init({autoLoad:false});
  if(!env.webgpu.available) showError(new Error('This runtime needs WebGPU. Update your browser or explicitly choose API mode.'));
} catch(e){showError(e);}
if('serviceWorker' in navigator) {
  const checkOffline = () => {
    const worker=navigator.serviceWorker.controller;
    if(!worker)return;
    const channel=new MessageChannel();
    channel.port1.onmessage=event=>{
      const current=event.data.cache==='plc-shell-'+window.APP_BUILD.commit;
      $('offlineStatus').textContent=current?'Offline app ready. Downloaded models can be loaded without a connection.':'An updated app is ready. Reload while online before the offline test.';
      $('reloadApp').hidden=current;
      channel.port1.close();
    };
    worker.postMessage({type:'offline-status'},[channel.port2]);
  };
  navigator.serviceWorker.addEventListener('controllerchange',checkOffline);
  navigator.serviceWorker.register('/sw.js').then(registration=>{
    const activate = worker=>worker?.postMessage({type:'activate-update'});
    activate(registration.waiting);
    registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed')activate(worker);});});
    checkOffline();
  }).catch(e=>showError(new Error('Offline app setup failed: '+e.message)));
} else $('offlineStatus').textContent='This browser cannot install the app for offline use.';

