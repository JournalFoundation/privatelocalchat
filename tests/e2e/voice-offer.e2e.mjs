import {launch,assert} from './harness.mjs';
// The downloaded-voice offer, driven with the in-page fake engine through the documented test hook (localStorage plc.test.voice=1 and
// window.__plcVoiceEngineFactory). The system voice is a mock that finishes quickly.
const mocks=()=>{
 window.__spoken=[];
 const voices=[{voiceURI:'v1',name:'Voice',lang:'en-US',localService:true}];
 Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>voices,cancel(){},addEventListener(){},removeEventListener(){},speak(u){window.__spoken.push(u.text);setTimeout(()=>u.onend&&u.onend(),20);}}});
 window.SpeechSynthesisUtterance=function(t){this.text=t;};
 window.AudioContext=class{constructor(){this.currentTime=0;this.destination={};}resume(){}close(){}createBuffer(c,n,r){return {duration:n/r,copyToChannel(){}};}createBufferSource(){const s={connect(){},stop(){},start(){setTimeout(()=>s.onended&&s.onended(),1);}};return s;}};
 // fake engine (same interface as chat/voice-engine.mjs); its on-disk state survives a reload through sessionStorage
 window.__fake={files:sessionStorage.getItem('fakeFiles')==='1',calls:[]};
 const set=v=>{window.__fake.files=v;sessionStorage.setItem('fakeFiles',v?'1':'0');};
 const engine={
  async status(){return {installed:window.__fake.files,bytes:window.__fake.files?30e6:0};},
  async install(p){window.__fake.calls.push('install');p(15e6,30e6);p(30e6,30e6);set(true);},
  async remove(){window.__fake.calls.push('remove');set(false);},async load(){},async unload(){window.__fake.calls.push('unload');},
  async speak(t,{onChunk}){onChunk(new Float32Array(2400),24000);return {audioSeconds:4,synthSeconds:1,realTimeFactor:4,firstAudioMs:200};},async sample(){}};
 const factory=async()=>engine;
 factory.inputs={devOffer:true,env:()=>({deviceMemoryGB:8,cores:8,webgpu:{available:false}}),estimate:async()=>({usage:1e8,quota:5e10}),
  loadModule:async n=>n==='storage-check.mjs'?{checkStorage:async()=>({usage:1e8,quota:5e10,writeOk:true})}:n==='voice-probe.mjs'?{runVoiceProbe:async()=>({ms:5})}:Promise.reject(new Error('x'))};
 window.__plcVoiceEngineFactory=factory;
};
const h=await launch({init:mocks,port:19400,storage:{'plc.test.voice':'1'}});const {page}=h;
page.on('dialog',d=>d.accept());
const ok=n=>console.log('PASS',n);
const settle=()=>page.waitForFunction(()=>/Response complete\./.test(document.querySelector('#generationStatus').textContent));
const listen=async()=>{await page.click('.message.assistant [data-action="speak"]');};
try{
 await page.waitForFunction(()=>!document.querySelector('#messageInput').disabled);
 await page.fill('#messageInput','tell me something');await page.click('#sendBtn');await settle();
 assert(await page.locator('#voiceOffer').count()===0,'no offer before anything was read aloud');

 await listen();
 await page.waitForSelector('#voiceOffer');
 assert(/more natural voice is available, \d+ MB, works offline/.test(await page.textContent('#voiceOffer')),'one quiet line with the size');
 assert(await page.locator('#voiceOffer button').count()===2,'Try it and Not now');
 // decline path: Try it, then Use the system voice deletes the files
 await page.click('#voiceOfferTry');
 await page.waitForSelector('#voiceOfferSystem');
 assert(await page.evaluate(()=>window.__fake.files),'the voice was downloaded');
 await page.click('#voiceOfferSystem');
 await page.waitForFunction(()=>window.__fake.files===false);
 assert(await page.locator('#voiceOffer').count()===0,'the line goes away');
 assert(JSON.parse(await page.evaluate(()=>localStorage.getItem('plc.voice.v1'))).chosen==='os','the choice is remembered');
 ok('offer, try, use the system voice removes the files');

 // forget the choice, reload, accept and keep; then Settings shows it and Remove deletes it
 await page.evaluate(()=>localStorage.removeItem('plc.voice.v1'));
 await page.reload();await page.waitForSelector('#messageInput');
 await page.waitForFunction(()=>!document.querySelector('#messageInput').disabled);
 await page.waitForSelector('.message.assistant [data-action="speak"]');
 await listen();await page.waitForSelector('#voiceOfferTry');
 await page.click('#voiceOfferLater');
 assert(await page.evaluate(()=>JSON.parse(localStorage.getItem('plc.voice.v1')).declinedAt>0),'Not now is remembered');
 await page.evaluate(()=>localStorage.removeItem('plc.voice.v1'));
 await page.reload();await page.waitForSelector('.message.assistant [data-action="speak"]');
 await listen();await page.waitForSelector('#voiceOfferTry');await page.click('#voiceOfferTry');
 await page.click('#voiceOfferKeep');
 await page.evaluate(()=>window.plcShell.openSettings('voice'));
 await page.waitForSelector('#voiceCard .set-btn:has-text("Remove")');
 assert(/30 MB/.test(await page.textContent('#voiceCard')),'Settings shows the size');
 await page.click('#voiceCard .set-btn:has-text("Remove")');
 await page.waitForFunction(()=>window.__fake.files===false);
 await page.waitForFunction(()=>/System voice/.test(document.querySelector('#voiceCard').textContent));
 ok('keep, settings card, remove');
 assert(h.errors.length===0,'no page errors: '+h.errors.join('|'));
 console.log('voice-offer e2e passed');
}catch(e){console.error(e);console.error(h.errors);process.exitCode=1;}finally{await h.close();}
