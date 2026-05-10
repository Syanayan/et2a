import test from 'node:test';
import assert from 'node:assert/strict';
import { activate } from '../src/extension.js';

function createFakeVscode() {
  const commands = [];
  const treeViews = [];
  const providers = new Map();
  const webviewPanels = [];

  return {
    commands,
    treeViews,
    providers,
    webviewPanels,
    api: {
      commands: {
        registerCommand(commandId, handler) {
          commands.push({ commandId, handler });
          return { dispose() {} };
        }
      },
      window: {
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
