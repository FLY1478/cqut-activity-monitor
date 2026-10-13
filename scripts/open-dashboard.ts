import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {readSecret} from '../src/secrets.ts';
const privateDir=resolve(process.env.CQUT_PRIVATE_DIR??'../../work/private');
const link=await readSecret<{url:string}>(join(privateDir,'dashboard-link.dpapi'));
const url=new URL(link.url);
if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!/^#[a-f0-9]{64}$/.test(url.hash))throw new Error('INVALID_LOCAL_ENTRY');
const child=spawn(process.env.CQUT_CHROMIUM_PATH??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',[url.href],{windowsHide:true,detached:true,stdio:'ignore'});
child.on('error',()=>{console.error('LOCAL_BROWSER_OPEN_FAILED');process.exitCode=1;});child.unref();
