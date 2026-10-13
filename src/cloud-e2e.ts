import {mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {openCloudTestConfig} from './cloud-test-config.ts';
import {readSecret,writeSecret} from './secrets.ts';
import {scanSchool,type Scan} from './school-client.ts';
import {emptyState,commitScan,queueDigest,deliver,type State} from './monitor.ts';
import {dispatchNotification} from './notify.ts';
import {localClock} from './schedule.ts';
import {acquireLocalLock} from './local-lock.ts';
const root=resolve(process.cwd()),directory=join(root,'.private','cloud-e2e');
const reportPath=join(root,'cloud-e2e-report.json');
const phase=process.argv.includes('--collect')?process.argv[process.argv.indexOf('--collect')+1]:undefined;
const safeError=(e:unknown)=>e instanceof Error&&e.name==='TimeoutError'?'BROWSER_TIMEOUT':e instanceof Error&&/^[A-Z_]{1,90}$/.test(e.message)?e.message:'CLOUD_TEST_OPERATION_FAILED';
const summarized=(scan:Scan)=>({complete:scan.complete,coverage:scan.coverage,details:scan.activities.length,verifiedDetails:scan.activities.filter(a=>a.detailVerified===true).length,authMode:scan.authMode,durationMs:scan.durationMs,sandboxVerified:scan.sandboxVerified===true});
function requireFullScan(scan:Scan,authMode:'fresh'|'restored'){
  if(!scan.complete||scan.activities.length!==scan.coverage.Activity||scan.activities.some(a=>a.detailVerified!==true))throw new Error('FULL_SCAN_VERIFICATION_FAILED');
  if(!scan.sandboxVerified)throw new Error('NORMAL_BROWSER_SANDBOX_NOT_VERIFIED');
  if(scan.authMode!==authMode)throw new Error('EXPECTED_AUTH_MODE_NOT_VERIFIED');
}
async function collect(){
  if(!['fresh','restored','missing_session'].includes(phase!))throw new Error('CLOUD_TEST_PHASE_INVALID');
  let release:(()=>Promise<void>)|undefined;
  let progress:unknown;
  try{
    release=await acquireLocalLock(directory);
    const scan=await scanSchool(directory,{forceFresh:phase==='fresh',sample:phase==='missing_session'?1:undefined,progress:value=>{progress=value;}});
    if(phase==='missing_session'){
      if(scan.authMode!=='fresh'||!scan.sandboxVerified||scan.activities.some(a=>!a.detailVerified))throw new Error('MISSING_SESSION_RECOVERY_NOT_VERIFIED');
    }else requireFullScan(scan,phase==='fresh'?'fresh':'restored');
    await writeSecret(join(directory,`${phase}-result.dpapi`),{ok:true,...summarized(scan)});
  }catch(e){await writeSecret(join(directory,`${phase}-result.dpapi`),{ok:false,error:safeError(e),progress});process.exitCode=1;}
  finally{await release?.();}
}
async function subprocess(name:string){
  const exit=await new Promise<number|null>((done,reject)=>{
    const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning',fileURLToPath(import.meta.url),'--collect',name],{env:process.env,stdio:'ignore',windowsHide:true});
    const timeout=setTimeout(()=>child.kill(),7*60*1000);
    child.on('error',()=>{clearTimeout(timeout);reject(new Error('CLOUD_TEST_CHILD_START_FAILED'));});
    child.on('exit',code=>{clearTimeout(timeout);done(code);});
  });
  const result=await readSecret<Record<string,unknown>>(join(directory,`${name}-result.dpapi`));
  if(exit!==0||result.ok!==true){console.log(JSON.stringify({collectionFailure:{phase:name,...result}}));throw new Error(typeof result.error==='string'?result.error:'CLOUD_TEST_CHILD_FAILED');}
  return result;
}
async function main(){
  const report:Record<string,any>={version:1,startedAt:new Date().toISOString(),purpose:'single_user_cloud_e2e_test',steps:[],schoolWriteEnabled:false,scheduled:false,rawArtifactsUploaded:false,actualReceiptConfirmed:false,naturalSessionExpiryVerified:false};
  const save=async()=>{await writeFile(reportPath,JSON.stringify(report,null,2),{mode:0o600});};
  try{
    if(process.platform!=='linux'||process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!=='FLY1478/cqut-activity-monitor')throw new Error('CLOUD_TEST_ENVIRONMENT_REQUIRED');
    const key=process.env.CQUT_E2E_STORAGE_KEY,payload=process.env.CQUT_E2E_CONFIG;if(!key||!payload)throw new Error('CLOUD_TEST_SECRETS_REQUIRED');
    const config=openCloudTestConfig(payload,key);
    process.env.CQUT_STORAGE_KEY=key;process.env.CQUT_PRIVATE_DIR=directory;process.env.CQUT_CLOUD_READONLY='1';
    delete process.env.CQUT_E2E_CONFIG;delete process.env.CQUT_E2E_STORAGE_KEY;
    await mkdir(directory,{recursive:true,mode:0o700});
    for(const [file,value] of [['credentials',config.credentials],['wechat',config.wechat],['preferences',config.preferences],['notification-preferences',config.notification]] as const)await writeSecret(join(directory,file+'.dpapi'),value);
    report.configValidated=true;await save();
    for(const name of ['fresh','restored','missing_session']){
      if(name==='missing_session')await writeSecret(join(directory,'session.dpapi'),{cookies:[],origins:[]});
      const result=await subprocess(name);report.steps.push({phase:name,...result});await save();
      if(name==='restored')await writeSecret(join(directory,'restored-scan.dpapi'),await readSecret<Scan>(join(directory,'latest-scan.dpapi')));
      console.log(JSON.stringify({phase:name,...result}));
      if(name!=='missing_session')await new Promise(r=>setTimeout(r,5000));
    }
    const scan=await readSecret<Scan>(join(directory,'restored-scan.dpapi'));requireFullScan(scan,'restored');
    let state=queueDigest(commitScan(emptyState(),scan),localClock(Date.now()).day);
    const event=state.events.find(e=>e.id.startsWith('daily:'))!;
    event.message={...event.message,title:`云端完整测试｜${event.changes.length}项活动汇总`};
    const statePath=join(directory,'test-outbox.dpapi');await writeSecret(statePath,state);
    // Exactly one aggregate event. An uncertain result is never retried here.
    state=await deliver(state,s=>writeSecret(statePath,s),(message,event)=>dispatchNotification(directory,message,event),[event.id]);
    const result=state.events.find(e=>e.id===event.id)!;
    report.notification={status:result.state,channel:result.channel,errorCode:result.errorCode,activityCount:event.changes.length,singleConfiguredRecipient:true};
    const persisted=await readSecret<State>(statePath);report.encryptedOutboxVerified=persisted.events.find(e=>e.id===event.id)?.state===result.state;
    report.status=result.state==='accepted'?'cloud_checks_passed_awaiting_phone_receipt':'notification_not_confirmed';
    if(result.state!=='accepted')process.exitCode=1;
  }catch(e){report.status='failed';report.error=safeError(e);process.exitCode=1;}
  finally{report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({cloudE2EReport:report}));}
}
if(process.argv.includes('--cleanup')){
  // This exact disposable directory is inside the checkout, never a user path.
  if(directory.startsWith(root+sep)&&directory!==root)await rm(directory,{recursive:true,force:true});
}else if(phase)await collect();else await main();
