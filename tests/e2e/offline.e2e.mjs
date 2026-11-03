// The app with no connection, fast (offline plan 4.1, runs with the per-push checks): the app saved by the service worker opens cold, keeps its
// conversations, finds them by search, opens its public pages, explains itself, and asks for nothing it could not have. No model is downloaded;
// tests/e2e/offline-model.e2e.mjs does the full lifecycle with a real model before a release.
import {launch,assert} from './harness.mjs';

const ok=n=>console.log('ok   '+n);
const h=await launch({port:18351,serviceWorkers:'allow'});
try{
 const {page,context,origin}=h;
 const MARKER='kumquat-harbour-'+Date.now().toString(36);
 await page.waitForFunction(()=>navigator.serviceWorker?.controller||false,null,{timeout:30000}).catch(async()=>{await page.reload();await page.waitForSelector('#messageInput');});
 await page.waitForFunction(()=>/Offline app ready/.test(document.querySelector('#offlineStatus')?.textContent||''),null,{timeout:60000});
 await page.fill('#messageInput','Remember the word '+MARKER);await page.click('#sendBtn');
 await page.waitForSelector('.message.assistant');
 await page.waitForFunction(()=>!document.querySelector('.message.assistant.streaming'));
 ok('online: a conversation exists and the app is saved');

 // ---- the checklist in Settings and the connection pill, on the page that is already open
 assert(await page.locator('#connectionPill').isHidden(),'no connection pill while online');
 await page.evaluate(()=>window.plcShell.openSettings('models'));
 await page.waitForSelector('#offlineSection .off-item[data-id="app"]');
 await page.waitForFunction(()=>document.querySelector('#offlineSection .off-item[data-id="app"]')?.dataset.state==='ready',null,{timeout:20000});
 assert(/Ready for offline use|connected provider/i.test(await page.locator('#offlineSummary').innerText()),'the checklist has a one-line summary: '+await page.locator('#offlineSummary').innerText());
 await page.keyboard.press('Escape');
 ok('online: no pill, and Settings lists what is ready for offline use');
 await context.setOffline(true);
 await page.waitForSelector('#connectionPill',{state:'visible',timeout:8000});
 assert(/Offline/.test(await page.locator('#connectionPill').innerText()),'the pill says Offline');
 assert(/provider needs a connection/i.test(await page.locator('#connectionPill').getAttribute('title')),'with a connected provider the pill says what will not work');
 assert(/offline/i.test(await page.locator('#connectionAnnounce').innerText()),'the change is announced to screen readers');
 await page.click('#connectionPill');await page.waitForSelector('.shell-pop');
 assert(/You are offline/.test(await page.locator('.shell-pop').innerText())&&/Offline settings/.test(await page.locator('.shell-pop').innerText()),'the pill opens an explanation and a way to the offline settings');
 await page.keyboard.press('Escape');
 await page.fill('#messageInput','are you there');await page.click('#sendBtn');
 await page.waitForSelector('.message.assistant.failed, .message.assistant .message-status.error, .message.assistant:has-text("offline")',{timeout:15000}).catch(()=>{});
 await page.waitForFunction(()=>!document.querySelector('.message.assistant.streaming'));
 const failedText=await page.locator('.message.assistant').last().innerText();
 assert(/You are offline/.test(failedText)&&/needs a connection/.test(failedText),'a provider failure while offline says so in words: '+failedText);
 assert(!/Failed to fetch/i.test(failedText),'and does not show the browser\'s words');
 ok('offline: the pill appears, explains itself, and a provider failure is explained');
 await context.setOffline(false);
 await page.waitForFunction(()=>/Back online/.test(document.querySelector('#connectionPill')?.innerText||''),null,{timeout:8000});
 await page.waitForSelector('#connectionPill',{state:'hidden',timeout:10000});
 ok('back online: the pill says so for a moment, then goes away');

 // ---- offline, in a brand-new page (the page and its workers start from the saved files)
 const foreign=[],failed=[],errors=[];
 await context.setOffline(true);
 await context.route(url=>url.origin!==origin,route=>{foreign.push(route.request().url());return route.abort('internetdisconnected');});
 const off=await context.newPage();
 off.on('pageerror',e=>errors.push(e.message));
 off.on('requestfailed',r=>{if(new URL(r.url()).origin===origin)failed.push(new URL(r.url()).pathname);});
 await off.goto(origin+'/');await off.waitForSelector('#messageInput',{timeout:20000});
 assert(await off.evaluate(()=>window.__plcBooted===true),'the page finished starting offline');
 assert(!/couldn.t start/i.test(await off.locator('body').innerText()),'no failure banner');
 ok('offline: the app opens cold');
 assert(await off.evaluate(m=>(localStorage.getItem('chatThreads')||'').includes(m),MARKER),'the conversation is kept');
 await off.keyboard.press('Control+k');await off.fill('.search-input',MARKER);
 await off.waitForSelector('.search-item',{timeout:8000});
 assert(/kumquat-harbour/.test(await off.locator('.search-item').first().innerText()),'search finds it by its words');
 await off.keyboard.press('Escape');
 ok('offline: conversations are kept and found by search');
 for(const [path,heading] of [['/help','Help'],['/privacy','Privacy'],['/about','About']]){
  const p=await context.newPage();await p.goto(origin+path);
  assert(new RegExp(heading,'i').test(await p.locator('h1').first().innerText()),path+' opens its own page offline');await p.close();
 }
 ok('offline: the public pages open');
 await off.evaluate(()=>window.plcShell.openSettings('data'));
 await off.waitForSelector('#settingsPage',{state:'visible'});
 await off.keyboard.press('Escape');
 ok('offline: Settings opens');
 assert(failed.length===0,'files of the app that failed to load: '+failed.join(', '));
 assert(errors.length===0,'page errors: '+errors.join(' | '));
 const unexpected=foreign.filter(u=>!/\/models\/memory\//.test(u));
 assert(unexpected.length===0,'unexpected outside requests: '+unexpected.join(', '));
 ok('offline: nothing failed and nothing unexpected was requested');
 await context.setOffline(false);
 console.log('offline e2e: ok');
}catch(e){console.error(e);process.exitCode=1;}
finally{await h.close();}
