import {resolve,join} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {scanSchool} from './school-client.ts';
import {readSecret,writeSecret} from './secrets.ts';
import {commitScan,queueDigest,mergeLatestUpdates,emptyState,deliver,recover,type State} from './monitor.ts';
import {scanDue,digestDay,inMonitoringWindow,localClock,schedulePolicy} from './schedule.ts';
import {dispatchNotification} from './notify.ts';
import {acquireLocalLock} from './local-lock.ts';
import {reportHealth} from './health-client.ts';
const privateDir=resolve(process.env.CQUT_PRIVATE_DIR??'../../work/private');
process.env.CQUT_PRIVATE_DIR=privateDir;
if(!process.env.CQUT_CHROMIUM_PATH&&process.platform==='win32')process.env.CQUT_CHROMIUM_PATH='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
await mkdir(privateDir,{recursive:true});
const statePath=join(privateDir,'monitor-state.dpapi');
const reportPath=resolve('local-report.json');
const rounds=process.argv.includes('--watch')?Infinity:1;
const scheduled=process.argv.includes('--watch')||process.argv.includes('--scheduled');
for(let round=0;round<rounds;round++){
    let release:(()=>Promise<void>)|undefined;
    try{
      release=await acquireLocalLock(privateDir);
      // Missing state is normal on the first run; damaged state must not reset the
      // baseline and resend every activity. Only ENOENT permits initialization.
      let state=await readSecret<State>(statePath).catch(e=>{if((e as NodeJS.ErrnoException).code==='ENOENT')return emptyState();throw e;});
      if(state.version!==1||!Array.isArray(state.events))throw new Error('INVALID_MONITOR_STATE');
      if(scheduled&&!scanDue(Date.now(),state.baseline?.scannedAt,state.lastDigestDay,state.lastScanAttemptAt)){
        await release();release=undefined;
        if(rounds===1)break;
        await new Promise(r=>setTimeout(r,60000));continue;
      }
      state=recover(state);await writeSecret(statePath,state);
      if(scheduled){
        const today=localClock(Date.now()).day;
        state={...state,lastScanAttemptAt:new Date().toISOString(),events:state.events.map(e=>e.state==='pending'&&e.id.startsWith('daily:')&&e.id!==`daily:${today}`?{...e,state:'filtered' as const,filterReason:'昨日汇总不在次日补发'}:e)};
        await writeSecret(statePath,state);
      }
      state={...state,lastScanAttemptAt:new Date().toISOString()};await writeSecret(statePath,state);
      const scan=await scanSchool(privateDir,{forceFresh:process.argv.includes('--fresh'),progress:p=>console.log(JSON.stringify(p))});
      state=commitScan(state,scan);await writeSecret(statePath,state);
      const day=scheduled?digestDay(Date.now(),state.lastDigestDay):undefined;
      if(day){state=queueDigest(state,day);await writeSecret(statePath,state);}
      else if(scheduled){state=mergeLatestUpdates(state);await writeSecret(statePath,state);}
      if(!process.argv.includes('--no-send')&&(!scheduled||inMonitoringWindow(Date.now())))state=await deliver(state,s=>writeSecret(statePath,s),(m,e)=>dispatchNotification(privateDir,m,e));
      const health=await reportHealth(privateDir,state).catch(()=>'failed');
      const report={finishedAt:new Date().toISOString(),status:scan.activities.some(a=>!a.detailVerified)?'scan_complete_with_unknown_details':'scan_complete',coverage:scan.coverage,details:scan.activities.length,detailWarnings:scan.activities.filter(a=>!a.detailVerified).length,authMode:scan.authMode,durationMs:scan.durationMs,
        qualification:scan.activities.reduce<Record<string,number>>((c,a)=>{c[a.qualification.state]=(c[a.qualification.state]??0)+1;return c;},{}),
        notifications:state.events.reduce<Record<string,number>>((c,e)=>{c[e.state]=(c[e.state]??0)+1;return c;},{}),lastSuccessfulScan:scan.scannedAt,schedule:scheduled?schedulePolicy:undefined,healthReporting:health,cloudEnabled:false};
      await writeFile(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
    }catch(e){
      const error=e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'LOCAL_OPERATION_FAILED';
      // The last successful baseline/outbox is untouched when collection fails.
      await writeFile(reportPath,JSON.stringify({failedAt:new Date().toISOString(),status:'failed',error,cloudEnabled:false},null,2));console.log(error);
      if(release)try{const saved=await readSecret<State>(statePath);const health=await reportHealth(privateDir,saved,error);if(health==='failed')console.log('HEALTH_REPORT_FAILED');}catch{console.log('HEALTH_REPORT_FAILED');}
      if(rounds===1)process.exitCode=1;
    }finally{await release?.();}
    if(round+1<rounds)await new Promise(r=>setTimeout(r,60000));
}
