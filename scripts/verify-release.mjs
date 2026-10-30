const origin=process.env.DEPLOY_SITE_URL;
const commit=process.env.GITHUB_SHA;
const branch=process.env.GITHUB_REF_NAME;
if(!origin||!commit||!['main','dev'].includes(branch))throw Error('Release verification needs the site, commit and release branch');
let last;
for(let attempt=0;attempt<20;attempt++){
 try{
  const r=await fetch(origin+'/version.json?verify='+commit,{cache:'no-store'});
  if(!r.ok)throw Error('Version HTTP '+r.status);
  const build=await r.json();
  if(build.commit!==commit||build.branch!==branch)throw Error('Published build does not match the requested commit/branch');
  const page=await fetch(origin+'/',{cache:'no-store'});
  if(!page.ok)throw Error('App HTTP '+page.status);
  if(page.headers.get('cross-origin-opener-policy')!=='same-origin'||page.headers.get('cross-origin-embedder-policy')!=='require-corp')throw Error('Browser isolation headers missing');
  const html=await page.text();
  if(html.includes('migration-warning-banner')||!html.includes('/releases/'+commit+'/local-models.js'))throw Error('Unexpected app shell');
  if(!html.includes('issues/new/choose')||!html.includes('View source'))throw Error('Code or feedback link missing');
  console.log('Verified '+origin+' at '+commit+' ('+branch+')');process.exit(0);
 }catch(e){last=e;await new Promise(resolve=>setTimeout(resolve,3000));}
}
throw last;
