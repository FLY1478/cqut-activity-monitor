import type {Activity} from './activity.ts';
import type {Analysis} from './analysis.ts';

export function activityHighlights(a:Activity,analysis:Analysis,now=Date.now()){
  const yes=(key:string)=>/^(是|需要|开启|启用|要求)$/.test(a.fields[key]??'');
  const tasks:string[]=[],reminders:string[]=[];
  const instructions=analysis.participation.filter(x=>x.source!=='开启定位签到/签退：是').map(x=>x.instruction).join('；');
  if(yes('开启定位签到/签退')||yes('开启定位签到')||yes('开启定位签退'))tasks.push('定位操作');
  if(/签到/.test(instructions))tasks.push('签到');
  if(yes('活动签退')||/签退/.test(instructions))tasks.push('签退');
  if(yes('需要提交总结')||analysis.submissions.some(x=>/总结|心得/.test(x.instruction)))tasks.push('交总结／心得');
  if(analysis.submissions.some(x=>/作品|设计稿|视频|论文|照片|截图|文案/.test(x.instruction)))tasks.push('交材料／作品');
  if(/实际参与运动/.test(instructions))tasks.push('实际运动');
  if(/比赛／评比/.test(instructions))tasks.push('比赛／评比');
  if(/考试|测试|问卷|答题/.test(instructions))tasks.push('测试／问卷');
  if(!tasks.length)tasks.push('参加要求见说明');
  if(a.availability==='registered')reminders.push('已申请／已报名，请核对学校记录');
  else if(a.applyEnd!==undefined&&a.applyEnd<=now)reminders.push('报名已结束');
  else if(a.applyStart!==undefined&&a.applyStart>now)reminders.push('尚未开放报名');
  else if(a.availability==='full')reminders.push('名额已满，当前无法报名');
  else {
    if(a.applyEnd!==undefined&&a.applyEnd-now<=3*60*60*1000)reminders.push('报名将在3小时内截止');
    else if(a.applyEnd!==undefined&&a.applyEnd-now<=24*60*60*1000)reminders.push('报名将在24小时内截止');
    if(a.availability==='open'&&!a.unlimited&&a.capacity!==undefined&&a.registered!==undefined){
      const remaining=a.capacity-a.registered;if(remaining>0&&remaining<=15)reminders.push(`读取时剩余${remaining}个名额，报名时需再次核对`);
    }
  }
  for(const phrase of ['请勿报名','不接受报名','名单已定'])if(a.description.includes(phrase)){reminders.push(`学校说明含“${phrase}”，先核实是否允许报名`);break;}
  const cancel=a.fields['取消报名时间限制'];if(cancel)reminders.push(`取消报名限制（原文）：${cancel}`);
  return {tasks,reminders};
}
