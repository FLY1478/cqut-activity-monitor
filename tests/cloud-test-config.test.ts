import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openCloudTestConfig,sealCloudTestConfig,validateCloudTestConfig,type CloudTestConfig} from '../src/cloud-test-config.ts';
const config=():CloudTestConfig=>({version:1,createdAt:Date.now(),expiresAt:Date.now()+3600000,credentials:{account:'fake-account',password:'fake-password'},wechat:{appId:'fake-app',appSecret:'fake-secret',openId:'fake-user',templateId:'fake-template'},preferences:{grade:'2024',preferSimple:true},notification:{style:'article-preview',dailyPreviewBudget:1}});
test('cloud bundle authenticates ciphertext, expires and omits unrelated private data',()=>{
  const c=config(),key='12'.repeat(32),payload=sealCloudTestConfig(c,key);
  assert.ok(!payload.includes('fake-password'));assert.deepEqual(openCloudTestConfig(payload,key),c);
  assert.throws(()=>openCloudTestConfig(payload,'34'.repeat(32)),/CLOUD_TEST_CONFIG_REJECTED/);
  const damaged=JSON.parse(payload);damaged.tag=Buffer.alloc(16).toString('base64');assert.throws(()=>openCloudTestConfig(JSON.stringify(damaged),key),/CLOUD_TEST_CONFIG_REJECTED/);
  assert.throws(()=>validateCloudTestConfig({...c,expiresAt:Date.now()-1}),/CLOUD_TEST_CONFIG_INVALID/);
  assert.throws(()=>validateCloudTestConfig({...c,expiresAt:c.createdAt+7200001}),/CLOUD_TEST_CONFIG_INVALID/);
  const extra={...c,session:'do-not-upload',preferences:{...c.preferences,studentName:'do-not-upload'}};
  assert.ok(!JSON.stringify(validateCloudTestConfig(extra)).includes('do-not-upload'));
});
test('school-only recovery config strips all notification secrets and cannot become notification mode',()=>{
  const c=config(),r=validateCloudTestConfig({...c,purpose:'school_recovery'}),key='56'.repeat(32);
  assert.equal(r.purpose,'school_recovery');assert.equal(r.wechat,undefined);assert.equal(r.notification,undefined);
  assert.ok(!JSON.stringify(r).includes('fake-secret'));
  assert.deepEqual(openCloudTestConfig(sealCloudTestConfig(r,key),key),r);
  assert.throws(()=>validateCloudTestConfig({...r,purpose:'school_and_wechat'}),/CONFIG_INVALID/);
});
