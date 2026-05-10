// Presentation層はapplication層のみを参照する。domain/infrastructureへの直接依存は禁止。
import { KousuSidebarProvider } from './sidebar.js';
import { KousuDashboard } from './dashboard.js';
import { NotificationRouter } from './notifier.js';

const COMMAND_IDS = [
  'kousu.selectProject',
  'kousu.updateActual',
  'kousu.openDashboard',
  'kousu.syncHolidays'
];

export function activate(options = {}) {
  const { vscode, initialViewState, initialDashboardState } = options;
  const dashboard = new KousuDashboard(vscode, initialDashboardState);
  const notifier = new NotificationRouter(vscode, options.now);

  if (vscode?.commands?.registerCommand && vscode?.window?.createTreeView) {
    const provider = new KousuSidebarProvider(initialViewState);
    for (const commandId of COMMAND_IDS) {
      const handlers = {
        'kousu.openDashboard': () => dashboard.open()
      };
      vscode.commands.registerCommand(commandId, handlers[commandId] ?? (() => undefined));
    }
    vscode.window.createTreeView('kousu.sidebar', { treeDataProvider: provider });
  }

  return {
    status: 'activated',
    updateDashboard: (state) => dashboard.update(state),
    notifyDashboardError: (message) => dashboard.error(message),
    notify: (notification) => notifier.notify(notification)
  };
}

export function deactivate() {}
