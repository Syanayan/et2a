const DEFAULT_STATE = {
  projectName: '-',
  progressPercent: 0,
  remainingPersonDays: 0,
  alertLabel: '正常'
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
    return [
      { label: `Project: ${this.state.projectName}` },
      { label: `Progress: ${this.state.progressPercent}%` },
      { label: `Remaining: ${this.state.remainingPersonDays} person_day` },
      { label: `Alert: ${this.state.alertLabel}` }
    ];
  }
}
