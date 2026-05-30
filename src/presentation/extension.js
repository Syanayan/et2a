// Presentation層はapplication層のみを参照する。domain/infrastructureへの直接依存は禁止。
import { KousuSidebarProvider } from './sidebar.js';
import { KousuDashboard } from './dashboard.js';
import { NotificationRouter } from './notifier.js';
import { initializeProject } from '../application/usecases/initializeProject.js';
import { updateActualEffort } from '../application/usecases/updateActualEffort.js';
import { syncHolidaysUsecase } from '../application/usecases/syncHolidays.js';
import { computeWeeklyEffort, computeBurndown } from '../application/computeDashboardCharts.js';
import { syncTimesheetUsecase } from '../application/usecases/syncTimesheet.js';

export function activate(options = {}) {
  const {
    vscode,
    initialViewState,
    initialDashboardState,
    projects = [],
    workingDayContext = {},
    appendAuditLog,
    saveProjectConfig,
    validateProjectConfig,
    holidayLoaders,
    readFile,
    createProjectConfig,
  } = options;

  const dashboard = new KousuDashboard(vscode, initialDashboardState);
  dashboard.onMessage(async (message) => {
    if (message?.type === 'action' && message?.payload?.command) {
      await vscode?.commands?.executeCommand?.(
        `kousu.${message.payload.command}`,
        message.payload.value
      );
    }
  });
  const notifier = new NotificationRouter(vscode, options.now);
  let activeProject = null;
  let provider = null;
  const disposables = [];
  const mutableWorkingDayContext = { ...workingDayContext };
  const effortHistory = [];
  const breakdownByProject = new Map();

  function refreshSidebar(activeProj, forecast, alert) {
    if (!provider) return;
    const activeId = activeProj?.config?.projectId ?? null;
    provider.state = {
      projects: projects.map((p) => {
        const isActive = p.config?.projectId === activeId;
        const cfg = p.config;
        const progressPercent = isActive && forecast?.progressPercent != null
          ? forecast.progressPercent
          : (cfg.effort?.actual != null && cfg.effort?.total
            ? Math.round((cfg.effort.actual / cfg.effort.total) * 100)
            : 0);
        return {
          projectId: cfg.projectId ?? '-',
          progressPercent,
          alertLabel: isActive ? (alert?.level ?? '正常') : '正常',
        };
      }),
      activeProjectId: activeId,
    };
    provider._onDidChangeTreeData?.fire();
  }

  if (vscode?.commands?.registerCommand && vscode?.window?.createTreeView) {
    provider = new KousuSidebarProvider(initialViewState);

    disposables.push(vscode.commands.registerCommand('kousu.openDashboard', () => dashboard.open()));
    disposables.push(vscode.commands.registerCommand('kousu.initializeProject', async () => {
      const totalInput = await vscode.window.showInputBox({ prompt: 'Enter total effort (person-days)' });
      if (totalInput === undefined) return;
      const total = Number(totalInput);
      if (!Number.isFinite(total) || total <= 0) {
        vscode.window.showErrorMessage('Total effort must be a positive number.');
        return;
      }
      const endDate = await vscode.window.showInputBox({ prompt: 'Enter deadline (YYYY-MM-DD)' });
      if (endDate === undefined) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || Number.isNaN(Date.parse(endDate))) {
        vscode.window.showErrorMessage('Deadline must be in YYYY-MM-DD format.');
        return;
      }
      const bufferInput = await vscode.window.showInputBox({ prompt: 'Enter buffer effort (person-days)' });
      if (bufferInput === undefined) return;
      const buffer = Number(bufferInput);
      if (!Number.isFinite(buffer) || buffer < 0) {
        vscode.window.showErrorMessage('Buffer effort must be a non-negative number.');
        return;
      }
      const projectName = await vscode.window.showInputBox({ prompt: 'Enter project name' });
      if (projectName === undefined) return;
      const normalizedName = projectName.trim();
      if (!normalizedName) {
        vscode.window.showErrorMessage('Project name is required.');
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      const projectId = normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
      const config = {
        schemaVersion: '1.0.0',
        projectId,
        schedule: { startDate: today, endDate },
        effort: { total, buffer, actual: 0, budgetMode: 'inclusive' },
        members: [],
        calendar: { holidays: [], holidaySources: [] },
      };
      const validation = typeof validateProjectConfig === 'function'
        ? validateProjectConfig(config)
        : { ok: true, error: null };
      if (!validation.ok) {
        vscode.window.showErrorMessage(validation.error?.message ?? 'Invalid project config.');
        return;
      }
      await (saveProjectConfig ?? (() => Promise.resolve()))(config);
      const project = { config };
      projects.push(project);
      activeProject = project;
      refreshSidebar(activeProject, null, null);
      dashboard.open();
      dashboard.update({ project: activeProject });
      notifier.notify({ level: 'info', message: 'Project initialized.' });
    }));

    disposables.push(vscode.commands.registerCommand('kousu.updatePredicted', async (value) => {
      if (!activeProject) {
        vscode.window.showWarningMessage('No project selected.');
        return;
      }
      const predicted = Number(value);
      if (!Number.isFinite(predicted) || predicted < 0) return;
      const nextConfig = {
        ...activeProject.config,
        effort: { ...activeProject.config.effort, predicted },
      };
      await (saveProjectConfig ?? (() => Promise.resolve()))(nextConfig);
      activeProject = { ...activeProject, config: nextConfig };
      dashboard.update({ project: activeProject });
      notifier.notify({ level: 'info', message: `予想工数を ${predicted}h に更新しました。` });
    }));

    disposables.push(vscode.commands.registerCommand('kousu.newProject', async () => {
      const projectName = await vscode.window.showInputBox({ prompt: 'Project name' });
      if (!projectName?.trim()) return;
      const totalInput = await vscode.window.showInputBox({ prompt: 'Total effort (person-days)' });
      if (totalInput === undefined) return;
      const total = Number(totalInput);
      if (!Number.isFinite(total) || total <= 0) {
        vscode.window.showErrorMessage('Total effort must be a positive number.');
        return;
      }
      const endDate = await vscode.window.showInputBox({ prompt: 'End date (YYYY-MM-DD)' });
      if (endDate === undefined) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || Number.isNaN(Date.parse(endDate))) {
        vscode.window.showErrorMessage('End date must be in YYYY-MM-DD format.');
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      const projectId = projectName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
      const config = {
        schemaVersion: '1.0.0',
        projectId,
        schedule: { startDate: today, endDate },
        effort: { total, buffer: 0, actual: 0, budgetMode: 'inclusive' },
        members: [],
        calendar: { holidays: [], holidaySources: [] },
      };
      const result = await (createProjectConfig ?? (() => Promise.resolve({ projects: [{ config }], activeProject: { config } })))(config);
      projects.length = 0;
      projects.push(...(result.projects ?? []));
      activeProject = result.activeProject ?? { config };
      refreshSidebar(activeProject, null, null);
      dashboard.update({ project: activeProject });
      notifier.notify({ level: 'info', message: `Project "${projectId}" created.` });
    }));

    disposables.push(vscode.commands.registerCommand('kousu.setTimesheetSource', async () => {
      if (!activeProject) {
        vscode.window.showWarningMessage('No project selected. Run "Kousu: Select Project" first.');
        return;
      }
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { Timesheet: ['csv', 'json'] },
        openLabel: 'Select Timesheet File',
      });
      if (!uris || uris.length === 0) return;
      const filePath = uris[0].fsPath;
      const type = filePath.endsWith('.json') ? 'json' : 'csv';
      const nextConfig = {
        ...activeProject.config,
        timesheetSource: { type, path: filePath },
      };
      await (saveProjectConfig ?? (() => Promise.resolve()))(nextConfig);
      activeProject = { ...activeProject, config: nextConfig };
      notifier.notify({ level: 'info', message: `Timesheet source set.` });
    }));

    disposables.push(vscode.commands.registerCommand('kousu.selectProjectById', (projectId) => {
      const found = projects.find((p) => p.config?.projectId === projectId);
      if (!found) return;
      activeProject = found;
      refreshSidebar(activeProject, null, null);
      dashboard.update({ project: activeProject, monthlyBreakdown: breakdownByProject.get(projectId) ?? null });
    }));

    disposables.push(vscode.commands.registerCommand('kousu.selectProject', async () => {
      const result = await initializeProject({
        projects,
        isInteractive: true,
        pickProject: async (options) => vscode.window.showQuickPick(options, { placeHolder: 'Select project' }),
      });
      if (result.project) {
        activeProject = result.project;
        refreshSidebar(activeProject, null, null);
      }
    }));

    disposables.push(vscode.commands.registerCommand('kousu.updateActual', async () => {
      if (!activeProject) {
        vscode.window.showWarningMessage('No project selected. Run "Kousu: Select Project" first.');
        return;
      }
      const input = await vscode.window.showInputBox({
        prompt: 'Enter actual effort (person-days)',
        validateInput: (v) => {
          const n = Number(v);
          return (isNaN(n) || n < 0) ? 'Enter a non-negative number' : undefined;
        },
      });
      if (input === undefined) return;
      const result = await updateActualEffort({
        project: activeProject,
        nextActual: Number(input),
        elapsedWorkingDays: mutableWorkingDayContext.elapsedWorkingDays ?? 0,
        totalWorkingDays: mutableWorkingDayContext.totalWorkingDays ?? 0,
        remainingWorkingDays: mutableWorkingDayContext.remainingWorkingDays ?? [],
        today: mutableWorkingDayContext.today ?? new Date().toISOString().slice(0, 10),
        saveProjectConfig: saveProjectConfig ?? (() => Promise.resolve()),
        appendAuditLog,
      });
      notifier.notify(result.notification);
      if (result.ok) {
        activeProject = result.project;
        const today = mutableWorkingDayContext.today ?? new Date().toISOString().slice(0, 10);
        const existing = effortHistory.findIndex((e) => e.date === today);
        if (existing >= 0) {
          effortHistory[existing] = { date: today, actual: Number(input) };
        } else {
          effortHistory.push({ date: today, actual: Number(input) });
        }
        const burndown = computeBurndown(breakdownByProject.get(activeProject?.config?.projectId) ?? null, activeProject);
        const weeklyEffort = computeWeeklyEffort(
          effortHistory,
          activeProject,
          today,
          mutableWorkingDayContext.totalWorkingDays ?? 0,
        );
        refreshSidebar(activeProject, result.forecast, result.alert);
        dashboard.update({ project: activeProject, forecast: result.forecast, alert: result.alert, burndown, weeklyEffort });
      }
    }));

    disposables.push(vscode.commands.registerCommand('kousu.syncHolidays', async () => {
      if (!activeProject) {
        vscode.window.showWarningMessage('No project selected. Run "Kousu: Select Project" first.');
        return;
      }
      const sources = activeProject?.config?.calendar?.holidaySources ?? [];
      if (sources.length === 0) {
        vscode.window.showWarningMessage('Holiday sync sources are not configured.');
        return;
      }
      const result = await syncHolidaysUsecase({
        project: activeProject,
        dryRun: false,
        loaders: holidayLoaders,
        saveProjectConfig: saveProjectConfig ?? (() => Promise.resolve()),
        appendAuditLog,
      });
      notifier.notify(result.notification);
      if (result.ok) {
        activeProject = result.project;
        dashboard.update(result.dashboardState);
      }
    }));

    disposables.push(vscode.commands.registerCommand('kousu.syncTimesheet', async () => {
      if (!activeProject) {
        vscode.window.showWarningMessage('No project selected. Run "Kousu: Select Project" first.');
        return;
      }
      const source = activeProject?.config?.timesheetSource;
      const result = await syncTimesheetUsecase({
        project: activeProject,
        sourceType: source?.type ?? (source ? 'csv' : null),
        sourcePath: source?.path,
        readFile: readFile ?? (() => Promise.resolve('')),
        saveProjectConfig: saveProjectConfig ?? (() => Promise.resolve()),
      });
      notifier.notify(result.notification);
      if (result.ok) {
        activeProject = result.project;
        const today = mutableWorkingDayContext.today ?? new Date().toISOString().slice(0, 10);
        const existing = effortHistory.findIndex((e) => e.date === today);
        const actual = result.project.config.effort.actual;
        if (existing >= 0) {
          effortHistory[existing] = { date: today, actual };
        } else {
          effortHistory.push({ date: today, actual });
        }
        const projectId = activeProject.config?.projectId;
        if (projectId && result.monthlyBreakdown) {
          breakdownByProject.set(projectId, result.monthlyBreakdown);
        }
        const burndown = computeBurndown(breakdownByProject.get(projectId) ?? null, activeProject);
        const weeklyEffort = computeWeeklyEffort(
          effortHistory,
          activeProject,
          today,
          mutableWorkingDayContext.totalWorkingDays ?? 0,
        );
        refreshSidebar(activeProject, null, null);
        dashboard.update({ project: activeProject, burndown, weeklyEffort, monthlyBreakdown: breakdownByProject.get(projectId) ?? null });
      }
    }));

    disposables.push(vscode.window.createTreeView('kousu.sidebar', { treeDataProvider: provider }));
  }

  return {
    status: 'activated',
    setProjects: (newProjects, initialActiveProject, nextWorkingDayContext) => {
      projects.length = 0;
      projects.push(...newProjects);
      if (nextWorkingDayContext) {
        Object.assign(mutableWorkingDayContext, nextWorkingDayContext);
      }
      if (initialActiveProject) {
        activeProject = initialActiveProject;
        refreshSidebar(activeProject, null, null);
        dashboard.update({ project: activeProject });
      }
    },
    updateDashboard: (state) => dashboard.update(state),
    setProjectBreakdown: (projectId, breakdown) => {
      breakdownByProject.set(projectId, breakdown);
      if (activeProject?.config?.projectId === projectId) {
        dashboard.update({ monthlyBreakdown: breakdown });
      }
    },
    notifyDashboardError: (message) => dashboard.error(message),
    notify: (notification) => notifier.notify(notification),
    close: () => {
      dashboard.close();
      if (provider) provider._listeners = [];
      while (disposables.length > 0) {
        const disposable = disposables.pop();
        disposable?.dispose?.();
      }
      provider = null;
      activeProject = null;
    },
  };
}

export function deactivate() {}
