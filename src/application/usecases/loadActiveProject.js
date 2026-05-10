export async function loadActiveProject(params) {
  const {
    projects,
    selectedProjectId,
    settingsActiveProjectId,
    isInteractive = true,
    pickProject,
  } = params;

  if (!Array.isArray(projects) || projects.length === 0) {
    return { project: null, resolution: 'no_projects' };
  }

  const sortedProjects = [...projects].sort((a, b) => {
    const left = a?.config?.projectId ?? '';
    const right = b?.config?.projectId ?? '';
    return left.localeCompare(right);
  });

  const byProjectId = new Map(sortedProjects.map((item) => [item?.config?.projectId, item]));

  if (selectedProjectId && byProjectId.has(selectedProjectId)) {
    return { project: byProjectId.get(selectedProjectId), resolution: 'selected_project_id' };
  }

  if (settingsActiveProjectId && byProjectId.has(settingsActiveProjectId)) {
    return { project: byProjectId.get(settingsActiveProjectId), resolution: 'settings_active_project_id' };
  }

  if (sortedProjects.length === 1) {
    return { project: sortedProjects[0], resolution: 'single_project' };
  }

  if (isInteractive && typeof pickProject === 'function') {
    const options = sortedProjects.map((item) => item.config.projectId);
    const pickedProjectId = await pickProject(options);
    if (pickedProjectId && byProjectId.has(pickedProjectId)) {
      return { project: byProjectId.get(pickedProjectId), resolution: 'quick_pick' };
    }
  }

  return { project: sortedProjects[0], resolution: 'non_interactive_fallback' };
}
