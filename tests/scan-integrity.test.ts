import {test} from 'node:test';
import assert from 'node:assert/strict';
import {commitScan,emptyState} from '../src/monitor.ts';
import {requireSafeScanTransition} from '../src/scan-integrity.ts';
import type {Scan} from '../src/school-client.ts';
const scan=(count:number):Scan=>({complete:true,scannedAt:new Date().toISOString(),activities:Array(count).fill({id:'1',availability:'ended',qualification:{state:'eligible'},fields:{}}),coverage:{Activity:count,Project:0,Course:0},profile:{},authMode:'fresh',durationMs:1});
test('unexpected empty scans preserve baseline and outbox and cannot produce an empty digest',()=>{
  const before=commitScan(emptyState(),scan(1)),saved=structuredClone(before);
  assert.throws(()=>commitScan(before,scan(0)),/UNEXPECTED_EMPTY_SCAN_NOT_COMMITTED/);
  assert.deepEqual(before,saved);
  assert.doesNotThrow(()=>commitScan(emptyState(),scan(0)));
  assert.doesNotThrow(()=>requireSafeScanTransition(scan(1),scan(1)));
  assert.throws(()=>requireSafeScanTransition(undefined,scan(0),1),/UNEXPECTED_EMPTY_SCAN/);
});
