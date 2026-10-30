import {launch,assert} from './harness.mjs';
const speechMocks=()=>{
 const spoken=[];window.__spoken=spoken;window.__recs=[];
 const voices=[{voiceURI:'remote-1',name:'Cloud Voice',lang:'en-US',localService:false},{voiceURI:'local-1',name:'Device Voice',lang:'en-US',localService:true}];
 Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>window.__noVoices?[voices[0]]:voices,cancel(){},addEventListener(){},removeEventListener(){},speak(u){spoken.push({text:u.text,voice:u.voice?.voiceURI});setTimeout(()=>u.onend&&u.onend(),5);}}});
 window.SpeechSynthesisUtterance=function(t){this.text=t;};
 class Rec{constructor(){this.continuous=false;this.interimResults=false;this._pl=false;window.__recs.push(this);}
  get processLocally(){return this._pl;}set processLocally(v){this._pl=v;}
  start(){this.started=true;}stop(){this.started=false;this.onend&&this.onend();}
  emit(text,final=true){this.onresult&&this.onresult({resultIndex:0,results:[Object.assign([{transcript:text}],{isFinal:final})]});}
  static async available(o){window.__availableOpts=o;return window.__dictation||'available';}}
 window.SpeechRecognition=Rec;
};
const h=await launch({init:speechMocks});
const {page}=h;
const ok=name=>console.log('PASS',name);
const requests=async()=>(await (await fetch(`http://127.0.0.1:${h.api.port}/__requests`)).json());
const settle=async()=>{await page.waitForFunction(()=>/^(Reply complete\.|Generation failed:|Answered on this device)/.test(document.querySelector('#generationStatus').textContent));await page.waitForFunction(()=>!document.querySelector('#stopGeneration').offsetParent);};
const send=async text=>{await page.fill('#messageInput',text);await page.click('#sendBtn');await settle();};
const newChat=async()=>{await page.click('#threadList .new-thread-button:not(.temp-chat-button):not(.new-project-button)');};
const systemOfLast=async()=>{const r=(await requests()).at(-1).body.messages;return r[0].role==='system'?r[0].content:'';};
try{
 await page.waitForFunction(()=>!document.querySelector('#messageInput').disabled);

 // personal instructions + memory + presets
 await page.click('#openPrefsBtn');
 await page.fill('#prefInstructions','Reply in British English and keep it short.');
 await page.fill('.app-dialog input[aria-label="New memory"]','I live in Lisbon');await page.click('.app-dialog button:has-text("Add")');
 assert(await page.locator('.app-dialog input[aria-label="Memory 1"]').inputValue()==='I live in Lisbon','memory listed');
 await page.click('.app-dialog button:has-text("Done")');
 await send('hello');
 let sys=await systemOfLast();
 assert(/standing preferences[\s\S]*Reply in British English/.test(sys),'standing preferences sent: '+sys);
 assert(/asked you to remember[\s\S]*- I live in Lisbon/.test(sys),'memory sent');
 await page.reload();await page.waitForSelector('#messageInput');await page.waitForFunction(()=>!document.querySelector('#messageInput').disabled);
 await newChat();await send('after reload');
 assert(/Reply in British English/.test(await systemOfLast()),'preferences survive a reload');
 ok('personal instructions and memory');

 await page.click('.temp-chat-button');await send('private question');
 sys=await systemOfLast();
 assert(/standing preferences/.test(sys)&&!/Lisbon/.test(sys),'temporary chat: preferences yes, memory no');
 assert(await page.locator('.message [data-action="remember"]').count()===0,'no Remember in a temporary chat');
 await newChat();
 await send('/remember my cat is called Miso');
 assert(/Remembered: Miso|Remembered: my cat is called Miso/.test(await page.locator('.message.assistant').innerText()),'remember command answered locally');
 await send('who am I?');
 assert(/my cat is called Miso/.test(await systemOfLast()),'new memory used');
 await page.locator('.message.user').last().locator('[data-action="remember"]').click();
 await page.fill('.app-dialog textarea','I prefer metric units');await page.click('.app-dialog button:has-text("Remember")');
 await page.click('#openPrefsBtn');
 assert(await page.locator('.app-dialog input[aria-label="Memory 3"]').inputValue()==='I prefer metric units','remember action stored an edited memory');
 await page.click('.app-dialog button:has-text("Forget")>>nth=0');
 assert(await page.locator('.app-dialog input[aria-label^="Memory"]').count()===2,'forgetting removes it');
 await page.click('.app-dialog button:has-text("Done")');
 ok('memory is explicit and editable');

 await newChat();
 await page.click('#systemPromptContainer summary');
 await page.selectOption('#presetSelect',{label:'Brief answers'});
 assert(/Answer as briefly as possible/.test(await page.inputValue('#systemPromptInput')),'preset fills the instructions');
 await send('define entropy');
 assert(/Answer as briefly as possible/.test(await systemOfLast()),'preset instructions sent');
 await page.fill('#systemPromptInput','Talk like a pirate.');await page.click('#savePresetBtn');
 await page.fill('.app-dialog input','Pirate');await page.click('.app-dialog button:has-text("Save preset")');
 assert((await page.locator('#presetSelect option').allInnerTexts()).includes('Pirate'),'custom preset saved');
 ok('presets');

 // exact tools
 await newChat();
 const before=(await requests()).length;
 await send('/calc 12*(3+4)');
 assert(/84/.test(await page.locator('.message.assistant').innerText())&&/Computed on this device/.test(await page.locator('.message.assistant').innerText()),'calc answered');
 await send('/convert 5 km to miles');await send('/date 2026-03-05');
 assert(/3\.10685596119 miles/.test(await page.locator('#messages').innerText())&&/Thursday, 5 March 2026/.test(await page.locator('#messages').innerText()),'convert and date answered');
 assert((await requests()).length===before,'no model request for slash commands');
 await send('/calc 1/0');assert(/Division by zero/.test(await page.locator('.message.assistant').last().innerText()),'errors explained');
 await send('Quick check: what is 1234 * 5678?');
 assert(/1234 \* 5678 = 7006652/.test(await page.locator('.message.user').last().innerText()),'exact result shown on the prompt');
 assert(/\[Exact result computed by the app: 1234 \* 5678 = 7006652/.test((await requests()).at(-1).body.messages.at(-1).content),'exact result sent to the model');
 await send('Nothing to compute here, in 2026-03-05 or 10-20.');
 assert(!/Exact result/.test((await requests()).at(-1).body.messages.at(-1).content),'ordinary text is left alone');
 ok('exact tools');

 // read aloud: local voices only, markdown stripped
 await newChat();await send('markdown please');
 await page.locator('.message.assistant [data-action="speak"]').click();
 await page.waitForFunction(()=>window.__spoken.length>0);
 const spoken=await page.evaluate(()=>window.__spoken);
 assert(spoken.every(s=>s.voice==='local-1'),'only the on-device voice: '+JSON.stringify(spoken));
 assert(!/[#*`]/.test(spoken.map(s=>s.text).join(' '))&&/Heading/.test(spoken[0].text),'markdown not read out');
 await page.waitForFunction(()=>document.querySelector('.message.assistant [data-action="speak"]').getAttribute('aria-pressed')==='false');
 await page.evaluate(()=>{window.__noVoices=true;window.__spoken.length=0;});
 await page.locator('.message.assistant [data-action="speak"]').click();
 await page.waitForFunction(()=>/No on-device voice/.test(document.querySelector('#toast').textContent));
 assert((await page.evaluate(()=>window.__spoken.length))===0,'nothing spoken with a remote voice');
 await page.evaluate(()=>{window.__noVoices=false;});
 ok('read aloud is on-device only');

 // dictation
 await newChat();
 await page.click('#micBtn');
 await page.waitForFunction(()=>window.__recs.length===1&&window.__recs[0].started);
 assert(await page.evaluate(()=>window.__recs[0].processLocally===true&&window.__availableOpts.processLocally===true),'recognition forced local');
 await page.evaluate(()=>window.__recs[0].emit('hello wor',false));assert((await page.inputValue('#messageInput'))==='hello wor','interim text shown');
 await page.evaluate(()=>window.__recs[0].emit('hello world'));assert((await page.inputValue('#messageInput')).trim()==='hello world','final text committed');
 await page.click('#micBtn');assert(await page.getAttribute('#micBtn','aria-pressed')==='false','stopped');
 ok('dictation');

 // voice conversation: listen, send, speak, listen again
 await page.evaluate(()=>{window.__spoken.length=0;});
 await page.fill('#messageInput','');
 await page.click('#voiceModeBtn');
 await page.waitForFunction(()=>window.__recs.length===2&&window.__recs[1].started);
 await page.evaluate(()=>window.__recs[1].emit('tell me a joke'));
 await page.waitForFunction(()=>window.__spoken.length>0,null,{timeout:15000});
 assert(/Reply to: tell me a joke/.test((await page.evaluate(()=>window.__spoken)).map(s=>s.text).join(' ')),'reply was spoken');
 await page.waitForFunction(()=>window.__recs.length===3&&window.__recs[2].started,null,{timeout:10000});
 assert((await page.locator('.message.user').last().innerText()).includes('tell me a joke'),'spoken prompt was sent');
 await page.click('#voiceModeBtn');
 assert(await page.getAttribute('#voiceModeBtn','aria-pressed')==='false'&&await page.evaluate(()=>!window.__recs.at(-1).started),'voice mode ended');
 ok('voice conversation');

 const unexpected=h.errors.filter(e=>!/API responded with status 500|network error/.test(e));
 assert(unexpected.length===0,'no unexpected page errors: '+JSON.stringify(unexpected));
 console.log('ALL PASS');
}catch(e){console.error(e.message);console.error(await page.locator('#messages').innerText().catch(()=>''));console.error(h.errors);process.exitCode=1;}
finally{await h.close();}

// dictation that cannot be confirmed local stays off and says why
const h2=await launch({build:false,port:18272,init:()=>{delete window.SpeechRecognition;window.webkitSpeechRecognition=class{};}});
try{
 await h2.page.waitForFunction(()=>!document.querySelector('#messageInput').disabled);
 await h2.page.click('#micBtn',{force:true});
 await h2.page.waitForFunction(()=>/can.t confirm that speech recognition stays on your device/.test(document.querySelector('#toast').textContent));
 await h2.page.click('#voiceModeBtn',{force:true});
 await h2.page.waitForFunction(()=>/can.t confirm|no on-device voice/i.test(document.querySelector('#toast').textContent));
 console.log('PASS dictation refuses without local confirmation');
}catch(e){console.error(e.message);process.exitCode=1;}finally{await h2.close();}
