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
    // repères 1J / 1S / 1M : où était l'indice il y a un jour, une semaine, un mois
    const marks = {};
    [['1d', '1J'], ['1w', '1S'], ['1m', '1M']].forEach(([k, txt]) => {
      const gm = el('g', { class: `risk-mark risk-mark--${k}`, visibility: 'hidden' }, svg);
      const ln = el('line', { x1: 0, y1: 0, x2: 0, y2: 0, class: 'risk-mark-line' }, gm);
      const t = el('text', { x: 0, y: 0, class: 'risk-mark-txt', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, gm);
      t.textContent = txt;
      marks[k] = { gm, t, ln };
    });
    const needle = el('g', { class: 'risk-needle' }, svg);
    el('line', { x1: CX, y1: CY, x2: CX + R_IN - 8, y2: CY, class: 'risk-needle-line' }, needle);
    el('circle', { cx: CX, cy: CY, r: 9, class: 'risk-hub' }, svg);
    const val = el('text', { x: CX, y: CY + 52, class: 'risk-value', 'text-anchor': 'middle' }, svg);
    const lab = el('text', { x: CX, y: CY + 78, class: 'risk-label', 'text-anchor': 'middle' }, svg);
    const sub = el('text', { x: CX, y: CY + 100, class: 'risk-sub', 'text-anchor': 'middle' }, svg);
    return { svg, segs, needle, val, lab, sub, marks };
  }

  /* ---------- graphique de l'historique : Semaine / Mois / Trimestre / Année (clic droit : 1 à 20 ans) ---------- */
  const H_LOW = 30; const H_HIGH = 70;
  const YEAR_CHOICES = [1, 3, 5];
  const TFS = [['w', 'Semaine', 7], ['m', 'Mois', 30], ['q', 'Trimestre', 91], ['y', 'Année', 365]];
  const LS_KEY = 'fxt-risk-range';
  let histRow = null; let histLast = null; let histLongLoading = false;
  let rng = { tf: 'm', years: 1 };
  try { const sv = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (sv && TFS.some((t) => t[0] === sv.tf)) rng = { tf: sv.tf, years: YEAR_CHOICES.includes(sv.years) ? sv.years : 1 }; } catch (e) { /* pas de stockage */ }
  const saveRng = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(rng)); } catch (e) { /* ignore */ } };
  const dFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short' });
  const mFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', month: 'short', year: '2-digit' });
  const dtFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  const dyFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', year: 'numeric' });
  const rangeDays = () => (rng.tf === 'y' ? rng.years * 365 : TFS.find((t) => t[0] === rng.tf)[2]);
  const tfLabel = (t) => (t[0] === 'y' ? (rng.tf === 'y' && rng.years > 1 ? `${rng.years} ans` : 'Année') : t[1]);

  function renderHistory(row, v) {
    if (row) { histRow = row; histLast = v; } else { row = histRow; v = histLast; }
    const box = wrap && wrap.querySelector('.risk-hist-box');
    if (!box || !row) return;
    updateTfButtons();
    const now = Date.now() / 1000;
    const days = rangeDays();
    const useLong = days > 95 && Array.isArray(row.history_long) && row.history_long.length > 20;
    const src = useLong ? row.history_long : (Array.isArray(row.history) ? row.history : []);
    let pts = src.filter((p) => p[0] >= now - days * 86400 - 86400).map((p) => [p[0], Number(p[1])]);
    if (!pts.length || now - pts[pts.length - 1][0] > 3600) pts.push([now, v]); else pts[pts.length - 1] = [pts[pts.length - 1][0], v];
    if (pts.length < 2) { box.innerHTML = '<p class="risk-hist-empty">Historique en cours de collecte…</p>'; return; }
    // si CNN ne remonte pas assez loin, l'axe commence au premier point disponible
    const t0 = Math.max(now - days * 86400, pts[0][0]);
    const span = (now - t0) / 86400;
    const note = wrap.querySelector('.risk-hist-note');
    if (note) note.textContent = (days > 95 && span < days * 0.93) ? `Données CNN disponibles depuis ${dyFmt.format(new Date(t0 * 1000))}` : '';
    const W = Math.max(320, Math.round(box.clientWidth || 800)); const Ht = Math.max(220, Math.round(box.clientHeight || 360));
    const m = { l: 14, r: 46, t: 16, b: 28 };
    const X = (t) => m.l + ((t - t0) / (now - t0)) * (W - m.l - m.r);
    const Y = (val) => m.t + (1 - val / 100) * (Ht - m.t - m.b);
    const svg = el('svg', { viewBox: `0 0 ${W} ${Ht}`, width: W, height: Ht, class: 'risk-hist-svg', role: 'img', 'aria-label': 'Historique du risque' });
    const x0 = m.l; const x1 = W - m.r;
    el('rect', { x: x0, y: Y(100), width: x1 - x0, height: Y(H_HIGH) - Y(100), class: 'risk-hz risk-hz--on' }, svg);
    el('rect', { x: x0, y: Y(H_HIGH), width: x1 - x0, height: Y(H_LOW) - Y(H_HIGH), class: 'risk-hz risk-hz--mid' }, svg);
    el('rect', { x: x0, y: Y(H_LOW), width: x1 - x0, height: Y(0) - Y(H_LOW), class: 'risk-hz risk-hz--off' }, svg);
    [H_LOW, 50, H_HIGH].forEach((lv) => el('line', { x1: x0, x2: x1, y1: Y(lv), y2: Y(lv), class: lv === 50 ? 'risk-hline risk-hline--mid' : 'risk-hline' }, svg));
    [0, H_LOW, 50, H_HIGH, 100].forEach((lv) => {
      const t = el('text', { x: x1 + 8, y: Y(lv), class: 'risk-haxis', 'dominant-baseline': 'middle' }, svg);
      t.textContent = String(lv);
    });
    // graduations de temps : pas choisi selon la durée affichée
    const maxTicks = Math.max(3, Math.floor((x1 - x0) / 90));
    const step = [1, 2, 7, 14, 30, 61, 91, 182, 365, 730, 1825].find((st) => span / st <= maxTicks) || 1825;
    for (let d = 0; d <= span + 0.5; d += step) {
      const tt = now - d * 86400; const x = X(tt);
      if (x < x0 - 1) break;
      el('line', { x1: x, x2: x, y1: m.t, y2: Ht - m.b, class: 'risk-hvline' }, svg);
      const t = el('text', { x, y: Ht - 8, class: 'risk-haxis', 'text-anchor': x < x0 + 26 ? 'start' : 'middle' }, svg);
      t.textContent = d === 0 ? 'Auj.' : (step >= 61 ? mFmt : dFmt).format(new Date(tt * 1000));
    }
    el('polyline', { points: pts.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' '), class: 'risk-hline-data' }, svg);
    // repères 1J / 1S / 1M sur la courbe (si la période les contient)
    [['1d', 1, '1J'], ['1w', 7, '1S'], ['1m', 30, '1M']].forEach(([k, dd, txt]) => {
      const tt = now - dd * 86400;
      if (tt < t0 || days > 95) return;
      let best = pts[0]; pts.forEach((p) => { if (Math.abs(p[0] - tt) < Math.abs(best[0] - tt)) best = p; });
      const x = X(tt); const y = Y(best[1]);
      el('circle', { cx: x, cy: y, r: 5, class: `risk-hdot risk-hdot--${k}` }, svg);
      const t = el('text', { x, y: y - 11, class: `risk-hdot-txt risk-hdot-txt--${k}`, 'text-anchor': 'middle' }, svg);
      t.textContent = txt;
    });
    const last = pts[pts.length - 1];
    el('circle', { cx: X(last[0]), cy: Y(last[1]), r: 5, class: 'risk-hlast' }, svg);
    const vt = el('text', { x: X(last[0]) + 4, y: Y(last[1]) + 20, class: 'risk-hlast-txt', 'text-anchor': 'end' }, svg);
    vt.textContent = String(Math.round(last[1]));
    // survol : valeur et date
    const cross = el('line', { y1: m.t, y2: Ht - m.b, class: 'risk-hcross', visibility: 'hidden' }, svg);
    const dot = el('circle', { r: 4, class: 'risk-hlast', visibility: 'hidden' }, svg);
    const tip = document.createElement('div'); tip.className = 'risk-htip'; tip.hidden = true;
    const ov = el('rect', { x: x0, y: m.t, width: x1 - x0, height: Ht - m.t - m.b, fill: 'transparent' }, svg);
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const tt = t0 + ((px - m.l) / (x1 - x0)) * (now - t0);
      let best = pts[0]; pts.forEach((p) => { if (Math.abs(p[0] - tt) < Math.abs(best[0] - tt)) best = p; });
      const x = X(best[0]); const y = Y(best[1]);
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('visibility', 'visible');
      tip.hidden = false; tip.textContent = `${(useLong ? dyFmt : dtFmt).format(new Date(best[0] * 1000))} · ${Math.round(best[1] * 10) / 10}`;
      tip.style.left = Math.max(4, Math.min(r.width - 170, (x / W) * r.width - 70)) + 'px';
    };
    ov.addEventListener('pointermove', move);
    ov.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hidden = true; });
    box.innerHTML = '';
    box.appendChild(svg); box.appendChild(tip);
  }

  /* boutons de période (même design que la case « session » de la barre du haut) */
  let tfMenu = null;
  function closeMenu() { if (tfMenu) { tfMenu.remove(); tfMenu = null; } }
  function updateTfButtons() {
    if (!wrap) return;
    wrap.querySelectorAll('.risk-tf').forEach((b) => {
      const t = TFS.find((x) => x[0] === b.dataset.tf);
      b.textContent = tfLabel(t);
      b.classList.toggle('is-on', b.dataset.tf === rng.tf);
    });
  }
  function setRange(tf, years) {
    rng.tf = tf; if (years) rng.years = years;
    saveRng(); renderHistory();
    if (rangeDays() > 95) ensureLong();
  }
  // l'historique long (plusieurs années) n'est chargé qu'à la demande
  async function ensureLong() {
    if (!histRow || histRow.history_long || histLongLoading || !window.Auth) return;
    const client = window.Auth.getClient(); if (!client) return;
    histLongLoading = true;
    try {
      const { data } = await client.from('risk_sentiment').select('history_long').eq('id', 'composite').maybeSingle();
      if (data && Array.isArray(data.history_long)) { histRow.history_long = data.history_long; renderHistory(); }
    } catch (e) { console.warn('risk.js long', e); } finally { histLongLoading = false; }
  }
  function openYearMenu(btn, ev) {
    ev.preventDefault(); closeMenu();
    tfMenu = document.createElement('div'); tfMenu.className = 'risk-tf-menu';
    YEAR_CHOICES.forEach((n) => {
      const it = document.createElement('button'); it.type = 'button'; it.className = 'risk-tf-item' + (rng.tf === 'y' && rng.years === n ? ' is-on' : '');
      it.textContent = n === 1 ? '1 an' : `${n} ans`;
      it.addEventListener('click', () => { closeMenu(); setRange('y', n); });
      tfMenu.appendChild(it);
    });
    const hist = btn.closest('.risk-hist'); hist.appendChild(tfMenu);
    const hr = hist.getBoundingClientRect(); const br = btn.getBoundingClientRect();
    tfMenu.style.top = (br.bottom - hr.top + 4) + 'px';
    tfMenu.style.left = Math.max(4, br.right - hr.left - tfMenu.offsetWidth) + 'px';
  }
  document.addEventListener('pointerdown', (e) => { if (tfMenu && !tfMenu.contains(e.target)) closeMenu(); });
  window.addEventListener('resize', () => { const p = document.getElementById(GAUGE_PANEL_ID); if (p && !p.hidden && histRow) renderHistory(); });

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
    const d = row.score_1d; const w = row.score_1w; const m = row.score_1m;
    g.sub.textContent = `1J ${arrow(v, d)} ${d ?? '–'}   ·   1S ${arrow(v, w)} ${w ?? '–'}   ·   1M ${arrow(v, m)} ${m ?? '–'}`;
    [['1d', d], ['1w', w], ['1m', m]].forEach(([k, val]) => {
      const mk = g.marks[k];
      if (val == null || !isFinite(Number(val))) { mk.gm.setAttribute('visibility', 'hidden'); return; }
      const a = angleFor(Number(val));
      mk.gm.setAttribute('visibility', 'visible');
      const [x1, y1] = pt(a, R_IN - 7); const [x2, y2] = pt(a, R_OUT + 5);
      mk.ln.setAttribute('x1', x1); mk.ln.setAttribute('y1', y1); mk.ln.setAttribute('x2', x2); mk.ln.setAttribute('y2', y2);
      const [tx, ty] = pt(a, R_IN - 22); // étiquette à l'intérieur de l'anneau
      mk.t.setAttribute('x', tx); mk.t.setAttribute('y', ty);
    });
    renderHistory(row, v);
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
        <div class="risk-hist"><div class="risk-hist-head"><div class="risk-hist-title">Historique du risque <span class="risk-hist-key"><i class="risk-k risk-k--off"></i>&lt; 30 peur <i class="risk-k risk-k--mid"></i>30–70 neutre <i class="risk-k risk-k--on"></i>&gt; 70 avidité</span><span class="risk-hist-note"></span></div><div class="risk-tfs">${TFS.map((t) => `<button type="button" class="risk-tf risk-tf--${t[0]}" data-tf="${t[0]}">${t[1]}</button>`).join('')}</div></div><div class="risk-hist-box"></div></div>
        <div class="risk-info"></div>`;
      g = buildGauge();
      wrap.querySelector('.risk-gauge').appendChild(g.svg);
      g.val.textContent = '–';
      wrap.querySelectorAll('.risk-tf').forEach((b) => {
        b.addEventListener('click', () => { closeMenu(); setRange(b.dataset.tf); });
        if (b.dataset.tf === 'y') b.addEventListener('contextmenu', (ev) => openYearMenu(b, ev));
      });
      updateTfButtons();
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
        .select('score, score_1d, score_1w, score_1m, components, rating, source, history').eq('id', 'composite').maybeSingle();
      if (error) throw error;
      if (data) { if (histRow && histRow.history_long) data.history_long = histRow.history_long; setScore(data); if (rangeDays() > 95) ensureLong(); }
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
