import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeSecret,readSecret} from '../src/secrets.ts';
test('Linux private storage authenticates encrypted files and rejects tampering',{skip:process.platform==='win32'},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'cqut-cloud-storage-'));
  try{
    const path=join(directory,'fake.dpapi');await writeSecret(path,{account:'fake-user',password:'fake-password'});
    const encrypted=await readFile(path,'utf8');assert.ok(!encrypted.includes('fake-password'));
    assert.deepEqual(await readSecret(path),{account:'fake-user',password:'fake-password'});
    const e=JSON.parse(encrypted);e.tag=Buffer.alloc(16).toString('base64');await writeFile(path,JSON.stringify(e));await assert.rejects(readSecret(path));
  }finally{await rm(directory,{recursive:true,force:true});}
});
