import {join} from 'node:path';
import {load} from 'cheerio';
import type {BrowserContext} from 'playwright';
import {readSecret} from './secrets.ts';
import {loadPlaywright} from './runtime.ts';
import {launchNormalBrowser} from './normal-browser.ts';
import {MOBILE_UA} from './auth-protocol.ts';
import {parseActivity} from './activity.ts';
import {acquireLocalLock} from './local-lock.ts';
import {classifySignup,type Prepared} from './registration.ts';
import type {Scan} from './school-client.ts';
import {mergeProfile,readPreferences} from './preferences.ts';
import {protectReadOnly} from './read-only.ts';
export const isSignupRequest=(url:string)=>/^\/Student\/activity\/applyGo\.html$/i.test(new URL(url).pathname);
export async function prepareSchool(privateDir:string,id:string,allowLive:boolean):Promise<Prepared>{
  const release=await acquireLocalLock(privateDir);
  let cleanup:(()=>Promise<void>)|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined;let closed=false;
  const close=async()=>{if(closed)return;closed=true;clearTimeout(timer);try{await cleanup?.();}finally{await release();}};
  try{
    const scan=await readSecret<Scan>(join(privateDir,'latest-scan.dpapi'));
    const original=scan.activities.find(a=>a.id===id);if(!original)throw new Error('UNKNOWN_ACTIVITY');
    const pw=await loadPlaywright();const launched=await launchNormalBrowser(pw.chromium,process.env.CQUT_CHROMIUM_PATH!,privateDir);cleanup=launched.close;
    const state=await readSecret<Awaited<ReturnType<BrowserContext['storageState']>>>(join(privateDir,'session.dpapi'));
    const context=await launched.browser.newContext({userAgent:MOBILE_UA,viewport:{width:390,height:844},isMobile:true,hasTouch:true,storageState:state});
    // Read-only preparation never invokes the site's signup button. Browser mutation
    // requests are blocked even in live mode; only the explicitly gated API below submits.
    await protectReadOnly(context);
    const page=await context.newPage();await page.goto('https://2class.cqut.edu.cn/Student/Activity/index.html',{waitUntil:'load',timeout:45000});
    const link=page.locator(`#ajaxbox a[href*="activityID=${id}&"]`);await link.waitFor();await page.waitForTimeout(3000);
    await link.click();await page.waitForLoadState('load');await page.waitForTimeout(3000);
    const html=await page.content();const profile=mergeProfile(scan.profile,await readPreferences(privateDir));
    const activity=parseActivity({activityID:id,activityName:original.title,applyStartDate:original.applyStart&&original.applyStart/1000,applyEndDate:original.applyEnd&&original.applyEnd/1000,startDate:original.start&&original.start/1000,endDate:original.end&&original.end/1000,score:original.score},html,original.url,profile);
    const $=load(html);const src=$('#vcode').attr('src');
    if(!src)throw new Error('CAPTCHA_NOT_AVAILABLE');const url=new URL(src,page.url());
    if(url.origin!=='https://2class.cqut.edu.cn'||!/^\/Student\/Activity\/verifycode\.html$/i.test(url.pathname))throw new Error('UNEXPECTED_CAPTCHA_SOURCE');
    const image=await context.request.get(url.href,{maxRedirects:0,timeout:15000});
    const mime=image.headers()['content-type']?.split(';')[0];if(!image.ok()||!mime||!['image/png','image/jpeg','image/gif'].includes(mime))throw new Error('CAPTCHA_READ_FAILED');
    const bytes=await image.body();if(bytes.length>100000)throw new Error('CAPTCHA_TOO_LARGE');
    const s1=html.match(/\bs1\s*:\s*['"]([^'"\r\n]+)['"]/)?.[1];const s2=html.match(/\bs2\s*:\s*['"]([^'"\r\n]+)['"]/)?.[1];
    if(!s1||!s2)throw new Error('SIGNUP_FORM_CHANGED');
    timer=setTimeout(()=>{void close();},180000);timer.unref();
    return {activity,captcha:`data:${mime};base64,${bytes.toString('base64')}`,close,submit:async captcha=>{
      if(!allowLive)throw new Error('LIVE_SIGNUP_DISABLED');if(closed)throw new Error('SIGNUP_INTENT_EXPIRED');
      // No automatic CAPTCHA recognition, no background registration, no retries.
      const response=await context.request.post('https://2class.cqut.edu.cn/Student/activity/applyGo.html',{form:{activityID:id,activityApplyRand:captcha,s1,s2},maxRedirects:0,timeout:15000});
      if(!response.ok())return {state:'unknown',message:'学校未返回可确认结果，请查看官方报名记录'};
      return classifySignup(await response.json());
    }};
  }catch(e){await close();throw e;}
}
