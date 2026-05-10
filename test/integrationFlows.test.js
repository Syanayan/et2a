import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { loadProjectConfigs } from '../src/infrastructure/configRepository.js';
import { updateActualEffort } from '../src/application/usecases/updateActualEffort.js';
import { activate } from '../src/extension.js';
import { createLocalApiServer } from '../src/infrastructure/localApiServer.js';
import { appendAuditLog } from '../src/infrastructure/auditLogger.js';
import { syncHolidaysUsecase } from '../src/application/usecases/syncHolidays.js';

function createFakeVscode() {
  const providers = new Map();
  return {
    providers,
    api: {
      commands: { registerCommand() { return { dispose() {} }; } },
      window: {
        createTreeView(viewId, options) {
          providers.set(viewId, options.treeDataProvider);
          return { dispose() {} };
        },
        createWebviewPanel() { return { webview: { postMessage: async () => true, onDidReceiveMessage() { return { dispose() {} }; }, html: '' } }; },
        showInformationMessage: async () => undefined,
        showWarningMessage: async () => undefined,
        showErrorMessage: async () => undefined,
      }
    }
  };
}

function createFakeHttp() {
  const servers = [];
  return {
    servers,
    createServer(handler) {
      const state = { handler };
      const server = {
        listen(_port, _host, cb) { cb?.(); },
        close(cb) { cb?.(); },
        on() {}
      };
      state.server = server;
      servers.push(state);
      return server;
    }
  };
}

function createResponseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(chunk = '') { this.body += chunk; }
  };
}

function createJsonRequest({ method, authorization, url, body }) {
  const handlers = {};
  return {
    method,
    url,
    headers: { authorization, 'content-type': 'application/json' },
    on(event, handler) { handlers[event] = handler; },
    emitBody() {
      handlers.data?.(JSON.stringify(body));
      handlers.end?.();
    }
  };
}

test('integration: config load -> recalc -> TreeView rendering', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'kousu-int-'));
  await mkdir(path.join(rootDir, 'kousu.projects'), { recursive: true });
  const configPath = path.join(rootDir, 'kousu.projects', 'alpha.local.json');
  await writeFile(configPath, JSON.stringify({
    projectId: 'alpha',
    schedule: { startDate: '2026-05-01', endDate: '2026-05-31' },
    effort: { total: 100, buffer: 20, actual: 40, budgetMode: 'inclusive' },
    members: [{ name: 'Alice', dailyEffort: 1 }]
  }));

  const loaded = await loadProjectConfigs(rootDir);
  assert.equal(loaded.projects.length, 1);

  const updated = await updateActualEffort({
    project: loaded.projects[0],
    nextActual: 50,
    elapsedWorkingDays: 10,
    totalWorkingDays: 20,
    today: '2026-05-20',
    remainingWorkingDays: ['2026-05-21'],
    saveProjectConfig: async () => {},
  });

  const viewState = {
    projectName: updated.project.config.projectId,
    progressPercent: Math.round((updated.project.config.effort.actual / updated.project.config.effort.total) * 100),
    remainingPersonDays: updated.forecast.remainingEffort,
    alertLabel: updated.alert.level,
  };

  const fake = createFakeVscode();
  activate({ vscode: fake.api, initialViewState: viewState });
  const provider = fake.providers.get('kousu.sidebar');
  const labels = (await provider.getChildren()).map((x) => x.label);

  assert.deepEqual(labels, [
    'Project: alpha',
    'Progress: 50%',
    'Remaining: 50 person_day',
    'Alert: normal'
  ]);
});

test('integration: PATCH API -> persisted config -> audit log', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'kousu-int-'));
  const projectPath = path.join(rootDir, 'alpha.json');
  const logPath = path.join(rootDir, 'audit.log');

  const initial = {
    projectId: 'alpha',
    schedule: { startDate: '2026-05-01', endDate: '2026-05-31' },
    effort: { total: 100, buffer: 20, actual: 40, budgetMode: 'inclusive' },
    members: [{ name: 'Alice', dailyEffort: 1 }]
  };
  await writeFile(projectPath, JSON.stringify(initial));

  const http = createFakeHttp();
  await createLocalApiServer({
    config: { enabled: true, port: 4567, token: 'secret' },
    http,
    handlers: {
      updateEffort: async (_projectId, payload) => {
        const project = { config: JSON.parse(await readFile(projectPath, 'utf8')) };
        const result = await updateActualEffort({
          project,
          nextActual: payload.actual,
          elapsedWorkingDays: 10,
          totalWorkingDays: 20,
          today: '2026-05-20',
          remainingWorkingDays: ['2026-05-21'],
          saveProjectConfig: async (config) => writeFile(projectPath, JSON.stringify(config)),
          appendAuditLog: async ({ entry }) => appendAuditLog({ logPath, entry }),
        });
        return result.ok ? { ok: true } : { error: result.error.code };
      }
    }
  });

  const handler = http.servers[0].handler;
  const req = createJsonRequest({ method: 'PATCH', authorization: 'Bearer secret', url: '/api/v1/projects/alpha/effort', body: { actual: 55 } });
  const res = createResponseRecorder();
  const promise = handler(req, res);
  req.emitBody();
  await promise;

  assert.equal(res.statusCode, 200);
  const persisted = JSON.parse(await readFile(projectPath, 'utf8'));
  assert.equal(persisted.effort.actual, 55);

  const logs = (await readFile(logPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(logs.at(-1).action, 'update_actual_effort');
  assert.equal(logs.at(-1).result, 'success');
});

test('integration: sync failure uses fallback and returns warning dashboard state', async () => {
  const project = {
    config: {
      projectId: 'alpha',
      calendar: {
        holidaySources: [{ kind: 'company', type: 'api', endpoint: 'https://example.com' }],
        holidays: ['2026-01-01']
      }
    }
  };

  const result = await syncHolidaysUsecase({
    project,
    dryRun: false,
    syncHolidays: async () => ({
      success: false,
      fallbackUsed: true,
      holidays: ['2026-01-01'],
      warningState: 'fallback_weekend_only',
      errors: [{ source: 'company', reason: 'timeout' }]
    }),
    saveProjectConfig: async () => {},
  });

  assert.equal(result.result.fallbackUsed, true);
  assert.equal(result.dashboardState.warningState, 'fallback_weekend_only');
  assert.equal(result.notification.level, 'warning');
});
