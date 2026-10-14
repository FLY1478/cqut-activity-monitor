import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qualify,parseActivity,parseFields,importantFingerprint,type Activity} from '../src/activity.ts';
import {changes,commitScan,emptyState,deliver,recover,reviewOutbox,type State} from '../src/monitor.ts';
import {templatePayload,classifySendResponse} from '../src/wechat.ts';
import {acquireLocalLock} from '../src/local-lock.ts';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Scan} from '../src/school-client.ts';
const fields={'限制人员':'不限制学院','限制年级':'不限制','报名方式':'报名制'};
const item=(patch:Partial<Activity>={}):Activity=>({id:'123',title:'测试活动',url:'https://2class.cqut.edu.cn/Student/Activity/apply.html?activityID=123',applyStart:100,applyEnd:4102444800000,fields,description:'公开活动说明',button:'立即报名',unlimited:true,qualification:{state:'eligible',reasons:[]},availability:'open',...patch});
const scan=(items:Activity[],complete=true,at='2026-10-12T12:00:00Z'):Scan=>({scannedAt:at,complete,profile:{},activities:items,coverage:{Activity:items.length,Project:0,Course:0},authMode:'restored',durationMs:1});
test('eligibility uses explicit constraints; absent and narrative constraints stay unknown',()=>{
  assert.equal(qualify(fields,'公开活动',{}).state,'eligible');
  assert.equal(qualify({...fields,'限制人员':'甲学院'},'公开活动',{college:'乙学院'}).state,'ineligible');
  assert.equal(qualify({...fields,'限制年级':'2024级'},'公开活动',{}).state,'unknown');
  assert.equal(qualify({...fields,'限制年级':'2024级'},'公开活动',{grade:'2024'}).state,'eligible');
  assert.equal(qualify(fields,'仅限学生党员，花溪校区',{}).state,'unknown');
  assert.equal(qualify({...fields,'限制年级':'2023-2025'},'公开活动',{grade:'2024'}).state,'unknown');
  assert.equal(qualify({},'公开活动',{}).state,'unknown');
});
test('detail parsing distinguishes upcoming, full and seats restored without assuming missing capacity',()=>{
  const html=(n:string)=>`<body>测试活动<ul>${Object.entries({...fields,'报名人数':n}).map(([k,v])=>`<li class="mui-table-view-cell"><span class="mui-pull-right">${v}</span>${k}</li>`).join('')}</ul><div class="mui-content-padded"><div>活动详情</div><div>公开活动说明</div></div><a id="ok">立即报名</a></body>`;
  const raw={activityID:'123',activityName:'测试活动',applyStartDate:10,applyEndDate:100};
  assert.equal(parseActivity(raw,html('10/10'),item().url,{},50000).availability,'full');
  assert.equal(parseActivity(raw,html('9/10'),item().url,{},50000).availability,'open');
  assert.equal(parseActivity(raw,html('999/不限制'),item().url,{},50000).unlimited,true);
  assert.equal(parseActivity(raw,html(''),item().url,{},5000).availability,'upcoming');
  assert.equal(parseActivity(raw,html(''),item().url,{},100000).availability,'ended');
  assert.throws(()=>parseActivity(raw,'<body>登录页面</body>',item().url,{}),/TITLE_MISMATCH/);
});
test('college separators are retained; ambiguous labels are never false mismatches',()=>{
  const parsed=parseFields('<li class="mui-table-view-cell"><span class="mui-pull-right">甲学院<br>乙学院</span>限制人员</li>');
  assert.equal(qualify({...fields,...parsed},'公开活动',{college:'乙学院'}).state,'eligible');
  assert.equal(qualify({...fields,'限制人员':'甲学院乙学院'},'公开活动',{college:'乙学院'}).state,'unknown');
});
test('inconsistent school details remain unknown only with matching embedded ID',()=>{
  const raw={activityID:'123',activityName:'测试活动',applyStartDate:10,applyEndDate:100,status2:2};
  const html='<body><ul>'+['模块名称','类别名称','报名人数','限制人员','限制年级'].map(k=>`<li class="mui-table-view-cell">${k}</li>`).join('')+'</ul><script>const v={activityID:"123"};</script></body>';
  const a=parseActivity(raw,html,item().url,{},50000);assert.equal(a.qualification.state,'unknown');assert.equal(a.detailVerified,false);
  assert.throws(()=>parseActivity(raw,html.replace('activityID:"123"','activityID:"456"'),item().url,{},50000),/TITLE_MISMATCH/);
});
test('count fluctuations do not notify; opening, new, unknown and recovered seats do',()=>{
  const before=scan([item({registered:1})]);const next=scan([item({registered:2})]);
  assert.equal(importantFingerprint(before.activities[0]!),importantFingerprint(next.activities[0]!));
  assert.equal(changes(before,next).length,0);
  assert.equal(changes(scan([item({availability:'full'})]),next)[0]?.reason,'seat_restored');
  assert.equal(changes(scan([item({availability:'upcoming'})]),next)[0]?.reason,'opened');
  assert.equal(changes(scan([]),scan([item({qualification:{state:'unknown',reasons:['待核实']}})]))[0]?.reason,'new');
  assert.equal(changes(scan([]),scan([item({qualification:{state:'ineligible',reasons:['不符']}})])).length,0);
});
test('incomplete scans cannot replace baseline; repeated full scans do not enqueue again',()=>{
  const state=commitScan(emptyState(),scan([item()]));
  assert.throws(()=>commitScan(state,scan([],false)),/INCOMPLETE_SCAN/);
  assert.equal(state.baseline?.activities.length,1);
  assert.equal(commitScan(state,scan([item()],true,'2026-10-12T12:05:00Z')).events.length,1);
});
test('timeout becomes unknown and restart does not resend it',async()=>{
  let calls=0;let stored:State=emptyState();
  const state=await deliver(commitScan(emptyState(),scan([item()])),async s=>{stored=structuredClone(s);},async()=>{calls++;throw new Error('timeout');});
  assert.equal(state.events[0]?.state,'unknown');
  await deliver(stored,async()=>{},async()=>{calls++;return {status:'accepted'};});assert.equal(calls,1);
});
test('crash after accepted request but before persistence remains unknown on recovery',async()=>{
  let stored:State=emptyState();let calls=0;
  await assert.rejects(deliver(commitScan(emptyState(),scan([item()])),async s=>{if(s.events[0]?.state==='accepted')throw new Error('crash');stored=structuredClone(s);},async()=>{calls++;return {status:'accepted',messageId:'fake'};}));
  assert.equal(stored.events[0]?.state,'in_flight');assert.equal(recover(stored).events[0]?.state,'unknown');
  await deliver(stored,async()=>{},async()=>{calls++;return {status:'accepted'};});assert.equal(calls,1);
});
test('persist failure before HTTP send cannot produce an unrecorded send',async()=>{
  let calls=0;await assert.rejects(deliver(commitScan(emptyState(),scan([item()])),async s=>{if(s.events[0]?.state==='in_flight')throw new Error('disk full');},async()=>{calls++;return {status:'accepted'};}));assert.equal(calls,0);
});
test('WeChat acceptance is distinct from actual receipt and links cannot go off school',()=>{
  assert.equal(classifySendResponse({errcode:0,msgid:'fake'}).status,'accepted');
  assert.equal(classifySendResponse({errcode:43004}).status,'rejected');
  assert.equal(classifySendResponse({errcode:0}).status,'unknown');
  const message=commitScan(emptyState(),scan([item()])).events[0]!.message;
  assert.throws(()=>templatePayload({appId:'fake',appSecret:'fake',openId:'fake',templateId:'fake'},{...message,url:'https://evil.example/'}),/INVALID_NOTIFICATION_LINK/);
});
test('local process lock prevents overlap and permits recovery after release',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'cqut-lock-'));
  try{const release=await acquireLocalLock(directory);await assert.rejects(acquireLocalLock(directory),/ALREADY_LOCKED/);await release();const again=await acquireLocalLock(directory);await again();}finally{await rm(directory,{recursive:true,force:true});}
});
test('review filters only explicit mismatches and ended items, retaining original pending records',()=>{
  const original=commitScan(emptyState(),scan([item()]));
  const baseline=scan([item({fields:{...fields,'限制人员':'甲学院'}})]);baseline.profile={college:'乙学院'};
  const reviewed=reviewOutbox({...original,baseline});assert.equal(reviewed.events[0]?.state,'filtered');assert.equal(reviewed.events[0]?.changes.length,1);assert.equal(original.events[0]?.state,'pending');
});
test('legacy oversized pending batch is divided without deleting parent or any activity',()=>{
  const items=Array.from({length:8},(_,i)=>({activity:item({id:String(i+1)}),reason:'new' as const}));
  const state:State={version:1,baseline:scan(items.map(x=>x.activity)),events:[{id:'legacy',createdAt:'2026-10-12T12:00:00Z',state:'pending',changes:items,message:{title:'old',subject:'old',time:'old',status:'old',remark:'old',url:item().url}}]};
  const reviewed=reviewOutbox(state);assert.equal(reviewed.events[0]?.state,'divided');const pending=reviewed.events.filter(e=>e.state==='pending');assert.equal(pending.flatMap(e=>e.changes).length,8);for(const event of pending)assert.ok(event.message.remark.length<=1000);assert.equal(reviewOutbox(reviewed).events.length,reviewed.events.length);
});
test('notification link refuses tickets, credential query parameters and URL userinfo',()=>{
  const message=commitScan(emptyState(),scan([item()])).events[0]!.message;
  const config={appId:'fake',appSecret:'fake',openId:'fake',templateId:'fake'};
  assert.throws(()=>templatePayload(config,{...message,url:item().url+'&ticket=ST-fake'}),/INVALID_NOTIFICATION_LINK/);
  assert.throws(()=>templatePayload(config,{...message,url:'https://user:fake@2class.cqut.edu.cn/'}),/INVALID_NOTIFICATION_LINK/);
});
