import { createRequire } from 'node:module';
import { activate as _activate, deactivate as _deactivate } from './presentation/extension.js';
import { loadProjectConfigs } from './infrastructure/configRepository.js';
import { initializeProject } from './application/usecases/initializeProject.js';
import { calculateWorkingDays } from './domain/workingDayCalculator.js';
import { appendAuditLog } from './infrastructure/auditLogger.js';
import { validateProjectConfig } from './infrastructure/configValidator.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { syncTimesheetUsecase } from './application/usecases/syncTimesheet.js';

const require = createRequire(import.meta.url);
const vscode = require('vscode');

async function saveProjectConfig(config, filePath) {
  await writeFile(filePath, JSON.stringify(config, null, 2), 'utf8');
}

function createHolidayLoaders(workspaceRoot) {
  return {
    api: async (source) => {
      const response = await fetch(source.endpoint);
      if (!response.ok) {
        throw new Error(`holiday_api_error:${response.status}`);
      }
      const data = await response.json();
      return Array.isArray(data) ? data : data?.holidays ?? [];
    },
    file: async (source) => {
      const targetPath = path.isAbsolute(source.path)
        ? source.path
        : path.join(workspaceRoot, source.path);
      const body = await readFile(targetPath, 'utf8');
      const data = JSON.parse(body);
      return Array.isArray(data) ? data : data?.holidays ?? [];
    },
    csv: async (source) => {
      const targetPath = path.isAbsolute(source.path)
        ? source.path
        : path.join(workspaceRoot, source.path);
      const body = await readFile(targetPath, 'utf8');
      return body
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^\d{4}-\d{2}-\d{2}$/.test(line));
    },
  };
}

async function reloadAndSetProjects(workspaceRoot, result, today, readFileFn) {
  const { projects: newProjects } = await loadProjectConfigs(workspaceRoot)
    .catch(() => ({ projects: [] }));
  if (newProjects.length === 0) return;
  const { project: active } = await initializeProject({ projects: newProjects, isInteractive: false });
  if (!active) return;
  const startDate = active.config?.schedule?.startDate ?? today;
  const endDate = active.config?.schedule?.endDate ?? today;
  const holidays = active.config?.calendar?.holidays ?? [];
  const { workingDays } = calculateWorkingDays(startDate, endDate, { companyHolidays: holidays, personalHolidays: [] });
  result.setProjects(newProjects, active, {
    today,
    elapsedWorkingDays: workingDays.filter((d) => d <= today).length,
    totalWorkingDays: workingDays.length,
    remainingWorkingDays: workingDays.filter((d) => d > today),
  });

  // timesheetSource が設定されていれば自動読み込みして monthlyBreakdown を復元
  const source = active.config?.timesheetSource;
  if (source?.path && readFileFn) {
    const tsResult = await syncTimesheetUsecase({
      project: active,
      sourceType: source.type ?? 'csv',
      sourcePath: source.path,
      readFile: readFileFn,
      saveProjectConfig: async () => {},
    }).catch(() => null);
    if (tsResult?.ok && tsResult.monthlyBreakdown) {
      result.setProjectBreakdown(active.config.projectId, tsResult.monthlyBreakdown);
    }
  }
}

export async function activate(context) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath ?? context.extensionPath;
  const logPath = path.join(workspaceRoot, 'kousu.audit.log');
  const today = new Date().toISOString().slice(0, 10);

  const { projects, conflicts } = await loadProjectConfigs(workspaceRoot).catch(() => ({ projects: [], conflicts: [] }));

  const result = _activate({
    vscode,
    projects,
    appendAuditLog: (entry) => appendAuditLog({ logPath, entry }),
    saveProjectConfig: (config) => {
      const found = projects.find((p) => p.config?.projectId === config.projectId);
      const filePath = found?.filePath ?? path.join(workspaceRoot, 'kousu.config.json');
      return saveProjectConfig(config, filePath);
    },
    validateProjectConfig,
    holidayLoaders: createHolidayLoaders(workspaceRoot),
    readFile: (filePath) => readFile(
      path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath),
      'utf8'
    ),
    workingDayContext: { today, elapsedWorkingDays: 0, totalWorkingDays: 0, remainingWorkingDays: [] },
    createProjectConfig: async (config) => {
      const projectsDir = path.join(workspaceRoot, 'kousu.projects');
      await mkdir(projectsDir, { recursive: true });
      const filePath = path.join(projectsDir, `${config.projectId}.json`);
      await saveProjectConfig(config, filePath);
      const { projects: newProjects } = await loadProjectConfigs(workspaceRoot)
        .catch(() => ({ projects: [] }));
      const activeProject = newProjects.find((p) => p.config?.projectId === config.projectId) ?? { config };
      return { projects: newProjects, activeProject };
    },
  });

  const readFileFn = (filePath) => readFile(
    path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath),
    'utf8'
  );

  if (projects.length > 0) {
    await reloadAndSetProjects(workspaceRoot, result, today, readFileFn);
  }

  if (conflicts.length > 0) {
    vscode.window.showWarningMessage(`Kousu: ${conflicts.length} project config conflict(s) detected. Check kousu.audit.log for details.`);
  }

  // B: ファイル監視 — kousu.projects/ と kousu.config.json の変更を自動検知
  const watcher = vscode.workspace.createFileSystemWatcher?.(
    new (vscode.RelativePattern ?? Object)(workspaceRoot, '{kousu.config.json,kousu.projects/**/*.json}')
  );
  if (watcher) {
    const onConfigChange = () => reloadAndSetProjects(workspaceRoot, result, today, readFileFn);
    watcher.onDidChange(onConfigChange);
    watcher.onDidCreate(onConfigChange);
    watcher.onDidDelete(onConfigChange);
    context.subscriptions.push(watcher);
  }

  context.subscriptions.push({ dispose: () => result.close?.() });

  return result;
}

export function deactivate() {
  return _deactivate();
}
