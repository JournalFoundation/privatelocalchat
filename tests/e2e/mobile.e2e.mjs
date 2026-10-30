import {launch,assert} from './harness.mjs';
for(const [name,viewport] of [['phone portrait',{width:390,height:664}],['phone landscape',{width:844,height:340}],['tablet',{width:820,height:1000}]]){
 const h=await launch({build:name==='phone portrait',viewport});
 try{
  const {page}=h;
  await page.waitForFunction(()=>!document.querySelector('#messageInput').disabled);
  for(let i=0;i<5;i++){await page.fill('#messageInput','message '+i);await page.click('#sendBtn');await page.waitForFunction(()=>/Reply complete/.test(document.querySelector('#generationStatus').textContent));await page.waitForFunction(()=>!document.querySelector('#stopGeneration').offsetParent);}
  const form=await page.locator('#messageForm').boundingBox(),send=await page.locator('#sendBtn').boundingBox(),input=await page.locator('#messageInput').boundingBox();
  assert(form.y+form.height<=viewport.height+1,name+': composer inside viewport '+JSON.stringify(form));
  assert(send.y+send.height<=viewport.height+1&&send.x+send.width<=viewport.width+1,name+': send button reachable');
  assert(input.width>120,name+': input usable width '+input.width);
  const msgs=await page.locator('#messages').boundingBox();
  assert(msgs.height>=60,name+': transcript has room: '+msgs.height);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),name+': no horizontal page scroll');
  const meta=await page.getAttribute('meta[name=viewport]','content');
  assert(!/user-scalable=no|maximum-scale/.test(meta),name+': text zoom is allowed');
  // wide code and tables stay inside the bubble
  await page.fill('#messageInput','markdown');await page.click('#sendBtn');await page.waitForFunction(()=>document.querySelector('.message.assistant:last-of-type .code-block'));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),name+': code/table do not widen the page');
  console.log('PASS',name);
 }catch(e){console.error(name,e.message);process.exitCode=1;}
 finally{await h.close();}
}
