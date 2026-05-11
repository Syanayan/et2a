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
    this.panel.webview.html = this.renderHtml();
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

  renderHtml() {
    return `<!DOCTYPE html>
<html lang="ja">
  <body>
    <div id="error-banner" style="display:none;color:#fff;background:#a00;padding:8px;margin-bottom:8px;"></div>
    <section id="kpi-cards">
      <div>総工数: <span id="kpi-total">-</span></div>
      <div>実績: <span id="kpi-actual">-</span></div>
      <div>残工数: <span id="kpi-remaining">-</span></div>
      <div>予測終了日: <span id="kpi-finish-date">-</span></div>
    </section>
    <section>
      <svg id="burndown-chart" width="640" height="220"></svg>
    </section>
    <section>
      バッファ閾値: <span id="buffer-threshold">-</span>
    </section>
    <section>
      <div>枯渇予測(バッファ除外): <span id="depletion-exclusive">-</span></div>
      <div>枯渇予測(バッファ込み): <span id="depletion-inclusive">-</span></div>
      <div id="sync-status">同期状態: -</div>
    </section>
    <script>
      const byId = (id) => document.getElementById(id);
      const vscode = acquireVsCodeApi ? acquireVsCodeApi() : null;
      const setText = (id, value) => { const el = byId(id); if (el) el.textContent = value ?? '-'; };
      function render(state = {}) {
        const kpi = state.kpi ?? {};
        const forecast = state.forecast ?? {};
        const effort = state.project?.config?.effort ?? {};
        setText('kpi-total', effort.total ?? kpi.total ?? '-');
        setText('kpi-actual', effort.actual ?? kpi.actual ?? '-');
        setText('kpi-remaining', forecast.remainingEffort ?? kpi.remainingEffort ?? '-');
        setText('kpi-finish-date', forecast.depletionDate ?? kpi.predictedEndDate ?? '-');
        setText('buffer-threshold', state.alert?.label ?? '-');
        setText('depletion-exclusive', forecast.depletionDate ?? '-');
        setText('depletion-inclusive', forecast.depletionDateWithBuffer ?? '-');
        setText('sync-status', '同期状態: ' + (state.syncStatus?.status ?? 'idle'));
      }
      window.addEventListener('message', (event) => {
        const { type, payload } = event.data || {};
        if (type === 'dashboard:init' || type === 'dashboard:update') {
          byId('error-banner').style.display = 'none';
          render(payload);
        }
        if (type === 'dashboard:error') {
          const banner = byId('error-banner');
          banner.textContent = payload?.message ?? 'Unknown error';
          banner.style.display = 'block';
        }
      });
    </script>
  </body>
</html>`;
  }
}
