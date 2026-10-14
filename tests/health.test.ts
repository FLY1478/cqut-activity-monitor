import {test} from 'node:test';
import assert from 'node:assert/strict';
import {healthIssues,validateHealthReport,type HealthReport} from '../src/health.ts';
const at=(clock:string)=>Date.parse(`2026-10-14T${clock}:00+08:00`),iso=(clock:string)=>new Date(at(clock)).toISOString(),enabled=iso('07:50');
const report=(patch:Partial<HealthReport>={}):HealthReport=>({version:1,observedAt:iso('19:10'),lastSuccessfulScan:iso('17:08'),pending:0,rejected:0,unknown:0,...patch});
test('quiet nights; scan grace tolerates a slow run and alerts on two missed planned slots',()=>{
  for(const clock of ['00:00','07:59','20:31','23:59'])assert.deepEqual(healthIssues(at(clock),new Date(at('00:00')).toISOString()),[]);
  assert.deepEqual(healthIssues(at('11:19'),enabled),[]);assert.ok(healthIssues(at('11:20'),enabled).includes('missed_scans'));
  assert.deepEqual(healthIssues(at('14:19'),enabled,report({lastSuccessfulScan:iso('08:08')})),[]);
  assert.ok(healthIssues(at('14:20'),enabled,report({lastSuccessfulScan:iso('08:08')})).includes('missed_scans'));
  assert.deepEqual(healthIssues(at('14:21'),iso('14:10')),[]);
});
test('queued digest is not delivered; complete fresh scan alone cannot hide notification problems',()=>{
  assert.deepEqual(healthIssues(at('19:59'),enabled,report()),[]);
  assert.ok(healthIssues(at('20:00'),enabled,report({digestDay:'2026-10-14',digestState:'pending'})).includes('digest_overdue'));
  assert.deepEqual(healthIssues(at('20:00'),enabled,report({digestDay:'2026-10-14',digestState:'accepted'})),[]);
  const issues=healthIssues(at('19:10'),enabled,report({lastSuccessfulScan:iso('19:09'),pending:1,oldestPendingAt:iso('18:30'),unknown:1}));
  assert.ok(issues.includes('notification_backlog'));assert.ok(issues.includes('notification_uncertain'));assert.ok(!issues.includes('missed_scans'));
});
test('health upload permits only bounded metadata, never school payloads or arbitrary errors',()=>{
  assert.doesNotThrow(()=>validateHealthReport(report()));
  for(const patch of [{password:'private'},{activities:[]},{lastError:'ticket=secret'},{pending:-1},{unknown:1.5},{lastSuccessfulScan:iso('23:00')}])assert.throws(()=>validateHealthReport({...report(),...patch}),/INVALID_HEALTH_REPORT/);
});
