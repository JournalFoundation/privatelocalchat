import {launch,assert} from './harness.mjs';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'plc-dev-'));
const h=await launch({});
const {page}=h;
const ok=name=>console.log('PASS',name);
const more=async(loc,action)=>{await loc.locator('[data-action="more"]').click();await page.click(`.thread-menu [data-menu-action="${action}"]`);};

const requests=async()=>(await (await fetch(`http://127.0.0.1:${h.api.port}/__requests`)).json());
const settle=async()=>{await page.waitForFunction(()=>/^(Response complete\.|The response was interrupted|Answered on this device|Earlier messages summarized|Summary)/.test(document.querySelector('#generationStatus').textContent));await page.waitForFunction(()=>!document.querySelector('#stopGeneration').offsetParent);};
const send=async text=>{await page.fill('#messageInput',text);await page.click('#sendBtn');await settle();};
const newChat=async()=>{await page.click('#newChatBtn');};
const names=async()=>page.locator('#threadList li[data-id] .thread-name').allInnerTexts();
try{
 await page.waitForFunction(()=>!document.querySelector('#messageInput').disabled);

 // ---- context meter and summary
 await send('first topic: '+'alpha '.repeat(800));
 assert(/uses about \d+%/.test(await page.locator('#contextMeter span').first().innerText()),'meter shown');
 for(const t of ['second','third','fourth'])await send(t+' topic: '+'beta '.repeat(800));
 assert(/getting long|full/.test(await page.locator('#contextMeter span').first().innerText()),'meter warns: '+await page.locator('#contextMeter').innerText());
 await page.waitForSelector('#summarizeBtn:not([hidden])');
 const fullCount=await page.locator('.message').count();
 await page.click('#summarizeBtn');
 await page.waitForFunction(()=>/Earlier messages summarized/.test(document.querySelector('#generationStatus').textContent),null,{timeout:20000});
 assert(await page.locator('.context-divider').count()===1,'divider shown');
 assert(await page.locator('.message').count()===fullCount,'the full transcript is still on screen');
 await send('and now a follow-up');
 let sent=(await requests()).at(-1).body.messages;
 assert(/Summary of the earlier part of this conversation:\nSUMMARY-TEXT/.test(sent[0].content),'summary sent: '+JSON.stringify(sent[0]).slice(0,200));
 assert(!JSON.stringify(sent).includes('alpha alpha alpha'),'summarized messages not sent');
 assert(sent.at(-1).content==='and now a follow-up','latest exchange still live');
 assert(/uses about|getting long/.test(await page.locator('#contextMeter span').first().innerText()),'meter recovered');
 await page.click('.context-divider button');
 await page.fill('.app-dialog textarea','');await page.click('.app-dialog button:has-text("Save")');
 assert(await page.locator('.context-divider').count()===0,'summary can be cleared');
 ok('context meter and summary');

 // excluded messages leave the model's view but stay on screen
 await newChat();await send('keep this one');await send('hide this one');
 await more(page.locator('.message.user').nth(1),'toggle-context');
 await send('what did I say?');
 assert(!(await requests()).at(-1).body.messages.some(m=>m.role==='user'&&m.content==='hide this one'),'excluded message not sent');
 assert(/hide this one/.test(await page.locator('#messages').innerText()),'still shown');
 ok('choose what stays in context');

 // ---- local-mode readiness
 await page.selectOption('#inferenceMode','local');
 await page.waitForSelector('#readiness li.no');
 assert(await page.locator('#readiness li').count()===3&&await page.locator('#readiness li.yes').count()===0,'three states, none reached');
 assert(await page.locator('#advancedModel').evaluate(d=>!d.open),'advanced controls collapsed');
 assert(await page.locator('#freeMemory').isHidden(),'nothing to free yet, so no Free memory button');
 assert(await page.locator('#setupPrivateChat').isHidden()&&await page.locator('#downloadModel').isHidden(),'controls that cannot work here are not shown');
 await page.click('#newChatBtn');
 assert(await page.locator('#emptySetup').count()===0&&/WebGPU|graphics card|software renderer/.test(await page.locator('#emptyState').innerText()),'an unsupported browser is told so instead of being offered a setup that cannot work');
 assert(await page.locator('#emptyProvider').isVisible(),'and is offered the connected provider path');
 await page.selectOption('#inferenceMode','api');
 ok('readiness states');

 // ---- storage and backups
 await page.click('#openStorageBtn');
 const text=await page.locator('.app-dialog').innerText();
 assert(/Conversations/.test(text)&&/Browser storage/.test(text)&&/Last backup/.test(text)&&/Never/.test(text),'storage screen content: '+text.slice(0,300));
 const [dl]=await Promise.all([page.waitForEvent('download'),page.click('.app-dialog button:has-text("Back up chats")')]);
 assert(/chat-history\.json$/.test(dl.suggestedFilename()),'plain backup downloaded');
 await page.waitForFunction(()=>!/Never/.test(document.querySelector('.app-dialog')?.innerText||''));
 await page.click('.app-dialog button:has-text("Done")');
 assert(await page.locator('#backupNudge').isHidden(),'no nudge after a backup');
 ok('storage screen and backup');

 // ---- encrypted backup round trip
 await page.click('#openPrefsBtn');
 await page.fill('.app-dialog input[aria-label="New memory"]','my favourite colour is green');await page.click('.app-dialog button:has-text("Add")');await page.click('.app-dialog button:has-text("Done")');
 const before=await names();
 await page.click('#openStorageBtn');await page.click('.app-dialog button:has-text("Encrypted backup")');
 await page.fill('#bkPass1','short');await page.fill('#bkPass2','short');await page.click('.app-dialog button:has-text("Create backup")');
 assert(/at least 8/.test(await page.locator('.app-dialog [role=alert]').innerText()),'weak passphrase refused');
 await page.fill('#bkPass1','correct horse battery');await page.fill('#bkPass2','different');await page.click('.app-dialog button:has-text("Create backup")');
 assert(/do not match/.test(await page.locator('.app-dialog [role=alert]').innerText()),'mismatch refused');
 await page.fill('#bkPass2','correct horse battery');
 const [enc]=await Promise.all([page.waitForEvent('download'),page.click('.app-dialog button:has-text("Create backup")')]);
 const file=join(dir,'backup.encrypted.json');await enc.saveAs(file);
 const raw=readFileSync(file,'utf8');
 assert(!raw.includes('hide this one')&&!raw.includes('green')&&JSON.parse(raw).format==='plc-encrypted-backup/1','backup file is ciphertext');
 // wipe everything and restore
 await page.evaluate(async()=>{localStorage.clear();await new Promise(r=>{const q=indexedDB.deleteDatabase('plc-docs');q.onsuccess=q.onerror=q.onblocked=()=>r();});});
 await page.reload();await page.waitForSelector('#messageInput');await page.waitForFunction(()=>!document.querySelector('#messageInput').disabled);
 assert(!(await page.evaluate(()=>localStorage.getItem('plc.memory.v1')||'')).includes('green'),'wiped');
 await page.setInputFiles('#importInput',file);
 await page.waitForSelector('.app-dialog input[type=text]');
 await page.fill('.app-dialog input[type=text]','wrong passphrase');await page.click('.app-dialog button:has-text("Unlock backup")');
 await page.waitForFunction(()=>/did not unlock/.test(document.querySelector('#toast').textContent));
 await page.waitForSelector('.app-dialog input[type=text]');
 await page.fill('.app-dialog input[type=text]','correct horse battery');await page.click('.app-dialog button:has-text("Unlock backup")');
 await page.waitForSelector('#importSummary');
 assert(await page.locator('#importExtras').isChecked(),'settings restore offered');
 await page.click('.app-dialog button:has-text("Import")');
 await page.waitForFunction(()=>[...document.querySelectorAll('#threadList .thread-name')].length>=3);
 const after=await names();
 assert(before.filter(n=>!/New chat/i.test(n)).every(n=>after.includes(n)),'chats restored: '+JSON.stringify({before,after}));
 await page.waitForFunction(()=>(localStorage.getItem('plc.memory.v1')||'').includes('green'));
 ok('encrypted backup round trip');

 // ---- app lock
 await page.click('#openLockBtn');
 await page.fill('#lockNew1','tiny');await page.fill('#lockNew2','tiny');await page.click('.app-dialog button:has-text("Turn on lock")');
 assert(/at least 6/.test(await page.locator('.app-dialog [role=alert]').innerText()),'weak lock refused');
 await page.fill('#lockNew1','open sesame');await page.fill('#lockNew2','open sesame');await page.click('.app-dialog button:has-text("Turn on lock")');
 await page.waitForSelector('#lockNowBtn');
 assert(!(await page.evaluate(()=>localStorage.getItem('plc.lock.v1'))).includes('open sesame'),'passphrase not stored');
 await page.click('#lockNowBtn');
 assert(await page.locator('#lockScreen').isVisible()&&await page.evaluate(()=>document.querySelector('#app').inert===true),'locked and inert');
 await page.fill('#unlockPass','nope');await page.press('#unlockPass','Enter');
 await page.waitForFunction(()=>/not right/.test(document.querySelector('#lockScreen').innerText));
 await page.fill('#unlockPass','open sesame');await page.press('#unlockPass','Enter');
 await page.waitForSelector('#lockScreen',{state:'hidden'});
 await page.reload();
 assert(await page.locator('#lockScreen').isVisible(),'locked again after a reload, before anything is shown');
 assert(await page.evaluate(()=>getComputedStyle(document.querySelector('#app')).visibility==='hidden'),'chats not visible while locked');
 await page.fill('#unlockPass','open sesame');await page.press('#unlockPass','Enter');
 await page.waitForSelector('#lockScreen',{state:'hidden'});
 // forgot the passphrase: erase and start over
 await page.click('#lockNowBtn');
 await page.click('#lockScreen button:has-text("Forgot")');
 await page.click('.app-dialog button:has-text("Erase everything")');
 await page.waitForSelector('#messageInput');await page.waitForFunction(()=>!document.querySelector('#messageInput').disabled);
 assert(await page.locator('#lockScreen').isHidden()&&!(await page.evaluate(()=>localStorage.getItem('plc.lock.v1'))),'lock removed by erasing');
 assert((await names()).every(n=>/New chat|^$/i.test(n)),'chats erased: '+JSON.stringify(await names()));
 ok('app lock');

 const unexpected=h.errors.filter(e=>!/API responded with status 500|network error/.test(e));
 assert(unexpected.length===0,'no unexpected page errors: '+JSON.stringify(unexpected));
 console.log('ALL PASS');
}catch(e){console.error(e.message);console.error(await page.locator('body').innerText().then(t=>t.slice(0,800)).catch(()=>''));console.error(h.errors);process.exitCode=1;}
finally{await h.close();}
