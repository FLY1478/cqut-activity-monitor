import {createHmac} from 'node:crypto';
import {join} from 'node:path';
import {readSecret,writeSecret} from './secrets.ts';
import type {State} from './monitor.ts';
import {validateHealthReport,type HealthReport} from './health.ts';
export async function reportHealth(directory:string,state:State,error?:string):Promise<'disabled'|'accepted'|'failed'>{
  const pending=state.events.filter(e=>e.state==='pending');
  const daily=state.events.find(e=>e.id===`daily:${state.lastDigestDay}`);
  const report:HealthReport={version:1,observedAt:new Date().toISOString(),lastSuccessfulScan:state.baseline?.complete&&state.baseline.activities.every(a=>a.detailVerified===true)?state.baseline.scannedAt:undefined,lastAttempt:state.lastScanAttemptAt,lastError:error,digestDay:state.lastDigestDay,digestState:daily&&['accepted','received','pending','unknown','rejected','in_flight'].includes(daily.state)?daily.state as HealthReport['digestState']:undefined,pending:pending.length,rejected:state.events.filter(e=>e.state==='rejected').length,unknown:state.events.filter(e=>e.state==='unknown'||e.state==='in_flight').length,oldestPendingAt:pending.map(e=>e.createdAt).sort()[0]};
  validateHealthReport(report);await writeSecret(join(directory,'health-report.dpapi'),report);
  const config=await readSecret<{url:string;key:string}>(join(directory,'health-config.dpapi')).catch(e=>{if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw e;});
  if(!config)return 'disabled';
  const url=new URL(config.url);if(url.protocol!=='https:'||!url.hostname.endsWith('.workers.dev')||url.pathname!=='/api/health'||url.username||url.password||url.search||url.hash||!/^[a-f0-9]{64}$/i.test(config.key))throw new Error('INVALID_HEALTH_CONFIG');
  const body=JSON.stringify(report),signature=createHmac('sha256',Buffer.from(config.key,'hex')).update(body).digest('hex');
  try{const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-CQUT-Signature':signature},body,redirect:'error',signal:AbortSignal.timeout(10000)});return response.ok?'accepted':'failed';}catch{return 'failed';}
}
