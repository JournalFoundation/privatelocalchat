import test from 'node:test';
import assert from 'node:assert/strict';
import {speechChunks,dictationAvailability,localVoices,bestVoice,speak} from '../chat/speech.mjs';
test('text is read in sentence-sized pieces',()=>{
 const text='First sentence here. Second one follows! And a question? '+'word '.repeat(80)+'\nNew paragraph.';
 const c=speechChunks(text,120);
 assert.ok(c.length>=5);assert.ok(c.every(x=>x.length<=125),JSON.stringify(c.map(x=>x.length)));
 assert.equal(c[0],'First sentence here. Second one follows! And a question?');
 assert.equal(c.at(-1),'New paragraph.');
});
test('only local voices are ever chosen',()=>{
 globalThis.speechSynthesis={getVoices:()=>[{voiceURI:'remote',localService:false,lang:'en-US'},{voiceURI:'local-fr',localService:true,lang:'fr-FR'},{voiceURI:'local-en',localService:true,lang:'en-GB'}],cancel(){},addEventListener(){}};
 assert.deepEqual(localVoices().map(v=>v.voiceURI),['local-fr','local-en']);
 assert.equal(bestVoice(undefined,'en-US').voiceURI,'local-en');assert.equal(bestVoice('local-fr','en-US').voiceURI,'local-fr');
 globalThis.speechSynthesis.getVoices=()=>[{voiceURI:'remote',localService:false,lang:'en-US'}];
 assert.equal(bestVoice(),null);
 delete globalThis.speechSynthesis;
});
test('read-aloud refuses rather than using a remote voice',async()=>{
 globalThis.SpeechSynthesisUtterance=class{};
 globalThis.speechSynthesis={getVoices:()=>[{voiceURI:'remote',localService:false,lang:'en-US'}],cancel(){},addEventListener(){},speak(){throw new Error('must not speak');}};
 await assert.rejects(speak('hello').done,/No on-device voice/);
 delete globalThis.speechSynthesis;delete globalThis.SpeechSynthesisUtterance;
});
test('dictation needs a recogniser that can be confirmed local',async()=>{
 delete globalThis.SpeechRecognition;delete globalThis.webkitSpeechRecognition;
 assert.equal((await dictationAvailability('en-US')).state,'unavailable');
 globalThis.webkitSpeechRecognition=class{};
 assert.match((await dictationAvailability('en-US')).reason,/can.t confirm/);
 globalThis.SpeechRecognition=class{static async available(o){assert.equal(o.processLocally,true);return 'available';}get processLocally(){return false;}set processLocally(v){}};
 assert.equal((await dictationAvailability('en-US')).state,'available');
 globalThis.SpeechRecognition.available=async()=>'downloadable';assert.equal((await dictationAvailability('en-US')).state,'downloadable');
 globalThis.SpeechRecognition.available=async()=>'unavailable';assert.equal((await dictationAvailability('en-US')).state,'unavailable');
 delete globalThis.SpeechRecognition;delete globalThis.webkitSpeechRecognition;
});
