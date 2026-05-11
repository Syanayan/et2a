import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { initializeProject } from '../src/application/usecases/initializeProject.js';
import { updateActualEffort } from '../src/application/usecases/updateActualEffort.js';
import { activate } from '../src/extension.js';
import { loadProjectConfigs } from '../src/infrastructure/configRepository.js';

function createFakeVscode() {
  const providers = new Map();
  const commands = new Map();
  const postedMessages = [];
  return {
    providers,
    commands,
    postedMessages,
    api: {
      commands: {
        registerCommand(commandId, handler) {
          commands.set(commandId, handler);
          return { dispose() {} };
        }
      },
      window: {
        createTreeView(viewId, options) {
          providers.set(viewId, options.treeDataProvider);
          return { dispose() {} };
        },
        createWebviewPanel() {
          return {
            webview: {
              html: '',
              postMessage(message) {
                postedMessages.push(message);
                return Promise.resolve(true);
              },
              onDidReceiveMessage() {
                return { dispose() {} };
              }
            }
          };
        },
        showInformationMessage: async () => undefined,
        showWarningMessage: async () => undefined,
        showErrorMessage: async () => undefined,
      }
    }
  };
}

test('E2E: 初期化フローでプロジェクトが決定される', async () => {
  const projects = [
    { config: { projectId: 'zeta' } },
    { config: { projectId: 'alpha' } }
  ];

  const result = await initializeProject({
    projects,
    isInteractive: true,
    pickProject: async (options) => {
      assert.deepEqual(options, ['alpha', 'zeta']);
      return 'zeta';
    }
  });

  assert.equal(result.project.config.projectId, 'zeta');
  assert.equal(result.resolution, 'quick_pick');
});

test('E2E: 実績入力時にKPIが即時更新される', async () => {
  const project = {
    config: {
      projectId: 'alpha',
      schedule: { startDate: '2026-05-01', endDate: '2026-05-31' },
      effort: { total: 100, buffer: 20, actual: 40, budgetMode: 'inclusive' },
      members: [{ name: 'Alice', dailyEffort: 1 }]
    }
  };

  const fake = createFakeVscode();
  const extension = activate({ vscode: fake.api });
  fake.commands.get('kousu.openDashboard')();

  const updated = await updateActualEffort({
    project,
    nextActual: 55,
    elapsedWorkingDays: 11,
    totalWorkingDays: 20,
    today: '2026-05-20',
    remainingWorkingDays: ['2026-05-21', '2026-05-22'],
    saveProjectConfig: async () => {},
  });

  await extension.updateDashboard({
    kpi: {
      actual: updated.project.config.effort.actual,
      remainingEffort: updated.forecast.remainingEffort,
      predictedTotalEffort: updated.forecast.predictedTotalEffort,
    },
    alert: { level: updated.alert.level, label: updated.alert.level },
  });

  const last = fake.postedMessages.at(-1);
  assert.equal(last.type, 'dashboard:update');
  assert.equal(last.payload.kpi.actual, 55);
  assert.equal(typeof last.payload.kpi.predictedTotalEffort, 'number');
});

test('E2E: 競合設定検知時に詳細表示用データを取得できる', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'kousu-e2e-'));
  const projectsDir = path.join(rootDir, 'kousu.projects');
  await mkdir(projectsDir, { recursive: true });

  await writeFile(path.join(projectsDir, 'alpha.local.json'), JSON.stringify({
    projectId: 'alpha',
    schedule: { startDate: '2026-05-01', endDate: '2026-05-31' },
    effort: { total: 100, buffer: 10, actual: 10, budgetMode: 'inclusive' },
    members: [{ name: 'Alice', dailyEffort: 1 }]
  }));

  await writeFile(path.join(projectsDir, 'alpha.json'), JSON.stringify({
    projectId: 'alpha',
    schedule: { startDate: '2026-05-01', endDate: '2026-05-31' },
    effort: { total: 100, buffer: 10, actual: 20, budgetMode: 'inclusive' },
    members: [{ name: 'Alice', dailyEffort: 1 }]
  }));

  const loaded = await loadProjectConfigs(rootDir);

  assert.equal(loaded.conflicts.length, 1);
  assert.equal(loaded.conflicts[0].projectId, 'alpha');
  assert.ok(loaded.conflicts[0].selectedFile.endsWith('alpha.local.json'));
  assert.ok(loaded.conflicts[0].ignoredFiles.some((file) => file.endsWith('alpha.json')));
});
