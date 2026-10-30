import {launch,assert} from './harness.mjs';
const profiles=[['phone portrait',{width:390,height:664},true],['phone landscape',{width:844,height:340},true],['tablet',{width:820,height:1000},true],['desktop',{width:1280,height:800},false]];
let first=true;
for(const [name,viewport,touch] of profiles){
 const h=await launch({build:first,viewport,touch,port:18400+Math.floor(Math.random()*90)});first=false;
 try{
  const {page}=h;
  await page.waitForFunction(()=>!document.querySelector('#messageInput').disabled);
  for(let i=0;i<4;i++){await page.fill('#messageInput','message '+i);await page.click('#sendBtn');await page.waitForFunction(()=>/Response complete/.test(document.querySelector('#generationStatus').textContent));await page.waitForFunction(()=>!document.querySelector('#stopGeneration').offsetParent);}
  const box=async sel=>page.locator(sel).first().boundingBox();
  const form=await box('#messageForm'),send=await box('#sendBtn'),input=await box('#messageInput');
  assert(form.y+form.height<=viewport.height+1,name+': composer inside viewport '+JSON.stringify(form));
  assert(send.y+send.height<=viewport.height+1&&send.x+send.width<=viewport.width+1,name+': send button reachable');
  assert(input.width>120,name+': input usable width '+input.width);
  assert((await box('#messages')).height>=60,name+': transcript has room: '+(await box('#messages')).height);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),name+': no horizontal page scroll');
  assert(!/user-scalable=no|maximum-scale/.test(await page.getAttribute('meta[name=viewport]','content')),name+': text zoom is allowed');

  // no control is ever shown disabled: if it cannot be used it is not shown
  const disabled=await page.evaluate(()=>[...document.querySelectorAll('button')].filter(b=>b.offsetParent&&(b.disabled||b.getAttribute('aria-disabled')==='true')).map(b=>b.id||b.textContent.trim().slice(0,30)));
  assert(disabled.length===0,name+': visible disabled buttons: '+JSON.stringify(disabled));
  await page.click('#openSidebarBtn',{force:!touch}).catch(()=>{});
  const disabledSidebar=await page.evaluate(()=>[...document.querySelectorAll('.sidebar button')].filter(b=>b.offsetParent&&(b.disabled||b.getAttribute('aria-disabled')==='true')).map(b=>b.id||b.textContent.trim().slice(0,30)));
  assert(disabledSidebar.length===0,name+': disabled buttons in the sidebar: '+JSON.stringify(disabledSidebar));
  if(touch)await page.keyboard.press('Escape');

  // the Enter-sends hint does not clutter the composer
  assert(!(await page.locator('#messageForm').innerText()).match(/Shift\+Enter|Make Enter/),name+': no keyboard hint in the composer');

  if(touch){
   // finger-sized targets for the things people tap most
   const small=await page.evaluate(()=>{const sel=['#sendBtn','#composerTools button','.message:last-child .message-actions button','#openSidebarBtn','#modeBadge'];const bad=[];for(const s of sel)for(const el of document.querySelectorAll(s)){const r=el.getBoundingClientRect();if(r.width&&r.height&&(r.height<43.5||r.width<43.5)&&s!=='#modeBadge')bad.push(s+' '+Math.round(r.width)+'x'+Math.round(r.height));}return bad;});
   assert(small.length===0,name+': tap targets under 44px: '+JSON.stringify(small));
   // Enter is a new line on a touch device
   await page.fill('#messageInput','first line');await page.press('#messageInput','Enter');await page.keyboard.type('second');
   assert((await page.inputValue('#messageInput'))==='first line\nsecond',name+': Enter adds a new line on touch');
   await page.fill('#messageInput','');
   // actions on older messages appear when the message is tapped
   const hidden=await page.evaluate(()=>{const m=document.querySelector('.message.assistant');const a=m.querySelector('.message-actions');return getComputedStyle(a).display==='none';});
   assert(hidden,name+': older messages do not carry a permanent row of buttons');
   await page.locator('.message.assistant .message-body').first().tap();
   assert(await page.evaluate(()=>getComputedStyle(document.querySelector('.message.assistant .message-actions')).display!=='none'),name+': tapping a message shows its actions');
  }else{
   await page.fill('#messageInput','typed');await page.press('#messageInput','Enter');
   await page.waitForFunction(()=>/Response complete/.test(document.querySelector('#generationStatus').textContent)&&document.querySelectorAll('.message.user').length===5);
   assert(true,'Enter sends on a desktop keyboard');
  }
  await page.fill('#messageInput','markdown');await page.press('#messageInput',touch?'Enter':'Enter');
  if(touch)await page.click('#sendBtn');
  await page.waitForFunction(()=>document.querySelector('.message.assistant:last-of-type .code-block'),null,{timeout:15000});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),name+': code/table do not widen the page');
  console.log('PASS',name);
 }catch(e){console.error(name,e.message);process.exitCode=1;}
 finally{await h.close();}
}
