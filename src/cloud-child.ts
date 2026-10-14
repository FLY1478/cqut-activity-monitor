import {spawn} from 'node:child_process';
export async function runCloudChild(script:string,args:string[],timeoutMs:number):Promise<{exitCode:number|null;timedOut:boolean}>{
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new Error('CLOUD_TEST_TIMEOUT_INVALID');
  return new Promise((done,reject)=>{
    const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning',script,...args],{env:process.env,stdio:'ignore',windowsHide:true});
    let timedOut=false;
    // This child can only collect read-only data, never send a notification.
    // A hard deadline must still work if a browser library traps SIGTERM.
    const timeout=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeoutMs);
    child.on('error',()=>{clearTimeout(timeout);reject(new Error('CLOUD_TEST_CHILD_START_FAILED'));});
    child.on('exit',exitCode=>{clearTimeout(timeout);done({exitCode,timedOut});});
  });
}
