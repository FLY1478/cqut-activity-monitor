import type {Activity,Profile} from './activity.ts';
export type Evidence={instruction:string;source:string};
export type Analysis={difficulty:'简单'|'中等'|'较难'|'待核实';recommendation:'优先考虑'|'可以考虑'|'投入较多'|'条件不符'|'先核实';effort:string;summary:string;participation:Evidence[];participationSummary:string;submissions:Evidence[];unknowns:string[];submissionSummary:string;rank:number};
const clip=(s:string,n=140)=>s.length>n?s.slice(0,n)+'…':s;
const no=/^(否|不需要|无需|未开启|不开启|不启用|关闭|不要求)$/;
const yes=/^(是|需要|开启|启用|要求)$/;
export function analyze(a:Activity,profile:Profile={}):Analysis{
  const participation:Evidence[]=[],submissions:Evidence[]=[],unknowns:string[]=[];
  const text=a.title+'\n'+a.description;let burden=0;
  const add=(list:Evidence[],instruction:string,source:string)=>{if(!list.some(x=>x.instruction===instruction))list.push({instruction,source:clip(source)});};
  const field=(key:string,instruction:string,list:Evidence[])=>{const value=a.fields[key];if(value&&yes.test(value))add(list,instruction,`${key}：${value}`);else if(!value||!no.test(value))unknowns.push(`${key}${value?`：${value}，含义待核实`:'未写明'}`);};
  field('需要提交总结','活动后提交总结',submissions);
  if(submissions.length){burden+=1;unknowns.push('总结字数、提交入口和截止时间以活动说明为准');}
  field('活动签退','现场签退',participation);
  if(yes.test(a.fields['活动签退']??''))burden+=1;
  if(a.fields['开启定位签到/签退']!==undefined){
    field('开启定位签到/签退','按说明完成定位签到／签退，核实具体时间与地点',participation);
    if(yes.test(a.fields['开启定位签到/签退']!))burden+=1;
  }else{
    field('开启定位签到','到现场定位签到',participation);
    field('开启定位签退','到现场定位签退',participation);
    if(yes.test(a.fields['开启定位签到']??'')||yes.test(a.fields['开启定位签退']??''))burden+=1;
  }
  const sentences=a.description.split(/[。！？\n；，]+|但(?:是)?|然而/).map(x=>x.trim()).filter(Boolean);
  for(const sentence of sentences){
    // Extract requirements with their wording; titles alone do not prove a deliverable.
    if(/无需|不需要|不要求|不用|不必|不得|禁止/.test(sentence)){continue;}
    if(/(提交|上传|发送|上交|提供|交付|报送|递交).{0,45}(照片|图片|视频|作品|证书|截图|心得|总结|论文|报告|文案|设计稿)|(?:照片|视频|作品|证书|截图|心得|总结|论文|报告|设计稿).{0,30}(提交|上传|发送|上交)/.test(sentence))add(submissions,clip(sentence,110),sentence);
    if(/(我|我们).{0,8}(通知|告知)|请爱护|不要浪费|QQ|微信群|诚信|概不负责|未完成|自身原因/.test(sentence))continue;
    if(/签到|签退|打卡|完成.{0,15}(测试|考试|问卷)|参加.{0,20}(比赛|培训|运动)|到场|现场参与|必须|务必|须.{0,10}(参加|完成|携带)|听满|听完|听完整/.test(sentence))add(participation,clip(sentence,85),sentence);
  }
  const lecture=/讲座|报告会|宣讲|分享会|观影/.test(text);
  const competition=/比赛|竞赛|赛事|评比|选拔/.test(text)&&(!lecture||/须参赛|必须参赛|需参加比赛/.test(a.description));
  const physical=/体育|运动|跑步|马拉松|篮球|足球|排球|羽毛球|健身|操舞|徒步/.test(text)&&(!lecture||/必须.{0,6}(运动|跑步)|须完成.{0,8}(跑步|运动)/.test(a.description));
  const work=submissions.some(x=>/作品|设计稿|视频|论文|文案/.test(x.instruction));
  const online=/线上|在线|网络|宿舍|寝室|手机|电脑/.test(a.fields['活动地点']??'');
  const exam=/考试|测试|考核|答题/.test(text);
  const practical=/志愿服务|劳动|实践|清扫|值守|摆摊|走访|排练/.test(text)&&!lecture;
  if(competition)burden+=3;if(physical||practical)burden+=2;if(work)burden+=3;if(exam)burden+=1;
  const wordCounts=submissions.flatMap(x=>[...x.instruction.matchAll(/(\d+)\s*字/g)].map(m=>Number(m[1])));
  if(wordCounts.some(n=>n>1000))burden+=3;else if(wordCounts.some(n=>n>=300))burden+=1;
  if(/连续\s*(?:[3-9]|\d{2,})\s*天|每日.{0,12}打卡/.test(a.description))burden+=3;
  if(physical)add(participation,'需实际参与运动；项目、强度和达标标准请看正文',a.title);
  if(practical)add(participation,'包含实际服务或实践，需按说明到场完成',a.title);
  if(competition)add(participation,'属于比赛／评比，需核实参赛流程和获分标准',a.title);
  const duration=text.match(/(?:持续|时长|耗时|约需|用时)\s*(\d+(?:\.\d+)?)\s*(分钟|小时)/);
  if(duration&&duration[2]==='小时'&&Number(duration[1])>2)burden+=1;
  const effort=duration?`说明标注约${duration[1]}${duration[2]}`:competition||work?'包含准备或制作，实际耗时未写明':physical?'需要实际运动，强度与耗时待核实':lecture?'通常需要按活动时间到场；是否有额外任务见下方':online?'可线上参加；具体步骤和耗时以说明为准':'参与地点和实际耗时需看说明';
  if(!a.description||a.detailVerified===false)unknowns.push('活动正文未可靠取得');
  if(!submissions.length)unknowns.push('页面未列出明确需交材料，不能据此保证无需提交');
  const difficulty:Analysis['difficulty']=!a.description||a.detailVerified===false?'待核实':burden>=3?'较难':burden>=1?'中等':'简单';
  const recommendation:Analysis['recommendation']=a.qualification.state==='ineligible'?'条件不符':difficulty==='待核实'?'先核实':burden>=3?'投入较多':burden===0&&(lecture||online)?'优先考虑':'可以考虑';
  const summary=a.qualification.state==='ineligible'?'不满足你的明确参加条件。':competition?'比赛类活动，与你偏好轻量参与的方向差距较大。':physical?'需要实际运动，不能只在手机上操作完成。':work?'需要制作材料或作品，准备投入较多。':lecture?'讲座／宣讲类，可优先了解签到和总结要求。':online?'线上活动，可优先核对完成步骤与提交要求。':'按公开要求评估；参加方式仍需阅读正文。';
  const concreteSummary=submissions.some(x=>x.source!=='需要提交总结：是'&&/总结|心得/.test(x.instruction));
  const submissionSummary=submissions.length?submissions.filter(x=>!concreteSummary||x.source!=='需要提交总结：是').map(x=>x.instruction).join('；'):'未明确列出需交材料；参加前核实';
  // Prefer the page's actual time/step wording over duplicate generic field labels.
  for(const word of ['签到','签退'])if(participation.some(x=>x.instruction.includes(word)&&x.source!==`活动${word}：是`&&/\d|分钟|活动|必须/.test(x.instruction))){
    for(let i=participation.length-1;i>=0;i--)if(participation[i]!.instruction.includes(word)&&/^(开启定位签到|开启定位签退|开启定位签到\/签退|活动签退)：/.test(participation[i]!.source))participation.splice(i,1);
    if(participation.some(x=>x.instruction.includes(word)&&/\d|分钟/.test(x.instruction)))for(let i=participation.length-1;i>=0;i--)if(participation[i]!.instruction.includes(word)&&!(/\d|分钟|必须|务必/.test(participation[i]!.instruction)))participation.splice(i,1);
  }
  const rank=(a.qualification.state==='ineligible'?100:0)+(a.qualification.state==='unknown'?5:0)+(profile.preferSimple===false?0:burden*10)+(!lecture&&!online?3:0);
  const structured=(e:Evidence)=>/^(开启定位签到|开启定位签退|开启定位签到\/签退|活动签退)：/.test(e.source);
  const concrete=participation.filter(x=>!structured(x));
  const participationSummary=participation.filter(x=>!structured(x)||['签到','签退'].filter(word=>x.instruction.includes(word)).some(word=>!concrete.some(y=>y.instruction.includes(word)))).map(x=>x.instruction).join('；')||effort;
  return {difficulty,recommendation,effort,summary,participation,participationSummary,submissions,unknowns,submissionSummary,rank};
}
