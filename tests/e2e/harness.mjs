// Builds the app, serves dist/, starts the fake provider and returns a Playwright page already configured for API mode.
import {execFileSync,spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
import {startFakeApi} from './fake-api.mjs';
import {setTimeout as sleep} from 'node:timers/promises';
export async function launch({build=true,port=18271,viewport={width:1280,height:800},storage={}}={}){
 if(build)execFileSync('node',['scripts/build.mjs'],{stdio:'pipe',env:{...process.env,DEPLOY_BRANCH:'local'}});
 const web=spawn('node',['scripts/serve.mjs'],{env:{...process.env,PORT:String(port)},stdio:'pipe'});
 const api=await startFakeApi();
 for(let i=0;i<50;i++){try{if((await fetch(`http://127.0.0.1:${port}/`)).ok)break;}catch{}await sleep(100);}
 const browser=await chromium.launch();
 const context=await browser.newContext({viewport,serviceWorkers:'block'});
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource|WebGPU|webgpu/i.test(m.text()))errors.push(m.text());});
 await page.addInitScript(({endpoint,storage})=>{
  if(!sessionStorage.getItem('chatConfig'))sessionStorage.setItem('chatConfig',JSON.stringify({endpoint,token:'',model:'fake-model',theme:'light'}));
  if(!sessionStorage.getItem('chatModels'))sessionStorage.setItem('chatModels',JSON.stringify(['fake-model']));
  if(!localStorage.getItem('plc.inferenceMode.v1'))localStorage.setItem('plc.inferenceMode.v1','api');
  for(const [k,v] of Object.entries(storage))if(!localStorage.getItem(k))localStorage.setItem(k,v);
 },{endpoint:`http://127.0.0.1:${api.port}/v1`,storage});
 await page.goto(`http://127.0.0.1:${port}/`);
 await page.waitForSelector('#messageInput');
 const close=async()=>{await browser.close();web.kill();await api.close();};
 return {page,context,browser,api,errors,close,origin:`http://127.0.0.1:${port}`};
}
export const assert=(cond,msg)=>{if(!cond)throw new Error('E2E assertion failed: '+msg);};
