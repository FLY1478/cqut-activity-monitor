import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ROOT, LOGIN, MOBILE_UA, encryptPassword, safeEndpoint, classifyLogin, jsonShape } from './auth-protocol.ts';
import { readSecret, writeSecret } from './secrets.ts';
import { loadPlaywright } from './runtime.ts';
import { launchNormalBrowser } from './normal-browser.ts';
import type { Browser, BrowserContext, Page, Response } from 'playwright';

type Credentials = {account:string;password:string};
type Report = {startedAt:string;steps:Array<Record<string,unknown>>;gate:'pending'|'blocked'|'local_auth_passed'; blocker?:string};
const privateDir = resolve(process.env.CQUT_PRIVATE_DIR ?? '../../work/private');
const reportPath = resolve(process.env.CQUT_REPORT_PATH ?? '../../work/access-report.json');
const report: Report = {startedAt:new Date().toISOString(), steps:[], gate:'pending'};
const mobileOptions = {userAgent:MOBILE_UA,viewport:{width:390,height:844},isMobile:true,hasTouch:true};

function fail(code:string): never { throw new Error(code); }
function expectedError(error:unknown): string {
  const msg=error instanceof Error ? error.message : '';
  return /^[A-Z][A-Z_]+$/.test(msg) ? msg : 'UNCLASSIFIED_FAILURE';
}
function atSchool(page:Page): boolean { return new URL(page.url()).hostname === '2class.cqut.edu.cn'; }

async function newMobile(browser:Browser, state?:Awaited<ReturnType<BrowserContext['storageState']>>) {
  const context=await browser.newContext({...mobileOptions,storageState:state});
  context.setDefaultTimeout(15000);
  return context;
}

async function login(context:BrowserContext, credentials:Credentials):Promise<Page> {
  const page=await context.newPage();
  await page.goto(ROOT,{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForTimeout(2500);
  if (new URL(page.url()).hostname !== 'uis.cqut.edu.cn') fail('AUTH_ENTRY_UNEXPECTED');
  // POST via the browser context's HTTP client: no form console logging of passwords.
  // One attempt per invocation. Never retry rejected credentials automatically.
  const response=await context.request.post(LOGIN, {
    data:{name:credentials.account,pwd:encryptPassword(credentials.password),verifyCode:'',universityId:'100005'},
    headers:{Origin:'https://uis.cqut.edu.cn',Referer:page.url()}, timeout:30000,
    maxRedirects:0,
  });
  let payload: {code?:unknown};
  try { payload=await response.json(); } catch { fail('LOGIN_RESPONSE_NOT_JSON'); }
  const outcome=classifyLogin(payload.code);
  report.steps.push({phase:'password_login',transport:'browser_cookie_http',httpStatus:response.status(),outcome});
  if (outcome !== 'accepted') fail(outcome.toUpperCase());
  await page.reload({waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForTimeout(2500);
  if (!atSchool(page)) fail('SECOND_CLASSROOM_REDIRECT_FAILED');
  const body=await page.locator('body').innerText();
  if (body.includes('请使用手机端访问')) fail('MOBILE_ACCESS_REJECTED');
  if (body.includes('请选择本次登录角色')) {
    // Select only an explicitly visible student role. Never assume the first option.
    const select=page.locator('select');
    if (await select.count() === 1) {
      const options=await select.locator('option').allTextContents();
      const students=options.filter(text => /学生/.test(text));
      if (students.length === 1) {
        await select.selectOption({label:students[0]!});
        await page.getByText('确定',{exact:true}).click();
        await page.waitForTimeout(2000);
      }
    }
  }
  if (!page.url().includes('/Student/')) fail('STUDENT_ROLE_NOT_CONFIRMED');
  return page;
}

async function capture(context:BrowserContext,page:Page) {
  const records:Array<Record<string,unknown>>=[];
  const tasks:Promise<void>[]=[];
  let capturedBytes=0;
  const onResponse=(response:Response) => {
    if (new URL(response.url()).hostname !== '2class.cqut.edu.cn') return;
    if (!['xhr','fetch','document'].includes(response.request().resourceType())) return;
    tasks.push((async()=>{
      try {
        const text=await response.text();
        if (capturedBytes + Buffer.byteLength(text) > 12_000_000) return;
        capturedBytes += Buffer.byteLength(text);
        // Sensitive request parameters and response bodies stay encrypted on this machine.
        const record:Record<string,unknown>={url:response.url(),method:response.request().method(),
          postData:response.request().postData(),status:response.status(),contentType:response.headers()['content-type'],body:text};
        records.push(record);
      } catch { /* Failed requests are accounted for by subsequent completeness checks. */ }
    })());
  };
  page.on('response',onResponse);
  await page.reload({waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForTimeout(3000);
  if (process.argv.includes('--interactive')) {
    console.log('浏览器已打开：请选择学生角色，打开活动列表和一项活动详情。完成后关闭此浏览器窗口。');
    await new Promise<void>(resolve => {
      page.once('close',()=>resolve());
      context.once('close',()=>resolve());
      const timer=setTimeout(resolve,10*60*1000);
      timer.unref();
    });
  }
  const pageState = page.isClosed() ? undefined : {
    url:page.url(),html:await page.content(),text:await page.locator('body').innerText(),
    anchors:await page.locator('a').evaluateAll(els=>els.map(e=>({text:e.textContent,href:e.getAttribute('href')}))),
  };
  await Promise.allSettled(tasks);
  page.off('response',onResponse);
  await writeSecret(join(privateDir,'discovery.dpapi'),{records,page:pageState});
  if (!page.isClosed()) await writeSecret(join(privateDir,'session.dpapi'),await context.storageState());
  const endpoints=records.map(r=>{
    let shape:unknown;
    try { shape=jsonShape(JSON.parse(String(r.body))); } catch { shape='non_json'; }
    return {endpoint:safeEndpoint(String(r.url)),method:r.method,status:r.status,shape};
  });
  report.steps.push({phase:'discovery',endpoints,privateCapture:true,
    roleSelectionRequired:pageState?.text.includes('请选择本次登录角色') ?? false});
}

let browser:Browser|undefined;
let closeNormal:(()=>Promise<void>)|undefined;
try {
  await mkdir(privateDir,{recursive:true});
  const credentials:Credentials=process.env.CQUT_USERNAME && process.env.CQUT_PASSWORD
    ? {account:process.env.CQUT_USERNAME,password:process.env.CQUT_PASSWORD}
    : await readSecret<Credentials>(join(privateDir,'credentials.dpapi')).catch(()=>fail('CREDENTIALS_NOT_CONFIGURED'));
  if (!credentials.account || !credentials.password) fail('CREDENTIALS_INVALID');
  const pw=await loadPlaywright();
  // First check pure HTTP access without executing WAF JavaScript.
  const request=await pw.request.newContext({userAgent:MOBILE_UA});
  try {
    const start=performance.now();
    const initial=await request.get(ROOT,{timeout:20000});
    report.steps.push({phase:'fresh_http_entry',status:initial.status(),endpoint:safeEndpoint(initial.url()),elapsedMs:Math.round(performance.now()-start)});
  } catch { report.steps.push({phase:'fresh_http_entry',outcome:'network_or_challenge_failure'}); }
  finally { await request.dispose(); }

  if(process.argv.includes('--normal-browser')) {
    if(!process.env.CQUT_CHROMIUM_PATH) fail('CHROMIUM_PATH_REQUIRED');
    const launched=await launchNormalBrowser(pw.chromium,process.env.CQUT_CHROMIUM_PATH,privateDir);
    browser=launched.browser;closeNormal=launched.close;
    report.steps.push({phase:'browser',mode:'normal_visible_cdp',version:browser.version()});
  } else {
    browser=await pw.chromium.launch({headless:!process.argv.includes('--interactive'),
      executablePath:process.env.CQUT_CHROMIUM_PATH,args:['--disable-logging']});
  }
  const fresh=await newMobile(browser);
  let page=await login(fresh,credentials);
  report.steps.push({phase:'fresh_login',outcome:'second_classroom_reached'});
  const state=await fresh.storageState();
  await writeSecret(join(privateDir,'session.dpapi'),state);
  await fresh.close();

  const restored=await newMobile(browser,state);
  page=await restored.newPage();
  const restoredResponse=page.waitForResponse(r=>r.url().includes('/getActivityCanApply.html'),{timeout:30000});
  await page.goto('https://2class.cqut.edu.cn/Student/Activity/index.html',{waitUntil:'domcontentloaded',timeout:45000});
  const listResponse=await restoredResponse;
  if(listResponse.status()!==200)fail('SESSION_RESTORE_FAILED');
  const restoredList=await listResponse.json();
  if(!Array.isArray(restoredList))fail('SESSION_RESTORE_FAILED');
  report.steps.push({phase:'isolated_context_restore',outcome:'student_activity_list_verified',count:restoredList.length});
  await restored.close();

  // Simulate lost/expired collector state using a fresh context, without logging out
  // or touching any of the user's daily browser contexts.
  const expired=await newMobile(browser);
  page=await login(expired,credentials);
  report.steps.push({phase:'missing_session_reauthentication',outcome:'second_classroom_reached'});
  await capture(expired,page);
  report.gate='local_auth_passed';
  report.steps.push({phase:'remaining_gates',cloudVerified:false,activitiesVerified:false,fullMonitorEnabled:false});
} catch(error) {
  report.gate='blocked'; report.blocker=expectedError(error);
} finally {
  if(closeNormal) await closeNormal();
  else if(browser) await browser.close().catch(()=>{});
  await mkdir(resolve(reportPath,'..'),{recursive:true});
  await writeFile(reportPath,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(report.gate==='blocked') process.exitCode=1;
}
