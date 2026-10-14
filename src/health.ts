import {localClock} from './schedule.ts';
export type HealthReport={version:1;observedAt:string;lastSuccessfulScan?:string;lastAttempt?:string;lastError?:string;digestDay?:string;digestState?:'accepted'|'received'|'pending'|'unknown'|'rejected'|'in_flight';pending:number;rejected:number;unknown:number;oldestPendingAt?:string};
export type HealthIssue='missed_scans'|'scan_failed'|'digest_overdue'|'notification_backlog'|'notification_uncertain';
export const healthPolicy={scanGraceMinutes:20,digestDeadlineMinute:20*60,alarmEndMinute:20*60+30,backlogMinutes:30} as const;
const stamp=(value:string|undefined)=>value?Date.parse(value):NaN;
export function validateHealthReport(value:unknown):HealthReport{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_HEALTH_REPORT');
  const r=value as Record<string,unknown>;
  const allowed=['version','observedAt','lastSuccessfulScan','lastAttempt','lastError','digestDay','digestState','pending','rejected','unknown','oldestPendingAt'];
  if(Object.keys(r).some(k=>!allowed.includes(k))||r.version!==1||typeof r.observedAt!=='string')throw new Error('INVALID_HEALTH_REPORT');
  for(const key of ['observedAt','lastSuccessfulScan','lastAttempt','oldestPendingAt'])if(r[key]!==undefined&&(typeof r[key]!=='string'||!Number.isFinite(Date.parse(r[key] as string))))throw new Error('INVALID_HEALTH_REPORT');
  for(const key of ['pending','rejected','unknown'])if(!Number.isInteger(r[key])||(r[key] as number)<0||(r[key] as number)>100000)throw new Error('INVALID_HEALTH_REPORT');
  if(r.lastError!==undefined&&(typeof r.lastError!=='string'||!/^[A-Z_]{1,90}$/.test(r.lastError)))throw new Error('INVALID_HEALTH_REPORT');
  if(r.digestDay!==undefined&&(typeof r.digestDay!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.digestDay)))throw new Error('INVALID_HEALTH_REPORT');
  if(r.digestState!==undefined&&!['accepted','received','pending','unknown','rejected','in_flight'].includes(String(r.digestState)))throw new Error('INVALID_HEALTH_REPORT');
  const observed=stamp(r.observedAt as string);for(const key of ['lastSuccessfulScan','lastAttempt','oldestPendingAt'])if(stamp(r[key] as string)>observed+60000)throw new Error('INVALID_HEALTH_REPORT');
  return r as HealthReport;
}
export function healthIssues(now:number,enabledAt:string,report?:HealthReport):HealthIssue[]{
  const enabled=stamp(enabledAt);if(!Number.isFinite(enabled)||now<enabled)throw new Error('INVALID_HEALTH_START');
  const clock=localClock(now);if(clock.minute<8*60||clock.minute>healthPolicy.alarmEndMinute)return [];
  const issues:HealthIssue[]=[],last=stamp(report?.lastSuccessfulScan);
  const midnight=Date.parse(clock.day+'T00:00:00+08:00');
  const missed=[8,11,14,17].filter(hour=>{const slot=midnight+hour*3600000;return slot>=enabled&&now>=slot+healthPolicy.scanGraceMinutes*60000&&(!Number.isFinite(last)||last<slot);});
  if(missed.length>=2)issues.push('missed_scans');
  if(report?.lastError&&stamp(report.lastAttempt)>=(Number.isFinite(last)?last:enabled)&&stamp(report.lastAttempt)>=enabled)issues.push('scan_failed');
  if(clock.minute>=healthPolicy.digestDeadlineMinute&&midnight+19*3600000>=enabled&&!(report?.digestDay===clock.day&&['accepted','received'].includes(report.digestState??'')))issues.push('digest_overdue');
  if((report?.pending??0)>0&&now-stamp(report?.oldestPendingAt)>=healthPolicy.backlogMinutes*60000)issues.push('notification_backlog');
  if((report?.rejected??0)>0||(report?.unknown??0)>0)issues.push('notification_uncertain');
  return issues;
}
export const issueLabels:Record<HealthIssue,string>={missed_scans:'连续两轮未完成扫描',scan_failed:'登录或活动扫描失败',digest_overdue:'19:00汇总未确认发送',notification_backlog:'活动通知积压超过30分钟',notification_uncertain:'通知被拒绝或发送结果未知'};
