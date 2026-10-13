import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {readSecret,writeSecret} from '../src/secrets.ts';
import {sealCloudTestConfig,validateCloudTestConfig} from '../src/cloud-test-config.ts';
import type {Profile} from '../src/activity.ts';
import type {WechatConfig} from '../src/wechat.ts';
const repo='FLY1478/cqut-activity-monitor';
const names=['CQUT_E2E_CONFIG','CQUT_E2E_STORAGE_KEY'];
const gh=process.platform==='win32'?'gh.exe':'gh';
const directory=resolve(process.env.CQUT_PRIVATE_DIR??'../../work/private');
const receiptPath=join(directory,'cloud-e2e-provision.dpapi');
const command=promisify(execFile);
async function ghInput(args:string[],input?:string):Promise<void>{
  await new Promise<void>((resolveDone,reject)=>{
    const child=spawn(gh,args,{windowsHide:true,stdio:['pipe','ignore','ignore']});
    child.on('error',()=>reject(new Error('CLOUD_TEST_SECRET_OPERATION_FAILED')));
    child.on('exit',code=>code===0?resolveDone():reject(new Error('CLOUD_TEST_SECRET_OPERATION_FAILED')));
    child.stdin.on('error',()=>{});child.stdin.end(input??'');
  });
}
async function run(){
  if(process.platform!=='win32')throw new Error('LOCAL_WINDOWS_PROVISION_REQUIRED');
  const user=JSON.parse((await command(gh,['api','user'],{windowsHide:true})).stdout);
  const repository=JSON.parse((await command(gh,['api','repos/'+repo],{windowsHide:true})).stdout);
  if(repository.full_name!==repo||repository.owner.id!==user.id||!repository.permissions?.admin)throw new Error('REPOSITORY_OWNERSHIP_NOT_VERIFIED');
  if(process.argv.includes('--remove')){
    const receipt=await readSecret<{repo:string;names:string[];createdAt:number}>(receiptPath);
    if(receipt.repo!==repo||receipt.names.some(n=>!names.includes(n)))throw new Error('CLOUD_TEST_RECEIPT_INVALID');
    const existing=JSON.parse((await command(gh,['secret','list','--repo',repo,'--json','name'],{windowsHide:true})).stdout) as {name:string}[];
    for(const name of receipt.names)if(existing.some(s=>s.name===name))await ghInput(['secret','delete',name,'--repo',repo]);
    await writeSecret(receiptPath,{...receipt,removedAt:Date.now()});console.log('TEMPORARY_TEST_SECRETS_REMOVED');return;
  }
  const existing=JSON.parse((await command(gh,['secret','list','--repo',repo,'--json','name'],{windowsHide:true})).stdout) as {name:string}[];
  if(existing.some(s=>names.includes(s.name)))throw new Error('EXISTING_TEST_SECRET_NOT_OVERWRITTEN');
  const credentials=await readSecret<{account:string;password:string}>(join(directory,'credentials.dpapi'));
  const wechat=await readSecret<WechatConfig>(join(directory,'wechat.dpapi'));
  const preferences=await readSecret<Profile>(join(directory,'preferences.dpapi'));
  const notification=await readSecret<{style:'template'|'article-preview'}>(join(directory,'notification-preferences.dpapi'));
  const createdAt=Date.now();
  const config=validateCloudTestConfig({version:1,createdAt,expiresAt:createdAt+2*60*60*1000,credentials,wechat,preferences,notification:{style:notification.style,dailyPreviewBudget:1}});
  const key=randomBytes(32).toString('hex'),payload=sealCloudTestConfig(config,key);
  // This receipt is Windows-user encrypted, contains no existing session, and
  // permits cleanup of only the new names created by this invocation.
  const receipt={repo,names:[] as string[],createdAt,expiresAt:config.expiresAt,key};
  await writeSecret(receiptPath,receipt);
  try{
    for(const [name,value] of [[names[0]!,payload],[names[1]!,key]]){
      await ghInput(['secret','set',name!,'--repo',repo],value);
      receipt.names.push(name!);await writeSecret(receiptPath,receipt);
    }
  }catch{
    for(const name of receipt.names)await ghInput(['secret','delete',name,'--repo',repo]).catch(()=>{});
    throw new Error('CLOUD_TEST_PROVISION_FAILED');
  }
  console.log(JSON.stringify({repository:repo,temporarySecretsConfigured:receipt.names.length,encryptedBundle:true,expiresInHours:2,existingSessionUploaded:false}));
}
run().catch(()=>{console.error('CLOUD_TEST_PROVISION_OR_CLEANUP_FAILED');process.exitCode=1;});
