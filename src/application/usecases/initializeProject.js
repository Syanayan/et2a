import { loadActiveProject } from './loadActiveProject.js';

export async function initializeProject(params) {
  return loadActiveProject(params);
}
