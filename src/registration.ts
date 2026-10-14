import {randomBytes} from 'node:crypto';
import type {Activity} from './activity.ts';
export type SignupResult={state:'success'|'review'|'lottery'|'full'|'rejected'|'unknown';message:string};
export type Attempt={activityId:string;at:number;state:'in_flight'|SignupResult['state'];mode:'simulation'|'live'};
export type SignupLedger={version:1;attempts:Attempt[]};
export type Prepared={activity:Activity;captcha:string;submit:(captcha:string)=>Promise<SignupResult>;close:()=>Promise<void>};
type Intent={id:string;expiresAt:number;prepared:Prepared;used:boolean};
export function classifySignup(value:unknown):SignupResult{
  const code=String(value);
  if(code==='1')return {state:'success',message:'学校返回报名成功'};
  if(code==='2')return {state:'review',message:'已提交，等待老师确认'};
  if(code==='3')return {state:'lottery',message:'已申请，等待随机抽签；尚未确认获得名额'};
  if(code==='-2')return {state:'full',message:'学校返回名额已满'};
  if(typeof value==='string'&&value.length<300)return {state:'rejected',message:'学校拒绝本次报名，请在官方页面核实原因'};
  return {state:'unknown',message:'结果无法确认，请查看学校报名记录，系统不会自动重试'};
}
export class Registration {
  private intent?:Intent;
  private busy=false;
  private nextPrepare=0;
  private options:{mode:'simulation'|'live';allowLive:boolean;ledger:SignupLedger;persist:(ledger:SignupLedger)=>Promise<void>;prepare:(id:string)=>Promise<Prepared>;now?:()=>number};
  constructor(options:Registration['options']){this.options=options;}
  private now(){return this.options.now?.()??Date.now();}
  async prepare(id:string){
    if(this.busy)throw new Error('SIGNUP_BUSY');
    if(this.now()<this.nextPrepare)throw new Error('SIGNUP_COOLDOWN');
    if(this.options.mode==='live'&&!this.options.allowLive)throw new Error('LIVE_SIGNUP_DISABLED');
    if(!/^\d+$/.test(id))throw new Error('INVALID_ACTIVITY');
    if(this.options.ledger.attempts.some(a=>a.activityId===id&&a.mode===this.options.mode&&['in_flight','unknown','success','review','lottery'].includes(a.state)))throw new Error('CHECK_OFFICIAL_RECORD_FIRST');
    this.busy=true;this.nextPrepare=this.now()+30000;
    try{
      await this.intent?.prepared.close();this.intent=undefined;
      const prepared=await this.options.prepare(id);
      if(prepared.activity.qualification.state==='ineligible'||prepared.activity.availability!=='open'||prepared.activity.detailVerified===false){await prepared.close();throw new Error('ACTIVITY_NOT_READY');}
      const intent={id:randomBytes(32).toString('hex'),expiresAt:this.now()+180000,prepared,used:false};this.intent=intent;
      return {intent:intent.id,expiresAt:intent.expiresAt,activity:prepared.activity,captcha:prepared.captcha,mode:this.options.mode};
    }finally{this.busy=false;}
  }
  async submit(id:string,captcha:string,confirmed:boolean):Promise<SignupResult&{mode:'simulation'|'live'}>{
    if(this.busy)throw new Error('SIGNUP_BUSY');
    const intent=this.intent;
    if(!intent||intent.id!==id||intent.used||this.now()>intent.expiresAt)throw new Error('SIGNUP_INTENT_EXPIRED');
    if(!confirmed)throw new Error('SIGNUP_CONFIRM_REQUIRED');
    if(!/^\d{1,8}$/.test(captcha))throw new Error('INVALID_CAPTCHA');
    if(this.options.mode==='live'&&!this.options.allowLive)throw new Error('LIVE_SIGNUP_DISABLED');
    const attempts=this.options.ledger.attempts.filter(a=>a.mode===this.options.mode);
    if(attempts.some(a=>this.now()-a.at<30000)||attempts.filter(a=>this.now()-a.at<600000).length>=3)throw new Error('SIGNUP_COOLDOWN');
    this.busy=true;intent.used=true;
    const attempt:Attempt={activityId:intent.prepared.activity.id,at:this.now(),state:'in_flight',mode:this.options.mode};
    try{
      this.options.ledger.attempts.push(attempt);
      // Persist before touching the school; a crash preserves an uncertain attempt.
      await this.options.persist(structuredClone(this.options.ledger));
      let result:SignupResult;
      try{result=await intent.prepared.submit(captcha);}catch{result={state:'unknown',message:'请求中断，结果未知。请检查学校报名记录；不会自动重发。'};}
      attempt.state=result.state;await this.options.persist(structuredClone(this.options.ledger));
      return {...result,mode:this.options.mode};
    }finally{await intent.prepared.close();this.intent=undefined;this.busy=false;}
  }
  async close(){await this.intent?.prepared.close();this.intent=undefined;}
}
