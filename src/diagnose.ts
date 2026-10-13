import { resolve,join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { loadPlaywright } from './runtime.ts';
import { launchNormalBrowser } from './normal-browser.ts';
import { readSecret,writeSecret } from './secrets.ts';
import { ROOT,LOGIN,MOBILE_UA,encryptPassword,classifyLogin,safeEndpoint } from './auth-protocol.ts';
import type { BrowserContext } from 'playwright';

const privateDir=resolve('../../work/private');
const pw=await loadPlaywright();
const launched=await launchNormalBrowser(pw.chromium,process.env.CQUT_CHROMIUM_PATH!,privateDir);
const report:Record<string,unknown>={startedAt:new Date().toISOString()};
const records:unknown[]=[];
const pending:Promise<unknown>[]=[];
try {
  const fresh=process.argv.includes('--fresh');
  const state=fresh?undefined:await readSecret<Awaited<ReturnType<BrowserContext['storageState']>>>(join(privateDir,'session.dpapi'));
  const context=await launched.browser.newContext({storageState:state,userAgent:MOBILE_UA,viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  page.on('response',r=>{
    if(!r.url().startsWith('https://2class.cqut.edu.cn/')||!['document','xhr','fetch'].includes(r.request().resourceType()))return;
    pending.push((async()=>records.push({url:r.url(),status:r.status(),headers:await r.allHeaders(),requestHeaders:await r.request().allHeaders(),body:await r.text().catch(()=>''),postData:r.request().postData()}))());
  });
  if(fresh) {
    await page.goto(ROOT,{waitUntil:'domcontentloaded'});
    await page.waitForURL('https://uis.cqut.edu.cn/**',{timeout:30000});
    const credentials=await readSecret<{account:string;password:string}>(join(privateDir,'credentials.dpapi'));
    const r=await context.request.post(LOGIN,{data:{name:credentials.account,pwd:encryptPassword(credentials.password),verifyCode:'',universityId:'100005'},headers:{Origin:'https://uis.cqut.edu.cn',Referer:page.url()},maxRedirects:0});
    if(classifyLogin((await r.json()).code)!=='accepted')throw new Error('LOGIN_REJECTED');
    await page.reload({waitUntil:'domcontentloaded'});
  }
  const listPromise=page.waitForResponse(r=>r.url().includes('getActivityCanApply.html'),{timeout:30000});
  await page.goto('https://2class.cqut.edu.cn/Student/Activity/index.html',{waitUntil:'domcontentloaded'});
  const listResponse=await listPromise;
  const list=await listResponse.json();
  if(!Array.isArray(list))throw new Error('INVALID_LIST');
  await page.locator('#ajaxbox a[href*="activityID="]').first().waitFor();
  await page.waitForTimeout(2000);
  report.listCount=list.length;
  const target=process.argv.find(a=>a.startsWith('--activity-id='))?.split('=')[1];
  const selected=target?list.find(a=>String(a.activityID)===target):(list.find(a=>Number(a.status2)===2)??list[0]);
  if(!selected)throw new Error('EMPTY_LIST');
  const link=page.locator(`#ajaxbox a[href*="activityID=${selected.activityID}&"]`);
  const href=await link.getAttribute('href');
  report.link={path:safeEndpoint(new URL(href!,page.url()).href),parameterNames:[...new URL(href!,page.url()).searchParams.keys()]};
  const detailResponse=page.waitForResponse(r=>r.request().isNavigationRequest()&&r.url().includes('/Activity/apply.html'),{timeout:30000});
  await link.click();
  const response=await detailResponse;
  await page.waitForTimeout(3000);
  const text=await page.locator('body').innerText();
  report.detail={status:response.status(),characters:text.length,containsTitle:text.replace(/\s/g,'').includes(selected.activityName.replace(/\s/g,'')),endpoint:safeEndpoint(page.url())};
  await writeSecret(join(privateDir,'diagnostic-page.dpapi'),{html:await page.content(),text,list});
  await writeSecret(join(privateDir,'session.dpapi'),await context.storageState());
  report.browser={version:launched.browser.version(),webdriver:await page.evaluate(()=>navigator.webdriver)};
} catch(e) { report.error=e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'DIAGNOSTIC_FAILURE'; }
finally {
  await Promise.allSettled(pending);
  await writeSecret(join(privateDir,'diagnostic-network.dpapi'),records);
  await launched.close();
  await writeFile('diagnostic-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
