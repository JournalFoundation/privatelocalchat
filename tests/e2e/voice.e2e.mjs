import {launch,assert} from './harness.mjs';
// Speech mocks: a recogniser the test can talk through, a voice that takes a configurable time per sentence, and a microphone permission switch.
const speechMocks=()=>{
 const spoken=[];window.__spoken=spoken;window.__recs=[];window.__speakMs=5;window.__mic='granted';
 const voices=[{voiceURI:'local-1',name:'Device Voice',lang:'en-US',localService:true}];
 Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>voices,cancel(){window.__cancels=(window.__cancels||0)+1;window.__timers?.forEach(t=>clearTimeout(t));},addEventListener(){},removeEventListener(){},speak(u){spoken.push(u.text);(window.__timers||=[]).push(setTimeout(()=>u.onend&&u.onend(),window.__speakMs));}}});
 window.SpeechSynthesisUtterance=function(t){this.text=t;};
 class Rec{constructor(){this.continuous=false;this.interimResults=false;window.__recs.push(this);}
  start(){this.started=true;if(window.__startError){const e=window.__startError;setTimeout(()=>this.onerror&&this.onerror({error:e}),0);}}
  stop(){this.started=false;this.onend&&this.onend();}abort(){this.started=false;this.aborted=true;}
  emit(text,final=true){this.onresult&&this.onresult({resultIndex:0,results:[Object.assign([{transcript:text}],{isFinal:final})]});}}
 window.SpeechRecognition=Rec;
 Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{if(window.__mic==='denied'){const e=new Error('denied');e.name='NotAllowedError';throw e;}return {getTracks:()=>[{stop(){}}]};}}});
};
const h=await launch({init:speechMocks});
const {page}=h;
const ok=name=>console.log('PASS',name);
const live=()=>page.evaluate(()=>window.__recs.filter(r=>r.started).length);
const state=()=>page.getAttribute('#voiceSheet','data-state');
const waitState=(s,timeout=15000)=>page.waitForFunction(v=>document.querySelector('#voiceSheet')?.dataset.state===v,s,{timeout});
const requests=async()=>(await (await fetch(`http://127.0.0.1:${h.api.port}/__requests`)).json());
try{
 await page.waitForFunction(()=>!document.querySelector('#messageInput').disabled);
 assert(await page.locator('#voiceModeBtn').count()===1,'voice button exists');

 // a whole turn: listen, send after a pause, speak the reply sentence by sentence, listen again
 await page.click('#voiceModeBtn');
 await waitState('listening');
 assert(await page.locator('#voiceSheet').isVisible(),'the voice sheet is shown');
 assert(!(await page.locator('#messageInput').isVisible()),'the typing box makes room for it');
 assert(await page.evaluate(()=>window.__recs.length===1&&window.__recs[0].started),'microphone on');
 await page.evaluate(()=>window.__recs[0].emit('speak about cats',false));
 assert((await page.textContent('#voiceCaption')).includes('speak about cats'),'what is heard is shown');
 await page.evaluate(()=>window.__recs[0].emit('speak about cats'));
 await waitState('thinking');
 assert(await page.evaluate(()=>window.__recs[0].aborted===true),'the microphone is off while the app thinks and speaks');
 await waitState('speaking');
 await waitState('listening');
 const spoken=await page.evaluate(()=>window.__spoken.filter(t=>t.trim()));
 assert(spoken.includes('Cats are small animals.')&&spoken.includes('They sleep a lot during the day.')&&spoken.at(-1)==='Dogs differ a great deal.','spoken sentence by sentence: '+JSON.stringify(spoken));
 assert((await page.locator('.message.user').last().innerText()).includes('speak about cats'),'the spoken prompt was sent as a message');
 const system=(await requests()).at(-1).body.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
 assert(/read aloud/.test(system),'the model is told to answer for speaking');
 assert(await live()===1,'listening again for the next turn');
 ok('voice turn');

 // interrupt in the middle of a long reply
 await page.evaluate(()=>{window.__speakMs=400;window.__spoken.length=0;});
 await page.evaluate(()=>window.__recs.filter(r=>r.started).at(-1).emit('speak-long please'));
 await waitState('speaking');
 await page.waitForFunction(()=>window.__spoken.length>=1);
 assert(await page.locator('#voiceInterrupt').isVisible(),'interrupt offered while speaking');
 await page.click('#voiceInterrupt');
 await waitState('listening');
 const count=await page.evaluate(()=>window.__spoken.length);
 await page.waitForTimeout(1200);
 assert(await page.evaluate(()=>window.__spoken.length)===count,'nothing more is spoken after interrupting');
 assert(!(await page.locator('#voiceInterrupt').isVisible()),'interrupt is not shown while listening');
 assert(await page.evaluate(()=>!document.querySelector('#stopGeneration').offsetParent),'the reply was stopped');
 ok('voice interrupt');

 // mute, then leave with Escape
 await page.click('#voiceMute');
 assert(await state()==='paused'&&await live()===0,'muted: microphone off');
 await page.click('#voiceMute');await waitState('listening');
 await page.keyboard.press('Escape');
 await page.waitForFunction(()=>document.querySelector('#voiceSheet').hidden);
 assert(await live()===0,'ended: microphone off');
 assert(await page.locator('#messageInput').isVisible(),'the typing box is back');
 ok('voice mute and end');

 // a microphone the browser blocks: the sheet explains it, and the controls stay when it is only a matter of allowing it
 await page.evaluate(()=>{window.__mic='denied';window.__startError='not-allowed';});
 await page.click('#voiceModeBtn');
 await waitState('error');
 await page.waitForFunction(()=>/blocked for this site/.test(document.querySelector('.voice-hint').textContent));
 await page.click('#voiceEnd');
 assert(await page.locator('#voiceModeBtn').count()===1&&await page.locator('#micBtn').count()===1,'still offered when the person can fix it');
 ok('blocked microphone is explained');

 // a browser that never lets sites use speech recognition: the first failure asks to try again, the second removes the controls
 await page.evaluate(()=>{window.__mic='granted';});
 await page.click('#micBtn');
 await page.waitForFunction(()=>/allowed now/.test(document.querySelector('#toast').textContent));
 await page.click('#micBtn');
 await page.waitForFunction(()=>/does not let websites/.test(document.querySelector('#toast').textContent));
 assert(await page.locator('#micBtn').count()===0&&await page.locator('#voiceModeBtn').count()===0,'unusable controls are removed');
 await page.reload();await page.waitForSelector('#messageInput');
 assert(await page.locator('#micBtn').count()===0,'and stay removed');
 ok('unusable speech input is hidden');

 const unexpected=h.errors.filter(e=>!/API responded with status 500|network error|aborted/i.test(e));
 assert(unexpected.length===0,'no unexpected page errors: '+JSON.stringify(unexpected));
 console.log('ALL PASS');
}catch(e){console.error(e.message);console.error(await page.locator('#messages').innerText().catch(()=>''));console.error(await page.locator('#voiceSheet').innerText().catch(()=>''));console.error(h.errors);process.exitCode=1;}
finally{await h.close();}
