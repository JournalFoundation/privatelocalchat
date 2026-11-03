import {launch,assert} from './harness.mjs';
// The chat-model picker's click is a toggle on whether the model is loaded (the shell talks to window.localModels, stubbed here for the state it should react to).
const h=await launch({port:19403});const {page}=h;
const ok=n=>console.log('PASS',n);
try{
 await page.waitForFunction(()=>!document.querySelector('#messageInput').disabled&&window.localModels);
 await page.evaluate(()=>{
  const lm=window.localModels;window.__calls=[];
  const set=(k,v)=>Object.defineProperty(lm,k,{get:()=>v,configurable:true});
  window.__set=(o)=>{for(const [k,v] of Object.entries(o))set(k,v);};
  lm.freeMemory=async()=>{window.__calls.push('free');};
  lm.ensureReady=async()=>{window.__calls.push('ensureReady');};
  lm.cancelDownload=()=>{window.__calls.push('cancel');};
  document.querySelector('#inferenceMode').value='local';
 });
 const sel=await page.evaluate(()=>document.querySelector('#localModelSelect').value);
 const row=async()=>{const r=page.locator('.shell-pop-row[role="menuitemradio"]',{hasText:/Qwen3\.5-2B|LFM|Granite|Qwen/}).filter({has:page.locator('.shell-pop-check')}).first();return r;};
 const openMenu=async()=>{if(!await page.locator('.shell-pop').count())await page.click('#modelPill');await page.waitForSelector('.shell-pop');};
 const clickCurrent=async()=>{await openMenu();await page.locator('.shell-pop-row[aria-checked="true"]').first().click();await page.waitForTimeout(250);};
 // loaded -> unload
 await page.evaluate(()=>window.__set({mode:'local',ready:true,state:{busy:false,load:{state:'ready'}}}));
 await clickCurrent();
 assert(await page.evaluate(()=>window.__calls.join())==='free','a click on the loaded chat model unloads it');
 assert(await page.locator('.shell-pop').count()===1,'the menu stays open');
 // downloaded, not loaded -> load
 await page.evaluate(()=>{window.__calls.length=0;window.__set({ready:false,state:{busy:false,load:{state:'unloaded'}}});});
 await clickCurrent();
 assert(await page.evaluate(()=>window.__calls.includes('ensureReady')),'a click on a downloaded chat model loads it');
 // downloading -> cancel
 await page.evaluate(()=>{window.__calls.length=0;window.__set({ready:false,state:{busy:'install',transfer:{bytesDone:1,bytesTotal:10},load:{state:'unloaded'}}});});
 await clickCurrent();
 assert(await page.evaluate(()=>window.__calls.join())==='cancel','a click on a downloading chat model cancels the download');
 ok('the chat model picker toggles loaded');
 assert(h.errors.length===0,'no page errors: '+h.errors.join('|'));
 console.log('model-toggle e2e passed');
}catch(e){console.error(e);console.error(h.errors);process.exitCode=1;}finally{await h.close();}
