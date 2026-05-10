import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateProjectConfig } from '../src/infrastructure/configMigrator.js';

test('auto-migrates when schema version differs only by minor/patch within same major', () => {
  const input = { projectId: 'alpha', schemaVersion: '1.0.5' };

  const result = migrateProjectConfig(input, '1.1.0');

  assert.equal(result.readOnly, false);
  assert.equal(result.migrated, true);
  assert.equal(result.reason, 'minor_auto_migrated');
  assert.equal(result.config.schemaVersion, '1.1.0');
  assert.equal(result.config.projectId, 'alpha');
});

test('returns read-only when schema major version mismatches', () => {
  const input = { projectId: 'beta', schemaVersion: '1.2.0' };

  const result = migrateProjectConfig(input, '2.0.0');

  assert.equal(result.readOnly, true);
  assert.equal(result.migrated, false);
  assert.equal(result.reason, 'major_mismatch');
  assert.equal(result.config.schemaVersion, '1.2.0');
});
