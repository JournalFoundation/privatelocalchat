// Internal notices remain in the saved transcript, outside model context.
export function messagesForInference(thread){
 const messages=[],system=[];let conversationStarted=false;
 if(thread.systemPrompt?.trim())system.push(thread.systemPrompt.trim());
 for(const message of thread.messages||[]){
  if(message.notice===true)continue;
  const {role,content}=message;
  if(conversationStarted&&role==='system'&&typeof content==='string'&&/^Error:\s/i.test(content.trim()))continue;
  if(!conversationStarted&&role==='system'){if(content)system.push(content);continue;}
  if(role==='user'||role==='assistant')conversationStarted=true;
  messages.push({role,content});
 }
 return system.length?[{role:'system',content:system.join('\n\n')},...messages]:messages;
}
