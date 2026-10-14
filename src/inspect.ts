import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { loadPlaywright } from './runtime.ts';
import { launchNormalBrowser } from './normal-browser.ts';
import { readSecret, writeSecret } from './secrets.ts';
import { MOBILE_UA, safeEndpoint } from './auth-protocol.ts';
import type { BrowserContext } from 'playwright';

const privateDir=resolve(process.env.CQUT_PRIVATE_DIR??'../../work/private');
const output=resolve(process.env.CQUT_REPORT_PATH??'../../work/inspection-report.json');
const report:Record<string,unknown>={startedAt:new Date().toISOString(),phase:'local_read_verification',status:'pending'};
await mkdir(privateDir,{recursive:true});
const pw=await loadPlaywright();
const executable=process.env.CQUT_CHROMIUM_PATH;
if(!executable) throw new Error('CHROMIUM_PATH_REQUIRED');
const launched=await launchNormalBrowser(pw.chromium,executable,privateDir);
let phase='restore_session';
const documents:Array<Record<string,unknown>>=[];
try {
  const state=await readSecret<Awaited<ReturnType<BrowserContext['storageState']>>>(join(privateDir,'session.dpapi'));
  const context=await launched.browser.newContext({storageState:state,userAgent:MOBILE_UA,
    viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  page.on('response',r=>{if(r.request().resourceType()==='document')documents.push({status:r.status(),endpoint:safeEndpoint(r.url())});});
  const responsePromise=page.waitForResponse(r=>r.url().includes('/getActivityCanApply.html'),{timeout:30000});
  await page.goto('https://2class.cqut.edu.cn/Student/Activity/index.html',{waitUntil:'domcontentloaded',timeout:45000});
  const response=await responsePromise;
  if(response.status()!==200) throw new Error('ACTIVITY_HTTP_FAILURE');
  const activities=await response.json();
  if(!Array.isArray(activities)) throw new Error('ACTIVITY_SCHEMA_FAILURE');
  const ids=activities.map(a=>String(a.activityID));
  if(ids.some(id=>!/^\d+$/.test(id))||new Set(ids).size!==ids.length) throw new Error('INVALID_OR_DUPLICATE_ACTIVITY_ID');
  await page.locator('#ajaxbox a[href*="activityID="]').first().waitFor();
  // Wait for the published page to finish loading external protection scripts.
  await page.waitForLoadState('load');
  const renderedIds:string[]=[];
  for(const anchor of await page.locator('#ajaxbox a[href*="activityID="]').all()) {
    const href=await anchor.getAttribute('href');
    if(href)renderedIds.push(new URL(href,'https://2class.cqut.edu.cn').searchParams.get('activityID')!);
  }
  if(ids.length!==renderedIds.length||ids.some(id=>!renderedIds.includes(id))) throw new Error('RENDERED_ACTIVITY_MISMATCH');
  report.processRestartSessionRestore='passed';
  report.list={apiCount:ids.length,renderedCount:renderedIds.length,uniqueIds:true,
    paginationObserved:false,coverage:'current_activity_home_only'};
  const details=[];
  const selected=activities.filter(a=>Number(a.status2)===2).slice(0,3);
  for(const activity of selected) {
    phase='read_activity_detail';
    // Give external page scripts time to initialize before following links.
    await page.waitForTimeout(2000);
    const link=page.locator(`#ajaxbox a[href*="activityID=${activity.activityID}&"]`);
    const href=await link.getAttribute('href');
    if(!href)throw new Error('DETAIL_LINK_MISSING');
    // Preserve the exact published href and let the browser perform navigation.
    // Direct page.goto with a modified return URL was rejected by this service.
    const detailResponse=page.waitForResponse(r=>r.request().isNavigationRequest()&&r.url().includes('/Student/Activity/apply.html'),{timeout:45000});
    await link.click();
    const documentResponse=await detailResponse;
    await page.waitForTimeout(3000);
    if(documentResponse && documentResponse.status()>=400)throw new Error('DETAIL_ACCESS_REJECTED');
    const info={html:await page.content(),text:await page.locator('body').innerText()};
    if(!info.text.replace(/\s/g,'').includes(activity.activityName.replace(/\s/g,'')))throw new Error('DETAIL_TITLE_MISMATCH');
    details.push({id:String(activity.activityID),...info});
    await page.goBack({waitUntil:'domcontentloaded',timeout:45000});
    await page.locator('#ajaxbox a[href*="activityID="]').first().waitFor();
  }
  const extra=[];
  for(const path of ['/Student/Project/index.html','/Student/Course/index.html','/Student/My/index.html']) {
    phase='read_related_page';
    await page.waitForTimeout(2000);
    await page.locator(`a[href="${path}"]`).last().click();
    await page.waitForTimeout(3000);
    if((await page.locator('body').innerText()).trim().length<20)throw new Error('RELATED_PAGE_EMPTY');
    if(new URL(page.url()).hostname!=='2class.cqut.edu.cn')throw new Error('RELATED_PAGE_AUTH_LOST');
    extra.push({path,html:await page.content(),text:await page.locator('body').innerText()});
  }
  await writeSecret(join(privateDir,'inspection.dpapi'),{activities,details,extra});
  await writeSecret(join(privateDir,'session.dpapi'),await context.storageState());
  report.details={sampled:details.length,allContainActivityTitle:details.every((d,i)=>d.text.replace(/\s/g,'').includes(selected[i].activityName.replace(/\s/g,'')))};
  report.relatedPages=extra.map(p=>({endpoint:safeEndpoint('https://2class.cqut.edu.cn'+p.path),readable:p.text.length>0}));
  report.status='passed';
  report.remaining=['cloud_not_authorized','qualification_rules_not_yet_verified','natural_session_expiry_not_observed'];
} catch(error) {
  report.status='blocked';
  report.failedPhase=phase;
  report.documents=documents;
  const msg=error instanceof Error?error.message:'';
  report.blocker=/^[A-Z_]+$/.test(msg)?msg:'READ_OR_SESSION_FAILURE';
} finally {
  await launched.close();
  await mkdir(resolve(output,'..'),{recursive:true});
  await writeFile(output,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(report.status!=='passed') process.exitCode=1;
}
