import {join} from 'node:path';
import {readSecret,writeSecret} from './secrets.ts';
export type WechatConfig={appId:string;appSecret:string;openId:string;templateId:string};
export type Notification={title:string;subject:string;time:string;status:string;remark:string;url:string};
export type SendResult={status:'accepted'|'rejected'|'unknown';messageId?:string;errorCode?:number;channel?:'template'|'article'|'template_fallback'};

async function api(path:string,body?:unknown):Promise<Record<string,any>> {
  // Credentials/tokens are sent only to the official API. Never print request URLs,
  // response bodies, or transport exception messages (which can contain a token).
  const response=await fetch('https://api.weixin.qq.com'+path,{method:body?'POST':'GET',
    headers:body?{'Content-Type':'application/json'}:undefined,
    body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('WECHAT_HTTP_FAILURE');
  return await response.json() as Record<string,any>;
}

export function templatePayload(config:WechatConfig,message:Notification) {
  const url=new URL(message.url);
  if(url.protocol!=='https:'||url.hostname!=='2class.cqut.edu.cn'||url.username||url.password||[...url.searchParams.keys()].some(key=>/ticket|token|password|pwd|cookie|account|username/i.test(key)))throw new Error('INVALID_NOTIFICATION_LINK');
  // All school content becomes plain template text, never executable HTML.
  const text=(value:string,max:number)=>value.replace(/[\u0000-\u0008\u000b-\u001f]/g,'').slice(0,max);
  return {touser:config.openId,template_id:config.templateId,url:url.href,data:{
    first:{value:text(message.title,80)},keyword1:{value:text(message.subject,200)},
    keyword2:{value:text(message.time,100)},keyword3:{value:text(message.status,100)},remark:{value:text(message.remark,1000)}}};
}

async function access(privateDir:string){
  const config=await readSecret<WechatConfig>(join(privateDir,'wechat.dpapi'));
  const cachePath=join(privateDir,'wechat-token.dpapi');
  let cached=await readSecret<{token:string;expiresAt:number;appId:string}>(cachePath).catch(()=>undefined);
  if(!cached||cached.appId!==config.appId||cached.expiresAt<Date.now()+60000) {
    let token=await api('/cgi-bin/stable_token',{grant_type:'client_credential',appid:config.appId,secret:config.appSecret,force_refresh:false});
    // Some development accounts expose the classic endpoint only.
    if(token.errcode===48001)token=await api('/cgi-bin/token?'+new URLSearchParams({grant_type:'client_credential',appid:config.appId,secret:config.appSecret}));
    if(typeof token.access_token!=='string'||typeof token.expires_in!=='number')throw new Error('WECHAT_AUTH_REJECTED');
    cached={appId:config.appId,token:token.access_token,expiresAt:Date.now()+(token.expires_in-300)*1000};
    await writeSecret(cachePath,cached);
  }
  return {config,token:cached.token};
}
export async function sendWechat(privateDir:string,message:Notification):Promise<SendResult> {
  const {config,token}=await access(privateDir);
  try {
    const payload=templatePayload(config,message);
    const response=await api('/cgi-bin/message/template/send?access_token='+encodeURIComponent(token),payload);
    return classifySendResponse(response);
  }catch{return {status:'unknown'};}
}
export async function sendWechatImage(privateDir:string,png:Uint8Array):Promise<SendResult>{
  // Optional card preview only. Official customer-message interaction quotas
  // prevent this channel from replacing unattended template reminders.
  if(png.length>2*1024*1024||png.length<8||Buffer.from(png.slice(0,8)).toString('hex')!=='89504e470d0a1a0a')throw new Error('INVALID_CARD_IMAGE');
  const {config,token}=await access(privateDir);
  try{
    const form=new FormData();form.append('media',new Blob([new Uint8Array(png)],{type:'image/png'}),'activity-card.png');
    const response=await fetch('https://api.weixin.qq.com/cgi-bin/media/upload?'+new URLSearchParams({access_token:token,type:'image'}),{method:'POST',body:form,redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok)return {status:'unknown'};
    const media=await response.json() as Record<string,unknown>;
    if(typeof media.media_id!=='string')return {status:typeof media.errcode==='number'?'rejected':'unknown',errorCode:typeof media.errcode==='number'?media.errcode:undefined};
    const result=await api('/cgi-bin/message/custom/send?access_token='+encodeURIComponent(token),{touser:config.openId,msgtype:'image',image:{media_id:media.media_id}});
    return result.errcode===0?{status:'accepted'}:{status:typeof result.errcode==='number'?'rejected':'unknown',errorCode:result.errcode};
  }catch{return {status:'unknown'};}
}
export async function sendWechatArticlePreview(privateDir:string,cover:Uint8Array,article:{title:string;content:string;sourceUrl:string;digest:string}):Promise<SendResult>{
  return sendWechatArticlePreviews(privateDir,cover,[article]);
}
export async function sendWechatArticlePreviews(privateDir:string,cover:Uint8Array,articles:{title:string;content:string;sourceUrl:string;digest:string}[]):Promise<SendResult>{
  if(!articles.length||articles.length>8)throw new Error('INVALID_ARTICLE_BATCH');
  const {config,token}=await access(privateDir);
  // Validate the only external link. The HTML is generated by our escaping
  // renderer; never pass school HTML or account/session values into this method.
  for(const article of articles){templatePayload(config,{title:'',subject:'',time:'',status:'',remark:'',url:article.sourceUrl});if(/<\s*(script|iframe|img|form|object|a)\b|\son\w+\s*=/i.test(article.content))throw new Error('UNSAFE_ARTICLE_CONTENT');}
  if(cover.length>2*1024*1024||cover.length<8||Buffer.from(cover.slice(0,8)).toString('hex')!=='89504e470d0a1a0a')throw new Error('INVALID_CARD_IMAGE');
  try{
    const form=new FormData();form.append('media',new Blob([new Uint8Array(cover)],{type:'image/png'}),'activity-cover.png');
    const upload=await fetch('https://api.weixin.qq.com/cgi-bin/media/upload?'+new URLSearchParams({access_token:token,type:'image'}),{method:'POST',body:form,redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!upload.ok)return {status:'unknown'};const image=await upload.json() as Record<string,unknown>;
    if(typeof image.media_id!=='string')return {status:typeof image.errcode==='number'?'rejected':'unknown',errorCode:typeof image.errcode==='number'?image.errcode:undefined};
    const news=await api('/cgi-bin/media/uploadnews?access_token='+encodeURIComponent(token),{articles:articles.map(article=>({title:article.title.slice(0,64),thumb_media_id:image.media_id,author:'二课活动手册',digest:article.digest.slice(0,100),show_cover_pic:0,content:article.content,content_source_url:article.sourceUrl,need_open_comment:0}))});
    if(typeof news.media_id!=='string')return {status:typeof news.errcode==='number'?'rejected':'unknown',errorCode:news.errcode};
    // Only preview to the configured single recipient. No mass/send, public
    // publication or messages to all followers are used.
    const result=await api('/cgi-bin/message/mass/preview?access_token='+encodeURIComponent(token),{touser:config.openId,msgtype:'mpnews',mpnews:{media_id:news.media_id}});
    return result.errcode===0?{status:'accepted'}:{status:typeof result.errcode==='number'?'rejected':'unknown',errorCode:result.errcode};
  }catch{return {status:'unknown'};}
}

export function classifySendResponse(response:Record<string,unknown>):SendResult {
  if(response.errcode===0&&response.msgid!==undefined)return {status:'accepted',messageId:String(response.msgid)};
  if(typeof response.errcode==='number'&&response.errcode!==0)return {status:'rejected',errorCode:response.errcode};
  return {status:'unknown'};
}
