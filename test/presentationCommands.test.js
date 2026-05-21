import test from 'node:test';
import assert from 'node:assert/strict';
import { activate } from '../src/extension.js';

function createFakeVscode() {
  const commands = [];
  const treeViews = [];
  const providers = new Map();
  const webviewPanels = [];
  const notifications = [];
  let disposedCount = 0;

  return {
    commands,
    treeViews,
    providers,
    webviewPanels,
    notifications,
    get disposedCount() { return disposedCount; },
    api: {
      commands: {
        registerCommand(commandId, handler) {
          commands.push({ commandId, handler });
          return { dispose() { disposedCount += 1; } };
        }
      },
      window: {
        showInputBox: async () => undefined,
        showOpenDialog: async () => undefined,
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
          return { dispose() { disposedCount += 1; } };
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
            handlers,
            disposed: false,
            dispose() { this.disposed = true; disposedCount += 1; }
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
  const initialViewState = {
    projects: [{ projectId: 'Alpha', progressPercent: 42, alertLabel: '注意' }],
    activeProjectId: 'Alpha',
  };

  const result = activate({ vscode: fake.api, initialViewState });

  assert.equal(result.status, 'activated');
  assert.deepEqual(
    fake.commands.map((x) => x.commandId).sort(),
    [
      'kousu.initializeProject',
      'kousu.newProject',
      'kousu.openDashboard',
      'kousu.selectProject',
      'kousu.selectProjectById',
      'kousu.setTimesheetSource',
      'kousu.syncHolidays',
      'kousu.syncTimesheet',
      'kousu.updateActual'
    ]
  );

  assert.equal(fake.treeViews.length, 1);
  assert.equal(fake.treeViews[0].viewId, 'kousu.sidebar');

  const provider = fake.providers.get('kousu.sidebar');
  const items = await provider.getChildren();
  assert.equal(items.length, 1);
  assert.ok(items[0].label.includes('▶'));
  assert.ok(items[0].label.includes('Alpha'));
  assert.equal(items[0].command.command, 'kousu.selectProjectById');
  assert.deepEqual(items[0].command.arguments, ['Alpha']);
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
  const answers = ['64', '2026-12-31', '8', 'New Project'];
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

test('initializeProject shows immediate error for invalid deadline format', async () => {
  const fake = createFakeVscode();
  const answers = ['64', 'invalid-date', 'SHOULD_NOT_BE_USED'];
  let promptCount = 0;
  let validated = 0;
  fake.api.window.showInputBox = async () => {
    promptCount += 1;
    return answers.shift();
  };
  const saved = [];

  activate({
    vscode: fake.api,
    saveProjectConfig: async (config) => { saved.push(config); },
    validateProjectConfig: () => {
      validated += 1;
      return { ok: true, error: null };
    },
  });

  const initialize = fake.commands.find((x) => x.commandId === 'kousu.initializeProject');
  await initialize.handler();

  assert.equal(promptCount, 2);
  assert.equal(validated, 0);
  assert.equal(saved.length, 0);
  assert.deepEqual(fake.notifications[0], { level: 'error', message: 'Deadline must be in YYYY-MM-DD format.' });
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

test('syncHolidays shows warning when holidaySources is empty', async () => {
  const fake = createFakeVscode();
  const saved = [];
  const extension = activate({
    vscode: fake.api,
    saveProjectConfig: async (config) => { saved.push(config); },
  });

  const config = {
    schemaVersion: '1.0.0',
    projectId: 'alpha',
    schedule: { startDate: '2026-01-01', endDate: '2026-01-31' },
    effort: { total: 10, buffer: 1, actual: 0, budgetMode: 'inclusive' },
    members: [],
    calendar: { holidays: [], holidaySources: [] },
  };
  extension.setProjects([{ config }], { config }, { today: '2026-01-10' });

  await fake.commands.find((x) => x.commandId === 'kousu.syncHolidays').handler();

  assert.deepEqual(fake.notifications.at(-1), { level: 'warn', message: 'Holiday sync sources are not configured.' });
  assert.equal(saved.length, 0);
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

test('setProjects updates workingDayContext used by updateActual', async () => {
  const fake = createFakeVscode();
  const answers = ['4'];
  fake.api.window.showInputBox = async () => answers.shift();

  const project = {
    config: {
      projectId: 'alpha',
      schedule: { startDate: '2026-05-01', endDate: '2099-12-31' },
      effort: { total: 10, buffer: 0, actual: 0, budgetMode: 'inclusive' },
      members: [],
      calendar: { holidays: [], holidaySources: [] },
    },
  };

  const activated = activate({
    vscode: fake.api,
    saveProjectConfig: async () => {},
    workingDayContext: { today: '2026-05-10', elapsedWorkingDays: 0, totalWorkingDays: 0, remainingWorkingDays: [] },
  });
  activated.setProjects([project], project, {
    today: '2026-05-10',
    elapsedWorkingDays: 2,
    totalWorkingDays: 8,
    remainingWorkingDays: ['2026-05-11', '2026-05-12', '2026-05-13'],
  });

  const updateActual = fake.commands.find((x) => x.commandId === 'kousu.updateActual');
  await updateActual.handler();

  const openDashboard = fake.commands.find((x) => x.commandId === 'kousu.openDashboard');
  openDashboard.handler();
  const panel = fake.webviewPanels[0];
  const updateMessage = panel.postedMessages.find((m) => m.type === 'dashboard:update' && m.payload?.forecast);
  assert.equal(updateMessage.payload.forecast.status, 'ok');
  assert.equal(updateMessage.payload.forecast.predictedTotalEffort, 16);
});




test('setProjects seeds dashboard state with initial active project', async () => {
  const fake = createFakeVscode();
  const project = {
    config: {
      projectId: 'alpha',
      schedule: { startDate: '2026-05-01', endDate: '2026-05-31' },
      effort: { total: 20, buffer: 2, actual: 5, budgetMode: 'inclusive' },
      members: [],
      calendar: { holidays: [], holidaySources: [] },
    },
  };

  const activated = activate({ vscode: fake.api });
  activated.setProjects([project], project);

  const openDashboard = fake.commands.find((x) => x.commandId === 'kousu.openDashboard');
  openDashboard.handler();

  const panel = fake.webviewPanels[0];
  assert.equal(panel.postedMessages[0].type, 'dashboard:init');
  assert.equal(panel.postedMessages[0].payload.project.config.projectId, 'alpha');
  assert.equal(panel.postedMessages[0].payload.project.config.effort.actual, 5);
});
test('TASK-30: dashboard HTML has header with title and report button', async () => {
  const fake = createFakeVscode();
  activate({ vscode: fake.api });
  fake.commands.find((x) => x.commandId === 'kousu.openDashboard').handler();
  const { html } = fake.webviewPanels[0].webview;
  assert.match(html, /プロジェクト全体サマリー/);
  assert.match(html, /id="btn-report"/);
  assert.match(html, /id="btn-settings"/);
});

test('TASK-30: dashboard HTML has 4 KPI cards with correct ids', async () => {
  const fake = createFakeVscode();
  activate({ vscode: fake.api });
  fake.commands.find((x) => x.commandId === 'kousu.openDashboard').handler();
  const { html } = fake.webviewPanels[0].webview;
  assert.match(html, /id="kpi-total"/);
  assert.match(html, /id="kpi-actual"/);
  assert.match(html, /id="kpi-predicted"/);
  assert.match(html, /id="kpi-remaining"/);
});

test('TASK-30: dashboard HTML has consumption rate and budget ratio elements', async () => {
  const fake = createFakeVscode();
  activate({ vscode: fake.api });
  fake.commands.find((x) => x.commandId === 'kousu.openDashboard').handler();
  const { html } = fake.webviewPanels[0].webview;
  assert.match(html, /id="kpi-actual-rate"/);
  assert.match(html, /id="kpi-predicted-rate"/);
});

test('TASK-30: dashboard render calculates consumption rate and budget ratio', async () => {
  const fake = createFakeVscode();
  const state = {
    project: {
      config: {
        effort: { total: 100, buffer: 10, actual: 25, budgetMode: 'inclusive' },
      },
    },
    forecast: { predictedTotalEffort: 80, remainingEffort: 75 },
  };
  activate({ vscode: fake.api, initialDashboardState: state });
  fake.commands.find((x) => x.commandId === 'kousu.openDashboard').handler();
  const panel = fake.webviewPanels[0];
  const initMsg = panel.postedMessages.find((m) => m.type === 'dashboard:init');
  assert.equal(initMsg.payload.project.config.effort.actual, 25);
  assert.equal(initMsg.payload.project.config.effort.total, 100);
  assert.equal(initMsg.payload.forecast.predictedTotalEffort, 80);
});

test('TASK-31: dashboard HTML has weekly chart SVG element', async () => {
  const fake = createFakeVscode();
  activate({ vscode: fake.api });
  fake.commands.find((x) => x.commandId === 'kousu.openDashboard').handler();
  const { html } = fake.webviewPanels[0].webview;
  assert.match(html, /id="weekly-chart"/);
  assert.match(html, /id="weekly-section"/);
});

test('TASK-31: dashboard weekly section is hidden when weeklyEffort is absent', async () => {
  const fake = createFakeVscode();
  activate({ vscode: fake.api });
  fake.commands.find((x) => x.commandId === 'kousu.openDashboard').handler();
  const { html } = fake.webviewPanels[0].webview;
  assert.match(html, /id="weekly-section"[^>]*style="display:none"/);
});

test('TASK-31: dashboard passes weeklyEffort in dashboard:init payload', async () => {
  const fake = createFakeVscode();
  const weeklyEffort = [
    { day: '月', planned: 8, actual: 8 },
    { day: '火', planned: 8, actual: 9 },
    { day: '水', planned: 8, actual: 7 },
    { day: '木', planned: 8, actual: 10 },
    { day: '金', planned: 8, actual: 5 },
  ];
  activate({ vscode: fake.api, initialDashboardState: { weeklyEffort } });
  fake.commands.find((x) => x.commandId === 'kousu.openDashboard').handler();
  const panel = fake.webviewPanels[0];
  const initMsg = panel.postedMessages.find((m) => m.type === 'dashboard:init');
  assert.deepEqual(initMsg.payload.weeklyEffort, weeklyEffort);
});

test('TASK-32: burndown actual polyline uses yellow-green stroke', async () => {
  const fake = createFakeVscode();
  activate({ vscode: fake.api });
  fake.commands.find((x) => x.commandId === 'kousu.openDashboard').handler();
  const { html } = fake.webviewPanels[0].webview;
  assert.match(html, /'#c8e06b'/);
});

test('TASK-32: burndown predicted polyline uses grey stroke', async () => {
  const fake = createFakeVscode();
  activate({ vscode: fake.api });
  fake.commands.find((x) => x.commandId === 'kousu.openDashboard').handler();
  const { html } = fake.webviewPanels[0].webview;
  assert.match(html, /'#888'/);
});

test('TASK-32: burndown chart draws circle markers for actual data points', async () => {
  const fake = createFakeVscode();
  activate({ vscode: fake.api });
  fake.commands.find((x) => x.commandId === 'kousu.openDashboard').handler();
  const { html } = fake.webviewPanels[0].webview;
  assert.match(html, /createElementNS\('http:\/\/www\.w3\.org\/2000\/svg', 'circle'\)/);
});

test('TASK-32: burndown chart draws grid lines and axis labels', async () => {
  const fake = createFakeVscode();
  activate({ vscode: fake.api });
  fake.commands.find((x) => x.commandId === 'kousu.openDashboard').handler();
  const { html } = fake.webviewPanels[0].webview;
  assert.match(html, /setAttribute\('class', 'grid'\)/);
  assert.match(html, /setAttribute\('class', 'x-label'\)/);
});

test('TASK-35: sidebar shows all projects with active marker after setProjects', async () => {
  const fake = createFakeVscode();
  const projectAlpha = {
    config: {
      projectId: 'alpha', schemaVersion: '1.0.0',
      schedule: { startDate: '2026-05-01', endDate: '2026-06-30' },
      effort: { total: 100, buffer: 10, actual: 40, budgetMode: 'inclusive' },
      members: [], calendar: { holidays: [], holidaySources: [] },
    },
  };
  const projectBeta = {
    config: {
      projectId: 'beta', schemaVersion: '1.0.0',
      schedule: { startDate: '2026-05-01', endDate: '2026-06-30' },
      effort: { total: 50, buffer: 5, actual: 5, budgetMode: 'inclusive' },
      members: [], calendar: { holidays: [], holidaySources: [] },
    },
  };

  const activated = activate({ vscode: fake.api });
  activated.setProjects([projectAlpha, projectBeta], projectAlpha);

  const provider = fake.providers.get('kousu.sidebar');
  const items = await provider.getChildren();

  assert.equal(items.length, 2);
  assert.ok(items[0].label.includes('▶'), 'alpha should be marked active');
  assert.ok(items[0].label.includes('alpha'));
  assert.ok(!items[1].label.includes('▶'), 'beta should not be marked active');
  assert.ok(items[1].label.includes('beta'));
});

test('TASK-35: selectProjectById switches active project in sidebar and dashboard', async () => {
  const fake = createFakeVscode();
  const projectAlpha = {
    config: {
      projectId: 'alpha', schemaVersion: '1.0.0',
      schedule: { startDate: '2026-05-01', endDate: '2026-06-30' },
      effort: { total: 100, buffer: 10, actual: 40, budgetMode: 'inclusive' },
      members: [], calendar: { holidays: [], holidaySources: [] },
    },
  };
  const projectBeta = {
    config: {
      projectId: 'beta', schemaVersion: '1.0.0',
      schedule: { startDate: '2026-05-01', endDate: '2026-06-30' },
      effort: { total: 50, buffer: 5, actual: 5, budgetMode: 'inclusive' },
      members: [], calendar: { holidays: [], holidaySources: [] },
    },
  };

  const activated = activate({ vscode: fake.api });
  activated.setProjects([projectAlpha, projectBeta], projectAlpha);

  fake.commands.find((x) => x.commandId === 'kousu.openDashboard').handler();
  await fake.commands.find((x) => x.commandId === 'kousu.selectProjectById').handler('beta');

  const panel = fake.webviewPanels[0];
  const updateMsg = panel.postedMessages.find(
    (m) => m.type === 'dashboard:update' && m.payload?.project?.config?.projectId === 'beta'
  );
  assert.ok(updateMsg, 'dashboard:update with beta project expected');

  const provider = fake.providers.get('kousu.sidebar');
  const items = await provider.getChildren();
  assert.ok(!items[0].label.includes('▶'), 'alpha should no longer be active');
  assert.ok(items[1].label.includes('▶'), 'beta should now be active');
});

test('TASK-34: dashboard HTML has monthly table section with correct id', async () => {
  const fake = createFakeVscode();
  activate({ vscode: fake.api });
  fake.commands.find((x) => x.commandId === 'kousu.openDashboard').handler();
  const { html } = fake.webviewPanels[0].webview;
  assert.match(html, /id="monthly-table"/);
});

test('TASK-34: monthly table is hidden by default', async () => {
  const fake = createFakeVscode();
  activate({ vscode: fake.api });
  fake.commands.find((x) => x.commandId === 'kousu.openDashboard').handler();
  const { html } = fake.webviewPanels[0].webview;
  assert.match(html, /id="monthly-table"[^>]*style="display:none"/);
});

test('TASK-34: syncTimesheet passes monthlyBreakdown to dashboard update', async () => {
  const fake = createFakeVscode();
  const csvContent = 'Alice,2026-04,40.0\nBob,2026-04,32.0\n';
  const project = {
    config: {
      projectId: 'alpha',
      schemaVersion: '1.0.0',
      schedule: { startDate: '2026-04-01', endDate: '2026-05-31' },
      effort: { total: 100, buffer: 10, actual: 0, budgetMode: 'inclusive' },
      members: [],
      calendar: { holidays: [], holidaySources: [] },
      timesheetSource: { type: 'csv', path: 'timesheet.csv' },
    },
  };
  const activated = activate({
    vscode: fake.api,
    readFile: async () => csvContent,
    saveProjectConfig: async () => {},
  });
  activated.setProjects([project], project);

  fake.commands.find((x) => x.commandId === 'kousu.openDashboard').handler();
  await fake.commands.find((x) => x.commandId === 'kousu.syncTimesheet').handler();

  const panel = fake.webviewPanels[0];
  const updateMsg = panel.postedMessages.find((m) => m.type === 'dashboard:update' && m.payload?.monthlyBreakdown);
  assert.ok(updateMsg, 'expected a dashboard:update with monthlyBreakdown');
  assert.deepEqual(updateMsg.payload.monthlyBreakdown.members, ['Alice', 'Bob']);
});

test('newProject creates project config with correct fields', async () => {
  const fake = createFakeVscode();
  const answers = ['My Project', '80', '2026-12-31'];
  fake.api.window.showInputBox = async () => answers.shift();
  const created = [];

  activate({
    vscode: fake.api,
    createProjectConfig: async (config) => {
      created.push(config);
      return { projects: [{ config }], activeProject: { config } };
    },
  });

  await fake.commands.find((x) => x.commandId === 'kousu.newProject').handler();

  assert.equal(created.length, 1);
  assert.equal(created[0].projectId, 'my-project');
  assert.equal(created[0].effort.total, 80);
  assert.equal(created[0].schedule.endDate, '2026-12-31');
  assert.equal(created[0].schemaVersion, '1.0.0');
});

test('newProject shows error and does not create for invalid total effort', async () => {
  const fake = createFakeVscode();
  const answers = ['My Project', 'abc'];
  fake.api.window.showInputBox = async () => answers.shift();
  const created = [];

  activate({
    vscode: fake.api,
    createProjectConfig: async (config) => { created.push(config); return { projects: [], activeProject: null }; },
  });

  await fake.commands.find((x) => x.commandId === 'kousu.newProject').handler();

  assert.equal(created.length, 0);
  assert.ok(fake.notifications.some((n) => n.level === 'error'));
});

test('newProject updates sidebar after creation', async () => {
  const fake = createFakeVscode();
  const answers = ['Beta', '50', '2026-09-30'];
  fake.api.window.showInputBox = async () => answers.shift();
  const newConfig = {
    schemaVersion: '1.0.0', projectId: 'beta',
    schedule: { startDate: '2026-05-21', endDate: '2026-09-30' },
    effort: { total: 50, buffer: 0, actual: 0, budgetMode: 'inclusive' },
    members: [], calendar: { holidays: [], holidaySources: [] },
  };

  activate({
    vscode: fake.api,
    createProjectConfig: async () => ({
      projects: [{ config: newConfig }],
      activeProject: { config: newConfig },
    }),
  });

  await fake.commands.find((x) => x.commandId === 'kousu.newProject').handler();

  const provider = fake.providers.get('kousu.sidebar');
  const items = await provider.getChildren();
  assert.ok(items.some((i) => i.label.includes('beta')));
});

test('setTimesheetSource saves timesheetSource path to active project', async () => {
  const fake = createFakeVscode();
  fake.api.window.showOpenDialog = async () => [{ fsPath: '/data/timesheet.csv' }];
  const saved = [];
  const project = {
    config: {
      projectId: 'alpha', schemaVersion: '1.0.0',
      schedule: { startDate: '2026-05-01', endDate: '2026-06-30' },
      effort: { total: 100, buffer: 10, actual: 0, budgetMode: 'inclusive' },
      members: [], calendar: { holidays: [], holidaySources: [] },
    },
  };

  const activated = activate({
    vscode: fake.api,
    saveProjectConfig: async (config) => { saved.push(config); },
  });
  activated.setProjects([project], project);

  await fake.commands.find((x) => x.commandId === 'kousu.setTimesheetSource').handler();

  assert.equal(saved.length, 1);
  assert.equal(saved[0].timesheetSource.type, 'csv');
  assert.equal(saved[0].timesheetSource.path, '/data/timesheet.csv');
});

test('setTimesheetSource detects json type from file extension', async () => {
  const fake = createFakeVscode();
  fake.api.window.showOpenDialog = async () => [{ fsPath: '/data/timesheet.json' }];
  const saved = [];
  const project = {
    config: {
      projectId: 'alpha', schemaVersion: '1.0.0',
      schedule: { startDate: '2026-05-01', endDate: '2026-06-30' },
      effort: { total: 100, buffer: 10, actual: 0, budgetMode: 'inclusive' },
      members: [], calendar: { holidays: [], holidaySources: [] },
    },
  };

  const activated = activate({ vscode: fake.api, saveProjectConfig: async (c) => saved.push(c) });
  activated.setProjects([project], project);

  await fake.commands.find((x) => x.commandId === 'kousu.setTimesheetSource').handler();

  assert.equal(saved[0].timesheetSource.type, 'json');
});

test('setTimesheetSource does nothing when dialog is cancelled', async () => {
  const fake = createFakeVscode();
  fake.api.window.showOpenDialog = async () => undefined;
  const saved = [];
  const project = {
    config: {
      projectId: 'alpha', schemaVersion: '1.0.0',
      schedule: { startDate: '2026-05-01', endDate: '2026-06-30' },
      effort: { total: 100, buffer: 10, actual: 0, budgetMode: 'inclusive' },
      members: [], calendar: { holidays: [], holidaySources: [] },
    },
  };

  const activated = activate({ vscode: fake.api, saveProjectConfig: async (c) => saved.push(c) });
  activated.setProjects([project], project);

  await fake.commands.find((x) => x.commandId === 'kousu.setTimesheetSource').handler();

  assert.equal(saved.length, 0);
});

test('close disposes registered resources including dashboard panel', async () => {
  const fake = createFakeVscode();
  const activated = activate({ vscode: fake.api });

  const openDashboard = fake.commands.find((x) => x.commandId === 'kousu.openDashboard');
  openDashboard.handler();
  assert.equal(fake.webviewPanels.length, 1);
  assert.equal(fake.webviewPanels[0].disposed, false);

  assert.equal(typeof activated.close, 'function');
  activated.close();

  assert.equal(fake.webviewPanels[0].disposed, true);
  assert.ok(fake.disposedCount >= 3);
});
