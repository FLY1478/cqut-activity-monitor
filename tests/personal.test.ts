import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyze} from '../src/analysis.ts';
import {qualify,type Activity} from '../src/activity.ts';
import {notificationBatches,notification,type Change} from '../src/monitor.ts';
import {activityCardHtml} from '../src/card.ts';
import {schoolReadAllowed} from '../src/read-only.ts';
const profile={college:'甲学院',grade:'2024',campus:'两江校区',transfer:true,crossCampus:false,preferSimple:true};
const fields={'限制人员':'不限制学院','限制年级':'2024级','报名方式':'报名制','活动地点':'两江校区','需要提交总结':'否','活动签退':'否','开启定位签到':'否','开启定位签退':'否'};
const item=(patch:Partial<Activity>={}):Activity=>({id:'123',title:'学习讲座',url:'https://2class.cqut.edu.cn/Student/Activity/apply.html?activityID=123',fields,description:'到场听讲。无需提交作品。',button:'立即报名',unlimited:true,qualification:{state:'eligible',reasons:[]},availability:'open',detailVerified:true,...patch});
test('campus and grade exclusions are explicit; unknown location stays reviewable',()=>{
  assert.equal(qualify(fields,'全校开放',profile).state,'eligible');
  assert.equal(qualify({...fields,'活动地点':'花溪校区三教'},'全校开放',profile).state,'ineligible');
  assert.equal(qualify({...fields,'活动地点':'综合楼'},'全校开放',profile).state,'unknown');
  assert.equal(qualify({...fields,'活动地点':'线上腾讯会议'},'全校开放',profile).state,'eligible');
  assert.equal(qualify({...fields,'限制年级':'2023级'},'全校开放',profile).state,'ineligible');
  assert.equal(qualify(fields,'专升本学生除外',profile).state,'ineligible');
  assert.equal(qualify(fields,'仅限本科生',profile).state,'unknown');
  assert.equal(qualify({...fields,'限制年级':'2024 专升本'},'全校开放',profile).state,'unknown');
});
test('analysis does not invent deliverables; negation and topic lectures are distinguished',()=>{
  const lecture=analyze(item({title:'体育健康讲座',description:'听讲，无需提交视频或作品。但须提交100字总结。'}),profile);
  assert.equal(lecture.difficulty,'简单');assert.ok(!lecture.participation.some(x=>x.instruction.includes('实际参与运动')));
  assert.ok(!lecture.submissions.some(x=>/视频|作品/.test(x.instruction)));assert.match(lecture.submissionSummary,/100字总结/);
  const none=analyze(item(),profile);assert.equal(none.submissions.length,0);assert.match(none.submissionSummary,/核实/);
});
test('hands-on sports and competition are marked; difficult activities stay available for choice',()=>{
  const sport=analyze(item({title:'篮球比赛',description:'必须参加比赛，完成现场签到。'}),profile);assert.equal(sport.difficulty,'较难');assert.ok(sport.participation.some(x=>x.instruction.includes('实际参与运动')));assert.equal(sport.recommendation,'投入较多');
  const work=analyze(item({title:'线上设计活动',description:'上传设计稿及一段视频。'}),profile);assert.equal(work.difficulty,'较难');assert.match(work.submissionSummary,/设计稿/);
  const summary=analyze(item({fields:{...fields,'需要提交总结':'是'},description:'现场签到。'}),profile);assert.match(summary.submissionSummary,/提交总结/);assert.ok(summary.unknowns.some(x=>x.includes('字数')));
});
test('every notified activity retains evaluation and final material checklist within template limit',()=>{
  const items:Change[]=Array.from({length:12},(_,i)=>({activity:item({id:String(i+1),title:'测试讲座'+i,description:'现场签到后提交一篇300字总结。'}),reason:'new'}));
  const batches=notificationBatches(items);assert.equal(batches.flat().length,12);
  for(const batch of batches){const m=notification(batch,'');assert.ok(m.remark.length<=1000);assert.equal((m.remark.match(/需要交：/g)??[]).length,batch.length);assert.match(m.remark,/评价：/);}
});
test('required card facts are present and school HTML is escaped',()=>{
  const html=activityCardHtml(item({title:'<script>alert(1)</script>',description:'<img src=x onerror=alert(2)>'}),profile);
  assert.ok(!html.includes('<script>alert'));assert.ok(!html.includes('<img src=x'));assert.match(html,/&lt;script&gt;/);
  for(const label of ['模块／积分','报名时间','活动时间','活动地点','报名方式','人数限制','学院限制','年级限制','需要交什么'])assert.ok(html.includes(label));
});
test('read-only policy blocks real signup including encoded paths; accepts known list pagination POSTs',()=>{
  assert.equal(schoolReadAllowed('https://2class.cqut.edu.cn/Student/activity/applyGo.html','POST'),false);
  assert.equal(schoolReadAllowed('https://2class.cqut.edu.cn/Student/activity/%61pplyGo.html','GET'),false);
  assert.equal(schoolReadAllowed('https://2class.cqut.edu.cn/Student/Activity/apply.html?activityID=123','GET'),true);
  assert.equal(schoolReadAllowed('https://2class.cqut.edu.cn/Student/Activity/getActivityCanApply.html','POST'),true);
  assert.equal(schoolReadAllowed('https://2class.cqut.edu.cn/Student/My/save.html','POST'),false);
});
