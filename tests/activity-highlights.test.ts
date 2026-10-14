import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activityHighlights} from '../src/activity-highlights.ts';
import {analyze} from '../src/analysis.ts';
import {activityCardHtml,wechatArticleHtml} from '../src/card.ts';
import type {Activity} from '../src/activity.ts';
const now=Date.parse('2026-10-13T10:00:00+08:00');
const activity=(patch:Partial<Activity>={}):Activity=>({id:'123',title:'测试讲座',url:'https://2class.cqut.edu.cn/Student/Activity/apply.html?activityID=123',fields:{'需要提交总结':'是','活动签退':'是','开启定位签到/签退':'是'},description:'听讲后须提交300字心得。',qualification:{state:'unknown',reasons:[]},availability:'open',button:'立即报名',unlimited:false,capacity:10,registered:9,applyStart:now-1000,applyEnd:now+2*60*60*1000,...patch});
test('task labels and deadline reminders retain material evidence without promising credit',()=>{
  const a=activity(),h=activityHighlights(a,analyze(a),now);
  for(const label of ['定位操作','签退','交总结／心得'])assert.ok(h.tasks.includes(label));
  assert.ok(h.reminders.some(x=>x.includes('3小时内截止')));assert.ok(h.reminders.some(x=>x.includes('剩余1个名额')));
  for(const html of [activityCardHtml(a),wechatArticleHtml(a)]){assert.match(html,/参加清单/);assert.match(html,/300字心得/);assert.ok(!html.includes('就能拿分'));}
});
test('full, upcoming and ended reminders remain distinct; cancellation is quoted rather than interpreted',()=>{
  for(const [patch,expected] of [[{availability:'full'},'名额已满'],[{applyStart:now+1000},'尚未开放'],[{applyEnd:now-1},'已结束']] as const){const a=activity({...patch});const h=activityHighlights(a,analyze(a),now);assert.ok(h.reminders.some(x=>x.includes(expected)));}
  const a=activity({fields:{'取消报名时间限制':'否'},description:'无需报名，请勿重复报名。'}),h=activityHighlights(a,analyze(a),now);
  assert.ok(h.reminders.some(x=>x==='取消报名限制（原文）：否'));
  assert.ok(!h.reminders.some(x=>/不允许|名单已定|请勿报名/.test(x)));
});
