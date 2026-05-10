import test from 'node:test';
import assert from 'node:assert/strict';
import { activate } from '../src/extension.js';

function createFakeVscode() {
  const commands = [];
  const treeViews = [];
  const providers = new Map();

  return {
    commands,
    treeViews,
    providers,
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
