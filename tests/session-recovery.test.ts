import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withSessionRecovery,requireStudentSession} from '../src/session-recovery.ts';
test('wrong role and login page cannot masquerade as a valid empty student list',()=>{
  assert.doesNotThrow(()=>requireStudentSession({studentRoute:true,studentMenu:true,loginPrompt:false}));
  for(const patch of [{studentRoute:false},{studentMenu:false},{loginPrompt:true}])assert.throws(()=>requireStudentSession({studentRoute:true,studentMenu:true,loginPrompt:false,...patch}),/STUDENT_SESSION_NOT_CONFIRMED/);
});
test('unexpected empty scan has one fresh recovery; repeated failure never resets baseline',async()=>{
  const modes:boolean[]=[],baseline={ids:['1','2']},saved=structuredClone(baseline);
  await assert.rejects(withSessionRecovery(async fresh=>{modes.push(fresh);throw new Error('UNEXPECTED_EMPTY_SCAN_NOT_COMMITTED');}),/UNEXPECTED_EMPTY/);
  assert.deepEqual(modes,[false,true]);assert.deepEqual(baseline,saved);
  let attempts=0;assert.equal(await withSessionRecovery(async fresh=>{attempts++;if(!fresh)throw new Error('STUDENT_SESSION_NOT_CONFIRMED');return 'recovered';}),'recovered');assert.equal(attempts,2);
});
test('CAPTCHA, rejected credentials, broken storage and pagination failures are not login loops',async()=>{
  for(const code of ['CAPTCHA_REQUIRED','REJECTED','SESSION_STORAGE_UNREADABLE','PAGINATION_HTTP_FAILURE','LIST_SCHEMA_FAILURE']){let attempts=0;await assert.rejects(withSessionRecovery(async()=>{attempts++;throw new Error(code);}));assert.equal(attempts,1);}
});
