export const schedulePolicy={timeZone:'Asia/Shanghai',startMinute:8*60,endMinute:20*60,intervalMs:180*60*1000,digestRetryMs:30*60*1000,digestMinute:19*60} as const;
export function localClock(now:number){
  const value=new Date(now+8*60*60*1000);
  return {day:value.toISOString().slice(0,10),minute:value.getUTCHours()*60+value.getUTCMinutes()};
}
export function inMonitoringWindow(now:number){const {minute}=localClock(now);return minute>=schedulePolicy.startMinute&&minute<schedulePolicy.endMinute;}
export function scanDue(now:number,lastScan?:string,lastDigestDay?:string,lastAttempt?:string){
  if(!inMonitoringWindow(now))return false;
  const clock=localClock(now);
  const attempt=lastAttempt?Date.parse(lastAttempt):NaN;
  const needsDigest=clock.minute>=schedulePolicy.digestMinute&&lastDigestDay!==clock.day;
  if(Number.isFinite(attempt)&&now-attempt<(needsDigest?schedulePolicy.digestRetryMs:schedulePolicy.intervalMs)){
    const previous=localClock(attempt);
    if(!(clock.minute>=schedulePolicy.digestMinute&&lastDigestDay!==clock.day&&(previous.day!==clock.day||previous.minute<schedulePolicy.digestMinute)))return false;
  }
  // Catch up today's digest after an outage, before the quiet period starts.
  if(clock.minute>=schedulePolicy.digestMinute&&lastDigestDay!==clock.day)return true;
  const last=lastScan?Date.parse(lastScan):NaN;
  if(!Number.isFinite(last))return true;
  const previous=localClock(last),slot=(minute:number)=>Math.floor((minute-schedulePolicy.startMinute)/(schedulePolicy.intervalMs/60000));
  return previous.day!==clock.day||slot(clock.minute)>slot(previous.minute);
}
export function digestDay(now:number,lastDigestDay?:string){const clock=localClock(now);return inMonitoringWindow(now)&&clock.minute>=schedulePolicy.digestMinute&&lastDigestDay!==clock.day?clock.day:undefined;}
