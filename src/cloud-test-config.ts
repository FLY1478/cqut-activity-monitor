import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import type {Profile} from './activity.ts';
import type {WechatConfig} from './wechat.ts';
type BaseConfig={version:1;createdAt:number;expiresAt:number;credentials:{account:string;password:string};preferences:Profile};
export type CloudTestConfig=BaseConfig&({purpose?:'school_and_wechat';wechat:WechatConfig;notification:{style:'template'|'article-preview';dailyPreviewBudget:1}}|{purpose:'school_recovery';wechat?:never;notification?:never});
const bounded=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f]/.test(v);
export function validateCloudTestConfig(value:unknown,now=Date.now()):CloudTestConfig{
  const v=value as CloudTestConfig;
  if(!v||v.version!==1||!Number.isFinite(v.createdAt)||!Number.isFinite(v.expiresAt)||v.createdAt>now+60000||v.expiresAt<=now||v.expiresAt-v.createdAt>2*60*60*1000||
    !bounded(v.credentials?.account,64)||!bounded(v.credentials?.password,256)||!v.preferences||![undefined,'school_and_wechat','school_recovery'].includes(v.purpose))throw new Error('CLOUD_TEST_CONFIG_INVALID');
  if(v.purpose!=='school_recovery'&&(!bounded(v.wechat?.appId,128)||!bounded(v.wechat?.appSecret,256)||!bounded(v.wechat?.openId,128)||!bounded(v.wechat?.templateId,256)||!['template','article-preview'].includes(v.notification?.style)||v.notification.dailyPreviewBudget!==1))throw new Error('CLOUD_TEST_CONFIG_INVALID');
  const preferences:Profile={};
  for(const name of ['college','grade','campus','major'] as const){const p=v.preferences[name];if(p!==undefined){if(!bounded(p,100))throw new Error('CLOUD_TEST_CONFIG_INVALID');preferences[name]=p;}}
  for(const name of ['transfer','crossCampus','preferSimple'] as const){const p=v.preferences[name];if(p!==undefined){if(typeof p!=='boolean')throw new Error('CLOUD_TEST_CONFIG_INVALID');preferences[name]=p;}}
  // Do not forward unrelated local data or extra keys into the cloud bundle.
  const base:BaseConfig={version:1,createdAt:v.createdAt,expiresAt:v.expiresAt,credentials:{account:v.credentials.account,password:v.credentials.password},preferences};
  if(v.purpose==='school_recovery')return {...base,purpose:'school_recovery'};
  return {...base,...(v.purpose?{purpose:v.purpose}:{}),wechat:{appId:v.wechat.appId,appSecret:v.wechat.appSecret,openId:v.wechat.openId,templateId:v.wechat.templateId},notification:{style:v.notification.style,dailyPreviewBudget:1}};
}
const keyBuffer=(key:string)=>{if(!/^[a-f0-9]{64}$/i.test(key))throw new Error('CLOUD_TEST_KEY_INVALID');return Buffer.from(key,'hex');};
export function sealCloudTestConfig(config:CloudTestConfig,key:string):string{
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',keyBuffer(key),iv);cipher.setAAD(Buffer.from('cqut:cloud-test:v1'));
  const data=Buffer.concat([cipher.update(JSON.stringify(validateCloudTestConfig(config)),'utf8'),cipher.final()]);
  return JSON.stringify({version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')});
}
export function openCloudTestConfig(payload:string,key:string):CloudTestConfig{
  try{
    if(payload.length>16384)throw new Error();const e=JSON.parse(payload);
    const iv=Buffer.from(e.iv,'base64'),tag=Buffer.from(e.tag,'base64');if(e.version!==1||iv.length!==12||tag.length!==16)throw new Error();
    const decipher=createDecipheriv('aes-256-gcm',keyBuffer(key),iv);decipher.setAAD(Buffer.from('cqut:cloud-test:v1'));decipher.setAuthTag(tag);
    return validateCloudTestConfig(JSON.parse(Buffer.concat([decipher.update(Buffer.from(e.data,'base64')),decipher.final()]).toString('utf8')));
  }catch{throw new Error('CLOUD_TEST_CONFIG_REJECTED');}
}
