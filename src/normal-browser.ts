import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, join, sep } from 'node:path';
import type { Browser, BrowserType } from 'playwright';

// Launch a regular visible browser with its supported local debugging interface.
// No fingerprint patches, injected challenge solvers, or altered site scripts.
export async function launchNormalBrowser(chromium:BrowserType, executable:string, privateDir:string):Promise<{browser:Browser;close:()=>Promise<void>}> {
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
    for(let attempt=0;attempt<40;attempt++) {
      if(failed||child.exitCode!==null) throw new Error('NORMAL_BROWSER_START_FAILED');
      try { browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000});break; }
      catch { await new Promise(resolve=>setTimeout(resolve,250)); }
    }
    if(!browser) throw new Error('NORMAL_BROWSER_CONNECTION_FAILED');
    // Default profile remains blank; all school activity uses an isolated,
    // nonpersistent browser context, with encrypted explicit session exports.
    return {browser,close};
  } catch(error) {await close();throw error;}
}
