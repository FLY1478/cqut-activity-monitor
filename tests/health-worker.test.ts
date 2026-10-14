import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {receiveHealth,queueHealthTransition,drainHealthAlarms,type Database,type HealthEnvironment,type Statement} from '../src/health-worker.ts';
const now=Date.parse('2026-10-14T14:25:00+08:00'),key='12'.repeat(32);
function setup(empty=false){
  const sqlite=new DatabaseSync(':memory:');if(!empty)sqlite.exec(readFileSync(new URL('../deploy/cloudflare/schema.sql',import.meta.url),'utf8'));
  const prepare=(sql:string):Statement=>{
    let values:any[]=[];
    return {bind(...v:unknown[]){values=v;return this;},async first<T>(){return sqlite.prepare(sql).get(...values) as T??null;},async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}};}};
  };
  const DB:Database={prepare,async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  const env:HealthEnvironment={DB,HEALTH_KEY:key,ENABLED_AT:'2026-10-14T07:50:00+08:00',WECHAT_APP_ID:'test',WECHAT_APP_SECRET:'test',WECHAT_OPEN_ID:'test',WECHAT_TEMPLATE_ID:'test'};
  return {env,sqlite};
}
const base={version:1,observedAt:new Date(now).toISOString(),pending:0,rejected:0,unknown:0};
const request=(body:unknown,signed=true)=>{const text=typeof body==='string'?body:JSON.stringify(body);return new Request('https://example.workers.dev/api/health',{method:'POST',headers:{'Content-Type':'application/json','X-CQUT-Signature':signed?createHmac('sha256',Buffer.from(key,'hex')).update(text).digest('hex'):'bad'},body:text});};

test('public endpoint reveals no state; authenticated reports reject tampering, private fields, stale values and replay',async()=>{
  const {env,sqlite}=setup(true);
  assert.deepEqual(await (await receiveHealth(new Request('https://example.workers.dev/ready'),env,now)).json(),{service:'cqut-health',version:1});
  assert.equal((await receiveHealth(new Request('https://example.workers.dev/api/health'),env,now)).status,404);
  assert.equal((await receiveHealth(request(base,false),env,now)).status,401);
  assert.equal((await receiveHealth(request({...base,password:'do-not-store'}),env,now)).status,400);
  assert.equal((await receiveHealth(request({...base,observedAt:new Date(now-6*60000).toISOString()}),env,now)).status,409);
  assert.equal((await receiveHealth(request('x'.repeat(4100)),env,now)).status,413);
  assert.equal((await receiveHealth(request(base),env,now)).status,200);
  assert.equal((await receiveHealth(request(base),env,now)).status,409);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM health_report').get()!.n,1);sqlite.close();
});
test('durable fault and recovery occur once; quiet hours cannot manufacture recovery; restarted ticks do not duplicate',async()=>{
  const {env,sqlite}=setup();
  await queueHealthTransition(env,now);await queueHealthTransition(env,now+60000);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM health_alarm').get()!.n,1);
  await queueHealthTransition(env,Date.parse('2026-10-14T23:00:00+08:00'));
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM health_alarm').get()!.n,1);
  assert.equal((await receiveHealth(request({...base,lastSuccessfulScan:base.observedAt}),env,now)).status,200);
  await queueHealthTransition(env,now);await queueHealthTransition(env,now+60000);
  const rows=sqlite.prepare('SELECT kind FROM health_alarm ORDER BY id').all();assert.deepEqual(rows.map(r=>r.kind),['fault','recovery']);sqlite.close();
});
test('a send timeout or crash after acceptance becomes uncertain without endless resend',async()=>{
  const {env,sqlite}=setup();await queueHealthTransition(env,now);let calls=0;
  const failingSend=async()=>{calls++;throw new Error('TRANSPORT_TIMEOUT');};
  await drainHealthAlarms(env,failingSend,now);await drainHealthAlarms(env,failingSend,now+60000);
  assert.equal(calls,1);assert.equal(sqlite.prepare('SELECT state FROM health_alarm WHERE id=1').get()!.state,'unknown');
  sqlite.prepare("INSERT INTO health_alarm(id,kind,issues,state,created_at,claimed_at) VALUES(2,'fault','scan_failed','in_flight',?,?)").run(new Date(now).toISOString(),new Date(now-6*60000).toISOString());
  await drainHealthAlarms(env,failingSend,now);assert.equal(calls,1);assert.equal(sqlite.prepare('SELECT state FROM health_alarm WHERE id=2').get()!.state,'unknown');sqlite.close();
});
test('explicit signed tests work at night without enabling production, persist outcomes and cannot repeat on duplicate clicks',async()=>{
  const {env,sqlite}=setup(true);delete env.ENABLED_AT;const at=Date.parse('2026-10-14T23:05:00+08:00');let calls=0;
  const data={version:1,observedAt:new Date(at).toISOString(),test:'fault'};
  const req=()=>{const r=request(data);return new Request('https://example.workers.dev/api/test',r);};
  const send=async()=>{calls++;return 'accepted' as const;};
  assert.deepEqual(await (await receiveHealth(req(),env,at,send)).json(),{test:'fault',status:'accepted'});
  assert.deepEqual(await (await receiveHealth(req(),env,at,send)).json(),{test:'fault',status:'accepted'});assert.equal(calls,1);
  const invalid=request({...data,schoolPassword:'private'});assert.equal((await receiveHealth(new Request('https://example.workers.dev/api/test',invalid),env,at,send)).status,400);assert.equal(calls,1);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM health_report').get()!.n,0);sqlite.close();
});
test('authenticated token diagnostics never send messages or disclose tokens and upstream bodies',async()=>{
  const {env,sqlite}=setup(true),original=globalThis.fetch;let sends=0;
  globalThis.fetch=async()=>new Response(JSON.stringify({access_token:'private-token-value',expires_in:7200,errmsg:'private-detail'}),{status:200});
  try{
    const data={version:1,observedAt:new Date(now).toISOString(),test:'auth'};
    const result=await receiveHealth(new Request('https://example.workers.dev/api/test',request(data)),env,now,async()=>{sends++;return 'accepted';});
    assert.deepEqual(await result.json(),{stage:'auth',endpoint:'stable',httpStatus:200,hasToken:true});assert.equal(sends,0);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='health_alarm'").get()!.n,0);
    globalThis.fetch=async()=>{throw new TypeError('Unsupported redirect mode: error private-token-value');};
    const diagnostic=await receiveHealth(new Request('https://example.workers.dev/api/test',request(data)),env,now);
    assert.deepEqual(await diagnostic.json(),{stage:'auth',endpoint:'stable',hasToken:false,failure:'REDIRECT_MODE'});
    globalThis.fetch=async(_input,init)=>{assert.equal(init?.redirect,'manual');return new Response('',{status:302,headers:{Location:'https://outside.example'}});};
    const redirected=await receiveHealth(new Request('https://example.workers.dev/api/test',request(data)),env,now);
    assert.deepEqual(await redirected.json(),{stage:'auth',endpoint:'stable',httpStatus:302,hasToken:false,failure:'REDIRECT_BLOCKED'});
  }finally{globalThis.fetch=original;sqlite.close();}
});
