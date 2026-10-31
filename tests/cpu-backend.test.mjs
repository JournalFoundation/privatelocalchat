import test from 'node:test';
import assert from 'node:assert/strict';
import {pickTier,lightBackend,cpuBackendSupport,gpuRunsLight} from '../runtime/auto-tier.mjs';
import {wasmSupport} from '../runtime/providers/capability-probe.mjs';
import {loadConfigFor} from '../runtime/providers/catalog.mjs';
import {createModelHost} from '../runtime/providers/model-host.mjs';
import {preflight} from '../runtime/providers/adapters/wllama.mjs';
const DESK='Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0',IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',MAC='Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari';
const WASM={available:true,simd:true};
const NO_GPU={webgpu:{available:false,hasApi:false},wasm:WASM,deviceMemoryGB:8};
test('without a usable graphics card the small model runs on the processor, where that is possible',()=>{
 assert.deepEqual(pickTier({env:NO_GPU,userAgent:DESK}),{tier:'light',backend:'cpu',reason:'no-gpu-cpu'});
 assert.equal(pickTier({env:{...NO_GPU,webgpu:{available:true,isFallbackAdapter:true,shaderF16:true}},userAgent:DESK}).backend,'cpu','a software renderer is slower than the processor');
 assert.equal(pickTier({env:{...NO_GPU,deviceMemoryGB:null},userAgent:DESK}).backend,'cpu','memory unknown (Firefox, Safari)');
 // the larger model is never run on the processor
 assert.equal(pickTier({env:NO_GPU,userAgent:DESK,selection:{tier:'default',chosenBy:'human'}}).tier,'light');
 assert.equal(pickTier({env:NO_GPU,userAgent:DESK,installed:{default:true}}).tier,'light');
});
test('a card without 16-bit shaders on a small device falls back to the processor instead of giving up',()=>{
 const env={webgpu:{available:true,shaderF16:false},wasm:WASM,deviceMemoryGB:4};
 assert.deepEqual(pickTier({env,userAgent:DESK}),{tier:'light',backend:'cpu',reason:'no-f16-cpu'});
 assert.equal(pickTier({env:{...env,deviceMemoryGB:8},userAgent:DESK}).tier,'default','a roomy desktop still uses the larger model on its card');
});
test('a card that works is used, and nothing changes for it',()=>{
 const env={webgpu:{available:true,shaderF16:true},wasm:WASM,deviceMemoryGB:4};
 assert.deepEqual(pickTier({env,userAgent:DESK}),{tier:'light',reason:'small-device'});
 assert.equal(lightBackend({env,userAgent:DESK}),'gpu');assert.equal(gpuRunsLight(env),true);
});
test('the processor is not offered where it cannot work',()=>{
 for(const [why,env,ua,touch] of [
  ['iphone',NO_GPU,IPHONE,5],['ipad as a mac',NO_GPU,MAC,5],
  ['no wasm',{...NO_GPU,wasm:{available:false}},DESK,0],['no simd',{...NO_GPU,wasm:{available:true,simd:false}},DESK,0],
  ['little memory',{...NO_GPU,deviceMemoryGB:2},DESK,0],['unprobed',{webgpu:{available:false}},DESK,0]]){
  assert.equal(cpuBackendSupport({env,userAgent:ua,maxTouchPoints:touch}).ok,false,why);
  assert.equal(pickTier({env,userAgent:ua,maxTouchPoints:touch}).tier,null,why);
 }
 assert.equal(cpuBackendSupport({env:NO_GPU,userAgent:'Mozilla/5.0 (Linux; Android 14) Chrome/140 Mobile'}).ok,true);
});
test('WebAssembly and SIMD are detected from the browser',()=>{
 assert.deepEqual(wasmSupport(null),{available:false,simd:false});
 assert.deepEqual(wasmSupport({validate:()=>true}),{available:true,simd:true});
 assert.deepEqual(wasmSupport({validate:()=>false}),{available:true,simd:false});
 assert.deepEqual(wasmSupport({validate(){throw new Error('x');}}),{available:true,simd:false});
 assert.equal(wasmSupport().available,true,'this Node can run WebAssembly');
});
test('the processor configuration keeps every layer and the embedding off the graphics card',()=>{
 const gpu=loadConfigFor('light',{runtimeDir:'/r/'}),cpu=loadConfigFor('light',{runtimeDir:'/r/',backend:'cpu'});
 assert.equal(gpu.backend,'gpu');assert.equal(gpu.context.n_gpu_layers,-1);assert.equal(gpu.knobs.offloadTiedEmbedding,true);
 assert.equal(cpu.backend,'cpu');assert.equal(cpu.context.n_gpu_layers,0);assert.equal(cpu.knobs.offloadTiedEmbedding,false);
 assert.deepEqual(cpu.files,gpu.files,'the same downloaded files serve both');assert.equal(cpu.modelUrl,gpu.modelUrl);
 assert.equal(loadConfigFor('default',{backend:'cpu'}).adapter,'webllm','the larger model has no processor build');
});
test('the runtime start-up check needs WebAssembly, not WebGPU, for the processor',async()=>{
 await preflight({backend:'cpu'}); // no navigator.gpu in Node: must not throw
 await assert.rejects(preflight({backend:'gpu'}),/WebGPU/);
 await assert.rejects(preflight(),/WebGPU/);
});
test('the model host picks the backend from the device and reports it',async()=>{
 const make=(env,userAgent=DESK)=>createModelHost({envProbe:async()=>env,userAgent:()=>userAgent,settings:null,createWorker:()=>{throw new Error('no worker in this test');}});
 const probe=async(host)=>{try{await host.init();}catch{}return host;};
 let host=await probe(make(NO_GPU));
 assert.equal(host.getState().backend.light,'cpu');assert.equal(host.tierConfig('light').context.n_gpu_layers,0);assert.equal(host.tierConfig('default').adapter,'webllm');
 host=await probe(make({webgpu:{available:true,shaderF16:true},wasm:WASM}));
 assert.equal(host.getState().backend.light,'gpu');assert.equal(host.tierConfig('light').context.n_gpu_layers,-1);
 host=await probe(make(NO_GPU,IPHONE));
 assert.equal(host.getState().backend.light,'gpu','an iPhone is never moved to the processor');
});
