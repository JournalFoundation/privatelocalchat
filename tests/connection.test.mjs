import test from 'node:test';
import assert from 'node:assert/strict';
import {createConnection,offlineReason,OFFLINE_REASON_KINDS} from '../chat/connection/connection.mjs';

function rig(startOnline=true,options={}){
  let online=startOnline,now=0,nextId=1;const timers=new Map(),listeners={online:[],offline:[]},changes=[];
  const host={
    isOnline:()=>online,
    listen:(name,fn)=>{listeners[name].push(fn);return()=>{listeners[name]=listeners[name].filter(f=>f!==fn);};},
    setTimer:(fn,ms)=>{const id=nextId++;timers.set(id,{fn,at:now+ms});return id;},
    clearTimer:id=>timers.delete(id),
    onChange:info=>changes.push(info.previous+'>'+info.state+(info.reason?':'+info.reason:'')),
    ...options,
  };
  const c=createConnection(host);
  return {c,changes,
    browser(value){online=value;for(const f of listeners[value?'online':'offline'])f();},
    tick(ms){now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}},
    pendingTimers:()=>timers.size};
}

test('starts from what the browser says',()=>{
  assert.equal(rig(true).c.state,'online');
  const r=rig(false);assert.equal(r.c.state,'offline');assert.equal(r.c.reason,'browser');assert.equal(r.c.online,false);
});

test('a flicker shorter than the settle time is not reported',()=>{
  const r=rig();r.browser(false);r.tick(500);r.browser(true);r.tick(5000);
  assert.deepEqual(r.changes,[]);assert.equal(r.c.state,'online');
});

test('going offline is reported once the browser keeps saying so',()=>{
  const r=rig();r.browser(false);r.tick(1499);assert.equal(r.c.state,'online');r.tick(1);
  assert.equal(r.c.state,'offline');assert.deepEqual(r.changes,['online>offline:browser']);
});

test('coming back shows "back" for a few seconds and then plain online',()=>{
  const r=rig();r.browser(false);r.tick(2000);r.browser(true);
  assert.equal(r.c.state,'back');assert.equal(r.c.online,true);
  r.tick(3999);assert.equal(r.c.state,'back');r.tick(1);assert.equal(r.c.state,'online');
  assert.deepEqual(r.changes,['online>offline:browser','offline>back','back>online']);
});

test('going offline again during "back" cancels the wait',()=>{
  const r=rig();r.browser(false);r.tick(2000);r.browser(true);r.browser(false);r.tick(1500);
  assert.equal(r.c.state,'offline');r.tick(10000);assert.equal(r.c.state,'offline');
});

test('requests that keep failing mean offline even when the browser says online',()=>{
  const r=rig();r.c.reportFailure();assert.equal(r.c.state,'online','one failure is not enough');
  r.c.reportFailure();assert.equal(r.c.state,'offline');assert.equal(r.c.reason,'unreachable');
});

test('a success between failures resets the count',()=>{
  const r=rig();r.c.reportFailure();r.c.reportSuccess();r.c.reportFailure();assert.equal(r.c.state,'online');
});

test('a success while the browser says online ends an unreachable period',()=>{
  const r=rig();r.c.reportFailure();r.c.reportFailure();assert.equal(r.c.state,'offline');
  r.c.reportSuccess();assert.equal(r.c.state,'back');r.tick(4000);assert.equal(r.c.state,'online');
});

test('a success does not override a device that says it is offline',()=>{
  const r=rig(false);r.c.reportSuccess();assert.equal(r.c.state,'offline');
});

test('a failure when the browser itself says offline is believed at once',()=>{
  const r=rig(true);r.browser(false);r.c.reportFailure();assert.equal(r.c.state,'offline');assert.equal(r.c.reason,'browser');
});

test('dispose removes the listeners and the timers',()=>{
  const r=rig();r.browser(false);assert.equal(r.pendingTimers(),1);r.c.dispose();assert.equal(r.pendingTimers(),0);
  r.browser(true);r.browser(false);r.tick(5000);assert.equal(r.c.state,'online');
});

test('every refusal has its own sentence, in plain words, and the fallback is generic',()=>{
  const seen=new Set();
  for(const kind of OFFLINE_REASON_KINDS){const s=offlineReason(kind);assert.match(s,/connection/i);assert.ok(!seen.has(s),kind+' repeats a sentence');seen.add(s);assert.ok(!/error|failed|exception/i.test(s),kind);}
  assert.equal(offlineReason('nothing-like-this'),'This needs a connection.');
});
