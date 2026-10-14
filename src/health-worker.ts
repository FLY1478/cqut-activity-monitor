import {healthIssues,issueLabels,validateHealthReport,type HealthReport} from './health.ts';
import {localClock} from './schedule.ts';

// This service receives bounded operational metadata, never school credentials,
// activity contents, profiles or browser sessions. Bind only a dedicated D1 DB.
export interface Statement {
  bind(...values:unknown[]):Statement;
  first<T>():Promise<T|null>;
  run():Promise<{meta:{changes:number}}>;
}
export interface Database {prepare(sql:string):Statement;batch(statements:Statement[]):Promise<unknown[]>}
export type HealthEnvironment={DB:Database;ENABLED_AT?:string;HEALTH_KEY?:string;WECHAT_APP_ID?:string;WECHAT_APP_SECRET?:string;WECHAT_OPEN_ID?:string;WECHAT_TEMPLATE_ID?:string};
type Alarm={id:number;kind:'fault'|'recovery';issues:string;state:string;created_at:string};
const json=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-CQUT-Release':'health-diag-20261014-3'}});
const keyBytes=(key:string)=>new Uint8Array(key.match(/../g)!.map(x=>parseInt(x,16)));

export async function verifyHealthSignature(body:string,signature:string,key:string){
  if(!/^[a-f0-9]{64}$/i.test(key)||!/^[a-f0-9]{64}$/i.test(signature))return false;
  const imported=await crypto.subtle.importKey('raw',keyBytes(key),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  return crypto.subtle.verify('HMAC',imported,keyBytes(signature),new TextEncoder().encode(body));
}
async function initializeHealthDatabase(env:HealthEnvironment){
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS health_report(id INTEGER PRIMARY KEY CHECK(id=1), observed_ms INTEGER NOT NULL, payload TEXT NOT NULL)'),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS health_state(id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, issues TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS health_alarm(id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('fault','recovery')), issues TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','in_flight','accepted','rejected','unknown')), created_at TEXT NOT NULL, claimed_at TEXT, completed_at TEXT)"),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS health_alarm_pending ON health_alarm(state,id)'),
  ]);
}
export async function receiveHealth(request:Request,env:HealthEnvironment,now=Date.now(),sender=sendHealthAlarm):Promise<Response>{
  const path=new URL(request.url).pathname;
  if(path==='/ready'&&request.method==='GET')return json(200,{service:'cqut-health',version:1});
  if(!['/api/health','/api/test'].includes(path)||request.method!=='POST')return json(404,{error:'NOT_FOUND'});
  if(!env.HEALTH_KEY)return json(503,{error:'NOT_CONFIGURED'});
  if(request.headers.get('Content-Type')?.split(';')[0]!=='application/json')return json(415,{error:'INVALID_CONTENT_TYPE'});
  // Enforce the limit while streaming, including requests without Content-Length.
  if(Number(request.headers.get('Content-Length')??0)>4096)return json(413,{error:'TOO_LARGE'});
  const reader=request.body?.getReader();if(!reader)return json(400,{error:'INVALID_REPORT'});
  const chunks:Uint8Array[]=[];let length=0;
  for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>4096){await reader.cancel();return json(413,{error:'TOO_LARGE'});}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const body=new TextDecoder().decode(bytes);
  if(!await verifyHealthSignature(body,request.headers.get('X-CQUT-Signature')??'',env.HEALTH_KEY))return json(401,{error:'UNAUTHORIZED'});
  if(path==='/api/test'){
    let value:Record<string,unknown>;
    try{value=JSON.parse(body);if(!value||Array.isArray(value)||Object.keys(value).sort().join(',')!=='observedAt,test,version'||value.version!==1||typeof value.observedAt!=='string'||!['fault','recovery','auth'].includes(String(value.test)))throw 0;}catch{return json(400,{error:'INVALID_TEST'});}
    const observed=Date.parse(value.observedAt as string);if(!Number.isFinite(observed)||Math.abs(now-observed)>5*60000)return json(409,{error:'STALE_REPORT'});
    if(![env.WECHAT_APP_ID,env.WECHAT_APP_SECRET,env.WECHAT_OPEN_ID,env.WECHAT_TEMPLATE_ID].every(Boolean))return json(503,{error:'NOT_CONFIGURED'});
    if(value.test==='auth')return json(200,await probeWechatAuth(env));
    await initializeHealthDatabase(env);
    // Negative IDs isolate explicit, signed tests from automatic transitions.
    // A repeated click with the same body reads the recorded outcome, never resends.
    const id=-observed;
    await env.DB.prepare("INSERT OR IGNORE INTO health_alarm(id,kind,issues,state,created_at) VALUES(?,?,?,'pending',?)").bind(id,value.test,value.test==='fault'?'scan_failed':'',value.observedAt).run();
    const alarm=await env.DB.prepare('SELECT id,kind,issues,state,created_at FROM health_alarm WHERE id=?').bind(id).first<Alarm>();
    if(alarm)await dispatchAlarm(env,alarm,sender,now);
    const outcome=await env.DB.prepare('SELECT state FROM health_alarm WHERE id=?').bind(id).first<{state:string}>();
    return json(200,{test:value.test,status:outcome?.state??'unknown'});
  }
  let report:HealthReport;
  try{report=validateHealthReport(JSON.parse(body));}catch{return json(400,{error:'INVALID_REPORT'});}
  const observed=Date.parse(report.observedAt);
  if(Math.abs(now-observed)>5*60000)return json(409,{error:'STALE_REPORT'});
  // Initialization is behind signature and payload validation; anonymous
  // requests cannot allocate database tables or trigger migrations.
  await initializeHealthDatabase(env);
  const result=await env.DB.prepare('INSERT INTO health_report (id,observed_ms,payload) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET observed_ms=excluded.observed_ms,payload=excluded.payload WHERE excluded.observed_ms>health_report.observed_ms').bind(observed,JSON.stringify(report)).run();
  return result.meta.changes===1?json(200,{accepted:true}):json(409,{error:'REPLAYED_REPORT'});
}

export async function queueHealthTransition(env:HealthEnvironment,now=Date.now()):Promise<void>{
  if(!env.ENABLED_AT)return;
  const minute=localClock(now).minute;
  if(minute<8*60||minute>20*60+30)return; // quiet hours cannot generate a false recovery
  const row=await env.DB.prepare('SELECT payload FROM health_report WHERE id=1').first<{payload:string}>();
  const report=row?validateHealthReport(JSON.parse(row.payload)):undefined;
  const issues=healthIssues(now,env.ENABLED_AT,report).sort().join(',');
  await env.DB.prepare("INSERT OR IGNORE INTO health_state (id,version,issues) VALUES (1,0,'')").run();
  const state=await env.DB.prepare('SELECT version,issues FROM health_state WHERE id=1').first<{version:number;issues:string}>();
  if(!state||issues===state.issues)return;
  const version=state.version+1;
  // D1 batch is transactional: no gap between recording a transition and its
  // durable outbox. The version predicate lets concurrent ticks create one event.
  await env.DB.batch([
    env.DB.prepare("INSERT INTO health_alarm (id,kind,issues,state,created_at) SELECT ?,?,?,'pending',? FROM health_state WHERE id=1 AND version=?").bind(version,issues?'fault':'recovery',issues,new Date(now).toISOString(),state.version),
    env.DB.prepare('UPDATE health_state SET version=?,issues=? WHERE id=1 AND version=?').bind(version,issues,state.version),
  ]);
}
async function wechatApi(path:string,body?:unknown):Promise<Record<string,unknown>>{
  const response=await fetch('https://api.weixin.qq.com'+path,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,headers:body?{'Content-Type':'application/json'}:undefined,redirect:'manual',signal:AbortSignal.timeout(10000)});
  if(response.status>=300&&response.status<400)throw new Error('WECHAT_REDIRECT_BLOCKED');
  if(!response.ok)throw new Error('WECHAT_HTTP_FAILURE');
  return await response.json() as Record<string,unknown>;
}
async function probeWechatAuth(env:HealthEnvironment){
  let endpoint='stable',httpStatus:number|undefined;
  try{
    let response=await fetch('https://api.weixin.qq.com/cgi-bin/stable_token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'client_credential',appid:env.WECHAT_APP_ID,secret:env.WECHAT_APP_SECRET,force_refresh:false}),redirect:'manual',signal:AbortSignal.timeout(10000)});
    httpStatus=response.status;if(httpStatus>=300&&httpStatus<400)return {stage:'auth',endpoint,httpStatus,hasToken:false,failure:'REDIRECT_BLOCKED'};
    let data=await response.json() as Record<string,unknown>;
    if(data.errcode===48001){endpoint='classic';response=await fetch('https://api.weixin.qq.com/cgi-bin/token?'+new URLSearchParams({grant_type:'client_credential',appid:env.WECHAT_APP_ID!,secret:env.WECHAT_APP_SECRET!}),{redirect:'manual',signal:AbortSignal.timeout(10000)});httpStatus=response.status;if(httpStatus>=300&&httpStatus<400)return {stage:'auth',endpoint,httpStatus,hasToken:false,failure:'REDIRECT_BLOCKED'};data=await response.json() as Record<string,unknown>;}
    // Never return upstream bodies, error messages, URLs, IPs or the token.
    return {stage:'auth',endpoint,httpStatus:response.status,code:typeof data.errcode==='number'?data.errcode:undefined,hasToken:typeof data.access_token==='string'};
  }catch(e){
    const error=e instanceof Error?e:undefined;
    const failure=error&&['TimeoutError','AbortError'].includes(error.name)?'TIMEOUT':error&&/redirect/i.test(error.message)?'REDIRECT_MODE':error&&/AbortSignal|timeout.*(?:function|supported)/i.test(error.message)?'TIMEOUT_API':error instanceof SyntaxError?'RESPONSE_FORMAT':error&&/certificate|TLS|SSL/i.test(error.message)?'TLS':'NETWORK_OR_RESPONSE';
    return {stage:'auth',endpoint,httpStatus,hasToken:false,failure};
  }
}
export async function sendHealthAlarm(env:HealthEnvironment,alarm:Alarm):Promise<'accepted'|'rejected'|'unknown'>{
  try{
    let auth=await wechatApi('/cgi-bin/stable_token',{grant_type:'client_credential',appid:env.WECHAT_APP_ID,secret:env.WECHAT_APP_SECRET,force_refresh:false});
    if(auth.errcode===48001)auth=await wechatApi('/cgi-bin/token?'+new URLSearchParams({grant_type:'client_credential',appid:env.WECHAT_APP_ID!,secret:env.WECHAT_APP_SECRET!}));
    if(typeof auth.access_token!=='string')return 'rejected';
    const descriptions=alarm.issues.split(',').filter(Boolean).map(key=>issueLabels[key as keyof typeof issueLabels]).filter(Boolean).join('；');
    const test=alarm.id<0;
    const result=await wechatApi('/cgi-bin/message/template/send?access_token='+encodeURIComponent(auth.access_token),{touser:env.WECHAT_OPEN_ID,template_id:env.WECHAT_TEMPLATE_ID,data:{first:{value:(test?'独立告警测试｜':'')+(alarm.kind==='fault'?'第二课堂监测异常':'第二课堂监测已恢复')},keyword1:{value:test?'模拟故障／恢复，验证云端微信通知':alarm.kind==='fault'?descriptions:'完整扫描与通知状态恢复正常'},keyword2:{value:alarm.created_at},keyword3:{value:test?'测试消息':alarm.kind==='fault'?'请检查监测系统':'恢复'},remark:{value:test?'这是经过你授权发送的测试提醒；正式采集尚未上线。':'独立故障监测。此消息不代表活动报名，也不包含学校账号。'}}});
    if(result.errcode===0&&result.msgid!==undefined)return 'accepted';
    return typeof result.errcode==='number'&&result.errcode!==0?'rejected':'unknown';
  }catch{return 'unknown';} // never log token-bearing transport errors
}
export async function drainHealthAlarms(env:HealthEnvironment,send=sendHealthAlarm,now=Date.now()):Promise<void>{
  if(!env.ENABLED_AT||![env.WECHAT_APP_ID,env.WECHAT_APP_SECRET,env.WECHAT_OPEN_ID,env.WECHAT_TEMPLATE_ID].every(Boolean))return;
  const minute=localClock(now).minute;if(minute<8*60||minute>20*60+30)return;
  // A crash after claiming may have occurred after WeChat accepted the message.
  // Preserve the uncertainty; automatic retries could send duplicate alerts.
  await env.DB.prepare("UPDATE health_alarm SET state='unknown' WHERE state='in_flight' AND claimed_at<?").bind(new Date(now-5*60000).toISOString()).run();
  const alarm=await env.DB.prepare("SELECT id,kind,issues,state,created_at FROM health_alarm WHERE state='pending' AND id>0 ORDER BY id LIMIT 1").first<Alarm>();
  if(!alarm)return;
  await dispatchAlarm(env,alarm,send,now);
}
async function dispatchAlarm(env:HealthEnvironment,alarm:Alarm,send:typeof sendHealthAlarm,now:number){
  const claim=await env.DB.prepare("UPDATE health_alarm SET state='in_flight',claimed_at=? WHERE id=? AND state='pending'").bind(new Date(now).toISOString(),alarm.id).run();
  if(claim.meta.changes!==1)return;
  const outcome=await send(env,alarm).catch(()=>'unknown' as const);
  await env.DB.prepare("UPDATE health_alarm SET state=?,completed_at=? WHERE id=? AND state='in_flight'").bind(outcome,new Date(now).toISOString(),alarm.id).run();
}
export default {
  async fetch(request:Request,env:HealthEnvironment){try{return await receiveHealth(request,env);}catch{return json(503,{error:'HEALTH_STORAGE_UNAVAILABLE'});}},
  async scheduled(_event:unknown,env:HealthEnvironment){await queueHealthTransition(env);await drainHealthAlarms(env);},
};
