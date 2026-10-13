import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {readSecret,writeSecret} from './secrets.ts';
import {sendWechat,sendWechatArticlePreviews,type SendResult,type Notification} from './wechat.ts';
import {wechatArticleHtml} from './card.ts';
import {analyze} from './analysis.ts';
import {readPreferences} from './preferences.ts';
import type {Event} from './monitor.ts';
export async function dispatchNotification(directory:string,message:Notification,event:Event):Promise<SendResult>{
  const settings:{style:string;dailyPreviewBudget?:number}=await readSecret<{style:string;dailyPreviewBudget?:number}>(join(directory,'notification-preferences.dpapi')).catch(e=>{if((e as NodeJS.ErrnoException).code==='ENOENT')return {style:'template'};throw e;});
  if(settings.style==='article-preview'){
    const selected=event.effectiveChanges??event.changes;
    if(!selected.length)return {...await sendWechat(directory,message),channel:'template_fallback'};
    const day=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
    const budgetPath=join(directory,'preview-budget.dpapi');
    let budget=await readSecret<{day:string;attempts:number}>(budgetPath).catch(e=>{if((e as NodeJS.ErrnoException).code==='ENOENT')return {day,attempts:0};throw e;});
    if(budget.day!==day)budget={day,attempts:0};
    const configured=settings.dailyPreviewBudget??40;
    const limit=Number.isFinite(configured)?Math.max(0,Math.min(40,Math.floor(configured))):0;
    if(budget.attempts<limit){
      const profile=await readPreferences(directory);const cover=await readFile(new URL('../assets/activity-cover.png',import.meta.url));
      const cards=selected.map(({activity:a})=>({title:'活动卡片｜'+a.title,content:wechatArticleHtml(a,profile,event.observedAt??event.createdAt),sourceUrl:a.url,digest:analyze(a,profile).summary}));
      const articles=event.id.startsWith('daily:')||event.id.startsWith('updates:')?[{title:message.title,content:cards.map(card=>`<h2>${card.title.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]!))}</h2>${card.content}`).join('<hr>'),sourceUrl:cards[0]!.sourceUrl,digest:`${cards.length}项可考虑或待核实活动，含报名状态、时间和所需材料。`}]:cards;
      // Reserve the attempt before sending; crashes must not reset daily quota.
      budget.attempts++;await writeSecret(budgetPath,budget);
      const result=await sendWechatArticlePreviews(directory,cover,articles);
      if(result.status!=='rejected')return {...result,channel:'article'};
      // An explicit API rejection confirms that no preview was accepted. Only
      // then may the verified template channel be used without an uncertain retry.
    }
    return {...await sendWechat(directory,message),channel:'template_fallback'};
  }
  return {...await sendWechat(directory,message),channel:'template'};
}
