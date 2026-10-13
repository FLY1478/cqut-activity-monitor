import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readSecret, writeSecret } from '../src/secrets.ts';
import { randomBytes } from 'node:crypto';
import { resolve, join } from 'node:path';

const repo=process.argv[2];
if(!repo||!/^[-\w]+\/[-\w]+$/.test(repo)) throw new Error('REPOSITORY_NOT_ALLOWED');
const gh=process.platform==='win32'?'gh.exe':'gh';
const run=promisify(execFile);
const user=JSON.parse((await run(gh,['api','user'],{windowsHide:true})).stdout);
const repository=JSON.parse((await run(gh,['api','repos/'+repo],{windowsHide:true})).stdout);
if(repository.owner.id!==user.id || !repository.permissions?.admin) throw new Error('REPOSITORY_OWNERSHIP_NOT_VERIFIED');
console.log('Verified owned repository: '+repository.full_name);
const privateDir=resolve(process.env.CQUT_PRIVATE_DIR??'../../work/private');
const credentials=await readSecret<{account:string;password:string}>(join(privateDir,'credentials.dpapi'));
const key=randomBytes(32).toString('hex');
await writeSecret(join(privateDir,'cloud-storage-key.dpapi'),{key});
for(const [name,value] of [['CQUT_USERNAME',credentials.account],['CQUT_PASSWORD',credentials.password],['CQUT_STORAGE_KEY',key]]) {
  await new Promise<void>((resolveSecret,reject)=>{
    const child=spawn(gh,['secret','set',name!,'--repo',repo],{windowsHide:true,stdio:['pipe','ignore','pipe']});
    child.stderr.resume();
    child.on('error',()=>reject(new Error('SECRET_UPLOAD_FAILED')));
    child.on('exit',code=>code===0?resolveSecret():reject(new Error('SECRET_UPLOAD_FAILED')));
    child.stdin.on('error',()=>{});
    child.stdin.end(value);
  });
  console.log(name+': configured');
}
