// An OpenAI-compatible chat server for browser tests. The last user message picks the behaviour:
//   "fail-now" 500 error | "fail-mid" some tokens then a dropped connection | "length" finishes with finish_reason=length
//   "speak" three short sentences | "speak-long" forty sentences, 120 ms apart | "slow" many tokens, 30 ms apart | "markdown" a reply with every Markdown construct (and hostile HTML) | anything else is echoed
import {createServer} from 'node:http';
export function startFakeApi(port=0){
 const requests=[],seen={};
 const server=createServer(async(req,res)=>{
  const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'};
  if(req.method==='OPTIONS'){res.writeHead(204,cors);return res.end();}
  const url=new URL(req.url,'http://x');
  if(url.pathname==='/__requests'){res.writeHead(200,{...cors,'Content-Type':'application/json'});return res.end(JSON.stringify(requests));}
  if(url.pathname.endsWith('/models')){res.writeHead(200,{...cors,'Content-Type':'application/json'});return res.end(JSON.stringify({data:[{id:'fake-model'}]}));}
  let raw='';for await(const c of req)raw+=c;
  let body={};try{body=JSON.parse(raw);}catch{}
  requests.push({url:url.pathname,body});
  const last=[...(body.messages||[])].reverse().find(m=>m.role==='user')?.content||'';
  const prompt=typeof last==='string'?last:JSON.stringify(last);
  seen[prompt]=(seen[prompt]||0)+1;
  if(/fail-once/.test(prompt)&&seen[prompt]===1){res.writeHead(500,{...cors,'Content-Type':'application/json'});return res.end('{"error":{"message":"first attempt fails"}}');}
  if(/fail-now/.test(prompt)){res.writeHead(500,{...cors,'Content-Type':'application/json'});return res.end('{"error":{"message":"synthetic failure"}}');}
  const system=(body.messages||[]).filter(m=>m.role==='system').map(m=>typeof m.content==='string'?m.content:'').join('\n');
  let words;
  if(/markdown/.test(prompt))words=['# Heading\n\n','Some **bold** and `code`, plus <script>window.__pwned=1</script> and ![x](https://tracker.invalid/p.png) and [bad](javascript:window.__pwned=1).\n\n','- one\n- two\n\n','| a | b |\n|---|---|\n| 1 | 2 |\n\n','```js\nconst answer = 42;\n```\n'];
  else if(/compact summary/.test(prompt))words=['SUMMARY-TEXT'];
  else if(/cite it with its number/.test(system))words=['Per ','the ','excerpt ','[1], ','the ','answer ','is ','in ','the ','document.'];
  else if(/speak-long/.test(prompt))words=Array.from({length:40},(_,i)=>`This is sentence number ${i}. `);
  else if(/speak/.test(prompt))words=['Cats ','are ','small ','animals. ','They ','sleep ','a ','lot ','during ','the ','day. ','Dogs ','differ ','a ','great ','deal.'];
  else if(/slow/.test(prompt))words=Array.from({length:200},(_,i)=>`word${i} `);
  else if(/length/.test(prompt))words=['This ','answer ','was ','cut ','short'];
  else if(/fail-mid/.test(prompt))words=['Partial ','text ','before ','the ','crash '];
  else words=('Reply to: '+prompt.replace(/\n/g,' ').slice(0,200)).split(/(?<= )/);
  const delay=/speak-long/.test(prompt)?120:/slow/.test(prompt)?30:3;
  if(!body.stream){res.writeHead(200,{...cors,'Content-Type':'application/json'});return res.end(JSON.stringify({choices:[{message:{role:'assistant',content:words.join('')},finish_reason:'stop'}]}));}
  res.writeHead(200,{...cors,'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
  let closed=false;req.on('close',()=>{closed=true;});res.on('close',()=>{closed=true;});
  for(const w of words){
   if(closed)return;
   res.write('data: '+JSON.stringify({choices:[{delta:{content:w}}]})+'\n\n');
   await new Promise(r=>setTimeout(r,delay));
  }
  if(/fail-mid/.test(prompt)){res.destroy();return;}
  res.write('data: '+JSON.stringify({choices:[{delta:{},finish_reason:/length/.test(prompt)?'length':'stop'}]})+'\n\n');
  res.write('data: [DONE]\n\n');res.end();
 });
 return new Promise(resolve=>server.listen(port,'127.0.0.1',()=>resolve({server,port:server.address().port,requests,close:()=>new Promise(r=>{server.closeAllConnections?.();server.close(r);})})));
}
