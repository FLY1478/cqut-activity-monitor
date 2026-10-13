import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {parseSandboxStatus} from './sandbox-status.mjs';
test('accept enabled namespace and seccomp layers without requiring obsolete SUID layer',()=>{
  assert.equal(parseSandboxStatus('SUID sandbox No\nPID namespaces Yes\nNetwork namespaces Yes\nSeccomp-BPF sandbox Yes\nSeccomp-BPF sandbox supports TSYNC Yes').verified,true);
});
test('reject absent, unknown and explicitly disabled protection',()=>{
  for(const text of ['', 'PID namespaces Yes\nNetwork namespaces Yes', 'PID namespaces Yes\nNetwork namespaces Yes\nSeccomp-BPF sandbox No\nSeccomp-BPF sandbox supports TSYNC Yes', 'PID namespaces No\nNetwork namespaces Yes\nSeccomp-BPF sandbox Yes'])assert.equal(parseSandboxStatus(text).verified,false);
});
