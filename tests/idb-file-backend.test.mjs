import test from 'node:test';
import assert from 'node:assert/strict';
import {createIdbFileBackend} from '../runtime/providers/idb-file-backend.mjs';

// A tiny in-memory IndexedDB (open, one object store, get/put/delete/getAllKeys, key ranges, transactions that complete when their requests are done): enough for the backend.
function fakeIdb(){
  const data=new Map();let opened=false;
  const range={bound:(lower,upper,lowerOpen,upperOpen)=>({lower,upper,lowerOpen,upperOpen})};
  const inRange=(k,r)=>(r.lowerOpen?k>r.lower:k>=r.lower)&&(r.upperOpen?k<r.upper:k<=r.upper);
  const later=fn=>new Promise(r=>setTimeout(r,0)).then(fn);
  function tx(){
    const t={oncomplete:null,onerror:null,onabort:null,pending:0,finished:false};
    const finishSoon=()=>later(()=>{if(!t.pending&&!t.finished){t.finished=true;t.oncomplete&&t.oncomplete();}});
    const req=fn=>{const r={onsuccess:null,onerror:null,result:undefined};t.pending++;later(()=>{r.result=fn();t.pending--;r.onsuccess&&r.onsuccess();finishSoon();});return r;};
    t.objectStore=()=>({
      get:k=>req(()=>data.get(k)),
      put:(v,k)=>req(()=>{data.set(k,v);}),
      delete:k=>req(()=>{if(typeof k==='object'&&k!==null)for(const key of [...data.keys()])if(inRange(key,k))data.delete(key);else{}else data.delete(k);}),
      getAllKeys:r=>req(()=>[...data.keys()].filter(k=>!r||inRange(k,r)).sort()),
    });
    finishSoon();return t;
  }
  const indexedDB={open:()=>{const r={onupgradeneeded:null,onsuccess:null,onerror:null,result:{createObjectStore(){opened=true;},transaction:()=>tx()}};later(()=>{r.onupgradeneeded&&r.onupgradeneeded();r.onsuccess&&r.onsuccess();});return r;}};
  return {indexedDB,keyRange:range,data};
}
const streamOf=(...parts)=>new ReadableStream({start(c){for(const p of parts)c.enqueue(new Uint8Array(p));c.close();}});
const bytes=async blob=>[...new Uint8Array(await blob.arrayBuffer())];

test('a file written from a stream reads back as one Blob, with its size, and is listed by name',async()=>{
  const b=createIdbFileBackend(fakeIdb());assert.equal(b.isSupported(),true);
  await b.write('abc_model.gguf',streamOf([1,2,3],[4,5]));
  assert.deepEqual(await bytes(await b.read('abc_model.gguf')),[1,2,3,4,5]);
  assert.equal(await b.getSize('abc_model.gguf'),5);
  assert.deepEqual(await b.list(),[{key:'abc_model.gguf',size:5}]);
});

test('a file bigger than one chunk is stored in several chunks and still reads back whole',async()=>{
  const idb=fakeIdb(),b=createIdbFileBackend(idb);
  const MiB=1<<20;const big=new Uint8Array(40*MiB).map((_,i)=>i%251);
  const stream=new ReadableStream({start(c){for(let at=0;at<big.length;at+=4*MiB)c.enqueue(big.subarray(at,at+4*MiB));c.close();}});
  await b.write('big',stream);
  const chunkKeys=[...idb.data.keys()].filter(k=>k.startsWith('c:big:'));
  assert.equal(chunkKeys.length,3,'40 MiB in 16 MiB chunks');
  const back=new Uint8Array(await (await b.read('big')).arrayBuffer());
  assert.equal(back.length,big.length);assert.ok(back.every((v,i)=>v===big[i]));
  assert.equal(await b.getSize('big'),big.length);
});

test('missing is null and -1, a rewrite replaces everything, and delete removes the chunks and the record',async()=>{
  const idb=fakeIdb(),b=createIdbFileBackend(idb);
  assert.equal(await b.read('nope'),null);assert.equal(await b.getSize('nope'),-1);
  await b.write('k',streamOf([1,2,3]));await b.write('k',streamOf([9]));
  assert.deepEqual(await bytes(await b.read('k')),[9]);
  await b.write('k2',streamOf([5]));
  await b.delete('k');
  assert.equal(await b.read('k'),null);assert.deepEqual(await b.list(),[{key:'k2',size:1}]);
  assert.ok(![...idb.data.keys()].some(x=>x.includes(':k:')||x==='m:k'),'nothing of k is left');
  assert.ok([...idb.data.keys()].some(x=>x==='m:k2'),'k2 is untouched (a name that starts the same is not caught by the range)');
  await b.delete('k');
});

test('a stream that fails leaves no file behind',async()=>{
  const idb=fakeIdb(),b=createIdbFileBackend(idb);
  const bad=new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2]));c.error(new Error('connection lost'));}});
  await assert.rejects(b.write('half',bad),/connection lost/);
  assert.equal(await b.read('half'),null);assert.equal(await b.getSize('half'),-1);assert.deepEqual(await b.list(),[]);
  assert.equal(idb.data.size,0);
});

test('odd names work and a browser without IndexedDB is not supported',async()=>{
  const b=createIdbFileBackend(fakeIdb());
  await b.write('__metadata__abc_a b/c?.gguf',streamOf([7]));
  assert.deepEqual(await b.list(),[{key:'__metadata__abc_a b/c?.gguf',size:1}]);
  assert.equal(createIdbFileBackend({indexedDB:undefined,keyRange:undefined}).isSupported(),false);
});
