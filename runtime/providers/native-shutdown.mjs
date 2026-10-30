// The pinned runtime's default exit terminates its worker without calling native exit.
// Ask its existing wire protocol to free native resources first; termination remains bounded.
export async function shutdownNativeRuntime(runtime,{timeoutMs=3000}={}){
 const proxy=runtime?.proxy;
 if(!runtime)return {nativeExit:'not-running'};
 if(!proxy?.worker||proxy.workerOwnedExternally){await runtime.exit();return {nativeExit:proxy?.workerOwnedExternally?'externally-owned':'not-running'};}
 const worker=proxy.worker,started=performance.now();let timer,nativeExit='acknowledged',errorName;
 try{
  const result=await Promise.race([
   proxy.pushTask({verb:'wllama.exit',args:[],callbackId:proxy.taskId++}),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('Native cleanup timed out'),{name:'TimeoutError'})),timeoutMs);}),
  ]);
  if(typeof result==='string'&&result.startsWith('{')&&JSON.parse(result).success===false)throw Error('Native cleanup refused');
 }catch(error){nativeExit=error.name==='TimeoutError'?'timed-out':'failed';errorName=error.name;}
 finally{
  clearTimeout(timer);
  try{await runtime.exit();}catch(error){worker.terminate();throw error;}
 }
 return {nativeExit,nativeExitMs:Math.round(performance.now()-started),...(errorName?{errorName}:{})};
}
