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
    if (this._messageHandler) {
      this.panel.webview.onDidReceiveMessage(this._messageHandler);
    }
    return this.panel;
  }

  onMessage(handler) {
    this._messageHandler = handler;
    if (this.panel) {
      this.panel.webview.onDidReceiveMessage(handler);
    }
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
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #1e1e2e; color: #cdd6f4; font-family: sans-serif; padding: 16px; }
    #error-banner { display:none; color:#fff; background:#a00; padding:8px; margin-bottom:12px; border-radius:4px; }
    .dashboard-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; }
    .dashboard-header h1 { font-size:1.2rem; font-weight:600; }
    .dashboard-header p { font-size:0.8rem; color:#a6adc8; margin-top:2px; }
    .header-actions { display:flex; gap:8px; }
    .header-actions button { background:#313244; color:#cdd6f4; border:none; border-radius:4px; padding:6px 12px; cursor:pointer; font-size:0.85rem; }
    .header-actions button:hover { background:#45475a; }
    #btn-settings { width:32px; font-size:1rem; }
    .kpi-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:20px; }
    .kpi-card { background:#313244; border-radius:8px; padding:14px 16px; }
    .kpi-card .kpi-label { font-size:0.75rem; color:#a6adc8; margin-bottom:6px; }
    .kpi-card .kpi-value { font-size:1.6rem; font-weight:700; }
    .kpi-card .kpi-value span { font-size:0.9rem; font-weight:400; margin-left:2px; }
    .kpi-card .kpi-sub { font-size:0.75rem; color:#a6adc8; margin-top:4px; }
    .kpi-remaining .kpi-value { color:#a6e3a1; }
    .chart-section { background:#313244; border-radius:8px; padding:16px; margin-bottom:16px; }
    .chart-section h2 { font-size:0.9rem; font-weight:600; margin-bottom:12px; color:#cdd6f4; }
    .chart-legend { display:flex; gap:16px; margin-top:8px; font-size:0.75rem; color:#a6adc8; }
    .legend-dot { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:4px; }
    svg { overflow: visible; }
  </style>
</head>
<body>
  <div id="error-banner"></div>

  <div class="dashboard-header">
    <div>
      <h1>プロジェクト全体サマリー</h1>
      <p>タスクの進捗と工数使用状況です。</p>
    </div>
    <div class="header-actions">
      <button id="btn-sync">同期</button>
      <button id="btn-report">レポート出力</button>
      <button id="btn-settings">⚙</button>
    </div>
  </div>

  <div class="kpi-grid" id="kpi-cards">
    <div class="kpi-card">
      <div class="kpi-label">総利用可能工数（月）</div>
      <div class="kpi-value"><span id="kpi-total">-</span><span>h</span></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">使用済み工数</div>
      <div class="kpi-value"><span id="kpi-actual">-</span><span>h</span></div>
      <div class="kpi-sub">消化率 <span id="kpi-actual-rate">-</span>%</div>
    </div>
    <div class="kpi-card" id="kpi-predicted-wrap" title="クリックして編集" style="cursor:pointer">
      <div class="kpi-label">最終使用予想工数 <span style="font-size:0.7rem;color:#585b70">✎</span></div>
      <div class="kpi-value"><span id="kpi-predicted">-</span><span>h</span></div>
      <div class="kpi-sub">予算比 <span id="kpi-predicted-rate">-</span>%</div>
    </div>
    <div class="kpi-card kpi-remaining">
      <div class="kpi-label">残工数（予算・予想）</div>
      <div class="kpi-value"><span id="kpi-remaining">-</span><span>h</span></div>
    </div>
  </div>

  <div class="chart-section" id="weekly-section" style="display:none">
    <h2>今週の稼働（予定 vs 実績）</h2>
    <svg id="weekly-chart" width="100%" height="180" viewBox="0 0 640 180"></svg>
    <div class="chart-legend">
      <span><span class="legend-dot" style="background:#888"></span>予定工数</span>
      <span><span class="legend-dot" style="background:#00bfff"></span>実績工数</span>
    </div>
  </div>

  <div class="chart-section">
    <h2>スプリント バーンダウン</h2>
    <svg id="burndown-chart" width="100%" height="220" viewBox="0 0 640 220"></svg>
    <div class="chart-legend">
      <span><span class="legend-dot" style="background:#c8e06b"></span>実績</span>
      <span><span class="legend-dot" style="background:#888;border-radius:0"></span>予測</span>
    </div>
  </div>

  <div class="chart-section" id="monthly-table" style="display:none">
    <h2>メンバー別月次工数</h2>
    <table id="monthly-table-body" style="width:100%;border-collapse:collapse;font-size:0.85rem;"></table>
  </div>

  <div class="chart-section" style="font-size:0.8rem;color:#a6adc8;">
    <div>バッファ閾値: <span id="buffer-threshold">-</span></div>
    <div>枯渇予測(バッファ除外): <span id="depletion-exclusive">-</span></div>
    <div>枯渇予測(バッファ込み): <span id="depletion-inclusive">-</span></div>
    <div id="sync-status">同期状態: -</div>
  </div>

  <script>
    const byId = (id) => document.getElementById(id);
    const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
    const setText = (id, value) => { const el = byId(id); if (el) el.textContent = value ?? '-'; };

    function pointsFromSeries(series = [], width = 640, height = 220, maxY = 1) {
      if (!Array.isArray(series) || series.length === 0) return '';
      const stepX = series.length > 1 ? width / (series.length - 1) : width / 2;
      return series.map((value, index) => {
        const x = Math.round(index * stepX);
        const y = Math.round(height - (Math.max(0, Number(value) || 0) / maxY) * (height - 20) - 10);
        return x + ',' + y;
      }).join(' ');
    }

    function drawBurndown(state = {}) {
      const svg = byId('burndown-chart');
      if (!svg) return;
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const rows = Array.isArray(state.burndown) ? state.burndown : [];
      if (rows.length === 0) return;
      const W = 640, H = 220;

      // 新フォーマット: { month, ideal, remaining, predicted }
      // 旧フォーマット互換: { date, actual, predicted }
      const isNewFormat = rows.some((r) => 'ideal' in r);
      const idealSeries   = rows.map((r) => Number(isNewFormat ? r.ideal : (r.predicted ?? r.actual ?? 0)));
      const remainingSeries = rows.map((r) => isNewFormat ? r.remaining : r.actual);
      const predictedSeries = rows.map((r) => isNewFormat ? r.predicted : null);

      const allValues = [
        ...idealSeries,
        ...remainingSeries.filter((v) => v != null),
        ...predictedSeries.filter((v) => v != null),
      ];
      const maxY = Math.max(1, ...allValues);

      // グリッド線
      const gridCount = 4;
      for (let i = 0; i <= gridCount; i++) {
        const y = Math.round(10 + (H - 20) * i / gridCount);
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('class', 'grid');
        line.setAttribute('x1', '0'); line.setAttribute('x2', String(W));
        line.setAttribute('y1', String(y)); line.setAttribute('y2', String(y));
        line.setAttribute('stroke', '#45475a'); line.setAttribute('stroke-width', '1');
        svg.appendChild(line);
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', '4'); label.setAttribute('y', String(y - 3));
        label.setAttribute('fill', '#a6adc8'); label.setAttribute('font-size', '10');
        label.textContent = Math.round(maxY * (1 - i / gridCount));
        svg.appendChild(label);
      }

      // X軸ラベル
      const stepX = rows.length > 1 ? W / (rows.length - 1) : W / 2;
      rows.forEach((row, i) => {
        const x = Math.round(i * stepX);
        const xLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        xLabel.setAttribute('class', 'x-label');
        xLabel.setAttribute('x', String(x)); xLabel.setAttribute('y', String(H));
        xLabel.setAttribute('fill', '#a6adc8'); xLabel.setAttribute('font-size', '10');
        xLabel.setAttribute('text-anchor', 'middle');
        const rawLabel = row.month ?? row.date ?? String(i + 1);
        xLabel.textContent = rawLabel.length >= 7 ? rawLabel.slice(5) + '月' : rawLabel;
        svg.appendChild(xLabel);
      });

      // 理想線（グレー破線）
      const idealLine = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      idealLine.setAttribute('fill', 'none');
      idealLine.setAttribute('stroke', '#888');
      idealLine.setAttribute('stroke-width', '2');
      idealLine.setAttribute('stroke-dasharray', '4 4');
      idealLine.setAttribute('points', pointsFromSeries(idealSeries, W, H, maxY));
      svg.appendChild(idealLine);

      // 予想残工数線（青破線）: predicted が null でない区間だけ描画
      const predPoints = rows.map((r, i) => ({ i, v: predictedSeries[i] })).filter((p) => p.v != null);
      if (predPoints.length >= 2) {
        const predLine = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        predLine.setAttribute('fill', 'none');
        predLine.setAttribute('stroke', '#89b4fa');
        predLine.setAttribute('stroke-width', '2');
        predLine.setAttribute('stroke-dasharray', '6 3');
        predLine.setAttribute('points', predPoints.map((p) => {
          const x = Math.round(p.i * stepX);
          const y = Math.round(H - (p.v / maxY) * (H - 20) - 10);
          return x + ',' + y;
        }).join(' '));
        svg.appendChild(predLine);
      }

      // 実績残工数線（黄緑）: remaining が null でない区間
      const remPoints = rows.map((r, i) => ({ i, v: remainingSeries[i] })).filter((p) => p.v != null);
      if (remPoints.length >= 1) {
        if (remPoints.length >= 2) {
          const remLine = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          remLine.setAttribute('fill', 'none');
          remLine.setAttribute('stroke', '#c8e06b');
          remLine.setAttribute('stroke-width', '2');
          remLine.setAttribute('points', remPoints.map((p) => {
            const x = Math.round(p.i * stepX);
            const y = Math.round(H - (p.v / maxY) * (H - 20) - 10);
            return x + ',' + y;
          }).join(' '));
          svg.appendChild(remLine);
        }
        remPoints.forEach((p) => {
          const x = Math.round(p.i * stepX);
          const y = Math.round(H - (p.v / maxY) * (H - 20) - 10);
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('cx', String(x)); circle.setAttribute('cy', String(y));
          circle.setAttribute('r', '4'); circle.setAttribute('fill', '#c8e06b');
          svg.appendChild(circle);
        });
      }
    }

    function drawWeeklyChart(state = {}) {
      const section = byId('weekly-section');
      const svg = byId('weekly-chart');
      if (!svg || !section) return;
      const rows = Array.isArray(state.weeklyEffort) ? state.weeklyEffort : [];
      if (rows.length === 0) { section.style.display = 'none'; return; }
      section.style.display = '';
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const W = 640, H = 180;
      const maxY = Math.max(1, ...rows.map((r) => Math.max(r.planned ?? 0, r.actual ?? 0)));
      const barW = Math.floor(W / rows.length * 0.35);
      const gap = Math.floor(W / rows.length * 0.05);
      rows.forEach((row, index) => {
        const centerX = Math.round(W / rows.length * (index + 0.5));
        const plannedH = Math.round((row.planned ?? 0) / maxY * (H - 30));
        const actualH = Math.round((row.actual ?? 0) / maxY * (H - 30));
        const plannedRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        plannedRect.setAttribute('x', String(centerX - barW - gap));
        plannedRect.setAttribute('y', String(H - 20 - plannedH));
        plannedRect.setAttribute('width', String(barW));
        plannedRect.setAttribute('height', String(plannedH));
        plannedRect.setAttribute('fill', '#585b70');
        svg.appendChild(plannedRect);
        const actualRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        actualRect.setAttribute('x', String(centerX + gap));
        actualRect.setAttribute('y', String(H - 20 - actualH));
        actualRect.setAttribute('width', String(barW));
        actualRect.setAttribute('height', String(actualH));
        actualRect.setAttribute('fill', '#00bfff');
        svg.appendChild(actualRect);
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('class', 'x-label');
        label.setAttribute('x', String(centerX)); label.setAttribute('y', String(H));
        label.setAttribute('fill', '#a6adc8'); label.setAttribute('font-size', '12');
        label.setAttribute('text-anchor', 'middle');
        label.textContent = row.day ?? String(index + 1);
        svg.appendChild(label);
      });
    }

    function renderMonthlyTable(state = {}) {
      const section = byId('monthly-table');
      if (!section) return;
      const bd = state.monthlyBreakdown;
      if (!bd || !bd.months || bd.months.length === 0) { section.style.display = 'none'; return; }
      section.style.display = '';
      const table = byId('monthly-table-body');
      if (!table) return;
      while (table.firstChild) table.removeChild(table.firstChild);
      const thead = document.createElement('tr');
      ['月', ...bd.members, '合計'].forEach((label, i) => {
        const th = document.createElement('th');
        th.textContent = label;
        th.style.cssText = 'padding:6px 12px;text-align:right;border-bottom:1px solid #45475a;color:#a6adc8;font-weight:600;font-size:0.8rem;';
        if (i === 0) th.style.textAlign = 'left';
        thead.appendChild(th);
      });
      table.appendChild(thead);
      bd.months.forEach((month) => {
        const tr = document.createElement('tr');
        const tdMonth = document.createElement('td');
        tdMonth.textContent = month;
        tdMonth.style.cssText = 'padding:6px 12px;color:#cdd6f4;';
        tr.appendChild(tdMonth);
        let rowTotal = 0;
        bd.members.forEach((member) => {
          const hours = bd.data[month]?.[member];
          const td = document.createElement('td');
          td.textContent = hours != null ? hours + 'h' : '-';
          td.style.cssText = 'padding:6px 12px;text-align:right;';
          tr.appendChild(td);
          if (hours != null) rowTotal += hours;
        });
        const tdTotal = document.createElement('td');
        tdTotal.textContent = rowTotal + 'h';
        tdTotal.style.cssText = 'padding:6px 12px;text-align:right;font-weight:600;';
        tr.appendChild(tdTotal);
        table.appendChild(tr);
      });
    }

    function render(state = {}) {
      const kpi = state.kpi ?? {};
      const forecast = state.forecast ?? {};
      const effort = state.project?.config?.effort ?? {};
      const total = effort.total ?? kpi.total;
      const actual = effort.actual ?? kpi.actual;
      const predicted = effort.predicted ?? forecast.predictedTotalEffort ?? kpi.predictedTotalEffort;
      const remaining = forecast.remainingEffort ?? kpi.remainingEffort
        ?? (total != null && actual != null ? Math.max(0, total - actual) : null);
      setText('kpi-total', total ?? '-');
      setText('kpi-actual', actual ?? '-');
      setText('kpi-predicted', predicted ?? '-');
      setText('kpi-remaining', remaining ?? '-');
      setText('kpi-actual-rate', (total && actual != null) ? Math.round(actual / total * 100) : '-');
      setText('kpi-predicted-rate', (total && predicted != null) ? Math.round(predicted / total * 100) : '-');
      setText('buffer-threshold', state.alert?.label ?? '-');
      setText('depletion-exclusive', forecast.depletionDateWithoutBuffer ?? forecast.depletionDate ?? '-');
      setText('depletion-inclusive', forecast.depletionDateWithBuffer ?? forecast.depletionDate ?? '-');
      setText('sync-status', '同期状態: ' + (state.syncStatus?.status ?? 'idle'));
      drawBurndown(state);
      drawWeeklyChart(state);
      renderMonthlyTable(state);
    }

    document.getElementById('btn-sync')?.addEventListener('click', () => {
      vscode?.postMessage({ type: 'action', payload: { command: 'syncTimesheet' } });
    });

    document.getElementById('kpi-predicted-wrap')?.addEventListener('click', () => {
      const wrap = byId('kpi-predicted-wrap');
      const current = byId('kpi-predicted')?.textContent ?? '';
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.value = current !== '-' ? current : '';
      input.placeholder = '予想工数(h)';
      input.style.cssText = 'width:90px;font-size:1.4rem;font-weight:700;background:#45475a;color:#cdd6f4;border:1px solid #89b4fa;border-radius:4px;padding:2px 6px;outline:none;';
      const valueDiv = wrap.querySelector('.kpi-value');
      if (!valueDiv || wrap.querySelector('input')) return;
      valueDiv.replaceChildren(input);
      input.focus();
      input.select();
      const confirm = () => {
        const val = parseFloat(input.value);
        if (Number.isFinite(val) && val >= 0) {
          vscode?.postMessage({ type: 'action', payload: { command: 'updatePredicted', value: val } });
        } else {
          setText('kpi-predicted', current);
          valueDiv.replaceChildren(byId('kpi-predicted') ?? input);
        }
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { input.blur(); }
        if (e.key === 'Escape') { setText('kpi-predicted', current); }
      });
      input.addEventListener('blur', confirm, { once: true });
    });

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
