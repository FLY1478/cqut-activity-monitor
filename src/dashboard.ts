import {resolve,join} from 'node:path';
import {readSecret,writeSecret} from './secrets.ts';
import {analyze} from './analysis.ts';
import {personalize} from './activity.ts';
import {mergeProfile,readPreferences} from './preferences.ts';
import {Registration,type SignupLedger} from './registration.ts';
import {prepareSchool} from './signup-school.ts';
import {startDashboard} from './dashboard-server.ts';
import type {State} from './monitor.ts';
import {acquireLocalLock} from './local-lock.ts';
const privateDir=resolve(process.env.CQUT_PRIVATE_DIR??'../../work/private');process.env.CQUT_PRIVATE_DIR=privateDir;
if(!process.env.CQUT_CHROMIUM_PATH)process.env.CQUT_CHROMIUM_PATH='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const live=process.argv.includes('--allow-live-signup');
// One dashboard per private database prevents stale ledger copies in two servers.
const releaseDashboard=await acquireLocalLock(privateDir,'dashboard');
const ledgerPath=join(privateDir,'signup-ledger.dpapi');
const ledger=await readSecret<SignupLedger>(ledgerPath).catch(e=>{if((e as NodeJS.ErrnoException).code==='ENOENT')return {version:1,attempts:[]} as SignupLedger;throw e;});
if(ledger.version!==1||!Array.isArray(ledger.attempts))throw new Error('INVALID_SIGNUP_LEDGER');
const data=async()=>{
  const state=await readSecret<State>(join(privateDir,'monitor-state.dpapi'));const scan=state.baseline;
  if(!scan)throw new Error('NO_SCAN_AVAILABLE');const profile=mergeProfile(scan.profile,await readPreferences(privateDir));
  const activities=scan.activities.map(a=>personalize(a,profile)).map(a=>({...a,analysis:analyze(a,profile)})).sort((a,b)=>a.analysis.rank-b.analysis.rank||(a.applyEnd??Infinity)-(b.applyEnd??Infinity));
  return {profile,scannedAt:scan.scannedAt,coverage:scan.coverage,activities,events:state.events.map(e=>({createdAt:e.createdAt,state:e.state,count:e.changes.length})),mode:live?'live':'simulation',cloudEnabled:false};
};
const registration=new Registration({mode:live?'live':'simulation',allowLive:live,ledger,persist:l=>writeSecret(ledgerPath,l),prepare:async id=>{
  if(live)return prepareSchool(privateDir,id,true);
  const activity=(await data()).activities.find(a=>a.id===id);if(!activity)throw new Error('UNKNOWN_ACTIVITY');
  return {activity,captcha:'simulation',close:async()=>{},submit:async captcha=>captcha==='1234'?{state:'success',message:'模拟通过：验证码与报名流程已验证，没有向学校发送报名'}:{state:'rejected',message:'模拟验证码错误，请重新准备；测试验证码为 1234'}};
}});
let nextInspect=0;
const dashboard=await startDashboard({data,registration,inspect:async id=>{
  if(!/^\d+$/.test(id))throw new Error('INVALID_ACTIVITY');
  if(Date.now()<nextInspect)throw new Error('SIGNUP_COOLDOWN');nextInspect=Date.now()+30000;
  const prepared=await prepareSchool(privateDir,id,false);
  try{return {activity:prepared.activity,captcha:prepared.captcha,analysis:analyze(prepared.activity,(await data()).profile),readOnly:true};}finally{await prepared.close();}
}});
// Local capability only: never commit, include in public reports, or share this link.
await writeSecret(join(privateDir,'dashboard-link.dpapi'),{url:dashboard.url});
console.log(`LOCAL_DASHBOARD_READY ${dashboard.origin} MODE=${live?'LIVE':'SIMULATION'}`);
let stopping=false;
const stop=async()=>{if(stopping)return;stopping=true;await dashboard.close();await releaseDashboard();process.exit(0);};
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
