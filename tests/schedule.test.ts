import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scanDue,digestDay,inMonitoringWindow} from '../src/schedule.ts';
import {queueDigest,mergeLatestUpdates,emptyState,commitScan,deliver,reviewOutbox} from '../src/monitor.ts';
import type {Scan} from '../src/school-client.ts';
import type {Activity} from '../src/activity.ts';
const at=(clock:string)=>Date.parse(`2026-10-12T${clock}:00+08:00`);
const scan=(activities:Activity[]=[],complete=true):Scan=>({scannedAt:new Date(at('19:00')).toISOString(),complete,activities,profile:{},coverage:{Activity:activities.length,Project:0,Course:0},authMode:'restored',durationMs:1});
test('night-time is quiet, including the 20:00 boundary',()=>{
  for(const clock of ['00:00','07:59','20:00','23:59']){assert.equal(inMonitoringWindow(at(clock)),false);assert.equal(scanDue(at(clock)),false);assert.equal(digestDay(at(clock)),undefined);}
  assert.equal(scanDue(at('08:00')),true);
});
test('30-minute polling, 19:00 digest, and retry after failures are distinct',()=>{
  const last=new Date(at('10:00')).toISOString();
  assert.equal(scanDue(at('10:29'),last,'2026-10-12'),false);
  assert.equal(scanDue(at('10:30'),last,'2026-10-12'),true);
  const recent=new Date(at('18:50')).toISOString();
  assert.equal(scanDue(at('19:00'),recent,undefined,recent),true);
  const failed=new Date(at('19:00')).toISOString();
  assert.equal(scanDue(at('19:01'),recent,undefined,failed),false);
  assert.equal(scanDue(at('19:30'),recent,undefined,failed),true);
  assert.equal(digestDay(at('19:30')),'2026-10-12');
  assert.equal(digestDay(at('19:30'),'2026-10-12'),undefined);
});
test('empty healthy daily report is sent once and survives restarts',async()=>{
  const state=queueDigest(commitScan(emptyState(),scan()),'2026-10-12');
  assert.equal(state.events.length,1);
  assert.equal(queueDigest(state,'2026-10-12').events.length,1);
  let sends=0;
  const result=await deliver(state,async()=>{},async()=>{sends++;return {status:'accepted'};});
  await deliver(result,async()=>{},async()=>{sends++;return {status:'accepted'};});
  assert.equal(sends,1);
  assert.throws(()=>queueDigest({...state,baseline:scan([],false)},'2026-10-13'),/COMPLETE_SCAN/);
});
test('same-scan new activity is included in one daily report rather than two messages',()=>{
  const a:Activity={id:'1',title:'模拟讲座',url:'https://2class.cqut.edu.cn/',fields:{},description:'',button:'',unlimited:false,availability:'open',qualification:{state:'unknown',reasons:['待核实']}};
  const result=queueDigest(commitScan(emptyState(),scan([a])),'2026-10-12');
  assert.equal(result.events.filter(e=>e.state==='pending').length,1);
  assert.equal(result.events.find(e=>e.id==='daily:2026-10-12')?.changes.length,1);
  const beforeCrash=commitScan(emptyState(),{...scan([a]),scannedAt:new Date(at('18:30')).toISOString()});
  const recovered=queueDigest(commitScan(beforeCrash,scan([a])),'2026-10-12');
  assert.equal(recovered.events.filter(e=>e.state==='pending').length,1);
  const many=scan(Array.from({length:10},(_,n)=>({...a,id:String(n)})));
  const updates=reviewOutbox(mergeLatestUpdates(commitScan(emptyState(),many)));
  assert.equal(updates.events.filter(e=>e.state==='pending').length,1);
  assert.equal(updates.events.find(e=>e.state==='pending')?.effectiveChanges?.length,10);
});
