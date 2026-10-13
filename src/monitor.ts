import {createHash} from 'node:crypto';
import {importantFingerprint,enrollment,personalize,type Activity} from './activity.ts';
import type {Scan} from './school-client.ts';
import type {Notification,SendResult} from './wechat.ts';
import {analyze} from './analysis.ts';
export type Change={activity:Activity;reason:'initial'|'new'|'opened'|'seat_restored'|'changed'};
export type Event={id:string;createdAt:string;observedAt?:string;state:'pending'|'in_flight'|'accepted'|'rejected'|'unknown'|'received'|'filtered'|'divided';changes:Change[];effectiveChanges?:Change[];message:Notification;messageId?:string;errorCode?:number;filterReason?:string;channel?:SendResult['channel']};
export type State={version:1;baseline?:Scan;events:Event[];lastDigestDay?:string;lastScanAttemptAt?:string};
export type DigestEvent=Event & {digestDay:string};
export const emptyState=():State=>({version:1,events:[]});
const relevant=(a:Activity)=>a.qualification.state!=='ineligible'&&['open','upcoming'].includes(a.availability);
export function changes(previous:Scan|undefined,next:Scan):Change[] {
  if(!next.complete)throw new Error('INCOMPLETE_SCAN_NOT_COMMITTED');
  const old=new Map(previous?.activities.map(a=>[a.id,a])??[]);const found:Change[]=[];
  for(const a of next.activities){
    if(!relevant(a))continue;
    const before=old.get(a.id);let reason:Change['reason']|undefined;
    if(!previous)reason='initial';
    else if(!before)reason='new';
    else if(before.availability==='full'&&a.availability==='open')reason='seat_restored';
    else if(before.availability!=='open'&&a.availability==='open')reason='opened';
    else if(importantFingerprint(before)!==importantFingerprint(a))reason='changed';
    if(reason)found.push({activity:a,reason});
  }
  return found.sort((a,b)=>analyze(a.activity,next.profile).rank-analyze(b.activity,next.profile).rank||(a.activity.applyEnd??Infinity)-(b.activity.applyEnd??Infinity));
}
export function notification(items:Change[],at:string):Notification {
  const labels={initial:'当前活动',new:'新活动',opened:'开放报名',seat_restored:'恢复名额',changed:'重要修改'};
  const when=(n:number|undefined)=>n===undefined?'未知':new Date(n).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
  const clip=(s:string,n:number)=>s.length>n?s.slice(0,n)+'…':s;
  const readable=items.map(({activity:a,reason})=>{const evaluation=analyze(a);const seats=enrollment(a);return `${labels[reason]} · ${clip(a.title,50)}\n【${clip(seats.fullness,35)}】上限${clip(seats.capacity,20)} · 已报${clip(seats.count,20)}\n模块：${clip(a.fields['模块名称']??'未知',30)}；${clip(String(a.fields['活动积分']??a.score??'未知'),40)}\n报名：${when(a.applyStart)} — ${when(a.applyEnd)}\n活动：${when(a.start)} — ${when(a.end)}\n地点：${clip(a.fields['活动地点']??'未知',35)}\n方式：${clip(a.fields['报名方式']??'未知',25)}\n学院：${clip(a.fields['限制人员']??'未知',45)}；年级：${clip(a.fields['限制年级']??'未知',30)}\n评价：${evaluation.difficulty} · ${evaluation.recommendation}；${evaluation.summary}\n参加：${clip(evaluation.participation.map(x=>x.instruction).join('；')||evaluation.effort,90)}\n资格：${a.qualification.state==='eligible'?'明确条件符合':'待核实'}；${clip(a.qualification.reasons.filter(x=>!/匹配|不限制/.test(x)).join('；')||'按页面要求完成',50)}\n需要交：${clip(evaluation.submissionSummary,110)}`;});
  const first=items[0]?.activity;
  if(!first)throw new Error('EMPTY_NOTIFICATION');
  return {title:`第二课堂：${items.length}项活动提醒`,subject:first.title,time:`${when(first.applyEnd)} 截止报名`,
    status:`${enrollment(first).fullness} · ${first.qualification.state==='eligible'?'明确条件符合':'资格待核实'}`,
    remark:readable.join('\n\n')+'\n点击进入首项活动；手机端可能需要学校登录。',url:first.url};
}
export function notificationBatches(items:Change[]):Change[][]{
  const batches:Change[][]=[];let current:Change[]=[];
  for(const item of items){const candidate=[...current,item];if(current.length&&notification(candidate,'').remark.length>980){batches.push(current);current=[item];}else current=candidate;}
  if(current.length)batches.push(current);return batches;
}
export function commitScan(state:State,scan:Scan):State {
  const diff=changes(state.baseline,scan);const events=[...state.events];
  for(const batch of notificationBatches(diff)){
    const id=createHash('sha256').update(JSON.stringify([state.baseline?.scannedAt??'initial',batch.map(x=>[x.activity.id,x.reason,importantFingerprint(x.activity)])])).digest('hex');
    if(!events.some(e=>e.id===id))events.push({id,createdAt:scan.scannedAt,state:'pending',changes:batch,message:notification(batch,scan.scannedAt)});
  }
  return {...state,version:1,baseline:scan,events};
}
export function queueDigest(state:State,day:string):State {
  if(!state.baseline?.complete)throw new Error('DIGEST_REQUIRES_COMPLETE_SCAN');
  if(state.lastDigestDay===day)return state;
  const items=state.baseline.activities.filter(relevant).sort((a,b)=>analyze(a,state.baseline!.profile).rank-analyze(b,state.baseline!.profile).rank).map(activity=>({activity,reason:'initial' as const}));
  const at=state.baseline.scannedAt;
  const message:Notification=items.length?{...notification(items,at),title:`每日二课汇总：${items.length}项活动`}:{title:'每日二课汇总：暂无可考虑活动',subject:'今天暂无符合或待核实的可报名活动',time:'每日19:00汇总',status:'完整扫描成功',remark:'报名已结束、已报名或明确条件不符合的活动未列入。',url:'https://2class.cqut.edu.cn/'};
  const event:DigestEvent={id:`daily:${day}`,digestDay:day,createdAt:at,state:'pending',changes:items,message};
  // Include queued updates from earlier scans too: a crash between committing
  // a scan and queuing the digest must not send that update a second time.
  const events=state.events.map(e=>e.state==='pending'&&!e.id.startsWith('daily:')?{...e,state:'filtered' as const,filterReason:'已合并到今日汇总；当前不可报名项目不再提醒'}:e);
  if(!events.some(e=>e.id===event.id))events.push(event);
  return {...state,lastDigestDay:day,events};
}
export function mergeLatestUpdates(state:State):State{
  const at=state.baseline?.scannedAt;
  const pending=state.events.filter(e=>e.state==='pending'&&e.createdAt===at&&!e.id.startsWith('daily:'));
  if(!pending.length||pending.some(e=>e.id.startsWith('updates:')))return state;
  const items=pending.flatMap(e=>e.changes),ids=new Set(pending.map(e=>e.id));
  const event:Event={id:`updates:${at}`,createdAt:at!,state:'pending',changes:items,message:{...notification(items,at!),title:`二课重要更新：${items.length}项活动`}};
  return {...state,events:[...state.events.map(e=>ids.has(e.id)?{...e,state:'filtered' as const,filterReason:'已合并到本轮更新'}:e),event]};
}
export function recover(state:State):State {
  // A crash while sending cannot tell whether WeChat received the request.
  // Keep the event for review; never turn it back into a pending automatic retry.
  return {...state,events:state.events.map(e=>e.state==='in_flight'?{...e,state:'unknown'}:e)};
}
export function reviewOutbox(state:State,eventIds?:string[]):State{
  const events=[...state.events],current=new Map(state.baseline?.activities.map(a=>[a.id,a])??[]);
  for(let i=0;i<state.events.length;i++){
    const event=events[i]!;if(event.state!=='pending'||eventIds&&!eventIds.includes(event.id))continue;
    const effective=event.changes.filter(c=>!state.baseline?.complete||current.has(c.activity.id)).map(c=>({...c,activity:personalize(current.get(c.activity.id)??c.activity,state.baseline?.profile??{})})).filter(c=>relevant(c.activity));
    if(event.id.startsWith('daily:')){events[i]={...event,effectiveChanges:effective,observedAt:state.baseline?.scannedAt??event.createdAt};continue;}
    if(!effective.length){events[i]={...event,state:'filtered',filterReason:'当前明确参加条件不符，或已不可报名；原提醒记录保留'};continue;}
    if(event.id.startsWith('updates:')){events[i]={...event,effectiveChanges:effective,observedAt:state.baseline?.scannedAt??event.createdAt,message:{...notification(effective,event.createdAt),title:`二课重要更新：${effective.length}项活动`}};continue;}
    const batches=notificationBatches(effective);
    if(batches.length===1){events[i]={...event,effectiveChanges:batches[0]!,observedAt:state.baseline?.scannedAt??event.createdAt,message:notification(batches[0]!,event.createdAt)};continue;}
    events[i]={...event,state:'divided'};
    batches.forEach((batch,n)=>{const id=`${event.id}:part:${n}`;if(!events.some(e=>e.id===id))events.push({...event,id,changes:batch,effectiveChanges:batch,observedAt:state.baseline?.scannedAt??event.createdAt,message:notification(batch,event.createdAt)});});
  }
  return {...state,events};
}
export async function deliver(state:State,persist:(value:State)=>Promise<void>,send:(message:Notification,event:Event)=>Promise<SendResult>,eventIds?:string[]):Promise<State> {
  state=reviewOutbox(recover(state),eventIds);await persist(state);
  for(let i=0;i<state.events.length;i++){
    if(state.events[i]!.state!=='pending'||eventIds&&!eventIds.some(id=>state.events[i]!.id===id||state.events[i]!.id.startsWith(id+':part:')))continue;
    state.events[i]={...state.events[i]!,state:'in_flight'};await persist(state);
    let result:SendResult;
    try{result=await send(state.events[i]!.message,state.events[i]!);}catch{result={status:'unknown'};}
    state.events[i]={...state.events[i]!,state:result.status,messageId:result.messageId,errorCode:result.errorCode,channel:result.channel};await persist(state);
    if(i<state.events.length-1)await new Promise(r=>setTimeout(r,1000));
  }
  return state;
}
