// Presentation層はapplication層のみを参照する。domain/infrastructureへの直接依存は禁止。
import { KousuSidebarProvider } from './sidebar.js';
import { KousuDashboard } from './dashboard.js';
import { NotificationRouter } from './notifier.js';
import { initializeProject } from '../application/usecases/initializeProject.js';
import { updateActualEffort } from '../application/usecases/updateActualEffort.js';
import { syncHolidaysUsecase } from '../application/usecases/syncHolidays.js';

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
  } = options;

  const dashboard = new KousuDashboard(vscode, initialDashboardState);
  const notifier = new NotificationRouter(vscode, options.now);
  let activeProject = null;
  let provider = null;
  const disposables = [];
  const mutableWorkingDayContext = { ...workingDayContext };

  function sidebarStateFromProject(project, forecast, alert) {
    if (!project) {
      return {};
    }
    const cfg = project.config;
    const progressPercent = forecast?.progressPercent
      ?? (cfg.effort?.actual != null && cfg.effort?.total
        ? Math.round((cfg.effort.actual / cfg.effort.total) * 100)
        : 0);
    return {
      projectName: cfg.projectId ?? '-',
      progressPercent,
      remainingPersonDays: forecast?.remainingEffort ?? 0,
      alertLabel: alert?.level ?? '正常',
    };
  }

  function refreshSidebar(project, forecast, alert) {
    if (!provider) return;
    provider.state = {
      ...provider.state,
      ...sidebarStateFromProject(project, forecast, alert),
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
        refreshSidebar(activeProject, result.forecast, result.alert);
        dashboard.update({ project: activeProject, forecast: result.forecast, alert: result.alert });
      }
    }));

    disposables.push(vscode.commands.registerCommand('kousu.syncHolidays', async () => {
      if (!activeProject) {
        vscode.window.showWarningMessage('No project selected. Run "Kousu: Select Project" first.');
        return;
      }
      const result = await syncHolidaysUsecase({
        project: activeProject,
        dryRun: false,
        saveProjectConfig: saveProjectConfig ?? (() => Promise.resolve()),
        appendAuditLog,
      });
      notifier.notify(result.notification);
      if (result.ok) {
        activeProject = result.project;
        dashboard.update(result.dashboardState);
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
