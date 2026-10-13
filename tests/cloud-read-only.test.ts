import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cloudReadAllowed} from '../src/read-only.ts';
test('credential-bearing cloud browser permits only approved HTTPS reads and known list POSTs',()=>{
  assert.equal(cloudReadAllowed('https://uis.cqut.edu.cn/login','GET'),true);
  assert.equal(cloudReadAllowed('https://2class.cqut.edu.cn/Student/Activity/getActivityCanApply.html','POST'),true);
  for(const [url,method] of [['https://2class.cqut.edu.cn/Student/Activity/applyGo.html','GET'],['https://2class.cqut.edu.cn/Student/My/save.html','POST'],['https://uis.cqut.edu.cn/logout','POST'],['http://uis.cqut.edu.cn/','GET'],['https://uis.cqut.edu.cn.evil.example/','GET'],['https://third-party.example/collect','GET'],['https://user@uis.cqut.edu.cn/','GET']])assert.equal(cloudReadAllowed(url!,method!),false);
});
