// A toast stays up long enough to read, is held while it is touched or the tab is hidden, and a tap puts it away. The shell's own messages reach it too.
import {launch,assert} from './harness.mjs';
const ok=n=>console.log('ok   '+n);
const h=await launch({port:18441});
try{
 const {page}=h;
 await page.waitForFunction(()=>window.plcApp?.toast);
 const shown=()=>page.evaluate(()=>document.querySelector('#toast').classList.contains('visible'));
 const long='This is a message with a fair amount of words in it, so it needs several seconds to read properly.';
 await page.evaluate(t=>window.plcApp.toast(t),long);
 assert(await shown(),'the toast shows');
 await page.waitForTimeout(6500);
 assert(await shown(),'a ~100 character message is still up after 6.5 s (the old fixed 3.2 s would have closed it)');
 await page.waitForTimeout(6000);
 assert(!(await shown()),'and goes away after its reading time');
 ok('the time follows the length of the message');

 await page.evaluate(()=>window.plcApp.toast('Held while touched.',1000));
 await page.locator('#toast').hover();
 await page.waitForTimeout(6000);
 assert(await shown(),'a toast under the pointer or finger is not closed');
 await page.mouse.move(5,5);
 await page.waitForTimeout(5000);
 assert(!(await shown()),'it goes once released');
 ok('held while touched, closes after');

 await page.evaluate(()=>window.plcApp.toast('Tap to dismiss me.',1000));
 await page.waitForTimeout(1200);
 await page.locator('#toast').click();
 await page.waitForTimeout(400);
 assert(!(await shown()),'a tap puts it away');
 await page.evaluate(()=>window.plcApp.toast('Not so fast.',1000));
 await page.locator('#toast').click({force:true,timeout:2000}).catch(()=>{});
 assert(await shown(),'a tap in the first moments (meant for something underneath) does not close it');
 ok('tap to dismiss, but not by accident');
 console.log('toast e2e: ok');
}catch(e){console.error(e);process.exitCode=1;}
finally{await h.close();}
