import test from 'node:test';
import assert from 'node:assert/strict';
import {offlineReadiness} from '../runtime/offline-readiness.mjs';

const ready={app:'current',mode:'local',model:{name:'Light',downloaded:true,loaded:false},runtime:{saved:8,expected:8},voice:{system:true},matching:{needed:true,downloaded:true},persisted:true};
const byId=(r,id)=>r.items.find(i=>i.id===id);

test('everything saved is ready, with no fix offered anywhere',()=>{
  const r=offlineReadiness(ready);
  assert.equal(r.summary,'ready');assert.match(r.text,/^Ready for offline use/);
  assert.ok(r.items.every(i=>i.state==='ready'&&i.fix===null));
});

test('a model that is not downloaded makes the device not ready, and says which step fixes it',()=>{
  const r=offlineReadiness({...ready,model:{name:'Light',downloaded:false}});
  assert.equal(r.summary,'not-ready');assert.equal(byId(r,'model').fix,'download-model');assert.equal(byId(r,'runtime'),undefined,'no runtime line until there is a model to run');
  assert.match(r.text,/chat model/);
});

test('the runtime files being absent or partial is shown, not hidden behind a yes',()=>{
  assert.equal(offlineReadiness({...ready,runtime:{saved:0,expected:8}}).summary,'not-ready');
  const some=offlineReadiness({...ready,runtime:{saved:3,expected:8}});
  assert.equal(some.summary,'almost');assert.equal(byId(some,'runtime').fix,'save-runtime');assert.match(byId(some,'runtime').detail,/3 of 8/);
});

test('an update waiting is "almost", with a reload fix',()=>{
  const r=offlineReadiness({...ready,app:'stale'});
  assert.equal(r.summary,'almost');assert.equal(byId(r,'app').fix,'reload');
});

test('an app that was never saved blocks, and an unsupported browser says so without a fix',()=>{
  assert.equal(offlineReadiness({...ready,app:'none'}).summary,'not-ready');
  const u=offlineReadiness({...ready,app:'unsupported'});assert.equal(u.summary,'not-ready');assert.equal(byId(u,'app').fix,null);
});

test('the matching model and the storage promise are advice, never a blocker',()=>{
  const r=offlineReadiness({...ready,matching:{needed:true,downloaded:false},persisted:false});
  assert.equal(r.summary,'ready');assert.equal(byId(r,'matching').state,'partial');assert.equal(byId(r,'storage').fix,'persist');
  assert.match(byId(r,'matching').detail,/exact words/);
});

test('matching model is not listed when nothing will ask for it',()=>{
  assert.equal(byId(offlineReadiness({...ready,matching:{needed:false}}),'matching'),undefined);
});

test('a downloaded voice is ready; a chosen voice that is not downloaded is a missing, fixable item',()=>{
  assert.equal(byId(offlineReadiness({...ready,voice:{name:'Kokoro',system:false,downloaded:true}}),'voice').state,'ready');
  const m=byId(offlineReadiness({...ready,voice:{name:'Kokoro',system:false,downloaded:false}}),'voice');
  assert.equal(m.state,'missing');assert.equal(m.fix,'download-voice');
});

test('with a connected provider the summary says it needs a connection and the model line is not applicable',()=>{
  const r=offlineReadiness({...ready,mode:'api'});
  assert.equal(r.summary,'api');assert.equal(byId(r,'model').state,'na');assert.match(r.text,/needs a connection/);
  assert.equal(byId(r,'runtime'),undefined);
});

test('nothing known yet is "checking", never a false ready or a false alarm',()=>{
  const r=offlineReadiness({});
  assert.equal(r.summary,'almost');assert.match(r.text,/Checking/);assert.ok(r.items.every(i=>i.state==='unknown'));
});
