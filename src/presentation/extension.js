// Presentation層はapplication層のみを参照する。domain/infrastructureへの直接依存は禁止。
import { KousuSidebarProvider } from './sidebar.js';

const COMMAND_IDS = [
  'kousu.selectProject',
  'kousu.updateActual',
  'kousu.openDashboard',
  'kousu.syncHolidays'
];

export function activate(options = {}) {
  const { vscode, initialViewState } = options;

  if (vscode?.commands?.registerCommand && vscode?.window?.createTreeView) {
    const provider = new KousuSidebarProvider(initialViewState);
    for (const commandId of COMMAND_IDS) {
      vscode.commands.registerCommand(commandId, () => undefined);
    }
    vscode.window.createTreeView('kousu.sidebar', { treeDataProvider: provider });
  }

  return { status: 'activated' };
}

export function deactivate() {}
