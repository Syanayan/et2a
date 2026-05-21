const DEFAULT_STATE = {
  projects: [],
  activeProjectId: null,
};

export class KousuSidebarProvider {
  constructor(initialState = DEFAULT_STATE) {
    this.state = { ...DEFAULT_STATE, ...initialState };
    this._listeners = [];
    this._onDidChangeTreeData = {
      fire: () => {
        for (const listener of this._listeners) {
          listener(undefined);
        }
      },
    };
    this.onDidChangeTreeData = (listener) => {
      this._listeners.push(listener);
      return { dispose: () => { this._listeners = this._listeners.filter((l) => l !== listener); } };
    };
  }

  getTreeItem(element) {
    return element;
  }

  getChildren() {
    if (this.state.projects.length === 0) {
      return [{ label: 'No projects loaded', collapsibleState: 0 }];
    }
    return this.state.projects.map((p) => {
      const isActive = p.projectId === this.state.activeProjectId;
      return {
        label: (isActive ? '▶ ' : '  ') + p.projectId,
        description: `${p.progressPercent ?? 0}%  ${p.alertLabel ?? '正常'}`,
        collapsibleState: 0,
        command: {
          command: 'kousu.selectProjectById',
          title: 'Select Project',
          arguments: [p.projectId],
        },
      };
    });
  }
}
