import {spawn} from 'node:child_process';
import {createServer as createHTTPServer} from 'node:http';
import {createServer as createTCPServer} from 'node:net';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {createRequire} from 'node:module';
import {parseSandboxStatus} from './sandbox-status.mjs';

// Standalone anonymous probe: no imports from the monitor or secret storage.
const started=Date.now();
const report={version:3,at:new Date().toISOString(),environment:{platform:process.platform,arch:process.arch,node:process.version},fixture:{passed:false,restartPassed:false,writeBlocked:false},anonymous:{},readOnlyBlocks:0,blockedRequests:[],activityAccessVerified:false,credentialsUsed:false};
const privateBase=resolve('.probe-private');
await mkdir(privateBase,{recursive:true});
const permittedHosts=new Set(['2class.cqut.edu.cn','uis.cqut.edu.cn','res.wx.qq.com','api.weixin.qq.com']);
let browser,chrome,profile,fixture,monitor;
let cgroupPeak=0;
async function memory() {
  for(const [current,limit] of [['/sys/fs/cgroup/memory.current','/sys/fs/cgroup/memory.max'],['/sys/fs/cgroup/memory/memory.usage_in_bytes','/sys/fs/cgroup/memory/memory.limit_in_bytes']]) {
    try {
      const used=Number((await readFile(current,'utf8')).trim());
      const cap=(await readFile(limit,'utf8')).trim();
      if(Number.isFinite(used))cgroupPeak=Math.max(cgroupPeak,used);
      return {used:Number.isFinite(used)?used:null,limitBytes:/^\d+$/.test(cap)&&Number(cap)<2**60?Number(cap):null};
    }catch{}
  }
  return {used:null,limitBytes:null};
}
async function closeBrowser(){
  await browser?.close().catch(()=>{});browser=undefined;
  chrome?.kill();chrome=undefined;
  if(profile){
    const checked=resolve(profile);
    if(!checked.startsWith(privateBase+sep)||checked===privateBase)throw new Error('CLEANUP_PATH_REJECTED');
    await rm(checked,{recursive:true,force:true,maxRetries:5,retryDelay:200});profile=undefined;
  }
}
async function launch(pw){
  profile=await mkdtemp(join(privateBase,'run-'));
  const portServer=createTCPServer();
  await new Promise((r,j)=>{portServer.once('error',j);portServer.listen(0,'127.0.0.1',r);});
  const port=portServer.address().port;
  await new Promise(r=>portServer.close(r));
  let failed=false;
  chrome=spawn(process.env.CQUT_PROBE_CHROME_PATH,[`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  chrome.stderr?.on('data',chunk=>{
    const message=String(chunk);
    if(/DevTools listening on/.test(message))report.devtoolsListening=true;
    if(/Remote debugging.*(?:disabled|not allowed)/i.test(message))report.chromeStartIssue='REMOTE_DEBUGGING_DISABLED';
    if(/No usable sandbox|Failed to move to new namespace|Failed to unshare|Operation not permitted/.test(message))report.chromeStartIssue='SANDBOX_OR_NAMESPACE_UNAVAILABLE';
    else if(/Running as root/.test(message))report.chromeStartIssue='ROOT_USER_UNSUPPORTED';
    else if(/Missing X server|cannot open display|Failed to initialize.*platform/.test(message))report.chromeStartIssue='DISPLAY_UNAVAILABLE';
    else if(/error while loading shared libraries/.test(message))report.chromeStartIssue='SHARED_LIBRARY_MISSING';
  });
  chrome.on('error',()=>{failed=true;});
  const deadline=Date.now()+45000;
  while(Date.now()<deadline){
    if(failed||chrome.exitCode!==null||chrome.signalCode!==null)throw new Error('BROWSER_START_FAILED');
    try{browser=await pw.chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000});return;}catch(error){
      report.connectionIssue=String(error.message).match(/\b(?:ECONNREFUSED|ECONNRESET|EACCES|EPERM|ENOTFOUND|ERR_[A-Z_]{1,60})\b/)?.[0]??(error.name==='TimeoutError'?'CONNECTION_TIMEOUT':'CDP_CONNECTION_FAILED');
    }
    await new Promise(r=>setTimeout(r,250));
  }
  throw new Error('BROWSER_CONNECTION_FAILED');
}
async function guard(context,fixtureOrigin){
  await context.route('**/*',route=>{
    const request=route.request();const u=new URL(request.url());
    if(['GET','HEAD'].includes(request.method())&&(u.origin===fixtureOrigin||u.protocol==='https:'&&permittedHosts.has(u.hostname)))return route.continue();
    report.readOnlyBlocks++;
    if(report.blockedRequests.length<10)report.blockedRequests.push({host:u.origin===fixtureOrigin?'local-fixture':permittedHosts.has(u.hostname)?u.hostname:'other',method:request.method(),navigation:request.isNavigationRequest()});
    return route.abort('blockedbyclient');
  });
}
try{
  if(!process.env.CQUT_PROBE_CHROME_PATH)throw new Error('CHROME_PATH_REQUIRED');
  if(process.platform==='linux'&&!process.env.DISPLAY)throw new Error('DISPLAY_REQUIRED');
  const pw=process.env.CQUT_PROBE_MODULE_DIR?createRequire(import.meta.url)(join(resolve(process.env.CQUT_PROBE_MODULE_DIR),'playwright')):await import('playwright');
  report.cgroupBefore=await memory();
  monitor=setInterval(()=>{void memory();},100);
  fixture=createHTTPServer((req,res)=>{
    if(req.method!=='GET'){res.writeHead(405);res.end();return;}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Set-Cookie','probe_fixture=ready; SameSite=Strict');
    res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>匿名环境测试</title><h1>仅本地模拟数据</h1><div id="result">未执行</div><button id="verify" onclick="document.querySelector(\'#result\').textContent=\'验证通过\'">验证按钮</button></html>');
  });
  await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
  const fixtureOrigin=`http://127.0.0.1:${fixture.address().port}`;
  const settings={userAgent:'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',viewport:{width:390,height:844},isMobile:true,hasTouch:true};
  const boot=Date.now();await launch(pw);report.browserVersion=browser.version();report.firstLaunchMs=Date.now()-boot;
  const sandboxPage=await browser.contexts()[0].newPage();
  await sandboxPage.goto('chrome://sandbox');
  report.actualSandbox=parseSandboxStatus(await sandboxPage.locator('body').innerText());
  await sandboxPage.close();
  if(!report.actualSandbox.verified)throw new Error('SANDBOX_STATUS_NOT_VERIFIED');
  let context=await browser.newContext(settings);await guard(context,fixtureOrigin);
  let page=await context.newPage();await page.goto(fixtureOrigin,{waitUntil:'load'});
  await page.locator('#verify').click();
  report.fixture.passed=await page.locator('#result').innerText()==='验证通过';
  // Retain only this synthetic local cookie; never retain school/WeChat state.
  const state=await context.storageState();await closeBrowser();
  const reboot=Date.now();await launch(pw);report.restartMs=Date.now()-reboot;
  context=await browser.newContext({...settings,storageState:state});await guard(context,fixtureOrigin);
  report.fixture.restartPassed=(await context.cookies(fixtureOrigin)).some(c=>c.name==='probe_fixture'&&c.value==='ready');
  page=await context.newPage();await page.goto(fixtureOrigin,{waitUntil:'load'});
  await page.locator('#verify').click();report.fixture.restartPassed&&=await page.locator('#result').innerText()==='验证通过';
  // Negative test on our own fixture only: no write reaches an external site.
  report.fixture.writeBlocked=await page.evaluate(()=>fetch('/must-not-write',{method:'POST'}).then(()=>false,()=>true));
  if(!report.fixture.passed||!report.fixture.restartPassed||!report.fixture.writeBlocked||report.readOnlyBlocks<1)throw new Error('FIXTURE_FAILED');
  if(!process.argv.includes('--fixture-only')){
    for(const [name,url] of [['school','https://2class.cqut.edu.cn/'],['wechat','https://api.weixin.qq.com/cgi-bin/token']]){
      await new Promise(r=>setTimeout(r,3000));
      const begin=Date.now();
      const navigationResponses=[];
      const observeResponse=response=>{
        const request=response.request();
        if(!request.isNavigationRequest()||request.frame()!==page.mainFrame()||navigationResponses.length>=10)return;
        const host=new URL(response.url()).hostname;
        const headers=response.headers();
        const mime=(headers['content-type']??'').split(';')[0];
        navigationResponses.push({host:permittedHosts.has(host)?host:'other',status:response.status(),contentType:/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime)?mime:'unknown',downloadDisposition:!!headers['content-disposition']});
      };
      page.on('response',observeResponse);
      try{
        const response=await page.goto(url,{waitUntil:'load',timeout:35000});
        let html;
        for(let attempt=0;attempt<4;attempt++){
          await page.waitForLoadState('domcontentloaded',{timeout:10000});
          try{html=await page.content();break;}catch(error){
            if(attempt===3)throw error;
            await new Promise(resolve=>setTimeout(resolve,1000));
          }
        }
        const end=new URL(page.url());
        report.anonymous[name]={status:response?.status()??null,durationMs:Date.now()-begin,finalHost:permittedHosts.has(end.hostname)?end.hostname:'other',loginPage:/统一身份认证|统一认证|用户登录|账号密码/.test(html),navigationResponses,activityAccessVerified:false};
      }catch(e){
        const known=String(e?.message).match(/\bERR_[A-Z_]{1,60}\b/)?.[0];
        report.anonymous[name]={error:known??(e?.name==='TimeoutError'?'NAVIGATION_TIMEOUT':/Download is starting/i.test(e?.message)?'DOWNLOAD_STARTED':'ANONYMOUS_NAVIGATION_FAILED'),durationMs:Date.now()-begin,navigationResponses};
      }finally{
        page.off('response',observeResponse);
      }
    }
  }
  report.environmentTestPassed=true;
}catch(e){
  report.environmentTestPassed=false;
  report.error=['CHROME_PATH_REQUIRED','DISPLAY_REQUIRED','BROWSER_START_FAILED','BROWSER_CONNECTION_FAILED','FIXTURE_FAILED','CLEANUP_PATH_REJECTED','SANDBOX_STATUS_NOT_VERIFIED'].includes(e.message)?e.message:'PROBE_FAILED';
}finally{
  clearInterval(monitor);await memory();report.cgroupPeakBytes=cgroupPeak||null;
  await closeBrowser().catch(()=>{report.cleanupError=true;});
  if(fixture)await new Promise(r=>fixture.close(r));
  report.durationMs=Date.now()-started;
}
const target=resolve(process.env.CQUT_PROBE_RESULT_PATH??'probe-result.json');
await writeFile(target,JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
if(!report.environmentTestPassed)process.exitCode=1;
