import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeThread,normalizeMessage,deriveTitle,listThreads,beginNewVersion,syncActiveVersion,selectVersion,editPrompt,undoEditPrompt,contextMessages,validateHistory,mergeThreads,describeImport,branchThread,purgeExpired,makeMessage,STATUS} from '../chat/threads.mjs';
const T=(id,msgs,extra={})=>normalizeThread({id,title:id,messages:msgs.map(([role,content])=>({role,content})),...extra},1000);
test('legacy threads gain ids and timestamps; unusable messages are dropped; a message cut off mid-answer is kept as interrupted',()=>{
 const t=normalizeThread({id:'a',title:'x',messages:[{role:'user',content:'hi'},{role:'bogus',content:'no'},{role:'assistant',content:'partial',status:'streaming'},null]},5);
 assert.equal(t.messages.length,2);assert.ok(t.messages.every(m=>m.id));assert.equal(t.messages[1].status,STATUS.INTERRUPTED);assert.equal(t.createdAt,5);
});
test('titles come from the first line of the first prompt',()=>{
 assert.equal(deriveTitle('## Tell me about the history of the Hermitage\nmore'),'Tell me about the history of the Hermitage');
 assert.equal(deriveTitle('   \n  '),'');
 const long=deriveTitle('Explain how photosynthesis converts light energy into chemical energy in detail please');
 assert.ok(long.length<=49&&long.endsWith('…'),long);
});
test('list is pinned first then most recent; archive and trash are separate',()=>{
 const a=T('a',[],{updatedAt:1}),b=T('b',[],{updatedAt:3}),c=T('c',[],{updatedAt:2,pinned:true}),d=T('d',[],{archived:true}),e=T('e',[],{deletedAt:50});
 assert.deepEqual(listThreads([a,b,c,d,e]).map(t=>t.id),['c','b','a']);
 assert.deepEqual(listThreads([a,b,c,d,e],{archived:true}).map(t=>t.id),['d']);
 assert.deepEqual(listThreads([a,b,c,d,e],{trashed:true}).map(t=>t.id),['e']);
 assert.deepEqual(purgeExpired([e,a],50+31*864e5).map(t=>t.id),['a']);
});
test('regenerating keeps the earlier answer reachable',()=>{
 const m=normalizeMessage({role:'assistant',content:'first'});
 beginNewVersion(m);m.content='second';m.status=STATUS.COMPLETE;syncActiveVersion(m);
 assert.equal(m.versions.length,2);assert.equal(m.versionIndex,1);
 selectVersion(m,0);assert.equal(m.content,'first');selectVersion(m,1);assert.equal(m.content,'second');
 const round=normalizeMessage(JSON.parse(JSON.stringify(m)));assert.equal(round.versions.length,2);assert.equal(round.content,'second');
});
test('editing a prompt drops what followed and can be undone',()=>{
 const t=T('a',[['user','one'],['assistant','two'],['user','three'],['assistant','four']]);
 const prev=editPrompt(t,0,'ONE');
 assert.equal(t.messages.length,1);assert.equal(t.messages[0].content,'ONE');assert.equal(prev.tail.length,3);
 undoEditPrompt(t,0,prev);assert.deepEqual(t.messages.map(m=>m.content),['one','two','three','four']);
 assert.equal(editPrompt(t,1,'x'),null);
});
test('context leaves out excluded, notices and the part covered by a summary',()=>{
 const t=T('a',[['user','1'],['assistant','2'],['user','3'],['assistant','4']]);
 t.messages[1].excluded=true;assert.deepEqual(contextMessages(t).map(m=>m.content),['1','3','4']);
 t.summary={text:'s',upTo:2};assert.deepEqual(contextMessages(t).map(m=>m.content),['3','4']);
});
test('importing validates first and merges without overwriting',()=>{
 assert.equal(validateHistory({nope:1}).ok,false);assert.equal(validateHistory([]).ok,false);assert.equal(validateHistory('x').ok,false);
 const existing=[T('a',[['user','hello']]),T('b',[['user','b']])];
 const incoming=validateHistory([{id:'a',title:'a',messages:[{role:'user',content:'hello'}]},{id:'b',title:'b',messages:[{role:'user',content:'changed'}]},{id:'c',title:'c',messages:[{role:'user',content:'new'}]}]).threads;
 const m=mergeThreads(existing,incoming);
 assert.equal(m.threads.length,4);assert.equal(m.duplicates,1);assert.equal(m.copies,1);assert.equal(m.added,2);
 assert.ok(m.threads.some(t=>t.title==='b (imported)'));assert.equal(existing.length,2);
 const r=mergeThreads(existing,incoming,{replace:true});assert.equal(r.threads.length,3);assert.match(describeImport(r),/2 current conversations will be removed/);
});
test('a branch cuts the chat at a message and gets new identity',()=>{
 const t=T('a',[['user','1'],['assistant','2'],['user','3']],{pinned:true});
 const b=branchThread(t,1);assert.equal(b.messages.length,2);assert.notEqual(b.id,t.id);assert.notEqual(b.messages[0].id,t.messages[0].id);assert.equal(b.pinned,undefined);assert.match(b.title,/branch/);
});
