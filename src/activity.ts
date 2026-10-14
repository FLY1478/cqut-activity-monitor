import {load} from 'cheerio';
import {createHash} from 'node:crypto';
export type Profile={college?:string;grade?:string;campus?:string;major?:string;transfer?:boolean;crossCampus?:boolean;preferSimple?:boolean};
export type Qualification={state:'eligible'|'ineligible'|'unknown';reasons:string[]};
export type Activity={id:string;title:string;url:string;applyStart?:number;applyEnd?:number;start?:number;end?:number;score?:number;
  fields:Record<string,string>;description:string;button:string;registered?:number;capacity?:number;unlimited:boolean;qualification:Qualification;detailVerified?:boolean;detailIssue?:string;availability:'upcoming'|'open'|'full'|'ended'|'registered'|'unknown'};
const tidy=(s:string)=>s.replace(/\s+/g,' ').trim();
export function parseFields(html:string):Record<string,string> {
  const $=load(html);const fields:Record<string,string>={};
  $('li.mui-table-view-cell').each((_,element)=>{const e=$(element);const values=e.find('span.mui-pull-right').clone();values.find('br').replaceWith('、');const value=tidy(values.text());const label=e.clone();label.find('span,i').remove();const key=tidy(label.text());if(key)fields[key]=value;});
  return fields;
}
export function parseProfile(html:string):Profile {
  const $=load(html);const text=$('.word .desc').text();
  // A class number or student number is not proof of the student's admission year.
  return {college:text.match(/学院[：:]\s*([^\n\r]+)/)?.[1]?.trim(),grade:text.match(/年级[：:]\s*(\d{4})/)?.[1],campus:text.match(/校区[：:]\s*([^\n\r]+)/)?.[1]?.trim()};
}
export function qualify(fields:Record<string,string>,description:string,profile:Profile):Qualification {
  const reasons:string[]=[];let missing=false;let mismatch=false;
  const check=(label:string,value:string|undefined,unrestricted:RegExp)=>{
    const rule=fields[label];
    if(!rule){missing=true;reasons.push(`${label}未取得`);return;}
    if(unrestricted.test(rule)){reasons.push(`${label}：${rule}`);return;}
    if(!value){missing=true;reasons.push(`${label}：${rule}；本人资料不足`);return;}
    // Compare whole school labels, not partial substrings ("机械" vs "机械工程学院").
    const allowed=rule.split(/[，,、;；\s]+/).map(s=>s.replace(/年级|级$/g,'').trim()).filter(Boolean);
    const understood=label==='限制年级'?allowed.every(s=>/^\d{4}$/.test(s)):allowed.every(s=>/学院$/.test(s)&&(s.match(/学院/g)??[]).length===1);
    if(!understood){missing=true;reasons.push(`${label}格式需要核实：${rule}`);}
    else if(allowed.includes(value)){reasons.push(`${label}匹配`);}
    else {mismatch=true;reasons.push(`${label}不匹配：${rule}`);}
  };
  check('限制人员',profile.college,/^(不限制学院|不限制|不限|全校)$/);
  check('限制年级',profile.grade,/^(不限制|不限|全校)$/);
  const location=fields['活动地点']??'';
  const campuses=['两江','花溪','綦江'].filter(c=>location.includes(c));
  const online=/^(线上|在线|网络|寝室|宿舍|手机|电脑)|腾讯会议|学习通|线上参与/.test(location);
  if(profile.crossCampus===false&&profile.campus&&!online){
    if(campuses.length===1&&!profile.campus.includes(campuses[0]!)){mismatch=true;reasons.push(`活动地点为${location}；不接受跨校区`);}
    else if(!campuses.length||campuses.length>1){missing=true;reasons.push(`活动地点未明确为${profile.campus}或线上，需核实`);}
    else reasons.push('活动地点符合本人校区');
  }
  if(profile.transfer&&/(不接受|不含|不包括|除外|不得).{0,6}专升本|专升本.{0,6}(除外|不得|不能)/.test(description)){mismatch=true;reasons.push('正文明确排除专升本学生');}
  // Descriptions may contain restrictions absent from structured fields. Campus,
  // sex, membership, majors and organizer approval are never silently ignored.
  if(/仅限|限.{0,8}(参加|报名)|只限|只面向|面向.{0,25}(学院|专业|年级|党员|学生|同学)|报名条件|参与条件|申请条件|资格|审核|限额|名单|花溪|两江|綦江|本科|研究生|大一|大二|大三|大四|新生|男生|女生|会员|团员|党员/.test(description)){
    missing=true;reasons.push('正文含校区或参与条件，请阅读详情核实');
  }
  const method=fields['报名方式'];
  if(!method||!/^报名制$/.test(method)){missing=true;reasons.push(`报名方式${method?`为${method}`:'未知'}，需核实参与方式`);}
  return {state:mismatch?'ineligible':missing?'unknown':'eligible',reasons};
}
function epoch(value:unknown):number|undefined {const n=Number(value);return Number.isFinite(n)&&n>0?n*1000:undefined;}
export function parseActivity(raw:Record<string,unknown>,html:string,url:string,profile:Profile,now=Date.now()):Activity {
  const $=load(html);const fields=parseFields(html);const title=String(raw.activityName??'');
  const text=$('body').text();const detailVerified=!!title&&text.replace(/\s/g,'').includes(title.replace(/\s/g,''));
  // The live service sometimes returns an empty detail template
  // (1970 dates and blank fields). Preserve that row
  // as unknown only when its embedded ID matches the requested list record.
  // A login page, a different activity, or an unrecognized response still fails.
  const embedded=[...html.matchAll(/activityID\s*:\s*['"](\d+)['"]/g)].map(m=>m[1]);
  if(!detailVerified&&(!title||!embedded.includes(String(raw.activityID))||Object.keys(fields).length<5))throw new Error('DETAIL_TITLE_MISMATCH');
  let description='';$('.mui-content-padded').each((_,e)=>{const block=$(e);if(block.children().first().text().trim()==='活动详情'){const content=block.clone();content.children().first().remove();content.find('br').replaceWith('\n');content.find('p,div,li').append('\n');description=content.text().replace(/[\t ]+/g,' ').replace(/\n\s*\n/g,'\n').trim();}});
  const button=tidy($('#ok').text());const numbers=fields['报名人数']?.match(/^(\d+)\s*\/\s*(\d+|不限制|不限)/);
  const registered=numbers?Number(numbers[1]):undefined;const unlimited=!!numbers&&/不限|不限制/.test(numbers[2]!);
  const capacity=numbers&&!unlimited?Number(numbers[2]):undefined;
  const applyStart=epoch(raw.applyStartDate),applyEnd=epoch(raw.applyEndDate);
  let availability:Activity['availability']='unknown';
  if(/已报名|等待.*(确认|审核)|已申请/.test(button))availability='registered';
  else if(applyEnd!==undefined&&now>=applyEnd)availability='ended';
  else if(applyStart!==undefined&&now<applyStart)availability='upcoming';
  else if(/已满/.test(button)||(capacity!==undefined&&registered!==undefined&&registered>=capacity))availability='full';
  else if(button==='立即报名'&&applyStart!==undefined&&applyEnd!==undefined)availability='open';
  else if(!detailVerified&&Number(raw.status2)===2&&applyStart!==undefined&&applyEnd!==undefined)availability='open';
  const qualification=qualify(fields,title+' '+description,profile);
  if(!description){qualification.state=qualification.state==='ineligible'?'ineligible':'unknown';qualification.reasons.push('活动正文未取得');}
  if(!detailVerified){qualification.state='unknown';qualification.reasons.push('学校详情未显示列表标题，需核实；未据此判定可参加');}
  return {id:String(raw.activityID),title,url,applyStart,applyEnd,start:epoch(raw.startDate),end:epoch(raw.endDate),score:typeof raw.score==='number'?raw.score:undefined,
    fields,description,button,registered,capacity,unlimited,qualification,availability,detailVerified,detailIssue:detailVerified?undefined:'school_detail_missing_or_inconsistent'};
}
export function importantFingerprint(a:Activity):string {
  // Exclude ordinary participant-count changes; only full -> open matters.
  const stableFields=Object.entries(a.fields).filter(([key])=>key!=='报名人数').sort(([a],[b])=>a.localeCompare(b));
  return createHash('sha256').update(JSON.stringify([a.title,a.applyStart,a.applyEnd,a.start,a.end,a.score,stableFields,a.capacity,a.unlimited,a.description,a.qualification,a.detailVerified])).digest('hex');
}
export function personalize(a:Activity,profile:Profile):Activity{
  const qualification=qualify(a.fields,a.title+' '+a.description,profile);
  if(!a.description||a.detailVerified===false){if(qualification.state!=='ineligible')qualification.state='unknown';qualification.reasons.push('活动详情未可靠取得，需核实');}
  let availability=a.availability;
  if(a.availability!=='registered'&&a.applyEnd!==undefined&&Date.now()>=a.applyEnd)availability='ended';
  return {...a,qualification,availability};
}
export function enrollment(a:Activity){
  const capacity=a.unlimited?'不限':a.capacity===undefined?(a.fields['限制活动参与人数']??'未知'):String(a.capacity)+'人';
  const count=a.registered===undefined?(a.fields['报名人数']??'未知'):String(a.registered)+'人';
  const fullness=a.availability==='full'?'已满':a.unlimited?'未满（不限人数）':a.registered!==undefined&&a.capacity!==undefined?(a.registered>=a.capacity?'已满':`未满（余${a.capacity-a.registered}名）`):'是否已满：未知，需实时核实';
  return {capacity,count,fullness};
}
