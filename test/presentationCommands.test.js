import test from 'node:test';
import assert from 'node:assert/strict';
import { activate } from '../src/extension.js';

function createFakeVscode() {
  const commands = [];
  const treeViews = [];
  const providers = new Map();
  const webviewPanels = [];
  const notifications = [];

  return {
    commands,
    treeViews,
    providers,
    webviewPanels,
    notifications,
    api: {
      commands: {
        registerCommand(commandId, handler) {
          commands.push({ commandId, handler });
          return { dispose() {} };
        }
      },
      window: {
        showInputBox: async () => undefined,
        showInformationMessage(message) {
          notifications.push({ level: 'info', message });
          return Promise.resolve(undefined);
        },
        showWarningMessage(message) {
          notifications.push({ level: 'warn', message });
          return Promise.resolve(undefined);
        },
        showErrorMessage(message) {
          notifications.push({ level: 'error', message });
          return Promise.resolve(undefined);
        },
        createTreeView(viewId, options) {
          treeViews.push({ viewId, options });
          if (options?.treeDataProvider) {
            providers.set(viewId, options.treeDataProvider);
          }
          return { dispose() {} };
        },
        createWebviewPanel(viewType, title, showOptions, options) {
          const postedMessages = [];
          const handlers = [];
          const panel = {
            viewType,
            title,
            showOptions,
            options,
            webview: {
              html: '',
              postMessage(message) {
                postedMessages.push(message);
                return Promise.resolve(true);
              },
              onDidReceiveMessage(handler) {
                handlers.push(handler);
                return { dispose() {} };
              }
            },
            postedMessages,
            handlers
          };
          webviewPanels.push(panel);
          return panel;
        }
      }
    }
  };
}

test('registers required commands and sidebar TreeView nodes', async () => {
  const fake = createFakeVscode();
  const state = {
    projectName: 'Alpha',
    progressPercent: 42,
    remainingPersonDays: 5.5,
    alertLabel: '注意'
  };

  const result = activate({ vscode: fake.api, initialViewState: state });

  assert.equal(result.status, 'activated');
  assert.deepEqual(
    fake.commands.map((x) => x.commandId).sort(),
    [
      'kousu.initializeProject',
      'kousu.openDashboard',
      'kousu.selectProject',
      'kousu.syncHolidays',
      'kousu.updateActual'
    ]
  );

  assert.equal(fake.treeViews.length, 1);
  assert.equal(fake.treeViews[0].viewId, 'kousu.sidebar');

  const provider = fake.providers.get('kousu.sidebar');
  const items = await provider.getChildren();
  assert.deepEqual(
    items.map((x) => x.label),
    [
      'Project: Alpha',
      'Progress: 42%',
      'Remaining: 5.5 person_day',
      'Alert: 注意'
    ]
  );
});

test('initializeProject command collects inputs, saves config, and opens dashboard', async () => {
  const fake = createFakeVscode();
  const answers = ['64', '2026-12-31', '8', 'New Project'];
  fake.api.window.showInputBox = async () => answers.shift();
  const saved = [];
  let validated = 0;

  activate({
    vscode: fake.api,
    saveProjectConfig: async (config) => { saved.push(config); },
    validateProjectConfig: (config) => {
      validated += 1;
      return { ok: true, error: null };
    },
  });

  const initialize = fake.commands.find((x) => x.commandId === 'kousu.initializeProject');
  assert.ok(initialize);
  await initialize.handler();

  assert.equal(saved.length, 1);
  assert.equal(saved[0].projectId, 'new-project');
  assert.equal(saved[0].effort.total, 64);
  assert.equal(saved[0].effort.buffer, 8);
  assert.equal(validated, 1);
  assert.equal(fake.webviewPanels.length, 1);
  assert.equal(fake.webviewPanels[0].postedMessages[0].type, 'dashboard:init');
});

test('initializeProject command does not save when validateProjectConfig fails', async () => {
  const fake = createFakeVscode();
  const answers = ['64', 'invalid-date', '8', 'New Project'];
  fake.api.window.showInputBox = async () => answers.shift();
  const saved = [];

  activate({
    vscode: fake.api,
    saveProjectConfig: async (config) => { saved.push(config); },
    validateProjectConfig: () => ({
      ok: false,
      error: { code: 'validation_error', field: 'schedule.endDate', message: 'schedule.endDate must be YYYY-MM-DD' },
    }),
  });

  const initialize = fake.commands.find((x) => x.commandId === 'kousu.initializeProject');
  await initialize.handler();

  assert.equal(saved.length, 0);
  assert.deepEqual(fake.notifications[0], { level: 'error', message: 'schedule.endDate must be YYYY-MM-DD' });
});

test('openDashboard posts init and update/error messages to Webview', async () => {
  const fake = createFakeVscode();
  const state = {
    kpi: { actual: 8, remainingEffort: 4, predictedTotalEffort: 12 },
    burndown: [{ date: '2026-05-10', actual: 8 }],
    alert: { level: 'warn', label: '注意' },
    syncStatus: { status: 'ok' }
  };

  const activated = activate({ vscode: fake.api, initialDashboardState: state });
  const openDashboard = fake.commands.find((x) => x.commandId === 'kousu.openDashboard');

  assert.ok(openDashboard);
  openDashboard.handler();

  assert.equal(fake.webviewPanels.length, 1);
  const panel = fake.webviewPanels[0];
  assert.match(panel.webview.html, /id="kpi-total"/);
  assert.match(panel.webview.html, /id="burndown-chart"/);
  assert.match(panel.webview.html, /id="sync-status"/);
  assert.match(panel.webview.html, /function drawBurndown/);
  assert.match(panel.webview.html, /createElementNS\('http:\/\/www\.w3\.org\/2000\/svg', 'polyline'\)/);
  assert.match(panel.webview.html, /typeof acquireVsCodeApi === 'function'/);
  assert.match(panel.webview.html, /type === 'dashboard:update'/);
  assert.match(panel.webview.html, /type === 'dashboard:error'/);
  assert.equal(panel.postedMessages.length, 1);
  assert.deepEqual(panel.postedMessages[0], { type: 'dashboard:init', payload: state });

  await activated.updateDashboard(state);
  assert.deepEqual(panel.postedMessages[1], { type: 'dashboard:update', payload: state });

  await activated.notifyDashboardError('sync failed');
  assert.deepEqual(panel.postedMessages[2], {
    type: 'dashboard:error',
    payload: { message: 'sync failed' }
  });
});

test('routes notifications by level and debounces duplicates within 30 seconds', async () => {
  const fake = createFakeVscode();
  let now = 1_000;
  const activated = activate({
    vscode: fake.api,
    now: () => now
  });

  await activated.notify({ level: 'info', message: '同期完了' });
  await activated.notify({ level: 'warn', message: '同期失敗' });
  await activated.notify({ level: 'error', message: '保存エラー' });
  await activated.notify({ level: 'warn', message: '同期失敗' });

  assert.deepEqual(fake.notifications, [
    { level: 'info', message: '同期完了' },
    { level: 'warn', message: '同期失敗' },
    { level: 'error', message: '保存エラー' }
  ]);

  now += 30_001;
  await activated.notify({ level: 'warn', message: '同期失敗' });

  assert.deepEqual(fake.notifications[3], { level: 'warn', message: '同期失敗' });
});
