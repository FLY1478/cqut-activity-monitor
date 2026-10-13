import {join} from 'node:path';
import {load} from 'cheerio';
import {loadPlaywright} from './runtime.ts';
import {launchNormalBrowser} from './normal-browser.ts';
import {readSecret,writeSecret} from './secrets.ts';
import {ROOT,LOGIN,MOBILE_UA,encryptPassword,classifyLogin,jsonShape} from './auth-protocol.ts';
import {parseActivity,parseProfile,type Activity,type Profile} from './activity.ts';
import type {Page,BrowserContext} from 'playwright';
import {readPreferences,mergeProfile} from './preferences.ts';
import {protectReadOnly} from './read-only.ts';
type IndexResult={raw:Record<string,unknown>[];html:string;links:Map<string,string>};
const origin='https://2class.cqut.edu.cn';
const settings={userAgent:MOBILE_UA,viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block' as const};

async function index(page:Page,section:'Activity'|'Project'|'Course',click=false):Promise<IndexResult> {
  const endpoint={Activity:'getActivityCanApply',Project:'getProjectsCanApply',Course:'getCoursesCanApply'}[section];
  const waiting=page.waitForResponse(r=>r.url().includes(`/${endpoint}.html`),{timeout:30000});
  const navigation=click?page.locator(`a[href="/Student/${section}/index.html"]`).last().click():page.goto(`${origin}/Student/${section}/index.html`,{waitUntil:'domcontentloaded',timeout:45000});
  const [,response]=await Promise.all([navigation,waiting]);
  if(response.status()!==200)throw new Error('LIST_HTTP_FAILURE');
  let payload=await response.json();
  const raw:Record<string,unknown>[]=[];
  let finished=false;
  for(let n=0;n<100;n++){
    const batch=section==='Activity'?payload:(Array.isArray(payload)&&payload.length===2?payload[1]:undefined);
    if(!Array.isArray(batch)||batch.some(a=>!a||typeof a!=='object')){console.log(JSON.stringify({phase:'schema',section,shape:Array.isArray(payload)?payload.map(v=>jsonShape(v)):jsonShape(payload)}));throw new Error('LIST_SCHEMA_FAILURE');}
    raw.push(...batch);
    await page.waitForLoadState('load');
    if(section==='Activity'||batch.length===0){finished=true;break;}
    await page.waitForTimeout(1500);
    const next=page.waitForResponse(r=>r.url().includes(`/${endpoint}.html`),{timeout:30000});
    await page.locator('#more').click();const following=await next;
    if(following.status()!==200)throw new Error('PAGINATION_HTTP_FAILURE');
    payload=await following.json();
  }
  if(!finished)throw new Error('PAGINATION_LIMIT_EXCEEDED');
  await page.waitForLoadState('load');
  if(raw.length)await page.locator('#ajaxbox a').first().waitFor();
  const html=await page.content();const $=load(html);const links=new Map<string,string>();
  $('#ajaxbox a[href]').each((_,a)=>{const url=new URL($(a).attr('href')!,origin);const id=url.searchParams.get(`${section.toLowerCase()}ID`);if(id){if(links.has(id))throw new Error('DUPLICATE_RENDERED_ID');links.set(id,url.href);}});
  const idKey=`${section.toLowerCase()}ID`;
  const ids=raw.map(a=>String(a[idKey]??''));
  if(ids.some(id=>!/^\d+$/.test(id))||new Set(ids).size!==ids.length||ids.length!==links.size||ids.some(id=>!links.has(id)))throw new Error('LIST_COMPLETENESS_FAILURE');
  // A future pagination feature must be adapted rather than silently scanning page 1.
  if(section==='Activity'&&/loadMore|pageSize|currentPage|下一页|加载更多/.test(html))throw new Error('PAGINATION_REQUIRES_ADAPTER');
  return {raw,html,links};
}
async function authenticate(context:BrowserContext):Promise<Page> {
  const page=await context.newPage();await page.goto(ROOT,{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForURL('https://uis.cqut.edu.cn/**',{timeout:30000});
  const privateDir=process.env.CQUT_PRIVATE_DIR!;
  const credentials=await readSecret<{account:string;password:string}>(join(privateDir,'credentials.dpapi'));
  const response=await context.request.post(LOGIN,{data:{name:credentials.account,pwd:encryptPassword(credentials.password),verifyCode:'',universityId:'100005'},headers:{Origin:'https://uis.cqut.edu.cn',Referer:page.url()},maxRedirects:0,timeout:30000});
  const outcome=classifyLogin((await response.json()).code);
  if(outcome!=='accepted')throw new Error(outcome.toUpperCase());
  await page.reload({waitUntil:'domcontentloaded',timeout:45000});await page.waitForTimeout(2000);
  if((await page.locator('body').innerText()).includes('请选择本次登录角色')){
    const select=page.locator('select');const students=(await select.locator('option').allTextContents()).filter(s=>/学生/.test(s));
    if(students.length!==1)throw new Error('STUDENT_ROLE_NOT_CONFIRMED');
    await select.selectOption({label:students[0]!});await page.getByText('确定',{exact:true}).click();await page.waitForTimeout(2000);
  }
  if(!page.url().includes('/Student/'))throw new Error('STUDENT_ROLE_NOT_CONFIRMED');return page;
}
export type Scan={scannedAt:string;complete:boolean;profile:Profile;activities:Activity[];coverage:{Activity:number;Project:number;Course:number};authMode:'restored'|'fresh';durationMs:number;sandboxVerified?:boolean};
export async function scanSchool(privateDir:string,options:{sample?:number;forceFresh?:boolean;progress?:(value:unknown)=>void}={}):Promise<Scan> {
  process.env.CQUT_PRIVATE_DIR=privateDir;
  const started=Date.now();const pw=await loadPlaywright();const executable=process.env.CQUT_CHROMIUM_PATH;
  if(!executable)throw new Error('CHROMIUM_PATH_REQUIRED');
  const launched=await launchNormalBrowser(pw.chromium,executable,privateDir);
  try {
    let context:BrowserContext;let page:Page;let activitiesIndex:IndexResult|undefined;let authMode:Scan['authMode']='restored';
    const state=options.forceFresh?undefined:await readSecret<Awaited<ReturnType<BrowserContext['storageState']>>>(join(privateDir,'session.dpapi')).catch(()=>undefined);
    context=await launched.browser.newContext({...settings,storageState:state});await protectReadOnly(context);page=await context.newPage();
    if(state)try {activitiesIndex=await index(page,'Activity');}catch{await context.close();context=await launched.browser.newContext(settings);await protectReadOnly(context);}
    if(!activitiesIndex){authMode='fresh';if(!state)await page.close();page=await authenticate(context);activitiesIndex=await index(page,'Activity');}
    const rawCapture:{section:string;html:string;raw?:unknown}[]=[{section:'Activity',html:activitiesIndex.html,raw:activitiesIndex.raw}];
    // Read each visible source; a nonempty unsupported source blocks a complete scan.
    const coverage={Activity:activitiesIndex.raw.length,Project:0,Course:0};
    await page.waitForTimeout(2000);
    for(const section of ['Project','Course'] as const){const data=await index(page,section,true);coverage[section]=data.raw.length;rawCapture.push({section,html:data.html,raw:data.raw});if(data.raw.length)throw new Error('NONEMPTY_RELATED_SOURCE_REQUIRES_ADAPTER');await page.waitForTimeout(2000);}
    await page.locator('a[href="/Student/My/index.html"]').last().click();await page.waitForLoadState('load');await page.waitForTimeout(2000);
    const profileHtml=await page.content();if(!(await page.locator('body').innerText()).trim())throw new Error('PROFILE_EMPTY');
    const profile=mergeProfile(parseProfile(profileHtml),await readPreferences(privateDir));rawCapture.push({section:'My',html:profileHtml});
    await page.waitForTimeout(1000);activitiesIndex=await index(page,'Activity',true);
    coverage.Activity=activitiesIndex.raw.length;
    const activities:Activity[]=[];const selected=options.sample===undefined?activitiesIndex.raw:activitiesIndex.raw.slice(0,options.sample);
    for(const raw of selected){
      const id=String(raw.activityID);const href=activitiesIndex.links.get(id)!;
      await page.waitForTimeout(1500);
      const link=page.locator(`#ajaxbox a[href*="activityID=${id}&"]`);
      const actualHref=await link.getAttribute('href');
      const responsePromise=page.waitForResponse(r=>r.request().isNavigationRequest()&&r.url().includes('/Student/Activity/apply.html'),{timeout:30000});
      await link.click();const response=await responsePromise;
      await page.waitForLoadState('load');
      if(response.status()!==200)throw new Error('DETAIL_HTTP_FAILURE');
      await page.waitForTimeout(3000);
      let html=await page.content();let a:Activity;
      try{a=parseActivity(raw,html,href,profile);}catch(e){await writeSecret(join(privateDir,'failed-detail.dpapi'),{raw,html,href,actualHref,responseUrl:response.url()});throw e;}
      if(!a.detailVerified){
        const retry=await page.reload({waitUntil:'load',timeout:45000});
        if(retry?.status()!==200)throw new Error('DETAIL_RETRY_HTTP_FAILURE');
        await page.waitForTimeout(3000);html=await page.content();a=parseActivity(raw,html,href,profile);
      }
      activities.push(a);rawCapture.push({section:'detail',html});
      options.progress?.({phase:'details',completed:activities.length,total:selected.length});
      await page.goBack({waitUntil:'domcontentloaded'});await page.locator('#ajaxbox a').first().waitFor();
    }
    const scan:Scan={scannedAt:new Date().toISOString(),complete:activities.length===activitiesIndex.raw.length,profile,activities,coverage,authMode,durationMs:Date.now()-started,sandboxVerified:launched.sandboxStatus?.verified};
    // Raw pages and personal profile never leave encrypted local storage.
    await writeSecret(join(privateDir,scan.complete?'scan-capture.dpapi':'sample-capture.dpapi'),rawCapture);
    await writeSecret(join(privateDir,'session.dpapi'),await context.storageState());
    await writeSecret(join(privateDir,scan.complete?'latest-scan.dpapi':'sample-scan.dpapi'),scan);return scan;
  } finally {await launched.close();}
}
