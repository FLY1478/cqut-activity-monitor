import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {writeSecret,readSecret} from '../src/secrets.ts';
import {dispatchNotification} from '../src/notify.ts';
import {sendWechatArticlePreviews} from '../src/wechat.ts';
import {commitScan,queueDigest,emptyState,reviewOutbox} from '../src/monitor.ts';
import type {Activity} from '../src/activity.ts';
import type {Scan} from '../src/school-client.ts';
const activity:Activity={id:'123',title:'讲座 <script>alert(1)</script>',url:'https://2class.cqut.edu.cn/Student/Activity/apply.html?activityID=123',applyEnd:4102444800000,fields:{'限制人员':'不限制学院','限制年级':'不限制','报名方式':'报名制','活动地点':'线上'},description:'参加讲座；提交100字总结',button:'报名',unlimited:true,qualification:{state:'eligible',reasons:[]},availability:'open'};
const scan:Scan={scannedAt:'2026-10-12T12:00:00Z',complete:true,profile:{},activities:[activity],coverage:{Activity:1,Project:0,Course:0},authMode:'restored',durationMs:1};
test('article dispatch targets only the configured recipient; quota and uncertain sends do not duplicate messages',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'cqut-article-'));const original=globalThis.fetch;let previews=0,templates=0;let behavior:'accepted'|'rejected'|'timeout'='accepted';
  try{
    await writeSecret(join(directory,'wechat.dpapi'),{appId:'fake-app',appSecret:'fake-secret',openId:'only-my-user',templateId:'fake-template'});
    await writeSecret(join(directory,'wechat-token.dpapi'),{appId:'fake-app',token:'fake-token',expiresAt:Date.now()+3600000});
    await writeSecret(join(directory,'notification-preferences.dpapi'),{style:'article-preview',dailyPreviewBudget:3});
    globalThis.fetch=(async(url:any,options:any)=>{
      const u=new URL(String(url));assert.equal(u.hostname,'api.weixin.qq.com');assert.equal(options.method,'POST');
      if(u.pathname==='/cgi-bin/media/upload')return Response.json({media_id:'fake-cover'});
      const body=JSON.parse(options.body);
      if(u.pathname==='/cgi-bin/media/uploadnews'){assert.equal(body.articles.length,1);assert.doesNotMatch(body.articles[0].content,/<script>/i);assert.equal(body.articles[0].content_source_url,activity.url);return Response.json({media_id:'fake-news'});}
      assert.equal(body.touser,'only-my-user');
      if(u.pathname==='/cgi-bin/message/mass/preview'){previews++;assert.equal(body.msgtype,'mpnews');if(behavior==='timeout')throw new Error('timeout');return Response.json(behavior==='rejected'?{errcode:48001}:{errcode:0});}
      assert.equal(u.pathname,'/cgi-bin/message/template/send');templates++;return Response.json({errcode:0,msgid:'fake-message'});
    }) as typeof fetch;
    const event=commitScan(emptyState(),scan).events[0]!;
    assert.deepEqual(await dispatchNotification(directory,event.message,event),{status:'accepted',channel:'article'});
    behavior='timeout';assert.equal((await dispatchNotification(directory,event.message,event)).status,'unknown');assert.equal(templates,0);
    behavior='rejected';assert.equal((await dispatchNotification(directory,event.message,event)).channel,'template_fallback');assert.equal(templates,1);
    behavior='accepted';assert.equal((await dispatchNotification(directory,event.message,event)).channel,'template_fallback');assert.equal(previews,3);assert.equal(templates,2);
    assert.equal((await readSecret<{attempts:number}>(join(directory,'preview-budget.dpapi'))).attempts,3);
    await writeSecret(join(directory,'preview-budget.dpapi'),{day:'2000-01-01',attempts:40});
    assert.equal((await dispatchNotification(directory,event.message,event)).channel,'article');assert.equal(previews,4);
    const daily=queueDigest(commitScan(emptyState(),{...scan,activities:Array.from({length:10},(_,n)=>({...activity,id:String(n)}))}),'2026-10-12').events.find(e=>e.id==='daily:2026-10-12')!;
    assert.equal((await dispatchNotification(directory,daily.message,daily)).channel,'article');assert.equal(previews,5);
    await assert.rejects(sendWechatArticlePreviews(directory,new Uint8Array(),[]),/INVALID_ARTICLE_BATCH/);
    await assert.rejects(sendWechatArticlePreviews(directory,new Uint8Array(),[{title:'bad',content:'<a href="https://evil.example">bad</a>',sourceUrl:activity.url,digest:''}]),/UNSAFE_ARTICLE_CONTENT/);
  }finally{globalThis.fetch=original;await rm(directory,{recursive:true,force:true});}
});
test('pending cards use the latest count and observation time while preserving original event evidence',()=>{
  const original=commitScan(emptyState(),scan);
  const latest={...activity,title:'最新讲座',fields:{...activity.fields,'报名人数':'9/10'},registered:9,capacity:10};
  const reviewed=reviewOutbox({...original,baseline:{...scan,scannedAt:'2026-10-12T12:05:00Z',activities:[latest]}});
  assert.equal(reviewed.events[0]?.changes[0]?.activity.title,activity.title);
  assert.equal(reviewed.events[0]?.effectiveChanges?.[0]?.activity.title,'最新讲座');
  assert.equal(reviewed.events[0]?.effectiveChanges?.[0]?.activity.registered,9);
  assert.equal(reviewed.events[0]?.observedAt,'2026-10-12T12:05:00Z');
});
