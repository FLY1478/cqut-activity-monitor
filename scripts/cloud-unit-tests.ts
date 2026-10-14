import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readdir} from 'node:fs/promises';
// The tests receive only an independent disposable encryption key. Real school
// and WeChat secrets are scoped to the later explicit collection step.
const files=(await readdir('tests')).filter(file=>file.endsWith('.test.ts')).map(file=>'tests/'+file);
const exit=await new Promise<number|null>((done,reject)=>{
  const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning','--test',...files],{env:{...process.env,CQUT_STORAGE_KEY:randomBytes(32).toString('hex')},stdio:'inherit',windowsHide:true});
  child.on('error',reject);child.on('exit',done);
});
process.exitCode=exit??1;
