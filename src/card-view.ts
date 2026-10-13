import {analyze} from './analysis.ts';
import {enrollment,type Activity,type Profile} from './activity.ts';
import {activityHighlights} from './activity-highlights.ts';
export const escapeCard=(value:unknown)=>String(value??'未知').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const tones={neutral:['#f1f5f9','#475569','#cbd5e1'],fit:['#dcfce7','#166534','#86efac'],warn:['#fef3c7','#92400e','#fcd34d'],reject:['#fee2e2','#991b1b','#fca5a5'],filled:['#dc2626','#ffffff','#991b1b'],blue:['#dbeafe','#1e40af','#93c5fd'],mint:['#f0fdfa','#0f766e','#99f6e4'],purple:['#f5f3ff','#6d28d9','#ddd6fe'],task:['#fff7ed','#9a3412','#fed7aa']} as const;
export function cardView(a:Activity,profile:Profile={}){
  const evaluation=analyze(a,profile),seats=enrollment(a),highlights=activityHighlights(a,evaluation);
  const when=(value:number|undefined,short=false)=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',...(short?{}:{year:'numeric' as const}),month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'未写明';
  const tag=(text:unknown,tone:keyof typeof tones='neutral')=>{const [bg,color,border]=tones[tone];return `<span style="display:inline-block;font-size:10px;font-weight:600;line-height:1.5;background:${bg};color:${color};border:1px solid ${border};padding:3px 9px;border-radius:20px;margin:0 5px 5px 0;overflow-wrap:anywhere">${escapeCard(text)}</span>`;};
  const qualified=a.qualification.state==='eligible'?'✓ 符合':a.qualification.state==='ineligible'?'条件不符':'资格待核实';
  const status={open:'正在报名',upcoming:'即将开放',full:'人数已满',ended:'报名结束',registered:'已报名／已申请',unknown:'报名状态未知'}[a.availability];
  const full=seats.fullness==='已满',border=evaluation.difficulty==='简单'?'#22c55e':evaluation.difficulty==='较难'?'#ef4444':'#f59e0b';
  const tags=tag(qualified,a.qualification.state==='eligible'?'fit':a.qualification.state==='ineligible'?'reject':'warn')+tag(evaluation.difficulty,evaluation.difficulty==='简单'?'fit':evaluation.difficulty==='较难'?'reject':'warn')+(full?'':tag(status,a.availability==='open'?'blue':'neutral'))+tag(seats.fullness,full?'filled':'mint')+tag(`上限 ${seats.capacity} · 已报 ${seats.count}`)+tag('活动 '+when(a.start,true))+tag('报名截止 '+when(a.applyEnd,true),'warn')+tag(`${a.fields['模块名称']??'模块未写明'} · ${a.fields['活动积分']??a.score??'积分未知'}`,'purple');
  const facts=[['模块／积分',`${a.fields['模块名称']??'未知'} · ${a.fields['活动积分']??a.score??'未知'}`],['报名时间',`${when(a.applyStart)} — ${when(a.applyEnd)}`],['活动时间',`${when(a.start)} — ${when(a.end)}`],['活动地点',a.fields['活动地点']??'未知'],['报名方式',a.fields['报名方式']??'未知'],['人数限制',`上限 ${seats.capacity} · 已报 ${seats.count}`],['学院限制',a.fields['限制人员']??'未知'],['年级限制',a.fields['限制年级']??'未知']];
  const taskTags=highlights.tasks.map(t=>tag(t,'task')).join('');
  const reminder=highlights.reminders.length?`<p style="font-size:11px;color:#92400e;line-height:1.7;margin:7px 0 0">${highlights.reminders.map(escapeCard).join('<br>')}</p>`:'';
  const insight=`<section style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:11px 13px;margin:12px 0;color:#78350f"><p style="font-size:12px;font-weight:700;color:#92400e;margin:0">✈️ 活动点评</p><p style="font-size:11px;font-weight:600;margin:6px 0">${escapeCard(evaluation.recommendation)} · ${escapeCard(evaluation.difficulty)}</p><p style="font-size:13px;line-height:1.9;margin:0">${escapeCard(evaluation.summary)}</p></section>`;
  const needs=`<section style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:11px 13px;margin:12px 0;color:#166534"><p style="font-size:12px;font-weight:700;margin:0">需要交什么</p><p style="font-size:13px;line-height:1.9;margin:5px 0 0">${escapeCard(evaluation.submissionSummary)}</p></section>`;
  return {evaluation,seats,highlights,when,tags,taskTags,reminder,border,facts,insight,needs};
}
