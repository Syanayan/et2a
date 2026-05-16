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

    vscode.commands.registerCommand('kousu.openDashboard', () => dashboard.open());

    vscode.commands.registerCommand('kousu.selectProject', async () => {
      const result = await initializeProject({
        projects,
        isInteractive: true,
        pickProject: async (options) => vscode.window.showQuickPick(options, { placeHolder: 'Select project' }),
      });
      if (result.project) {
        activeProject = result.project;
        refreshSidebar(activeProject, null, null);
      }
    });

    vscode.commands.registerCommand('kousu.initializeProject', async () => {
      const totalInput = await vscode.window.showInputBox({ prompt: 'Enter total effort (person-days)' });
      if (totalInput === undefined) return;
      const endDate = await vscode.window.showInputBox({ prompt: 'Enter deadline (YYYY-MM-DD)' });
      if (endDate === undefined) return;
      const bufferInput = await vscode.window.showInputBox({ prompt: 'Enter buffer effort (person-days)' });
      if (bufferInput === undefined) return;
      const projectId = await vscode.window.showInputBox({ prompt: 'Enter project name (projectId)' });
      if (projectId === undefined) return;

      const today = new Date().toISOString().slice(0, 10);
      const config = {
        schemaVersion: '1.0.0',
        projectId,
        schedule: {
          startDate: today,
          endDate,
        },
        effort: {
          total: Number(totalInput),
          buffer: Number(bufferInput),
          actual: 0,
        },
        members: [{ id: 'default', dailyEffort: 1 }],
        calendar: { holidays: [] },
      };

      const validation = validateProjectConfig ? validateProjectConfig(config) : { ok: true, error: null };
      if (!validation.ok) {
        vscode.window.showErrorMessage(`Invalid project config: ${validation.error.message}`);
        return;
      }

      await (saveProjectConfig ?? (() => Promise.resolve()))(config);
      vscode.window.showInformationMessage('Kousu project initialized: kousu.config.json');
      dashboard.open();
    });

    vscode.commands.registerCommand('kousu.updateActual', async () => {
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
        elapsedWorkingDays: workingDayContext.elapsedWorkingDays ?? 0,
        totalWorkingDays: workingDayContext.totalWorkingDays ?? 0,
        remainingWorkingDays: workingDayContext.remainingWorkingDays ?? 0,
        today: workingDayContext.today ?? new Date().toISOString().slice(0, 10),
        saveProjectConfig: saveProjectConfig ?? (() => Promise.resolve()),
        appendAuditLog,
      });
      notifier.notify(result.notification);
      if (result.ok) {
        activeProject = result.project;
        refreshSidebar(activeProject, result.forecast, result.alert);
        dashboard.update({ project: activeProject, forecast: result.forecast, alert: result.alert });
      }
    });

    vscode.commands.registerCommand('kousu.syncHolidays', async () => {
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
    });

    vscode.window.createTreeView('kousu.sidebar', { treeDataProvider: provider });
  }

  return {
    status: 'activated',
    setProjects: (newProjects, initialActiveProject) => {
      projects.length = 0;
      projects.push(...newProjects);
      if (initialActiveProject) {
        activeProject = initialActiveProject;
        refreshSidebar(activeProject, null, null);
      }
    },
    updateDashboard: (state) => dashboard.update(state),
    notifyDashboardError: (message) => dashboard.error(message),
    notify: (notification) => notifier.notify(notification),
  };
}

export function deactivate() {}
