import path from 'node:path';
import { readdir, readFile, rename, copyFile } from 'node:fs/promises';

const PROJECTS_DIR = 'kousu.projects';
const ROOT_CONFIG = 'kousu.config.json';

export async function loadProjectConfigs(rootDir) {
  const candidates = await discoverCandidates(rootDir);
  const loaded = [];

  for (const candidate of candidates) {
    const parsed = await parseWithRecovery(candidate.filePath);
    if (!parsed) {
      continue;
    }

    loaded.push({
      filePath: candidate.filePath,
      priority: candidate.priority,
      config: parsed,
    });
  }

  loaded.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.filePath.localeCompare(b.filePath);
  });

  const selectedByProjectId = new Map();
  const conflictsByProjectId = new Map();

  for (const item of loaded) {
    const projectId = item.config?.projectId;
    if (typeof projectId !== 'string' || projectId.length === 0) {
      continue;
    }

    const winner = selectedByProjectId.get(projectId);
    if (!winner) {
      selectedByProjectId.set(projectId, item);
      continue;
    }

    if (!conflictsByProjectId.has(projectId)) {
      conflictsByProjectId.set(projectId, {
        projectId,
        selectedFile: winner.filePath,
        ignoredFiles: [],
        detectedAtUtc: new Date().toISOString(),
      });
    }

    conflictsByProjectId.get(projectId).ignoredFiles.push(item.filePath);
  }

  return {
    projects: Array.from(selectedByProjectId.values()),
    conflicts: Array.from(conflictsByProjectId.values()),
  };
}

async function discoverCandidates(rootDir) {
  const projectsDir = path.join(rootDir, PROJECTS_DIR);
  const candidates = [];
  let projectFiles = [];

  try {
    projectFiles = await readdir(projectsDir);
  } catch {
    projectFiles = [];
  }

  for (const name of projectFiles) {
    if (name.endsWith('.local.json')) {
      candidates.push({ filePath: path.join(projectsDir, name), priority: 0 });
    }
  }

  for (const name of projectFiles) {
    if (name.endsWith('.json') && !name.endsWith('.local.json')) {
      candidates.push({ filePath: path.join(projectsDir, name), priority: 1 });
    }
  }

  candidates.push({ filePath: path.join(rootDir, ROOT_CONFIG), priority: 2 });

  return candidates;
}

async function parseWithRecovery(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    const brokenPath = `${filePath}.broken.${Date.now()}`;
    await rename(filePath, brokenPath);

    const backupPath = `${filePath}.bak`;
    try {
      await copyFile(backupPath, filePath);
      const backupRaw = await readFile(filePath, 'utf8');
      return JSON.parse(backupRaw);
    } catch {
      return null;
    }
  }
}
