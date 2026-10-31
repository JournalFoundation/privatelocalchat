import test from 'node:test';
import assert from 'node:assert/strict';
import {createSentenceStream,createSpeaker,createVoiceSession,VOICE_STYLE} from '../chat/voice.mjs';
const sentences=(chunks,{final=true}={})=>{const out=[];const s=createSentenceStream({onSentence:t=>out.push(t)});let full='';for(const c of chunks){full+=c;s.update(full);}if(final)s.update(full,{final:true});return out;};
test('a streaming reply is spoken sentence by sentence as it arrives',()=>{
 const out=[];const s=createSentenceStream({onSentence:t=>out.push(t)});
 s.update('Hello there, my frie');assert.deepEqual(out,[]);
 s.update('Hello there, my friend. How are you do');assert.deepEqual(out,['Hello there, my friend.']);
 s.update('Hello there, my friend. How are you doing today? I hope well');assert.deepEqual(out,['Hello there, my friend.','How are you doing today?']);
 s.update('Hello there, my friend. How are you doing today? I hope well.',{final:true});assert.equal(out.at(-1),'I hope well.');
 assert.equal(out.length,3);
});
test('short fragments and abbreviations are joined to what follows, links and code are not read out',()=>{
 assert.deepEqual(sentences(['OK. That works for me, thanks for asking. See https://example.com/a/b for more.']),['OK. That works for me, thanks for asking.','See a link for more.']);
 const out=sentences(['Here is the code.\n```js\nconst a = 1;\n```\nIt sets a variable to one.']);
 assert.deepEqual(out,['Here is the code.','I left a code block out of the spoken reply.','It sets a variable to one.']);
 assert.deepEqual(sentences(['A list:\n- first thing here\n- second thing here\n']),['A list:','- first thing here','- second thing here']);
});
test('markdown is cleaned per sentence and the text is read from a growing string only once',()=>{
 const out=[];const s=createSentenceStream({onSentence:t=>out.push(t),clean:t=>t.replace(/\*\*/g,'')});
 s.update('This is **really** important to know. ');s.update('This is **really** important to know. And then more things follow here.',{final:true});
 assert.deepEqual(out,['This is really important to know.','And then more things follow here.']);
});
test('the speaker plays in order, can be cleared, and reports idle',async()=>{
 const played=[];let stops=0;
 const speakOne=t=>{let stop;const done=new Promise(r=>{stop=r;setTimeout(r,10);});played.push(t);return {done,stop(){stops++;stop();}};};
 const sp=createSpeaker(speakOne);sp.enqueue('one');sp.enqueue('two');sp.enqueue('three');
 await new Promise(r=>setTimeout(r,15));sp.clear();assert.ok(stops>=1);
 await sp.idle();assert.deepEqual(played.slice(0,2),['one','two']);assert.ok(!played.includes('three'),'cleared before it was spoken');assert.equal(sp.busy,false);
});
// ---- the session, with a hand-driven clock and fake microphone/voice
function rig(opts={}){
 let now=0,timers=[],id=0;const log=[],states=[],spoken=[],sent=[];let rec=null,aborts=0,listens=0,speakDelay=1;
 const setTimer=(fn,ms)=>{const t={id:++id,at:now+ms,fn};timers.push(t);return t.id;};
 const clearTimer=i=>{timers=timers.filter(t=>t.id!==i);};
 const advance=async ms=>{const end=now+ms;for(;;){const next=timers.filter(t=>t.at<=end).sort((a,b)=>a.at-b.at)[0];if(!next)break;now=next.at;timers=timers.filter(t=>t!==next);next.fn();await Promise.resolve();await Promise.resolve();}now=end;await Promise.resolve();};
 const session=createVoiceSession({
  listen:h=>{listens++;rec={...h,aborted:false,abort(){this.aborted=true;aborts++;}};return rec;},
  speakOne:text=>{spoken.push(text);let stop;const done=new Promise(r=>{stop=r;setTimer(r,speakDelay);});return {done,stop:()=>stop()};},
  send:async t=>{sent.push(t);},abortReply:()=>log.push('abort-reply'),onState:(s,i)=>states.push(s),
  unlockAudio:()=>log.push('unlock'),keepAwake:v=>log.push('awake:'+v),setTimer,clearTimer,silenceMs:1000,restartMs:200,...opts});
 return {session,advance,log,states,spoken,sent,get rec(){return rec;},get listens(){return listens;},get aborts(){return aborts;},setSpeakDelay:v=>{speakDelay=v;}};
}
test('start unlocks audio, keeps the screen on and listens; a pause after speaking sends what was said',async()=>{
 const r=rig();r.session.start();
 assert.deepEqual(r.log.slice(0,2),['unlock','awake:true']);assert.equal(r.session.state,'listening');
 r.rec.onText({final:'',interim:'tell me'});r.rec.onText({final:'tell me about cats',interim:''});
 await r.advance(900);assert.deepEqual(r.sent,[]);
 await r.advance(200);assert.deepEqual(r.sent,['tell me about cats']);assert.equal(r.session.state,'thinking');assert.ok(r.rec.aborted&&r.aborts>=1,'the microphone is off while thinking');
});
test('the reply is spoken as it streams, and listening resumes when it has all been spoken',async()=>{
 const r=rig();r.session.start();r.rec.onText({final:'hello',interim:''});await r.advance(1100);
 r.session.replyStarted();
 r.session.replyText('Cats are small mammals. They sleep a lot, ');
 await r.advance(5);assert.deepEqual(r.spoken,['Cats are small mammals.']);assert.equal(r.session.state,'speaking');
 r.session.replyText('Cats are small mammals. They sleep a lot, mostly during the day. Dogs differ.');
 r.session.replyEnded({text:'Cats are small mammals. They sleep a lot, mostly during the day. Dogs differ.'});
 await r.advance(50);
 assert.deepEqual(r.spoken,['Cats are small mammals.','They sleep a lot, mostly during the day.','Dogs differ.']);
 assert.equal(r.session.state,'listening');assert.equal(r.listens,2,'a fresh listening session for the next turn');
});
test('interrupting while speaking stops the speech and the reply, and goes straight back to listening',async()=>{
 const r=rig();r.setSpeakDelay(500);r.session.start();r.rec.onText({final:'tell me a story',interim:''});await r.advance(1100);
 r.session.replyStarted();r.session.replyText('Once upon a time there was a fox. It lived in a forest. ');await r.advance(10);
 assert.equal(r.session.state,'speaking');
 r.session.interrupt();
 assert.ok(r.log.includes('abort-reply'));assert.equal(r.session.state,'listening');
 r.session.replyText('Once upon a time there was a fox. It lived in a forest. More text arrives late.');
 await r.advance(2000);assert.deepEqual(r.spoken,['Once upon a time there was a fox.'],'nothing more is spoken after the interruption');
});
test('tapping while listening sends right away; tapping while thinking cancels',async()=>{
 const r=rig();r.session.start();r.rec.onText({final:'quick one',interim:''});r.session.tap();await r.advance(1);
 assert.deepEqual(r.sent,['quick one']);r.session.tap();assert.equal(r.session.state,'listening');
});
test('a recogniser that stops by itself is restarted, or sends what it had',async()=>{
 const r=rig();r.session.start();r.rec.onEnd();await r.advance(300);assert.equal(r.listens,2,'restarted after empty silence');
 r.rec.onText({final:'something',interim:''});r.rec.onEnd();await r.advance(1);assert.deepEqual(r.sent,['something']);
});
test('muting turns the microphone off and unmuting resumes; going to the background waits for a tap',async()=>{
 const r=rig();r.session.start();r.session.setMuted(true);assert.equal(r.session.state,'paused');assert.ok(r.rec.aborted);
 r.session.setMuted(false);assert.equal(r.session.state,'listening');
 r.session.pause();assert.equal(r.session.state,'paused');r.session.tap();assert.equal(r.session.state,'listening');
});
test('a permission problem ends the session with the reason; other errors just restart listening',async()=>{
 const r=rig();r.session.start();r.rec.onError({code:'no-speech'});await r.advance(1100);assert.equal(r.session.state,'listening');
 r.rec.onError({code:'not-allowed',message:'blocked'});assert.equal(r.session.state,'error');assert.equal(r.session.active,false);
});
test('a permission error after listening worked only pauses (the restart was not a tap); a stopped reply listens again',async()=>{
 const r=rig();r.session.start();r.rec.onText({final:'hi there',interim:''});r.session.tap();await r.advance(1);
 r.session.replyStarted();r.session.replyEnded({stopped:true});assert.equal(r.session.state,'listening');
 r.rec.onError({code:'not-allowed',message:'blocked'});assert.equal(r.session.state,'paused');assert.equal(r.session.active,true);
 r.session.tap();assert.equal(r.session.state,'listening');
});
test('a failed reply says so out loud and listens again; stop ends everything',async()=>{
 const r=rig();r.session.start();r.rec.onText({final:'hi',interim:''});await r.advance(1100);
 r.session.replyStarted();r.session.replyEnded({ok:false});await r.advance(20);
 assert.match(r.spoken[0],/did not work/);assert.equal(r.session.state,'listening');
 r.session.stop();assert.equal(r.session.state,'idle');assert.ok(r.log.includes('awake:false'));
});
test('the voice style tells the model to speak plainly',()=>{ assert.match(VOICE_STYLE,/read aloud/);assert.match(VOICE_STYLE,/Markdown/); });
