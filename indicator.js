'use strict';

/**
 * indicator.js
 * Fenêtre « Indicator » : deux graphiques (dessinés en SVG, couleurs réglables dans Thèmes) au-dessus du graphique VIX.
 *   1. Force des devises : reprise de l'indicateur Pine « Macro & Currency Dashboard »
 *      (variation des 8 devises depuis l'ouverture de la semaine, dimanche 23 h heure de Paris).
 *      Données : table fx_strength (robot fx-strength-bot, Yahoo Finance).
 *   2. Courbe des taux américains : 14 échéances, de 1 mois à 30 ans.
 *      Données : table yield_curve (robot yields-bot, source U.S. Department of the Treasury).
 */
(function () {
  const PANEL_ID = 'tab-indicator';
  const FX_POLL_MS = 60 * 1000;
  const YC_POLL_MS = 10 * 60 * 1000;
  const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'CHF', 'AUD', 'NZD'];
  const TENORS = ['1 Mo', '1.5 Mo', '2 Mo', '3 Mo', '4 Mo', '6 Mo', '1 Yr', '2 Yr', '3 Yr', '5 Yr', '7 Yr', '10 Yr', '20 Yr', '30 Yr'];
  const NS = 'http://www.w3.org/2000/svg';
  const DAY = 86400;

  let fxData = null;
  let ycData = null;
  const hidden = new Set();
  let wrapFx = null;
  let wrapYc = null;
  let busyFx = false;
  let busyYc = false;

  try { JSON.parse(localStorage.getItem('fxt-indicator-hidden') || '[]').forEach((c) => hidden.add(c)); } catch (e) { /* stockage indisponible */ }
  function saveHidden() { try { localStorage.setItem('fxt-indicator-hidden', JSON.stringify([...hidden])); } catch (e) { /* ignoré */ } }

  const cssVar = (n, d) => { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d; } catch (e) { return d; } };
  function svg(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k]));
    if (parent) parent.appendChild(n);
    return n;
  }
  function el(tag, cls, html, parent) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    if (parent) parent.appendChild(n);
    return n;
  }
  function fmt(v, d) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d); }
  function niceStep(range, target) {
    const raw = range / target;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / pow;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow;
  }
  function parisTime(sec, opts) {
    return new Date(sec * 1000).toLocaleString('fr-FR', Object.assign({ timeZone: 'Europe/Paris' }, opts));
  }

  async function client() {
    if (!window.Auth || !window.Auth.isConfigured()) return null;
    const c = window.Auth.getClient();
    if (!c) return null;
    try { if (!(await window.Auth.getSession())) return null; } catch (e) { return null; }
    return c;
  }

  /* ---------------- Construction de la page ---------------- */
  function build() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || panel.querySelector('.fxs-wrap')) return;
    wrapFx = el('div', 'fxs-wrap');
    wrapFx.innerHTML = `
      <div class="speeches-toolbar">
        <span class="speeches-toolbar-title">Force des devises</span>
        <span class="speeches-toolbar-info" data-fxs-info>Depuis l'ouverture de la semaine (dimanche 23 h) · molette ou glisser pour zoomer</span>
      </div>
      <div class="fxs-legend" data-fxs-legend></div>
      <div class="fxs-chart" data-fxs-chart><p class="ind-empty">Chargement…</p></div>`;
    wrapYc = el('div', 'yc-wrap');
    wrapYc.innerHTML = `
      <div class="speeches-toolbar">
        <span class="speeches-toolbar-title">Courbe des taux américains</span>
        <span class="speeches-toolbar-info" data-yc-info>Trésor américain · de 1 mois à 30 ans</span>
      </div>
      <div class="yc-chart" data-yc-chart><p class="ind-empty">Chargement…</p></div>`;
    panel.insertBefore(wrapYc, panel.firstChild);
    panel.insertBefore(wrapFx, panel.firstChild);

    wrapFx.querySelector('[data-fxs-legend]').addEventListener('click', (event) => {
      const b = event.target.closest('[data-cur]');
      if (!b) return;
      const c = b.dataset.cur;
      if (hidden.has(c)) hidden.delete(c); else hidden.add(c);
      saveHidden();
      renderFx();
    });
    if (window.ResizeObserver) {
      let t = null;
      new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => { if (!panel.hidden) { renderFx(); renderYc(); } }, 120); }).observe(panel);
    }
  }

  /* ---------------- Force des devises ---------------- */
  function renderLegend() {
    const box = wrapFx.querySelector('[data-fxs-legend]');
    const s = fxData && fxData.series;
    const n = s && s.t ? s.t.length : 0;
    box.innerHTML = CURRENCIES.map((c) => {
      const last = n && s[c] ? s[c][n - 1] : null;
      const off = hidden.has(c);
      return `<button type="button" class="fxs-chip${off ? ' is-off' : ''}" data-cur="${c}" aria-pressed="${off ? 'false' : 'true'}" style="--chip:var(--fxs-${c.toLowerCase()})"><span class="fxs-dot"></span><span class="fxs-cur">${c}</span><span class="fxs-val">${last == null ? '' : fmt(last, 2) + '%'}</span></button>`;
    }).join('');
  }

  let fxView = null;
  function renderFx() {
    if (!wrapFx) return;
    renderLegend();
    const host = wrapFx.querySelector('[data-fxs-chart]');
    const s = fxData && fxData.series;
    if (!s || !s.t || s.t.length < 2) {
      host.innerHTML = '<p class="ind-empty">Pas encore de données cette semaine (le marché ouvre dimanche à 23 h, heure de Paris).</p>';
      return;
    }
    const W = Math.max(320, host.clientWidth || 800);
    const H = W < 560 ? 300 : 380;
    const m = { l: 52, r: 14, t: 14, b: 28 };
    const ws = Math.floor(new Date(fxData.week_start).getTime() / 1000);
    const fx0 = ws; const fx1 = ws + 5 * DAY;
    if (fxView && (fxView.ws !== ws || fxView.b - fxView.a >= fx1 - fx0 - 60)) fxView = null;
    const x0 = fxView ? fxView.a : fx0; const x1 = fxView ? fxView.b : fx1;
    // courbes rebasées : chaque devise part de 0 au bord gauche de la zone visible
    const T = s.t;
    const valAt = (arr, t) => {
      if (t <= T[0]) return arr[0];
      if (t >= T[T.length - 1]) return arr[T.length - 1];
      let a = 0; let b = T.length - 1;
      while (b - a > 1) { const mid = (a + b) >> 1; if (T[mid] <= t) a = mid; else b = mid; }
      return arr[a] + (arr[b] - arr[a]) * ((t - T[a]) / ((T[b] - T[a]) || 1));
    };
    const shown = CURRENCIES.filter((c) => !hidden.has(c) && s[c]);
    const vis = {};
    let nvis = 0;
    shown.forEach((c) => {
      const base = fxView ? valAt(s[c], x0) : 0;
      const pts = [];
      if (fxView && x0 >= T[0] && x0 <= T[T.length - 1]) pts.push([x0, 0]);
      for (let i = 0; i < T.length; i++) if (T[i] >= x0 && T[i] <= x1) pts.push([T[i], s[c][i] - base]);
      vis[c] = pts; nvis = Math.max(nvis, pts.length);
    });
    if (fxView) wrapFx.querySelectorAll('.fxs-chip').forEach((chip) => {
      const pts = vis[chip.dataset.cur]; const v = chip.querySelector('.fxs-val');
      if (pts && pts.length && v) v.textContent = fmt(pts[pts.length - 1][1], 2) + '%';
    });
    if (nvis < 2) { fxView = null; host.innerHTML = '<p class="ind-empty">Aucune donnée dans cette zone (double-clique pour tout afficher).</p>'; return; }
    let lo = 0; let hi = 0;
    shown.forEach((c) => vis[c].forEach((p) => { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }));
    if (hi - lo < 0.2) { hi = Math.max(hi, 0.1); lo = Math.min(lo, -0.1); }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const step = niceStep(hi - lo, 6);
    const y0 = Math.floor(lo / step) * step; const y1 = Math.ceil(hi / step) * step;
    const X = (t) => m.l + ((t - x0) / (x1 - x0)) * (W - m.l - m.r);
    const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);

    host.innerHTML = '';
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': 'Force des devises depuis l\'ouverture de la semaine' }, host);
    const grid = cssVar('--fxs-grid', '#2a2a2a'); const txt = cssVar('--fxs-text', '#9a9a9a'); const zero = cssVar('--fxs-zero', '#e6e6e6');
    for (let v = y0; v <= y1 + step / 2; v += step) {
      const y = Y(v);
      svg('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: grid, 'stroke-width': 1 }, root);
      const t = svg('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end', fill: txt, 'font-size': 11, 'font-family': 'var(--mono)' }, root);
      t.textContent = v.toFixed(step < 0.1 ? 2 : 1) + '%';
    }
    // repères de jours : lundi 00 h à vendredi 00 h (heure de Paris)
    for (let d = 1; d <= 5; d++) {
      const t = fx0 + 3600 + (d - 1) * DAY;
      if (t > x1) break;
      if (t < x0) continue;
      const x = X(t);
      svg('line', { x1: x, x2: x, y1: m.t, y2: H - m.b, stroke: grid, 'stroke-width': 1, 'stroke-dasharray': '2 4' }, root);
      const lab = svg('text', { x: x + 4, y: H - 9, fill: txt, 'font-size': 11, 'font-family': 'var(--mono)' }, root);
      lab.textContent = parisTime(t + 3600, { weekday: 'short' }).replace('.', '');
    }
    if (fxView) {
      const lab = svg('text', { x: W - m.r, y: m.t + 10, 'text-anchor': 'end', fill: txt, 'font-size': 10, 'font-family': 'var(--mono)' }, root);
      lab.textContent = 'Zoom · double-clic pour réinitialiser · base 0 = ' + parisTime(x0, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    }
    if (y0 <= 0 && y1 >= 0) svg('line', { x1: m.l, x2: W - m.r, y1: Y(0), y2: Y(0), stroke: zero, 'stroke-width': 1, 'stroke-dasharray': '5 4', opacity: 0.8 }, root);

    shown.forEach((c) => {
      const pts = vis[c].map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
      svg('polyline', { points: pts, fill: 'none', stroke: cssVar('--fxs-' + c.toLowerCase(), '#888'), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, root);
    });

    // survol : repère vertical + info-bulle
    const cross = svg('line', { y1: m.t, y2: H - m.b, stroke: txt, 'stroke-width': 1, opacity: 0, 'pointer-events': 'none' }, root);
    const tip = el('div', 'ind-tip', '', host);
    tip.hidden = true;
    const overlay = svg('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, root);
    const ref = shown.find((c) => vis[c].length) || shown[0];
    const P = vis[ref] || [];
    function at(ev) {
      if (drag || !P.length) return;
      const r = root.getBoundingClientRect();
      const px = (ev.clientX - r.left) * (W / r.width);
      const t = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
      let a = 0; let b = P.length - 1;
      while (b - a > 1) { const mid = (a + b) >> 1; if (P[mid][0] < t) a = mid; else b = mid; }
      const i = Math.abs(P[a][0] - t) <= Math.abs(P[b][0] - t) ? a : b;
      const x = X(P[i][0]);
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('opacity', 0.5);
      const rows = shown.map((c) => [c, vis[c][i] ? vis[c][i][1] : 0]).sort((p, q) => q[1] - p[1]);
      tip.innerHTML = `<b>${parisTime(P[i][0], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</b>` + rows.map(([c, v]) => `<span><i style="background:var(--fxs-${c.toLowerCase()})"></i>${c} <em>${fmt(v, 2)}%</em></span>`).join('');
      tip.hidden = false;
      const hw = host.clientWidth;
      const left = x * (r.width / W);
      tip.style.left = (left + 150 > hw ? left - 150 : left + 12) + 'px';
      tip.style.top = '8px';
    }
    // zoom horizontal uniquement : molette (ancrée sur le curseur) ou glisser pour sélectionner une plage ; double-clic = tout afficher
    const MINSPAN = 1800;
    const tAt = (ev) => { const r = root.getBoundingClientRect(); const px = (ev.clientX - r.left) * (W / r.width); return x0 + Math.min(1, Math.max(0, (px - m.l) / (W - m.l - m.r))) * (x1 - x0); };
    const setView = (a, b) => {
      if (b - a < MINSPAN) { const mid = (a + b) / 2; a = mid - MINSPAN / 2; b = mid + MINSPAN / 2; }
      if (a < fx0) { b += fx0 - a; a = fx0; }
      if (b > fx1) { a -= b - fx1; b = fx1; }
      a = Math.max(fx0, a);
      fxView = (b - a >= fx1 - fx0 - 60) ? null : { ws, a, b };
      renderFx();
    };
    let drag = null;
    const sel = svg('rect', { y: m.t, height: H - m.t - m.b, fill: txt, opacity: 0, 'pointer-events': 'none' }, root);
    overlay.style.touchAction = 'pan-y';
    overlay.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const t = tAt(ev);
      const k = ev.deltaY < 0 ? 0.8 : 1.25;
      setView(t - (t - x0) * k, t + (x1 - t) * k);
    }, { passive: false });
    overlay.addEventListener('dblclick', () => { fxView = null; renderFx(); });
    overlay.addEventListener('pointerdown', (ev) => {
      if (ev.button > 0) return;
      drag = { px: ev.clientX, t: tAt(ev), moved: false };
      try { overlay.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    });
    overlay.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      if (Math.abs(ev.clientX - drag.px) > 6) drag.moved = true;
      if (!drag.moved) return;
      tip.hidden = true; cross.setAttribute('opacity', 0);
      const xa = X(Math.min(drag.t, tAt(ev))); const xb = X(Math.max(drag.t, tAt(ev)));
      sel.setAttribute('x', xa); sel.setAttribute('width', Math.max(0, xb - xa)); sel.setAttribute('opacity', 0.18);
    });
    const endDrag = (ev) => {
      if (!drag) return;
      const d = drag; drag = null;
      sel.setAttribute('opacity', 0);
      if (d.moved) { const t = tAt(ev); setView(Math.min(d.t, t), Math.max(d.t, t)); }
    };
    overlay.addEventListener('pointerup', endDrag);
    overlay.addEventListener('pointercancel', () => { drag = null; sel.setAttribute('opacity', 0); });
    overlay.addEventListener('pointermove', at);
    overlay.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); tip.hidden = true; });

    const info = wrapFx.querySelector('[data-fxs-info]');
    if (info && fxData.updated_at) info.textContent = `Depuis l'ouverture de la semaine (dimanche 23 h) · mis à jour ${parisTime(Math.floor(new Date(fxData.updated_at).getTime() / 1000), { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
  }

  async function loadFx() {
    if (busyFx) return;
    busyFx = true;
    try {
      const c = await client();
      if (!c || !wrapFx) return;
      const { data, error } = await c.from('fx_strength').select('week_start,series,updated_at').eq('id', 'current').limit(1);
      if (error) throw error;
      const row = data && data[0];
      const sig = row ? row.updated_at : '';
      if (row && (!fxData || fxData.updated_at !== sig)) { fxData = row; renderFx(); } else if (!row && !fxData) renderFx();
    } catch (e) { console.warn('indicator.js fx', e); } finally { busyFx = false; }
  }

  /* ---------------- Courbe des taux ---------------- */
  function renderYc() {
    if (!wrapYc) return;
    const host = wrapYc.querySelector('[data-yc-chart]');
    const rows = ycData;
    if (!rows || !rows.length) { host.innerHTML = '<p class="ind-empty">Courbe indisponible pour le moment.</p>'; return; }
    const cur = rows[0].rates; const prev = rows[1] ? rows[1].rates : null;
    const vals = TENORS.map((t) => cur[t]).filter((v) => typeof v === 'number');
    const W = Math.max(320, host.clientWidth || 800);
    const H = W < 560 ? 260 : 300;
    const m = { l: 54, r: 10, t: 12, b: 30 };
    const mn = Math.min.apply(null, vals); const mx = Math.max.apply(null, vals);
    const step = niceStep((mx - mn) + 0.4, 6);
    const y0 = Math.floor((mn - 0.15) / step) * step; const y1 = Math.ceil((mx + 0.1) / step) * step;
    const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);
    host.innerHTML = '';
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': 'Courbe des taux du Trésor américain' }, host);
    const defs = svg('defs', {}, root);
    const g = svg('linearGradient', { id: 'ycGrad', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    svg('stop', { offset: '0%', 'stop-color': cssVar('--yc-bar-top', '#4d94ff') }, g);
    svg('stop', { offset: '100%', 'stop-color': cssVar('--yc-bar-bottom', '#0062d2') }, g);
    const grid = cssVar('--yc-grid', '#2a2a2a'); const txt = cssVar('--yc-text', '#9a9a9a');
    for (let v = y0; v <= y1 + step / 2; v += step) {
      const y = Y(v);
      svg('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: grid, 'stroke-width': 1 }, root);
      const t = svg('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end', fill: txt, 'font-size': 11, 'font-family': 'var(--mono)' }, root);
      t.textContent = v.toFixed(2) + '%';
    }
    const n = TENORS.length; const slot = (W - m.l - m.r) / n; const bw = Math.min(46, slot * 0.64);
    const tip = el('div', 'ind-tip', '', host); tip.hidden = true;
    TENORS.forEach((t, i) => {
      const v = cur[t]; if (typeof v !== 'number') return;
      const cx = m.l + slot * (i + 0.5); const y = Y(v);
      const bar = svg('rect', { x: cx - bw / 2, y, width: bw, height: Math.max(1, H - m.b - y), rx: 2, fill: 'url(#ycGrad)', class: 'yc-bar' }, root);
      const lab = svg('text', { x: cx, y: H - 10, 'text-anchor': 'middle', fill: txt, 'font-size': slot < 44 ? 9 : 11, 'font-family': 'var(--mono)' }, root);
      lab.textContent = t;
      const show = () => {
        const d = prev && typeof prev[t] === 'number' ? Math.round((v - prev[t]) * 100) : null;
        tip.innerHTML = `<b>${t}</b><span>${v.toFixed(2)}%</span>` + (d == null ? '' : `<span>Veille : ${d >= 0 ? '+' : '−'}${Math.abs(d)} pb</span>`);
        tip.hidden = false;
        const hw = host.clientWidth; const left = cx * (host.clientWidth / W);
        tip.style.left = (left + 140 > hw ? left - 140 : left + 12) + 'px'; tip.style.top = Math.max(4, y * (host.clientHeight / H) - 20) + 'px';
      };
      bar.addEventListener('pointerenter', show); bar.addEventListener('pointerdown', show);
      bar.addEventListener('pointerleave', () => { tip.hidden = true; });
    });
    const info = wrapYc.querySelector('[data-yc-info]');
    if (info) {
      const d = new Date(rows[0].obs_date + 'T12:00:00');
      info.textContent = `Trésor américain · clôture du ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} · de 1 mois à 30 ans`;
    }
  }

  async function loadYc() {
    if (busyYc) return;
    busyYc = true;
    try {
      const c = await client();
      if (!c || !wrapYc) return;
      const { data, error } = await c.from('yield_curve').select('obs_date,rates').order('obs_date', { ascending: false }).limit(2);
      if (error) throw error;
      const sig = (data || []).map((r) => r.obs_date).join('|') + JSON.stringify(data && data[0] ? data[0].rates : '');
      if (sig !== (ycData && ycData.sig)) { ycData = data || []; ycData.sig = sig; renderYc(); }
    } catch (e) { console.warn('indicator.js yc', e); } finally { busyYc = false; }
  }

  /* ---------------- Navigation ---------------- */
  function refresh(tabId) {
    if (tabId && tabId !== PANEL_ID) return;
    build();
    loadFx(); loadYc();
    setTimeout(() => { renderFx(); renderYc(); }, 60);
  }
  window.Indicator = { refresh };

  document.addEventListener('DOMContentLoaded', () => {
    build();
    if (window.Auth) window.Auth.onAuthStateChange((s) => { if (s) { loadFx(); loadYc(); } });
    const visible = () => { const p = document.getElementById(PANEL_ID); return !!p && !p.hidden && !document.hidden; };
    setInterval(() => { if (visible()) loadFx(); }, FX_POLL_MS);
    setInterval(() => { if (visible()) loadYc(); }, YC_POLL_MS);
  });
})();
