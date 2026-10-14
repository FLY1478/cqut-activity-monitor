import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {writeSecret} from '../src/secrets.ts';
import {sendWechatImage} from '../src/wechat.ts';
test('image upload uses fetch Response.ok property and only then dispatches one official custom message',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'cqut-image-'));const original=globalThis.fetch;let uploads=0,sends=0;
  try{
    await writeSecret(join(directory,'wechat.dpapi'),{appId:'fake-app',appSecret:'fake-secret',openId:'fake-user',templateId:'fake-template'});
    await writeSecret(join(directory,'wechat-token.dpapi'),{appId:'fake-app',token:'fake-token',expiresAt:Date.now()+3600000});
    globalThis.fetch=(async(url:any,options:any)=>{const u=new URL(String(url));assert.equal(u.hostname,'api.weixin.qq.com');assert.equal(options.method,'POST');if(u.pathname==='/cgi-bin/media/upload'){uploads++;assert.ok(options.body instanceof FormData);return Response.json({media_id:'fake-media'});}assert.equal(u.pathname,'/cgi-bin/message/custom/send');sends++;assert.equal(JSON.parse(options.body).msgtype,'image');return Response.json({errcode:0,errmsg:'ok'});}) as typeof fetch;
    const png=Uint8Array.from([137,80,78,71,13,10,26,10]);assert.equal((await sendWechatImage(directory,png)).status,'accepted');assert.equal(uploads,1);assert.equal(sends,1);
    globalThis.fetch=(async()=>Response.json({errcode:48001})) as typeof fetch;assert.equal((await sendWechatImage(directory,png)).status,'rejected');assert.equal(sends,1);
  }finally{globalThis.fetch=original;await rm(directory,{recursive:true,force:true});}
});
