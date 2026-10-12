import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptPassword, safeEndpoint, isSchoolHost, classifyLogin, jsonShape } from '../src/auth-protocol.ts';
import { writeSecret, readSecret } from '../src/secrets.ts';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('RSA protocol chunks, randomness and empty-password rejection', () => {
  const password = 'a'.repeat(60);
  const encoded = encryptPassword(password);
  const chunks = JSON.parse(decodeURIComponent(encoded));
  assert.equal(chunks.length, 3);
  for (const chunk of chunks) assert.equal(Buffer.from(decodeURI(chunk), 'base64').length, 128);
  assert.notEqual(encoded, encryptPassword(password));
  assert.throws(() => encryptPassword(' '), /EMPTY_PASSWORD/);
});
test('reports strip URL secrets and JSON values', () => {
  assert.equal(safeEndpoint('https://2class.cqut.edu.cn/a?ticket=secret#secret'), 'https://2class.cqut.edu.cn/a');
  const shape = JSON.stringify(jsonShape({name:'private-person', pwd:'secret', ticket:'secret'}));
  assert.ok(!shape.includes('private-person') && !shape.includes('secret'));
});
test('host allowlist rejects misleading hosts and plaintext HTTP', () => {
  assert.equal(isSchoolHost('https://uis.cqut.edu.cn/'), true);
  assert.equal(isSchoolHost('https://cqut.edu.cn.evil.example/'), false);
  assert.equal(isSchoolHost('http://uis.cqut.edu.cn/'), false);
});
test('manual auth conditions do not masquerade as login success', () => {
  assert.equal(classifyLogin(16300), 'manual_second_factor_required');
  assert.equal(classifyLogin(601), 'manual_identity_selection_required');
  assert.equal(classifyLogin(200), 'accepted');
  assert.equal(classifyLogin('200'), 'rejected');
});
test('DPAPI round trip stores no plaintext', {skip:process.platform !== 'win32'}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cqut-test-'));
  try {
    const path=join(directory, 'test.dpapi');
    await writeSecret(path,{password:'fake-test-password',account:'fake-test-account'});
    assert.ok(!(await readFile(path,'utf8')).includes('fake-test-password'));
    assert.deepEqual(await readSecret(path),{password:'fake-test-password',account:'fake-test-account'});
  } finally { await rm(directory,{recursive:true,force:true}); }
});
