import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';

// docs/evidence/encryption/storage-inventory.json lists every browser storage key and every file that touches browser storage, each with the class the
// encryption plan gives it (docs/ENCRYPTION-AT-REST-PLAN.md). This test is what makes "every new key is classified" true: a key the source uses that the
// inventory does not know, a file that starts using storage, or an inventory line for something that is gone, all fail here.
const inv=JSON.parse(await readFile(new URL('../docs/evidence/encryption/storage-inventory.json',import.meta.url),'utf8'));
const ROOT=new URL('../',import.meta.url);
const SKIP=new Set(['node_modules','dist','work','.git','vendor','tests','docs','ops','dev-tools','scripts','privacy','about','help','updates','releases']);
async function walk(dir,rel=''){
  const out=[];
  for(const e of await readdir(new URL(rel||'.',ROOT),{withFileTypes:true})){
    if(e.name.startsWith('.')||SKIP.has(e.name))continue;
    const path=rel+e.name;
    if(e.isDirectory())out.push(...await walk(dir,path+'/'));
    else if(/\.(mjs|js|html)$/.test(e.name)&&!/(^|\/)(sw|_worker)\.js$/.test(path)&&!/\.min\.js$/.test(path))out.push(path);
  }
  return out;
}
const files=[...await walk(ROOT),'scripts/service-worker.js'];
const sources=Object.fromEntries(await Promise.all(files.map(async f=>[f,await readFile(new URL(f,ROOT),'utf8')])));
const API=/\b(localStorage|sessionStorage|indexedDB)\b/;
const LEGACY=['chatThreads','chatConfig','chatModels','chatEndpointTokens','promoDismissed'];

test('every file that touches browser storage is in the inventory, and every listed file still does',()=>{
  const using=Object.keys(sources).filter(f=>API.test(sources[f])||/\bcaches\.(open|match|keys|delete)\b|navigator\.storage|\.getDirectory\(/.test(sources[f])).sort();
  const listed=[...inv.files.list].sort();
  assert.deepEqual(using.filter(f=>!listed.includes(f)),[],'files use browser storage but are not in the inventory (decide how the vault will see them, then add them)');
  assert.deepEqual(listed.filter(f=>!using.includes(f)),[],'the inventory lists files that no longer touch browser storage');
});

test('every plc.* key and every older key the source uses is classified',()=>{
  const known=new Set(inv.keys.map(k=>k.key));
  const used=new Set();
  for(const [f,text] of Object.entries(sources))for(const m of text.matchAll(/['"`](plc\.[A-Za-z0-9_.-]+)['"`]/g))used.add(m[1]);
  assert.deepEqual([...used].filter(k=>!known.has(k)).sort(),[],'keys used in the source but not in the inventory');
  for(const k of LEGACY)assert.ok(known.has(k),k+' is classified');
});

test('every classified key is still used by its owner',()=>{
  const gone=[];
  for(const k of inv.keys){
    const text=sources[k.owner];
    if(text===undefined){gone.push(k.key+' (owner file '+k.owner+' not found)');continue;}
    // the key is named in its owner, or (for the older keys that the page declares as constants) in the page itself
    const named=text.includes(`'${k.key}'`)||text.includes(`"${k.key}"`)||text.includes('`'+k.key+'`')||(LEGACY.includes(k.key)&&sources['index.html'].includes(`'${k.key}'`));
    if(!named)gone.push(k.key+' is not named in '+k.owner);
  }
  assert.deepEqual(gone,[],'inventory lines that no longer match the source');
});

test('the inventory is well formed: unique keys, a known class, a store, an owner',()=>{
  const classes=new Set(Object.keys(inv.classes));
  const seen=new Set();
  for(const k of inv.keys){
    assert.ok(!seen.has(k.key),'duplicate '+k.key);seen.add(k.key);
    assert.ok(classes.has(k.class),k.key+' has a known class');
    assert.ok(['localStorage','sessionStorage'].includes(k.store),k.key+' store');
    assert.ok(k.owner&&k.note,k.key+' has an owner and a note');
  }
  for(const d of inv.databases)assert.ok(classes.has(d.class)&&d.owner,d.name);
});

test('a key is named only by its owner and the files the inventory lists in alsoIn (the model-memory switch once overwrote the memory items)',()=>{
  const extra={};
  for(const k of inv.keys){
    const named=Object.keys(sources).filter(f=>sources[f].includes(`'${k.key}'`)||sources[f].includes(`"${k.key}"`));
    const allowed=new Set([k.owner,...(k.alsoIn||[])]);
    const others=named.filter(f=>!allowed.has(f));
    if(others.length)extra[k.key]=others;
  }
  assert.deepEqual(extra,{},'a file names a key that belongs to another owner: add it to alsoIn if it only reads it, otherwise give it its own key');
});

test('production builds carry no test-only key outside the page markers',async()=>{
  const test_=inv.keys.filter(k=>k.class==='test').map(k=>k.key);
  for(const k of test_){
    for(const [f,text] of Object.entries(sources)){
      if(!text.includes(k))continue;
      assert.equal(f,'index.html',k+' appears outside the page: '+f);
      const before=text.slice(0,text.indexOf(k));
      assert.ok(before.lastIndexOf('DEV_DIAGNOSTICS_START')>before.lastIndexOf('DEV_DIAGNOSTICS_END'),k+' must sit inside DEV_DIAGNOSTICS markers');
    }
  }
});
