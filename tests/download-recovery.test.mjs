import test from 'node:test';
import assert from 'node:assert/strict';
import {createDownloadRecovery} from '../runtime/download-recovery.mjs';
const KEY='plc.downloadIntent.v1';
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(storage=new Map()){
 const jobs=[],states=[];let complete=false,failures=0,installs=0,loads=0,cancels=0,connected=true;
 const store={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 const host={getState:()=>({busy:null,host:{state:'running'},selection:{tier:'light'},tiers:{light:{install:{ok:complete}}}}),inspect:async()=>{},install:async()=>{installs++;if(failures-->0)throw Object.assign(Error('Something entirely unexpected happened'),{name:'UnrecognizedFailure'});complete=true;},load:async()=>{assert.equal(store.getItem(KEY),null);loads++;},cancelTransfer:()=>cancels++};
 const recovery=createDownloadRecovery({host,storage:store,online:()=>connected,lock:null,onState:s=>states.push(s),schedule:(fn,ms)=>{const job={fn,ms};jobs.push(job);return job;},unschedule:job=>job.cancelled=true});
 return {recovery,host,store,storage,jobs,states,set complete(v){complete=v;},set failures(v){failures=v;},set connected(v){connected=v;},get installs(){return installs;},get loads(){return loads;},get cancels(){return cancels;},async step(){const job=jobs.find(j=>!j.cancelled&&!j.ran);assert.ok(job,'scheduled recovery expected');job.ran=true;job.fn();await flush();return job.ms;}};
}
test('unrecognized failures retain intent, back off and eventually load without another click',async()=>{
 const f=fixture();f.failures=2;f.recovery.resume();f.recovery.start('light');
 await f.step();assert.equal(f.recovery.state.phase,'retrying');assert.ok(f.store.getItem(KEY));
 assert.equal(await f.step(),1000);assert.equal(f.loads,0);assert.equal(await f.step(),2000);
 assert.equal(f.installs,3);assert.equal(f.loads,1);assert.equal(f.store.getItem(KEY),null);assert.equal(f.recovery.state.phase,'ready');
});
test('a reconstructed page resumes an unfinished request and does not repeat native loading',async()=>{
 const storage=new Map(),old=fixture(storage);old.recovery.start('light');
 const fresh=fixture(storage);fresh.recovery.resume();await fresh.step();assert.equal(fresh.installs,1);assert.equal(fresh.loads,1);
 const reopened=fixture(storage);reopened.complete=true;reopened.recovery.resume();assert.equal(reopened.jobs.length,0);assert.equal(reopened.loads,0);
});
test('offline requests wait and an online wake resumes; Cancel clears pending and future work',async()=>{
 const f=fixture();f.connected=false;f.recovery.resume();f.recovery.start('light');await f.step();assert.equal(f.recovery.state.phase,'offline');assert.equal(f.installs,0);
 f.connected=true;f.recovery.wake();await f.step();assert.equal(f.loads,1);
 const g=fixture();g.failures=5;g.recovery.resume();g.recovery.start('light');await g.step();g.recovery.cancel();
 assert.equal(g.store.getItem(KEY),null);assert.equal(g.recovery.state.pending,false);assert.equal(g.cancels,1);assert.ok(g.jobs.every(j=>j.ran||j.cancelled));
});
test('completion despite a lost result skips re-download, and a failed load never creates a retry loop',async()=>{
 const f=fixture();f.host.install=async()=>{f.complete=true;throw Error('Lost completion acknowledgement');};f.host.load=async()=>{throw Error('Native loading failed');};
 f.recovery.resume();f.recovery.start('light');await f.step();await f.step();
 assert.equal(f.recovery.state.phase,'load-failed');assert.equal(f.recovery.state.pending,false);assert.equal(f.store.getItem(KEY),null);assert.ok(f.jobs.every(j=>j.ran||j.cancelled));
});
test('another page completing or cancelling the shared intent does not resurrect it',async()=>{
 const f=fixture();f.recovery.resume();f.recovery.start('light');f.store.removeItem(KEY);await f.step();assert.equal(f.installs,0);assert.equal(f.loads,0);assert.equal(f.recovery.state.pending,false);
});
test('freeing storage resumes the same request automatically, and retry delay has a ceiling',async()=>{
 const f=fixture();let space=false;
 f.host.install=async()=>{if(!space)throw new DOMException('Device storage full','QuotaExceededError');f.complete=true;};
 f.recovery.resume();f.recovery.start('light');await f.step();assert.equal(f.recovery.state.pending,true);
 for(const ms of [1000,2000,4000,8000,16000,32000,60000,60000])assert.equal(await f.step(),ms);
 space=true;await f.step();assert.equal(f.loads,1);assert.equal(f.recovery.state.pending,false);
});
test('Cancel during an active operation prevents its later result from loading a model',async()=>{
 const f=fixture();let finish;f.host.install=()=>new Promise(resolve=>finish=()=>{f.complete=true;resolve();});
 f.recovery.resume();f.recovery.start('light');await f.step();f.recovery.cancel();finish();await flush();
 assert.equal(f.loads,0);assert.equal(f.store.getItem(KEY),null);assert.equal(f.recovery.state.pending,false);
});

test('automatic loading waits for startup hooks and Cancel during that wait prevents loading',async()=>{
 const f=fixture();let initialized;
 const recovery=createDownloadRecovery({host:f.host,storage:f.store,lock:null,online:()=>true,beforeLoad:()=>new Promise(resolve=>initialized=resolve),schedule:fn=>{f.jobs.push({fn});return fn;},unschedule:()=>{}});
 recovery.resume();recovery.start('light');await f.step();assert.ok(initialized);assert.equal(f.loads,0);assert.ok(f.store.getItem(KEY));
 recovery.cancel();initialized();await flush();assert.equal(f.loads,0);assert.equal(f.store.getItem(KEY),null);
});

test('completed cached inventory can automatically load after reopening offline',async()=>{
 const f=fixture();f.complete=true;f.connected=false;f.recovery.resume();f.recovery.start('light');await f.step();assert.equal(f.loads,1);assert.equal(f.installs,0);assert.equal(f.store.getItem(KEY),null);
});
