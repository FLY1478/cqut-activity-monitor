import puppeteer from '@cloudflare/puppeteer';
import {parseSandboxStatus} from './sandbox-status.ts';
import {cloudReadAllowed} from './read-only.ts';
type Environment={BROWSER:Parameters<typeof puppeteer.launch>[0]};
const userAgent='Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

// Separate from the alarm Worker: no credentials, no WeChat secrets, no school
// storage state. HTTP visits cannot launch a browser or consume browser quota.
export default {
  fetch(){return new Response(JSON.stringify({service:'cqut-anonymous-browser-probe',credentialsSupplied:false}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});},
  async scheduled(_event:unknown,env:Environment){
    const started=Date.now();let phase='launch',blockedRequests=0;
    const blockedCategories:Record<string,number>={};
    const blockedHosts=new Set<string>();
    const blockedResources:Record<string,number>={};
    let browser:Awaited<ReturnType<typeof puppeteer.launch>>|undefined;
    const report:Record<string,unknown>={probe:'anonymous_browser',credentialsSupplied:false,schoolWriteEnabled:false};
    try{
      // Default vendor security settings; never add --no-sandbox arguments.
      browser=await puppeteer.launch(env.BROWSER,{keep_alive:60000});
      report.browserVersion=await browser.version();
      const context=await browser.createBrowserContext();const page=await context.newPage();
      await page.setBypassServiceWorker(true);
      await page.setRequestInterception(true);
      page.on('request',request=>{
        if(request.isInterceptResolutionHandled())return;
        const internal=request.url().startsWith('chrome://sandbox');
        // Blank child frames and embedded assets do not create a network
        // destination. Their subsequent network requests still use the allowlist.
        const embedded=request.url()==='about:blank'||(!request.isNavigationRequest()&&/^(data:|blob:)/.test(request.url()));
        if(internal||embedded||cloudReadAllowed(request.url(),request.method()))void request.continue().catch(()=>{});
        else{
          blockedRequests++;
          let category='other';try{const url=new URL(request.url());const protocol=['https:','http:','data:','blob:','about:','chrome:'].includes(url.protocol)?url.protocol:'other';category=protocol+'_'+(['2class.cqut.edu.cn','uis.cqut.edu.cn'].includes(url.hostname)?url.hostname:'other')+'_'+request.method();if(blockedHosts.size<10&&/^[a-z0-9.-]{1,253}$/i.test(url.hostname))blockedHosts.add(url.hostname);}catch{}
          blockedCategories[category]=(blockedCategories[category]??0)+1;
          const resource=request.resourceType();blockedResources[resource]=(blockedResources[resource]??0)+1;
          void request.abort('blockedbyclient').catch(()=>{});
        }
      });
      phase='sandbox';
      try{
        await page.goto('chrome://sandbox',{waitUntil:'domcontentloaded',timeout:10000});
        report.sandbox=parseSandboxStatus(await page.evaluate(()=>document.body.innerText));
      }catch{report.sandboxReportAvailable=false;}
      phase='school_anonymous';
      await page.setUserAgent(userAgent);
      await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
      const response=await page.goto('https://2class.cqut.edu.cn/Admin/Index/cqutCAS',{waitUntil:'domcontentloaded',timeout:20000});
      await page.waitForFunction(()=>location.hostname==='uis.cqut.edu.cn'&&!!document.querySelector('input[type="password"]'),{timeout:30000}).catch(()=>{});
      const host=new URL(page.url()).hostname;
      const loginFormVisible=await page.evaluate(()=>!!document.querySelector('input[type="password"]'));
      report.school={initialHttpStatus:response?.status(),finalHost:['uis.cqut.edu.cn','2class.cqut.edu.cn'].includes(host)?host:'other',loginFormVisible};
      report.status=host==='uis.cqut.edu.cn'&&loginFormVisible?'anonymous_login_page_reached':'anonymous_login_page_not_reached';
    }catch{report.status='anonymous_probe_failed';report.failedPhase=phase;}
    finally{
      await browser?.close().catch(()=>{});
      report.durationMs=Date.now()-started;report.blockedRequests=blockedRequests;report.blockedCategories=blockedCategories;report.blockedHosts=[...blockedHosts];report.blockedResources=blockedResources;
      // Only bounded, anonymous facts; never print URLs, page contents or errors.
      console.log(JSON.stringify(report));
    }
  },
};
