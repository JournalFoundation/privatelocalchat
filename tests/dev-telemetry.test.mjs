import test from 'node:test';
import assert from 'node:assert/strict';
import {Telemetry,safeData} from '../dev-tools/telemetry-core.mjs';
import {execFileSync} from 'node:child_process';
import {readFile,readdir} from 'node:fs/promises';
class Store{constructor(){this.events=[];}async add(e){this.events.push(e);}async list(n){return this.events.slice(0,n);}async remove(ids){this.events=this.events.filter(e=>!ids.includes(e.id));}async count(){return this.events.length;}async clear(){this.events=[];}}
const settings=()=>{const values=new Map();return {getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};};
test('diagnostics disabled means no recording and no uploads',async()=>{const store=new Store();let requests=0;const t=new Telemetry({store,settings:settings(),fetchImpl:async()=>requests++});await t.record('generation-start');await t.flush();assert.equal(store.events.length,0);assert.equal(requests,0);});
test('durable events survive a new page and failed upload, and clear only after acknowledgement',async()=>{
 const store=new Store(),config=settings();let online=false;
 const send=async(url,options)=>{if(!online)throw Error('offline');const body=JSON.parse(options.body);return {ok:true,json:async()=>({accepted:body.events.length})};};
 const first=new Telemetry({store,settings:config,fetchImpl:send});first.configure({enabled:true,disk:true,url:'https://receiver.example/session'});await first.record('generation-start',{model:'test-model'});await first.flush();assert.equal(store.events.length,1);
 const reopened=new Telemetry({store,settings:config,fetchImpl:send});assert.equal(reopened.config.enabled,true);online=true;await reopened.flush();assert.equal(store.events.length,0);
});
test('conversation and credential fields are excluded from event data',()=>{assert.deepEqual(safeData({prompt:'secret',reply:'secret',token:'secret',messages:['secret'],model:'public-model',chunks:3,memory:{wasm:123,prompt:'secret'}}),{model:'public-model',chunks:3,memory:{wasm:123}});});
test('production artefact contains no diagnostic UI, modules, receiver or disk journal',async()=>{
 execFileSync('node',['scripts/build.mjs'],{env:{...process.env,DEPLOY_BRANCH:'main'},stdio:'pipe'});
 const build=JSON.parse(await readFile('dist/version.json','utf8'));const html=await readFile('dist/index.html','utf8');const app=await readFile('dist/releases/'+build.commit+'/local-models.js','utf8');
 assert.ok(!html.includes('dev-tools'));assert.ok(!app.includes('__plcDebugModelHost'));assert.ok(!app.includes('plc.diagnostic.generations'));
 const files=await readdir('dist');assert.ok(!files.includes('_worker.js'));assert.ok(!files.includes('_routes.json'));assert.ok(!(await readdir('dist/releases/'+build.commit)).includes('dev-tools'));
});
test('development artefact includes isolated diagnostics and exact-host activation',async()=>{
 execFileSync('node',['scripts/build.mjs'],{env:{...process.env,DEPLOY_BRANCH:'dev'},stdio:'pipe'});
 const build=JSON.parse(await readFile('dist/version.json','utf8'));const start=await readFile('dist/releases/'+build.commit+'/dev-tools/start.js','utf8');
 assert.match(start,/location.hostname==='dev.privatelocal.chat'/);assert.match(await readFile('dist/_worker.js','utf8'),/url.hostname!==HOST/);
});
