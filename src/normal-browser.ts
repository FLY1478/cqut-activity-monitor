import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, join, sep } from 'node:path';
import type { Browser, BrowserType } from 'playwright';
import {parseSandboxStatus,type LinuxSandboxStatus} from './sandbox-status.ts';

// Launch a regular visible browser with its supported local debugging interface.
// No fingerprint patches, injected challenge solvers, or altered site scripts.
export async function launchNormalBrowser(chromium:BrowserType, executable:string, privateDir:string):Promise<{browser:Browser;close:()=>Promise<void>;sandboxStatus?:LinuxSandboxStatus}> {
  const base=resolve(privateDir);
  const profile=await mkdtemp(join(base,'browser-'));
  const port=await new Promise<number>((resolvePort,reject)=>{
    const server=createServer();
    server.on('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      const address=server.address();
      const port=typeof address==='object'&&address?address.port:0;
      server.close(()=>resolvePort(port));
    });
  });
  const child=spawn(executable,[`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],
    {windowsHide:true,stdio:'ignore'});
  let failed=false;
  child.on('error',()=>{failed=true;});
  let browser:Browser|undefined;
  const close=async()=>{
    if(browser) await browser.close().catch(()=>{});
    child.kill();
    // Verify the cleanup target stays inside the explicit private workspace.
    if(profile.startsWith(base+sep) && profile !== base) {
      await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
    }
  };
  try {
    const deadline=Date.now()+45000;
    while(Date.now()<deadline) {
      if(failed||child.exitCode!==null) throw new Error('NORMAL_BROWSER_START_FAILED');
      try { browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000});break; }
      catch { await new Promise(resolve=>setTimeout(resolve,250)); }
    }
    if(!browser) throw new Error('NORMAL_BROWSER_CONNECTION_FAILED');
    let sandboxStatus:LinuxSandboxStatus|undefined;
    if(process.platform==='linux') {
      const statusPage=await browser.contexts()[0].newPage();
      try {
        await statusPage.goto('chrome://sandbox',{timeout:10000});
        sandboxStatus=parseSandboxStatus(await statusPage.locator('body').innerText());
        if(!sandboxStatus.verified)throw new Error('NORMAL_BROWSER_SANDBOX_NOT_VERIFIED');
      } finally {await statusPage.close().catch(()=>{});}
    }
    // Default profile remains blank; all school activity uses an isolated,
    // nonpersistent browser context, with encrypted explicit session exports.
    return {browser,close,sandboxStatus};
  } catch(error) {await close();throw error;}
}
