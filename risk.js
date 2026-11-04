'use strict';

/**
 * risk.js
 *   1) Fenêtre « Sentiment du risque » : cadran d'appétit pour le risque (0 = risk-off, 100 = risk-on),
 *      lu dans la table risk_sentiment (alimentée par l'edge function risk-bot, qui relaie
 *      le CNN Fear & Greed Index : indice publié, non calculé par l'appli).
 *   2) Fenêtre « Indicator » : grand graphique TradingView du VIX.
 */
(function () {
  const GAUGE_PANEL_ID = 'tab-risk';
  const CHART_PANEL_ID = 'tab-indicator';
  const NS = 'http://www.w3.org/2000/svg';
  const CX = 200; const CY = 190; const R_OUT = 150; const R_IN = 122;
  const A0 = 150; const A1 = 390; // degrés : de bas-gauche (0) à bas-droite (100), en passant par le haut
  const SEG = 40;
  let wrap = null;
  let chartWrap = null;
  let tvDone = false;
  let loading = false;

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v));
    if (parent) parent.appendChild(e);
    return e;
  }
  const pt = (deg, r) => [CX + r * Math.cos(deg * Math.PI / 180), CY + r * Math.sin(deg * Math.PI / 180)];
  const angleFor = (v) => A0 + (A1 - A0) * Math.max(0, Math.min(100, v)) / 100;
  const zone = (v) => (v < 45 ? 'off' : v > 55 ? 'on' : 'mid');
  const label = (v) => (v < 45 ? 'RISK-OFF' : v > 55 ? 'RISK-ON' : 'NEUTRAL');

  function buildGauge() {
    const svg = el('svg', { viewBox: '0 0 400 300', class: 'risk-gauge-svg', role: 'img', 'aria-label': 'Cadran du risque' });
    const segs = [];
    for (let i = 0; i < SEG; i += 1) {
      const a = A0 + ((A1 - A0) * (i + 0.12)) / SEG; const b = A0 + ((A1 - A0) * (i + 0.88)) / SEG;
      const [x1, y1] = pt(a, R_OUT); const [x2, y2] = pt(b, R_OUT); const [x3, y3] = pt(b, R_IN); const [x4, y4] = pt(a, R_IN);
      const mid = ((i + 0.5) / SEG) * 100;
      const s = el('path', { d: `M${x1},${y1} A${R_OUT},${R_OUT} 0 0 1 ${x2},${y2} L${x3},${y3} A${R_IN},${R_IN} 0 0 0 ${x4},${y4} Z`, class: `risk-seg risk-seg--${zone(mid)}` }, svg);
      segs.push([s, mid]);
    }
    [0, 20, 40, 60, 80, 100].forEach((v) => {
      const [x, y] = pt(angleFor(v), R_OUT + 16);
      const t = el('text', { x, y, class: 'risk-tick', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, svg);
      t.textContent = String(v);
    });
    const needle = el('g', { class: 'risk-needle' }, svg);
    el('line', { x1: CX, y1: CY, x2: CX + R_IN - 8, y2: CY, class: 'risk-needle-line' }, needle);
    el('circle', { cx: CX, cy: CY, r: 9, class: 'risk-hub' }, svg);
    const val = el('text', { x: CX, y: CY + 52, class: 'risk-value', 'text-anchor': 'middle' }, svg);
    const lab = el('text', { x: CX, y: CY + 78, class: 'risk-label', 'text-anchor': 'middle' }, svg);
    const sub = el('text', { x: CX, y: CY + 100, class: 'risk-sub', 'text-anchor': 'middle' }, svg);
    return { svg, segs, needle, val, lab, sub };
  }

  let g = null;
  function setScore(row) {
    const v = Math.round(Number(row.score));
    g.needle.setAttribute('transform', `rotate(${angleFor(v)} ${CX} ${CY})`);
    g.segs.forEach(([s, mid]) => s.classList.toggle('is-lit', mid <= v));
    g.val.textContent = String(v);
    g.val.setAttribute('class', `risk-value risk-value--${zone(v)}`);
    g.lab.textContent = label(v);
    g.lab.setAttribute('class', `risk-label risk-value--${zone(v)}`);
    const arrow = (now, was) => (was == null ? '' : now > was ? '▲' : now < was ? '▼' : '■');
    const w = row.score_1w; const m = row.score_1m;
    g.sub.textContent = `1S ${arrow(v, w)} ${w ?? '–'}   ·   1M ${arrow(v, m)} ${m ?? '–'}`;
    const head = wrap.querySelector('.speeches-toolbar-info');
    if (head && row.source) head.textContent = `${row.source} · ${row.rating || ''} · 0–100`;
    const info = wrap.querySelector('.risk-info');
    if (info) {
      const parts = Array.isArray(row.components) ? row.components : [];
      info.innerHTML = parts.map((c) => `<span class="risk-chip risk-chip--${zone(c.score)}">${String(c.label).replace(/[<>&]/g, '')} <b>${Math.round(c.score)}</b></span>`).join('');
    }
  }

  function ensureGauge() {
    const panel = document.getElementById(GAUGE_PANEL_ID);
    if (!panel) return null;
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'risk-wrap';
      wrap.innerHTML = `
        <div class="speeches-toolbar">
          <span class="speeches-toolbar-title">Appétit pour le risque</span>
          <span class="speeches-toolbar-info">CNN Fear &amp; Greed Index · 0–100</span>
        </div>
        <div class="risk-gauge"></div>
        <div class="risk-info"></div>`;
      g = buildGauge();
      wrap.querySelector('.risk-gauge').appendChild(g.svg);
      g.val.textContent = '–';
      panel.appendChild(wrap);
    }
    return wrap;
  }

  function ensureChart() {
    const panel = document.getElementById(CHART_PANEL_ID);
    if (!panel) return null;
    if (!chartWrap) {
      chartWrap = document.createElement('div');
      chartWrap.className = 'risk-wrap';
      chartWrap.innerHTML = `
        <div class="speeches-toolbar">
          <span class="speeches-toolbar-title">VIX</span>
          <span class="speeches-toolbar-info">Graphique H1</span>
        </div>
        <div class="risk-chart"></div>`;
      panel.appendChild(chartWrap);
    }
    return chartWrap;
  }

  const cssVar = (n, d) => { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d; } catch (e) { return d; } };

  // Repli : widget « embed » officiel (fond et grille réglables, mais pas les bougies) si tv.js ne se charge pas.
  function mountEmbedFallback(box) {
    box.innerHTML = '<div class="tradingview-widget-container" style="height:100%;width:100%"><div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div></div>';
    const s = document.createElement('script');
    s.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    s.async = true;
    s.text = JSON.stringify({
      autosize: true, symbol: 'CAPITALCOM:VIX', interval: '120', timezone: 'Europe/Paris', theme: 'dark', style: '1', locale: 'fr',
      backgroundColor: cssVar('--risk-chart-bg', '#272727'), gridColor: 'rgba(0, 0, 0, 0)', hide_volume: true,
      allow_symbol_change: true, hide_side_toolbar: true, save_image: false, calendar: false,
      support_host: 'https://www.tradingview.com',
    });
    box.firstChild.appendChild(s);
  }

  // Widget TradingView complet (tv.js) : accepte les réglages « overrides » (bougies, fond, grille).
  function buildWidget() {
    const up = cssVar('--risk-candle-up-body', '#ffffff');
    const down = cssVar('--risk-candle-down-body', '#000000');
    const border = cssVar('--risk-candle-border', '#ffffff');
    const wick = cssVar('--risk-candle-wick', '#ffffff');
    const bg = cssVar('--risk-chart-bg', '#272727');
    const none = 'rgba(0,0,0,0)'; // aucun quadrillage
    const overrides = {
      // bougies : tout blanc, sauf le corps des baissières (noir)
      'mainSeriesProperties.candleStyle.drawBody': true,
      'mainSeriesProperties.candleStyle.drawBorder': true,
      'mainSeriesProperties.candleStyle.drawWick': true,
      'mainSeriesProperties.candleStyle.upColor': up,
      'mainSeriesProperties.candleStyle.downColor': down,
      'mainSeriesProperties.candleStyle.borderUpColor': border,
      'mainSeriesProperties.candleStyle.borderDownColor': border,
      'mainSeriesProperties.candleStyle.wickUpColor': wick,
      'mainSeriesProperties.candleStyle.wickDownColor': wick,
      // fond uni (pas de dégradé)
      'paneProperties.backgroundType': 'solid',
      'paneProperties.background': bg,
      'paneProperties.backgroundGradientStartColor': bg,
      'paneProperties.backgroundGradientEndColor': bg,
      'chartProperties.paneProperties.backgroundType': 'solid',
      'chartProperties.paneProperties.background': bg,
      'scalesProperties.backgroundColor': bg,
      // aucune grille
      'paneProperties.gridLinesMode': 'none',
      'paneProperties.gridProperties.color': none,
      'paneProperties.vertGridProperties.color': none,
      'paneProperties.horzGridProperties.color': none,
      'chartProperties.paneProperties.vertGridProperties.color': none,
      'chartProperties.paneProperties.horzGridProperties.color': none,
    };
    new window.TradingView.widget({
      container_id: 'riskChartHost',
      autosize: true,
      symbol: 'CAPITALCOM:VIX',
      interval: '120',
      timezone: 'Europe/Paris',
      theme: 'dark',
      style: '1',
      locale: 'fr',
      toolbar_bg: bg,
      enable_publishing: false,
      allow_symbol_change: true,
      hide_side_toolbar: true,
      hide_volume: true,
      save_image: false,
      disabled_features: ['create_volume_indicator_by_default'],
      overrides,
      loading_screen: { backgroundColor: bg },
    });
  }

  // Le widget doit être créé quand la fenêtre est visible (sinon sa taille est nulle).
  function mountChart() {
    const panel = document.getElementById(CHART_PANEL_ID);
    if (tvDone || !chartWrap || !panel || panel.hidden) return;
    tvDone = true;
    const box = chartWrap.querySelector('.risk-chart');
    box.innerHTML = '<div id="riskChartHost" style="height:100%;width:100%"></div>';
    const start = () => {
      try { buildWidget(); } catch (e) { console.warn('risk.js widget', e); mountEmbedFallback(box); }
    };
    if (window.TradingView && window.TradingView.widget) { start(); return; }
    const s = document.createElement('script');
    s.src = 'https://s3.tradingview.com/tv.js';
    s.async = true;
    s.onload = start;
    s.onerror = () => mountEmbedFallback(box);
    document.head.appendChild(s);
  }

  // Appelé à l'ouverture de la fenêtre « Indicator »
  function showChart() {
    if (!ensureChart()) return;
    mountChart();
  }

  async function load() {
    if (!ensureGauge()) return;
    if (loading || !window.Auth || !window.Auth.isConfigured()) return;
    const client = window.Auth.getClient();
    if (!client) return;
    loading = true;
    try {
      if (!(await window.Auth.getSession())) return;
      const { data, error } = await client.from('risk_sentiment')
        .select('score, score_1w, score_1m, components, rating, source').eq('id', 'composite').maybeSingle();
      if (error) throw error;
      if (data) setScore(data);
    } catch (e) {
      console.warn('risk.js', e);
    } finally {
      loading = false;
    }
  }

  window.Risk = { refresh: load, showChart };

  document.addEventListener('DOMContentLoaded', () => {
    ensureGauge();
    ensureChart();
    if (window.Auth) window.Auth.onAuthStateChange((s) => { if (s) load(); });
    setInterval(() => {
      const p = document.getElementById(GAUGE_PANEL_ID);
      if (!document.hidden && p && !p.hidden) load();
    }, 5 * 60 * 1000);
  });
})();
