import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCloudChild} from '../src/cloud-child.ts';
test('collector deadlines terminate even a process that ignores graceful shutdown',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'cqut-child-'));
  try{
    const script=join(directory,'fixture.cjs');await writeFile(script,"process.on('SIGTERM',()=>{});setInterval(()=>{},1000);");
    const started=Date.now(),result=await runCloudChild(script,[],400);
    assert.equal(result.timedOut,true);assert.ok(Date.now()-started<5000);
    await writeFile(script,'process.exit(0);');assert.deepEqual(await runCloudChild(script,[],5000),{exitCode:0,timedOut:false});
  }finally{await rm(directory,{recursive:true,force:true});}
});
