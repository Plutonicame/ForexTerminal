'use strict';

/**
 * risk.js
 * Onglet « Événements secondaires » (haut de page) :
 *   1) cadran d'appétit pour le risque (0 = risk-off, 100 = risk-on), lu dans la table risk_sentiment
 *      (calculée par l'edge function risk-bot) ;
 *   2) en dessous, grand graphique TradingView du VIX en H1.
 */
(function () {
  const PANEL_ID = 'tab-2';
  const NS = 'http://www.w3.org/2000/svg';
  const CX = 200; const CY = 190; const R_OUT = 150; const R_IN = 122;
  const A0 = 150; const A1 = 390; // degrés : de bas-gauche (0) à bas-droite (100), en passant par le haut
  const SEG = 40;
  let wrap = null;
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
  const zone = (v) => (v < 40 ? 'off' : v > 60 ? 'on' : 'mid');
  const label = (v) => (v < 40 ? 'RISK-OFF' : v > 60 ? 'RISK-ON' : 'NEUTRAL');

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
    const info = wrap.querySelector('.risk-info');
    if (info) {
      const parts = Array.isArray(row.components) ? row.components : [];
      info.innerHTML = parts.map((c) => `<span class="risk-chip risk-chip--${zone(c.score)}">${String(c.label).replace(/[<>&]/g, '')} <b>${Math.round(c.score)}</b></span>`).join('');
    }
  }

  function ensure() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return null;
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'risk-wrap';
      wrap.innerHTML = `
        <div class="speeches-toolbar">
          <span class="speeches-toolbar-title">Appétit pour le risque</span>
          <span class="speeches-toolbar-info">Indice composite 0–100</span>
        </div>
        <div class="risk-gauge"></div>
        <div class="risk-info"></div>
        <div class="speeches-toolbar">
          <span class="speeches-toolbar-title">VIX</span>
          <span class="speeches-toolbar-info">Graphique H1</span>
        </div>
        <div class="risk-chart"></div>`;
      g = buildGauge();
      wrap.querySelector('.risk-gauge').appendChild(g.svg);
      g.val.textContent = '–';
      panel.insertBefore(wrap, panel.firstChild);
    }
    return wrap;
  }

  // Le widget TradingView doit être créé quand l'onglet est visible (sinon sa taille est nulle).
  function mountChart() {
    const panel = document.getElementById(PANEL_ID);
    if (tvDone || !wrap || !panel || panel.hidden) return;
    tvDone = true;
    const box = wrap.querySelector('.risk-chart');
    box.innerHTML = '<div class="tradingview-widget-container" style="height:100%;width:100%"><div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div></div>';
    const s = document.createElement('script');
    s.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    s.async = true;
    const cssVar = (n, d) => { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d; } catch (e) { return d; } };
    s.text = JSON.stringify({
      backgroundColor: cssVar('--risk-chart-bg', '#131722'), gridColor: cssVar('--risk-chart-grid', '#2a2e39'),
      autosize: true, symbol: 'CBOE:VIX', interval: '60', timezone: 'Europe/Paris', theme: 'dark', style: '1', locale: 'fr',
      allow_symbol_change: true, hide_side_toolbar: true, hide_top_toolbar: false, save_image: false, calendar: false,
      support_host: 'https://www.tradingview.com',
    });
    box.firstChild.appendChild(s);
  }

  async function load() {
    if (!ensure()) return;
    mountChart();
    if (loading || !window.Auth || !window.Auth.isConfigured()) return;
    const client = window.Auth.getClient();
    if (!client) return;
    loading = true;
    try {
      if (!(await window.Auth.getSession())) return;
      const { data, error } = await client.from('risk_sentiment')
        .select('score, score_1w, score_1m, components').eq('id', 'composite').maybeSingle();
      if (error) throw error;
      if (data) setScore(data);
    } catch (e) {
      console.warn('risk.js', e);
    } finally {
      loading = false;
    }
  }

  window.Risk = { refresh: load };

  document.addEventListener('DOMContentLoaded', () => {
    ensure();
    if (window.Auth) window.Auth.onAuthStateChange((s) => { if (s) load(); });
    setInterval(() => {
      const p = document.getElementById(PANEL_ID);
      if (!document.hidden && p && !p.hidden) load();
    }, 5 * 60 * 1000);
  });
})();
