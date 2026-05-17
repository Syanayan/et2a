import { createRequire } from 'node:module';
import { activate as _activate, deactivate as _deactivate } from './presentation/extension.js';
import { loadProjectConfigs } from './infrastructure/configRepository.js';
import { initializeProject } from './application/usecases/initializeProject.js';
import { calculateWorkingDays } from './domain/workingDayCalculator.js';
import { appendAuditLog } from './infrastructure/auditLogger.js';
import { validateProjectConfig } from './infrastructure/configValidator.js';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const vscode = require('vscode');

async function saveProjectConfig(config, filePath) {
  await writeFile(filePath, JSON.stringify(config, null, 2), 'utf8');
}

export async function activate(context) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath ?? context.extensionPath;
  const logPath = path.join(workspaceRoot, 'kousu.audit.log');

  const { projects, conflicts } = await loadProjectConfigs(workspaceRoot).catch(() => ({ projects: [], conflicts: [] }));

  const today = new Date().toISOString().slice(0, 10);

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
    workingDayContext: { today, elapsedWorkingDays: 0, totalWorkingDays: 0, remainingWorkingDays: 0 },
  });

  if (projects.length > 0) {
    const { project: initialProject } = await initializeProject({
      projects,
      isInteractive: false,
    });

    if (initialProject) {
      const startDate = initialProject.config?.schedule?.startDate ?? today;
      const endDate = initialProject.config?.schedule?.endDate ?? today;
      const holidays = initialProject.config?.calendar?.holidays ?? [];
      const { workingDays } = calculateWorkingDays(startDate, endDate, { companyHolidays: holidays, personalHolidays: [] });
      const elapsed = workingDays.filter((d) => d <= today).length;
      const remaining = workingDays.filter((d) => d > today).length;

      result.setProjects(projects, initialProject, {
        today,
        elapsedWorkingDays: elapsed,
        totalWorkingDays: workingDays.length,
        remainingWorkingDays: workingDays.filter((d) => d > today),
      });
    }
  }

  if (conflicts.length > 0) {
    vscode.window.showWarningMessage(`Kousu: ${conflicts.length} project config conflict(s) detected. Check kousu.audit.log for details.`);
  }

  context.subscriptions.push({ dispose: () => result.close?.() });

  return result;
}

export function deactivate() {
  return _deactivate();
}
