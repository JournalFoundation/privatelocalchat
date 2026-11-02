// The app shell: rail, panel, composer menus, model picker, settings page, search overlay, Roberta's page, phone drawer.
import {launch,assert} from './harness.mjs';
const ok=m=>console.log('PASS',m);
const t=await launch({shell:true});
const {page}=t;
try{
 await page.waitForSelector('#shellRail');
 assert(await page.locator('.sidebar .brand').isVisible(),'wordmark is in the sidebar');
 assert(await page.locator('#newChatBtn').isVisible()&&await page.locator('#robertaDot').isVisible(),'new chat and Roberta are in the panel');
 assert(!(await page.locator('#providerSettings').isVisible()),'model and connection are not in the sidebar');
 ok('rail and panel');

 await page.click('#shellPlus');
 const items=await page.locator('.shell-pop .shell-pop-label').allInnerTexts();
 assert(['Add photos & files','Add from library','Work in a project','Instructions for this chat'].every(x=>items.includes(x)),'plus menu items: '+items);
 await page.keyboard.press('Escape');
 ok('plus menu');

 assert(!(await page.locator('#sendBtn').isVisible())&&await page.locator('#voiceModeBtn').count()>=0,'no send button without text');
 await page.fill('#messageInput','find me later: pineapple');
 assert(await page.locator('#sendBtn').isVisible(),'send button appears with text');
 await page.click('#sendBtn');
 await page.waitForFunction(()=>/Response complete/.test(document.querySelector('#generationStatus').textContent));
 ok('send');

 await page.click('#modelPill');
 assert((await page.locator('.shell-pop').innerText()).includes('fake-model'),'picker lists the connected model');
 await page.keyboard.press('Escape');
 ok('model picker');

 await page.evaluate(()=>window.plcShell.openSettings('models'));
 assert(await page.locator('#endpointInput').isVisible(),'provider form is in settings');
 await page.keyboard.press('Escape');
 assert(!(await page.locator('#settingsPage').isVisible()),'settings closes');
 await page.evaluate(()=>window.plcShell.openSettings('data'));
 assert(await page.locator('#transferChatsBtn').isVisible(),'transfer is in data controls');
 await page.keyboard.press('Escape');
 ok('settings');

 await page.keyboard.press('Control+k');
 await page.fill('.search-input','pineapple');
 await page.waitForSelector('.search-item');
 assert(/find me later/.test(await page.locator('.search-item').first().innerText()),'search finds the message');
 await page.keyboard.press('Enter');
 assert(!(await page.locator('#searchOverlay').isVisible()),'search closes on choose');
 ok('search');

 await page.click('.header-temp');
 assert(await page.evaluate(()=>document.body.classList.contains('view-temp')),'temporary chat is on');
 await page.click('.header-temp');
 ok('temporary chat toggle');

 await page.click('#robertaDot');
 await page.waitForSelector('#robertaPage:not([hidden])');
 assert(await page.locator('#robertaCallBtn').isVisible(),'Roberta has a call button');
 await page.click('#newChatBtn');
 assert(!(await page.locator('#robertaPage').isVisible()),'new chat leaves Roberta');
 ok('Roberta page');

 await page.click('.panel-toggle');
 assert(!(await page.locator('.sidebar').isVisible())&&await page.locator('.show-panel').isVisible(),'panel collapses');
 await page.click('.show-panel');
 assert(await page.locator('.sidebar').isVisible(),'panel returns');
 ok('collapse');

 await page.setViewportSize({width:390,height:800});
 await page.waitForTimeout(300);
 assert(!(await page.locator('#shellRail').isVisible()),'rail is hidden on a phone');
 await page.click('.show-panel');
 await page.waitForTimeout(400);
 assert(await page.locator('.sidebar .mobile-only').first().isVisible(),'drawer shows Library, Explore and Settings');
 ok('phone drawer');
 assert(t.errors.length===0,'no page errors: '+JSON.stringify(t.errors));
 console.log('ALL PASS');
}finally{await t.close();}
