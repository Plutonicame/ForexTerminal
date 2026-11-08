'use strict';

/**
 * seasonality.js
 * Fenêtre « Saisonnalité » : pour chacune des 8 devises (et « All » = les 8 l'une sous l'autre),
 *   1. un grand graphique : courbe de saisonnalité moyenne + courbe de l'année en cours
 *      (+ bouton « Spread » : écart entre l'année en cours et la saisonnalité) ;
 *   2. dessous, sur la même ligne : barres verticales par mois et par jour de la semaine.
 *
 * Données : table seasonality_series (robot seasonality-bot), une ligne par devise :
 * indice de force de la devise face aux 7 autres, une valeur par jour de bourse (ln x 100, donc ~ en %).
 * Tout le calcul de saisonnalité se fait ici, selon la période choisie (1, 5, 10, 15, 20 ans, Max).
 * Les années complètes seulement sont utilisées ; l'année en cours est tracée à part.
 */
(function () {
  const PANEL_ID = 'tab-seasonality';
  const WIN = 'seasonality';
  const PERIODS = [1, 5, 10, 15, 20];
  const LS_PERIOD = 'fxt-seas-period';
  const LS_SPREAD = 'fxt-seas-spread';
  const RELOAD_MS = 30 * 60 * 1000;
  const CUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]; // début de chaque mois (année de 365 jours)
  const MONTH_END = [30, 58, 89, 119, 150, 180, 211, 242, 272, 303, 333, 364];
  const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
  const MONTHS_SHORT = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
  const DAYS = { 1: 'Lun', 2: 'Mar', 3: 'Mer', 4: 'Jeu', 5: 'Ven' };

  let rawRows = {};        // devise -> { d, v }
  let prepared = {};       // devise -> { years: Map, row }
  let loaded = false;
  let failed = false;
  let loading = false;
  let loadedAt = 0;
  let period = 10;         // nombre d'années, ou 0 = Max
  let spreadOn = false;
  let toolbar = null;

  try {
    const p = localStorage.getItem(LS_PERIOD);
    if (p !== null && (p === '0' || PERIODS.includes(Number(p)))) period = Number(p);
    spreadOn = localStorage.getItem(LS_SPREAD) === '1';
  } catch (e) { /* stockage indisponible */ }

  const cssVar = (n, d) => { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d; } catch (e) { return d; } };
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = (v, d = 2) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d) + ' %';
  const nice = (range, target) => {
    const raw = range / target;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / pow;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow;
  };
  const gridDate = (g) => new Date(Date.UTC(2001, 0, 1 + g)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });

  function gridOf(dt) {
    const m = dt.getUTCMonth();
    const d = dt.getUTCDate();
    if (m === 1 && d === 29) return 58;
    return CUM[m] + d - 1;
  }

  /* ---------------- Préparation des données ---------------- */
  function prepare(row) {
    const years = new Map();
    let prevLast = null;
    let cur = null;
    let curYear = null;
    for (let i = 0; i < row.d.length; i++) {
      const dt = new Date(row.d[i] * 86400000);
      const y = dt.getUTCFullYear();
      if (y !== curYear) {
        if (cur) prevLast = cur.lastV;
        curYear = y;
        cur = { year: y, base: prevLast, pts: [], lastV: null, lastG: 0 };
        years.set(y, cur);
      }
      const g = gridOf(dt);
      cur.pts.push([g, row.v[i]]);
      cur.lastV = row.v[i];
      cur.lastG = g;
    }
    return { years, row };
  }

  // Courbe cumulée de l'année (en %, 0 au 1er janvier), 365 jours ; NaN après la dernière donnée si l'année est en cours.
  function curveOf(yr, partial) {
    const a = new Float64Array(365).fill(NaN);
    yr.pts.forEach(([g, v]) => { a[g] = v - yr.base; });
    let last = 0;
    for (let g = 0; g < 365; g++) { if (!Number.isNaN(a[g])) last = a[g]; else a[g] = last; }
    if (partial) for (let g = yr.lastG + 1; g < 365; g++) a[g] = NaN;
    return a;
  }

  function thisYearOf(p) {
    const ys = [...p.years.keys()];
    return ys[ys.length - 1];
  }
  function completeYears(p) {
    const cy = thisYearOf(p);
    return [...p.years.values()].filter((y) => y.base !== null && y.year < cy).map((y) => y.year);
  }
  function windowYears(p) {
    const all = completeYears(p);
    return period === 0 ? all : all.slice(-period);
  }

  function compute(code) {
    const p = prepared[code];
    if (!p) return null;
    const ys = windowYears(p);
    if (!ys.length) return null;
    const curves = ys.map((y) => curveOf(p.years.get(y), false));
    const seasonal = new Float64Array(365);
    for (let g = 0; g < 365; g++) seasonal[g] = curves.reduce((s, c) => s + c[g], 0) / curves.length;

    // mois
    const months = MONTHS.map((_, m) => {
      const rets = curves.map((c) => c[MONTH_END[m]] - (m === 0 ? 0 : c[MONTH_END[m - 1]]));
      return { avg: rets.reduce((s, x) => s + x, 0) / rets.length, pos: rets.filter((x) => x > 0).length, n: rets.length };
    });

    // jours de la semaine
    const set = new Set(ys);
    const sums = [0, 0, 0, 0, 0, 0, 0]; const cnt = [0, 0, 0, 0, 0, 0, 0]; const pos = [0, 0, 0, 0, 0, 0, 0];
    const d = p.row.d; const v = p.row.v;
    for (let i = 1; i < d.length; i++) {
      const dt = new Date(d[i] * 86400000);
      if (!set.has(dt.getUTCFullYear())) continue;
      const wd = dt.getUTCDay();
      if (wd < 1 || wd > 5) continue;
      const r = v[i] - v[i - 1];
      sums[wd] += r; cnt[wd] += 1; if (r > 0) pos[wd] += 1;
    }
    const days = [1, 2, 3, 4, 5].map((wd) => ({ avg: cnt[wd] ? sums[wd] / cnt[wd] : 0, pos: pos[wd], n: cnt[wd] }));

    // année en cours
    const cy = thisYearOf(p);
    const cyr = p.years.get(cy);
    const current = cyr && cyr.base !== null ? curveOf(cyr, true) : null;
    return { ys, seasonal, months, days, current, curYear: cy, todayG: cyr ? cyr.lastG : -1 };
  }

  /* ---------------- Graphiques (SVG en texte) ---------------- */
  function mainChart(code, r, W) {
    const H = W < 560 ? 280 : 360;
    const m = { l: 52, r: 14, t: 14, b: 26 };
    const pw = W - m.l - m.r; const ph = H - m.t - m.b;
    let lo = 0; let hi = 0;
    for (let g = 0; g < 365; g++) {
      lo = Math.min(lo, r.seasonal[g]); hi = Math.max(hi, r.seasonal[g]);
      if (r.current && !Number.isNaN(r.current[g])) { lo = Math.min(lo, r.current[g]); hi = Math.max(hi, r.current[g]); }
    }
    if (hi - lo < 0.2) { hi = Math.max(hi, 0.1); lo = Math.min(lo, -0.1); }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const step = nice(hi - lo, 6);
    const y0 = Math.floor(lo / step) * step; const y1 = Math.ceil(hi / step) * step;
    const X = (g) => m.l + (g / 364) * pw;
    const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * ph;
    const grid = cssVar('--seas-grid', '#2a2a2a'); const txt = cssVar('--seas-text', '#9a9a9a');
    let s = '';
    for (let v = y0; v <= y1 + step / 2; v += step) {
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="${grid}" stroke-width="1"/>`;
      s += `<text x="${m.l - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" fill="${txt}" font-size="11" font-family="var(--mono)">${v.toFixed(step < 0.01 ? 3 : step < 0.1 ? 2 : 1)}%</text>`;
    }
    const narrow = W < 560; // téléphone : étiquettes de 3 lettres, plus petites, pour ne pas se chevaucher
    MONTHS.forEach((lab, i) => {
      const x = X(CUM[i]);
      s += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${m.t}" y2="${H - m.b}" stroke="${grid}" stroke-width="1" stroke-dasharray="2 4"/>`;
      s += `<text x="${(x + 2).toFixed(1)}" y="${H - 9}" fill="${txt}" font-size="${narrow ? 8.5 : 11}" font-family="var(--mono)">${narrow ? MONTHS_SHORT[i] : lab}</text>`;
    });
    if (y0 <= 0 && y1 >= 0) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="${cssVar('--seas-zero', '#e6e6e6')}" stroke-width="1" stroke-dasharray="5 4" opacity="0.7"/>`;
    const path = (arr, to) => { let d = ''; for (let g = 0; g <= to; g++) { if (Number.isNaN(arr[g])) break; d += `${g ? 'L' : 'M'}${X(g).toFixed(1)} ${Y(arr[g]).toFixed(1)}`; } return d; };
    s += `<path d="${path(r.seasonal, 364)}" fill="none" stroke="${cssVar('--seas-line-season', '#4d94ff')}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (r.current) s += `<path d="${path(r.current, 364)}" fill="none" stroke="${cssVar('--seas-line-current', '#f5a623')}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (r.current && r.todayG >= 0) {
      s += `<line x1="${X(r.todayG).toFixed(1)}" x2="${X(r.todayG).toFixed(1)}" y1="${m.t}" y2="${H - m.b}" stroke="${cssVar('--seas-today', '#8a8a8a')}" stroke-width="1" stroke-dasharray="3 3"/>`;
    }
    s += '<line class="seas-cross" y1="' + m.t + '" y2="' + (H - m.b) + `" stroke="${txt}" stroke-width="1" opacity="0"/>`;
    s += `<rect class="seas-hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent"/>`;
    return { svg: `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Saisonnalité ${code}">${s}</svg>`, m, pw, W };
  }

  function spreadChart(r, W) {
    const H = 150;
    const m = { l: 52, r: 14, t: 10, b: 22 };
    const pw = W - m.l - m.r; const ph = H - m.t - m.b;
    if (!r.current || r.todayG < 0) return '';
    const diffs = []; let maxAbs = 0.05;
    for (let g = 0; g <= r.todayG; g++) { const d = r.current[g] - r.seasonal[g]; diffs.push(d); maxAbs = Math.max(maxAbs, Math.abs(d)); }
    const step = nice(maxAbs * 2, 4);
    const lim = Math.ceil(maxAbs / step) * step;
    const X = (g) => m.l + (g / 364) * pw;
    const Y = (v) => m.t + (1 - (v + lim) / (2 * lim)) * ph;
    const grid = cssVar('--seas-grid', '#2a2a2a'); const txt = cssVar('--seas-text', '#9a9a9a');
    let s = '';
    for (let v = -lim; v <= lim + step / 2; v += step) {
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="${Math.abs(v) < 1e-9 ? cssVar('--seas-zero', '#e6e6e6') : grid}" stroke-width="1" ${Math.abs(v) < 1e-9 ? 'stroke-dasharray="5 4" opacity="0.7"' : ''}/>`;
      s += `<text x="${m.l - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" fill="${txt}" font-size="10" font-family="var(--mono)">${v.toFixed(step < 0.01 ? 3 : step < 0.1 ? 2 : 1)}%</text>`;
    }
    const narrow = W < 560;
    MONTHS.forEach((lab, i) => { s += `<text x="${(X(CUM[i]) + 2).toFixed(1)}" y="${H - 7}" fill="${txt}" font-size="${narrow ? 8.5 : 10}" font-family="var(--mono)">${narrow ? MONTHS_SHORT[i] : lab}</text>`; });
    const bw = Math.max(1, pw / 365);
    const up = cssVar('--seas-pos', '#2ecc71'); const down = cssVar('--seas-neg', '#fe1111');
    diffs.forEach((d, g) => {
      const y = Y(Math.max(0, d)); const h = Math.max(0.5, Math.abs(Y(d) - Y(0)));
      s += `<rect x="${(X(g) - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${d >= 0 ? up : down}"><title>${esc(gridDate(g))} : ${esc(fmt(d))}</title></rect>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Écart entre l'année en cours et la saisonnalité">${s}</svg>`;
  }

  function barsChart(items, W, label) {
    const H = 230;
    const m = { l: 48, r: 10, t: 18, b: 26 };
    const pw = W - m.l - m.r; const ph = H - m.t - m.b;
    let hi = 0; let lo = 0;
    items.forEach((it) => { hi = Math.max(hi, it.avg); lo = Math.min(lo, it.avg); });
    if (hi - lo < 0.1) { hi = Math.max(hi, 0.05); lo = Math.min(lo, -0.05); }
    const pad = (hi - lo) * 0.18; hi += pad; lo -= pad;
    const step = nice(hi - lo, 5);
    const y0 = Math.floor(lo / step) * step; const y1 = Math.ceil(hi / step) * step;
    const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * ph;
    const grid = cssVar('--seas-grid', '#2a2a2a'); const txt = cssVar('--seas-text', '#9a9a9a');
    const up = cssVar('--seas-pos', '#2ecc71'); const down = cssVar('--seas-neg', '#fe1111');
    let s = '';
    for (let v = y0; v <= y1 + step / 2; v += step) {
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="${Math.abs(v) < 1e-9 ? cssVar('--seas-zero', '#e6e6e6') : grid}" stroke-width="1" ${Math.abs(v) < 1e-9 ? 'opacity="0.7"' : ''}/>`;
      s += `<text x="${m.l - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" fill="${txt}" font-size="10" font-family="var(--mono)">${v.toFixed(step < 0.01 ? 3 : step < 0.1 ? 2 : 1)}%</text>`;
    }
    const slot = pw / items.length; const bw = Math.min(40, slot * 0.62);
    const dec = hi - lo < 0.6 ? 3 : 2; // petites variations (barres par jour) : 3 décimales
    items.forEach((it, i) => {
      const cx = m.l + slot * (i + 0.5);
      const yv = Y(it.avg); const yz = Y(0);
      const top = Math.min(yv, yz); const h = Math.max(1, Math.abs(yv - yz));
      const tip = `${it.name} : ${fmt(it.avg)} en moyenne · positif ${it.pos}/${it.n}`;
      s += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${it.avg >= 0 ? up : down}"><title>${esc(tip)}</title></rect>`;
      const ly = it.avg >= 0 ? top - 4 : top + h + 11;
      if (slot >= 30) s += `<text x="${cx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" fill="${txt}" font-size="${slot < 40 ? 8.5 : 10}" font-family="var(--mono)">${it.avg >= 0 ? '+' : '−'}${Math.abs(it.avg).toFixed(dec)}</text>`;
      s += `<text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="${txt}" font-size="${slot < 34 ? 9 : 11}" font-family="var(--mono)">${esc(it.label)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">${s}</svg>`;
  }

  /* ---------------- Affichage d'un panneau ---------------- */
  function periodLabel(r) {
    if (!r) return '';
    const a = r.ys[0]; const b = r.ys[r.ys.length - 1];
    return r.ys.length === 1 ? `année ${a}` : `moyenne des ${r.ys.length} dernières années (${a}–${b})`;
  }

  function renderPanel(panel) {
    const code = panel.dataset.currency;
    let box = panel.querySelector('.seas');
    if (!box) {
      box = document.createElement('div');
      box.className = 'seas';
      panel.appendChild(box);
    }
    const msg = (t) => { box.innerHTML = `<p class="seas-empty">${esc(t)}</p>`; };
    if (!loaded) return msg(failed ? 'Impossible de charger les données de saisonnalité pour le moment.' : 'Chargement…');
    const r = compute(code);
    if (!r) return msg('Pas assez de données pour calculer la saisonnalité de cette devise.');

    const W = Math.floor(box.clientWidth || panel.clientWidth);
    if (W < 120) return; // panneau masqué : redessiné à l'ouverture
    const hasCur = !!r.current;
    const mc = mainChart(code, r, W);
    const sp = spreadOn && hasCur ? spreadChart(r, W) : '';
    const half = W >= 720;
    const WM = half ? Math.floor((W - 12) * 0.6) : W;
    const WD = half ? W - 12 - WM : W;
    const monthItems = r.months.map((x, i) => ({ label: MONTHS[i], name: MONTHS[i], avg: x.avg, pos: x.pos, n: x.n }));
    const dayItems = r.days.map((x, i) => ({ label: DAYS[i + 1], name: DAYS[i + 1], avg: x.avg, pos: x.pos, n: x.n }));

    box.innerHTML = `
      <div class="seas-card">
        <div class="seas-card-head">
          <h4 class="seas-card-title">${esc(code)} · saisonnalité sur l'année</h4>
          <span class="seas-card-sub">${esc(periodLabel(r))}</span>
        </div>
        <div class="seas-legend">
          <span class="seas-legend-item"><i class="seas-dot seas-dot--season"></i>Saisonnalité</span>
          ${hasCur ? `<span class="seas-legend-item"><i class="seas-dot seas-dot--current"></i>${r.curYear} (année en cours)</span>` : ''}
        </div>
        <div class="seas-main">${mc.svg}<div class="seas-tip" hidden></div></div>
        ${sp ? `<div class="seas-spread"><div class="seas-spread-title">Spread : année en cours − saisonnalité</div>${sp}</div>` : ''}
      </div>
      <div class="seas-bars">
        <div class="seas-card seas-card--bars">
          <div class="seas-card-head"><h4 class="seas-card-title">${esc(code)} · par mois</h4><span class="seas-card-sub">variation moyenne du mois</span></div>
          ${barsChart(monthItems, WM - 30, 'Saisonnalité par mois')}
        </div>
        <div class="seas-card seas-card--bars">
          <div class="seas-card-head"><h4 class="seas-card-title">${esc(code)} · par jour</h4><span class="seas-card-sub">variation moyenne du jour</span></div>
          ${barsChart(dayItems, WD - 30, 'Saisonnalité par jour de la semaine')}
        </div>
      </div>`;
    wireHover(box.querySelector('.seas-main'), r, mc);
  }

  function wireHover(host, r, mc) {
    const svg = host.querySelector('svg');
    const hit = host.querySelector('.seas-hit');
    const cross = host.querySelector('.seas-cross');
    const tip = host.querySelector('.seas-tip');
    if (!svg || !hit) return;
    const show = (ev) => {
      const rect = svg.getBoundingClientRect();
      const px = (ev.clientX - rect.left) * (mc.W / rect.width);
      const g = Math.max(0, Math.min(364, Math.round(((px - mc.m.l) / mc.pw) * 364)));
      const x = mc.m.l + (g / 364) * mc.pw;
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('opacity', 0.5);
      const sv = r.seasonal[g];
      const cv = r.current && !Number.isNaN(r.current[g]) ? r.current[g] : null;
      tip.innerHTML = `<b>${esc(gridDate(g))}</b>`
        + `<span><i style="background:var(--seas-line-season)"></i>Saisonnalité <em>${esc(fmt(sv))}</em></span>`
        + (cv !== null ? `<span><i style="background:var(--seas-line-current)"></i>${r.curYear} <em>${esc(fmt(cv))}</em></span><span>Spread <em>${esc(fmt(cv - sv))}</em></span>` : '');
      tip.hidden = false;
      const left = x * (rect.width / mc.W);
      tip.style.left = (left + 190 > host.clientWidth ? left - 190 : left + 12) + 'px';
      tip.style.top = '8px';
    };
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); tip.hidden = true; });
  }

  function renderAll() {
    document.querySelectorAll(`.currency-panel[data-win="${WIN}"]`).forEach((p) => { if (!p.hidden) renderPanel(p); });
  }

  /* ---------------- Barre d'outils (période + spread) ---------------- */
  function availableYears() {
    const p = prepared.USD || Object.values(prepared)[0];
    return p ? completeYears(p).length : 0;
  }

  function renderToolbar() {
    if (!toolbar) return;
    const n = availableYears();
    const opts = PERIODS.filter((y) => !loaded || y <= n);
    const chips = opts.map((y) => `<button type="button" class="seas-chip${period === y ? ' is-active' : ''}" data-period="${y}" aria-pressed="${period === y}">${y === 1 ? '1 an' : y + ' ans'}</button>`).join('')
      + `<button type="button" class="seas-chip${period === 0 ? ' is-active' : ''}" data-period="0" aria-pressed="${period === 0}">Max${loaded && n ? ' (' + n + ' ans)' : ''}</button>`;
    toolbar.querySelector('.seas-periods').innerHTML = chips;
    const sb = toolbar.querySelector('.seas-spread-btn');
    sb.setAttribute('aria-pressed', String(spreadOn));
    sb.classList.toggle('is-active', spreadOn);
  }

  function ensureToolbar() {
    const sec = document.getElementById(PANEL_ID);
    if (!sec || toolbar) return;
    toolbar = document.createElement('div');
    toolbar.className = 'calendar-toolbar seas-toolbar';
    toolbar.innerHTML = `
      <span class="calendar-toolbar-title">Saisonnalité</span>
      <div class="calendar-toolbar-tools">
        <span class="seas-toolbar-label">Comparer avec</span>
        <div class="seas-periods" role="group" aria-label="Période de comparaison"></div>
        <button type="button" class="seas-chip seas-spread-btn" aria-pressed="false" title="Afficher l'écart entre le cours actuel et la saisonnalité">Spread</button>
      </div>`;
    const host = sec.querySelector('.currency-panels');
    sec.insertBefore(toolbar, host);
    const note = document.createElement('p');
    note.className = 'seas-note';
    note.textContent = 'Indice de force de chaque devise face aux 7 autres (calcul maison, données Yahoo Finance). La saisonnalité est une statistique du passé : elle n\'est pas une prévision.';
    sec.insertBefore(note, host);
    toolbar.addEventListener('click', (ev) => {
      const c = ev.target.closest('[data-period]');
      if (c) {
        period = Number(c.dataset.period);
        try { localStorage.setItem(LS_PERIOD, String(period)); } catch (e) { /* ignoré */ }
        renderToolbar(); renderAll();
        return;
      }
      if (ev.target.closest('.seas-spread-btn')) {
        spreadOn = !spreadOn;
        try { localStorage.setItem(LS_SPREAD, spreadOn ? '1' : '0'); } catch (e) { /* ignoré */ }
        renderToolbar(); renderAll();
      }
    });
    renderToolbar();
  }

  /* ---------------- Lecture dans Supabase ---------------- */
  async function load(force) {
    if (loading) return;
    if (!force && loaded && Date.now() - loadedAt < RELOAD_MS) return;
    const client = window.Auth && window.Auth.getClient ? window.Auth.getClient() : null;
    if (!client) return;
    loading = true;
    try {
      if (!(await window.Auth.getSession())) return;
      const { data, error } = await client.from('seasonality_series').select('currency,d,v');
      if (error) throw error;
      rawRows = {}; prepared = {};
      (data || []).forEach((r) => { if (r.d && r.d.length > 300) { rawRows[r.currency] = r; prepared[r.currency] = prepare(r); } });
      loaded = Object.keys(prepared).length > 0;
      failed = !loaded;
      loadedAt = Date.now();
    } catch (e) {
      console.warn('seasonality.js', e);
      if (!loaded) failed = true;
    } finally {
      loading = false;
      renderToolbar();
      renderAll();
    }
  }

  window.Seasonality = {
    refresh() { ensureToolbar(); load(false).then(renderAll); renderAll(); },
  };

  document.addEventListener('DOMContentLoaded', () => {
    ensureToolbar();
    document.addEventListener('fx-currency-select', (e) => { if (e.detail && e.detail.win === WIN) { renderAll(); } });
    if (window.Auth) window.Auth.onAuthStateChange((s) => { if (s) load(true); });
    let t = null;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(renderAll, 150); });
    window.addEventListener('fx-theme-changed', () => renderAll());
    renderAll();
  });
})();
