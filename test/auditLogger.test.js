import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendAuditLog } from '../src/infrastructure/auditLogger.js';

test('appends JSON Lines audit log and masks sensitive keys recursively', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-log-'));
  const logPath = join(root, '.kousu', 'logs', 'audit.log');

  await appendAuditLog({
    logPath,
    entry: {
      actor: 'user',
      action: 'update_effort',
      target: 'project:p-001',
      before: { actual: 40, token: 'secret-before' },
      after: {
        actual: 45,
        authorization: 'Bearer very-secret',
        nested: { TOKEN: 'nested-secret' },
      },
      result: 'success',
    },
  });

  const lines = (await readFile(logPath, 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1);

  const row = JSON.parse(lines[0]);
  assert.equal(row.actor, 'user');
  assert.equal(typeof row.timestamp, 'string');
  assert.equal(row.before.token, '***');
  assert.equal(row.after.authorization, '***');
  assert.equal(row.after.nested.TOKEN, '***');
});

test('truncates payload larger than 200KB and marks truncated=true', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-log-'));
  const logPath = join(root, '.kousu', 'logs', 'audit.log');
  const oversized = 'x'.repeat(205 * 1024);

  await appendAuditLog({
    logPath,
    entry: {
      actor: 'user',
      action: 'save_config',
      payload: oversized,
      result: 'success',
    },
  });

  const lines = (await readFile(logPath, 'utf8')).trim().split('\n');
  const row = JSON.parse(lines[0]);

  assert.equal(row.truncated, true);
  assert.ok(typeof row.payload === 'string');
  assert.ok(row.payload.length < oversized.length);
});
