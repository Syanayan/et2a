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
    if (this.panel) {
      return this.panel;
    }
    this.panel = this.vscode.window.createWebviewPanel(
      'kousu.dashboard',
      'Kousu Dashboard',
      {},
      { enableScripts: true }
    );
    this.panel.webview.html = this.renderHtml();
    this.post('dashboard:init', this.state);
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

  close() {
    if (this.panel?.dispose) {
      this.panel.dispose();
    }
    this.panel = null;
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
      const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
      const setText = (id, value) => { const el = byId(id); if (el) el.textContent = value ?? '-'; };
      function pointsFromSeries(series = [], width = 640, height = 220, maxY = 1) {
        if (!Array.isArray(series) || series.length === 0) return '';
        const stepX = series.length > 1 ? width / (series.length - 1) : width / 2;
        return series
          .map((value, index) => {
            const x = Math.round(index * stepX);
            const y = Math.round(height - (Math.max(0, Number(value) || 0) / maxY) * (height - 20) - 10);
            return x + ',' + y;
          })
          .join(' ');
      }
      function drawBurndown(state = {}) {
        const svg = byId('burndown-chart');
        if (!svg) return;
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        const rows = Array.isArray(state.burndown) ? state.burndown : [];
        if (rows.length === 0) return;
        const actualSeries = rows.map((row) => Number(row.actual ?? row.actualEffort ?? 0));
        const predictedSeries = rows.map((row) => Number(row.predicted ?? row.predictedTotalEffort ?? row.actual ?? 0));
        const maxY = Math.max(1, ...actualSeries, ...predictedSeries);
        const actualLine = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        actualLine.setAttribute('fill', 'none');
        actualLine.setAttribute('stroke', '#007acc');
        actualLine.setAttribute('stroke-width', '2');
        actualLine.setAttribute('points', pointsFromSeries(actualSeries, 640, 220, maxY));
        const predictedLine = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        predictedLine.setAttribute('fill', 'none');
        predictedLine.setAttribute('stroke', '#f39c12');
        predictedLine.setAttribute('stroke-width', '2');
        predictedLine.setAttribute('stroke-dasharray', '4 4');
        predictedLine.setAttribute('points', pointsFromSeries(predictedSeries, 640, 220, maxY));
        svg.appendChild(actualLine);
        svg.appendChild(predictedLine);
      }
      function render(state = {}) {
        const kpi = state.kpi ?? {};
        const forecast = state.forecast ?? {};
        const effort = state.project?.config?.effort ?? {};
        setText('kpi-total', effort.total ?? kpi.total ?? '-');
        setText('kpi-actual', effort.actual ?? kpi.actual ?? '-');
        setText('kpi-remaining', forecast.remainingEffort ?? kpi.remainingEffort ?? '-');
        setText('kpi-finish-date', forecast.depletionDate ?? kpi.predictedEndDate ?? '-');
        setText('buffer-threshold', state.alert?.label ?? '-');
        setText('depletion-exclusive', forecast.depletionDateWithoutBuffer ?? forecast.depletionDate ?? '-');
        setText('depletion-inclusive', forecast.depletionDateWithBuffer ?? forecast.depletionDate ?? '-');
        setText('sync-status', '同期状態: ' + (state.syncStatus?.status ?? 'idle'));
        drawBurndown(state);
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
