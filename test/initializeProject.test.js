import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeProject } from '../src/application/usecases/initializeProject.js';

test('initializeProject prioritizes selectedProjectId', async () => {
  const projects = [
    { config: { projectId: 'alpha' } },
    { config: { projectId: 'beta' } },
  ];

  const result = await initializeProject({
    projects,
    selectedProjectId: 'beta',
    settingsActiveProjectId: 'alpha',
    isInteractive: true,
    pickProject: async () => 'alpha',
  });

  assert.equal(result.project.config.projectId, 'beta');
  assert.equal(result.resolution, 'selected_project_id');
});

test('initializeProject uses quickPick when interactive and multiple remain', async () => {
  const projects = [
    { config: { projectId: 'alpha' } },
    { config: { projectId: 'beta' } },
  ];

  const result = await initializeProject({
    projects,
    isInteractive: true,
    pickProject: async (options) => {
      assert.deepEqual(options, ['alpha', 'beta']);
      return 'beta';
    },
  });

  assert.equal(result.project.config.projectId, 'beta');
  assert.equal(result.resolution, 'quick_pick');
});

test('initializeProject falls back to ascending projectId for non-interactive context', async () => {
  const projects = [
    { config: { projectId: 'zeta' } },
    { config: { projectId: 'alpha' } },
  ];

  const result = await initializeProject({
    projects,
    isInteractive: false,
  });

  assert.equal(result.project.config.projectId, 'alpha');
  assert.equal(result.resolution, 'non_interactive_fallback');
});
