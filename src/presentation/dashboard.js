const DEFAULT_DASHBOARD_STATE = {
  kpi: {},
  burndown: [],
  alert: { level: 'ok', label: '正常' },
  syncStatus: { status: 'idle' }
};

export class KousuDashboard {
  constructor(vscode, initialState = DEFAULT_DASHBOARD_STATE) {
    this.vscode = vscode;
    this.state = { ...DEFAULT_DASHBOARD_STATE, ...initialState };
    this.panel = null;
  }

  open() {
    if (!this.vscode?.window?.createWebviewPanel) {
      return null;
    }
    const wasCreated = !this.panel;
    this.panel =
      this.panel ??
      this.vscode.window.createWebviewPanel(
        'kousu.dashboard',
        'Kousu Dashboard',
        {},
        { enableScripts: true }
      );
    this.panel.webview.html = '<html><body><div id="dashboard-root"></div></body></html>';
    if (wasCreated) {
      this.post('dashboard:init', this.state);
    }
    return this.panel;
  }

  async update(nextState) {
    this.state = { ...this.state, ...nextState };
    this.open();
    await this.post('dashboard:update', this.state);
  }

  async error(message) {
    this.open();
    await this.post('dashboard:error', { message });
  }

  post(type, payload) {
    return this.panel?.webview?.postMessage({ type, payload });
  }
}
