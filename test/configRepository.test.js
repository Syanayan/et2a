import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { loadProjectConfigs } from '../src/infrastructure/configRepository.js';

async function withTempDir(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kousu-config-repo-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('prefers .local.json over .json over kousu.config.json', async () => {
  await withTempDir(async (rootDir) => {
    const projectsDir = path.join(rootDir, 'kousu.projects');
    await mkdir(projectsDir, { recursive: true });

    await writeFile(path.join(rootDir, 'kousu.config.json'), JSON.stringify({ projectId: 'alpha', source: 'root' }));
    await writeFile(path.join(projectsDir, 'alpha.json'), JSON.stringify({ projectId: 'alpha', source: 'json' }));
    await writeFile(path.join(projectsDir, 'alpha.local.json'), JSON.stringify({ projectId: 'alpha', source: 'local' }));

    const result = await loadProjectConfigs(rootDir);

    assert.equal(result.projects.length, 1);
    assert.equal(result.projects[0].config.source, 'local');
    assert.equal(result.conflicts.length, 1);
    assert.deepEqual(result.conflicts[0].ignoredFiles.map((value) => path.basename(value)).sort(), ['alpha.json', 'kousu.config.json']);
  });
});

test('creates conflict records for same projectId duplicates', async () => {
  await withTempDir(async (rootDir) => {
    const projectsDir = path.join(rootDir, 'kousu.projects');
    await mkdir(projectsDir, { recursive: true });

    await writeFile(path.join(projectsDir, 'a-winner.local.json'), JSON.stringify({ projectId: 'beta', marker: 'winner' }));
    await writeFile(path.join(projectsDir, 'z-loser.local.json'), JSON.stringify({ projectId: 'beta', marker: 'loser' }));

    const result = await loadProjectConfigs(rootDir);

    assert.equal(result.projects.length, 1);
    assert.equal(result.projects[0].config.marker, 'winner');
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].projectId, 'beta');
    assert.equal(result.conflicts[0].ignoredFiles.length, 1);
  });
});

test('moves broken file and restores from backup file when primary is invalid JSON', async () => {
  await withTempDir(async (rootDir) => {
    const projectsDir = path.join(rootDir, 'kousu.projects');
    await mkdir(projectsDir, { recursive: true });

    const primaryPath = path.join(projectsDir, 'gamma.local.json');
    const backupPath = path.join(projectsDir, 'gamma.local.json.bak');
    await writeFile(primaryPath, '{"projectId":"gamma"');
    await writeFile(backupPath, JSON.stringify({ projectId: 'gamma', source: 'backup' }));

    const result = await loadProjectConfigs(rootDir);

    assert.equal(result.projects.length, 1);
    assert.equal(result.projects[0].config.source, 'backup');

    const files = await readdir(projectsDir);
    assert.ok(files.some((name) => /^gamma\.local\.json\.broken\./.test(name)));
    assert.ok(files.includes('gamma.local.json'));
  });
});
