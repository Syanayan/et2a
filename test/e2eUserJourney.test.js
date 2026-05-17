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
  const notifications = { info: [], warning: [], error: [] };
  const inputs = [];
  return {
    providers,
    commands,
    postedMessages,
    notifications,
    inputs,
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
        showInformationMessage: async (message) => {
          notifications.info.push(message);
          return undefined;
        },
        showWarningMessage: async (message) => {
          notifications.warning.push(message);
          return undefined;
        },
        showErrorMessage: async (message) => {
          notifications.error.push(message);
          return undefined;
        },
        showInputBox: async () => inputs.shift(),
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

test('E2E: TASK-27主要フロー(初期化/表示/実績更新/祝日同期/停止)が連続実行できる', async () => {
  const fake = createFakeVscode();
  const savedConfigs = [];
  const extension = activate({
    vscode: fake.api,
    saveProjectConfig: async (config) => {
      savedConfigs.push(config);
    },
    holidayLoaders: {
      api: async () => ['2026-05-26'],
    },
  });

  fake.inputs.push('100', '2026-06-30', '20', 'Task 27 Project');
  await fake.commands.get('kousu.initializeProject')();
  assert.equal(savedConfigs.length, 1);
  assert.equal(savedConfigs[0].projectId, 'task-27-project');
  savedConfigs[0].calendar.holidaySources = [{ kind: 'company', type: 'api', endpoint: 'https://example.com/holidays' }];

  await fake.commands.get('kousu.openDashboard')();
  assert.ok(fake.postedMessages.some((message) => message.type === 'dashboard:init'));

  extension.setProjects(
    [{ config: savedConfigs[0] }],
    { config: savedConfigs[0] },
    {
      elapsedWorkingDays: 5,
      totalWorkingDays: 20,
      remainingWorkingDays: ['2026-05-26', '2026-05-27'],
      today: '2026-05-25',
    }
  );
  fake.inputs.push('30');
  await fake.commands.get('kousu.updateActual')();
  const dashboardUpdate = fake.postedMessages.findLast((message) => message.type === 'dashboard:update');
  assert.equal(dashboardUpdate.payload.project.config.effort.actual, 30);

  await fake.commands.get('kousu.syncHolidays')();
  assert.ok(fake.notifications.info.includes('Holiday sync completed'));
  assert.ok(savedConfigs.length >= 3);
  assert.ok(Array.isArray(savedConfigs.at(-1).calendar.holidays));

  assert.doesNotThrow(() => extension.close());
});
