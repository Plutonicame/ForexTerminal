'use strict';

/**
 * fxchart.js : graphique financier maison, dans le style de TradingView (thème sombre).
 *   - bougies / ligne / aire, échelle de prix à droite, échelle de temps en bas, dernier cours repéré,
 *   - curseur en croix avec étiquettes prix / date, légende O H L C qui suit le curseur,
 *   - molette = zoom sur l'axe du temps (ancré sur le curseur), glisser = déplacer, glisser sur l'échelle de prix = étirer,
 *     double-clic sur une échelle = ajustement automatique, pincement et glissé au doigt sur mobile,
 *   - unités de temps 15 min, 1 h, 4 h, 1 j, 1 sem. et raccourcis de période (1J, 5J, 1M, 3M, 6M, 1A, Tout).
 * Les bougies viennent de la table fx_index (indices des devises calculés par le robot fx-index-bot).
 * Usage : FXChart.create(element, { currency: 'USD', name: 'USD', big: true, tf: '60' })
 */
(function () {
  const TFS = [
    { k: '15', label: '15 min', src: '15m', step: 900 },
    { k: '60', label: '1 h', src: '1h', step: 3600 },
    { k: '240', label: '4 h', src: '1h', step: 14400 },
    { k: 'D', label: '1 j', src: '1d', step: 86400 },
    { k: 'W', label: '1 sem.', src: '1d', step: 604800 },
  ];
  const RANGES = [
    { l: '1J', d: 1 }, { l: '5J', d: 5 }, { l: '1M', d: 30 }, { l: '3M', d: 91 }, { l: '6M', d: 182 }, { l: '1A', d: 365 }, { l: 'Tout', d: 0 },
  ];
  const AXIS_W = 62; const AXIS_H = 26; const PAD_RIGHT_BARS = 8;
  const cssVar = (n, d) => { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d; } catch (e) { return d; } };
  const mono = () => cssVar('--mono', 'ui-monospace, Menlo, Consolas, monospace');
  const fmtTZ = (opts) => new Intl.DateTimeFormat('fr-FR', Object.assign({ timeZone: 'Europe/Paris' }, opts));
  const F = {
    hm: fmtTZ({ hour: '2-digit', minute: '2-digit', hour12: false }),
    d: fmtTZ({ day: 'numeric' }),
    mo: fmtTZ({ month: 'short' }),
    y: fmtTZ({ year: 'numeric' }),
    full: fmtTZ({ weekday: 'short', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }),
    fullD: fmtTZ({ weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' }),
    dm: fmtTZ({ day: 'numeric', month: 'short' }),
    md: fmtTZ({ month: 'short', year: '2-digit' }),
  };
  const parisDay = (t) => F.d.format(new Date(t * 1000)) + '/' + F.mo.format(new Date(t * 1000));

  /* ---------- données ---------- */
  const cache = new Map(); // 'USD:1h' -> { bars, at }
  let clientP = null;
  async function client() {
    if (!window.Auth || !window.Auth.isConfigured || !window.Auth.isConfigured()) return null;
    const c = window.Auth.getClient && window.Auth.getClient();
    if (!c) return null;
    try { if (!(await window.Auth.getSession())) return null; } catch (e) { return null; }
    return c;
  }
  async function loadSrc(cur, src, force) {
    const key = cur + ':' + src;
    const hit = cache.get(key);
    if (hit && !force && Date.now() - hit.at < 20000) return hit.bars;
    const c = await client();
    if (!c) return hit ? hit.bars : null;
    const { data, error } = await c.from('fx_index').select('candles,updated_at').eq('id', key).limit(1);
    if (error || !data || !data[0]) return hit ? hit.bars : null;
    const cd = data[0].candles || {};
    const bars = (cd.t || []).map((t, i) => ({ t, o: cd.o[i], h: cd.h[i], l: cd.l[i], c: cd.c[i] }));
    cache.set(key, { bars, at: Date.now() });
    return bars;
  }
  function aggregate(bars, step, weekly) {
    const out = [];
    let cur = null; let key = null;
    for (const b of bars) {
      let k;
      if (weekly) { const d = new Date(b.t * 1000); const dow = (d.getUTCDay() + 6) % 7; k = Math.floor(b.t / 86400) - dow; } else k = Math.floor(b.t / step);
      if (k !== key) { cur = { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c }; out.push(cur); key = k; } else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; }
    }
    return out;
  }
  async function loadBars(cur, tfk, force) {
    const tf = TFS.find((x) => x.k === tfk) || TFS[1];
    const base = await loadSrc(cur, tf.src, force);
    if (!base) return null;
    if (tf.k === '240') return aggregate(base, 14400, false);
    if (tf.k === 'W') return aggregate(base, 0, true);
    return base;
  }

  /* ---------- graphique ---------- */
  function create(host, opts) {
    const o = Object.assign({ currency: 'USD', name: 'USD', big: false, tf: '60' }, opts || {});
    const st = { tf: o.tf, style: 'candles', bars: [], right: 0, bw: 8, yScale: 1, yShift: 0, auto: true, cross: null, drag: null, pointers: new Map(), w: 0, h: 0, ready: false, msg: 'Chargement…' };
    host.classList.add('fxc');
    host.innerHTML = '';
    const bar = document.createElement('div'); bar.className = 'fxc-bar';
    const main = document.createElement('div'); main.className = 'fxc-main';
    const cv = document.createElement('canvas'); cv.className = 'fxc-canvas';
    const legend = document.createElement('div'); legend.className = 'fxc-legend';
    main.append(cv, legend);
    const ranges = document.createElement('div'); ranges.className = 'fxc-ranges';
    if (o.big) host.append(bar, main, ranges); else host.append(main);
    const ctx = cv.getContext('2d');

    if (o.big) {
      bar.innerHTML = `<span class="fxc-sym">${o.name}</span><span class="fxc-sep"></span>`
        + TFS.map((t) => `<button type="button" class="fxc-btn" data-tf="${t.k}">${t.label}</button>`).join('')
        + '<span class="fxc-sep"></span>'
        + '<button type="button" class="fxc-btn" data-style="candles" title="Bougies">Bougies</button><button type="button" class="fxc-btn" data-style="line" title="Ligne">Ligne</button><button type="button" class="fxc-btn" data-style="area" title="Aire">Aire</button>'
        + '<span class="fxc-grow"></span><button type="button" class="fxc-btn" data-fs title="Plein écran">⛶</button>';
      ranges.innerHTML = RANGES.map((r) => `<button type="button" class="fxc-btn fxc-rng" data-rng="${r.d}">${r.l}</button>`).join('') + '<span class="fxc-grow"></span><span class="fxc-tz">Paris (UTC+1/+2)</span>';
    }
    const syncBtns = () => {
      bar.querySelectorAll('[data-tf]').forEach((b) => b.classList.toggle('is-active', b.dataset.tf === st.tf));
      bar.querySelectorAll('[data-style]').forEach((b) => b.classList.toggle('is-active', b.dataset.style === st.style));
    };

    /* géométrie */
    const plotW = () => Math.max(10, st.w - AXIS_W);
    const plotH = () => Math.max(10, st.h - AXIS_H);
    const xOf = (i) => plotW() - (st.right - i) * st.bw - st.bw / 2;
    const iOf = (x) => st.right - (plotW() - x - st.bw / 2) / st.bw;
    const visRange = () => {
      const n = st.bars.length;
      const a = Math.max(0, Math.floor(iOf(0)) - 1); const b = Math.min(n - 1, Math.ceil(iOf(plotW())) + 1);
      return [a, b];
    };
    function priceRange() {
      const [a, b] = visRange();
      let lo = Infinity; let hi = -Infinity;
      for (let i = a; i <= b; i++) { const k = st.bars[i]; if (!k) continue; if (st.style === 'candles') { if (k.l < lo) lo = k.l; if (k.h > hi) hi = k.h; } else { if (k.c < lo) lo = k.c; if (k.c > hi) hi = k.c; } }
      if (!isFinite(lo)) { lo = 99; hi = 101; }
      if (hi - lo < 1e-6) { hi += 0.01; lo -= 0.01; }
      const pad = (hi - lo) * 0.1;
      lo -= pad; hi += pad;
      const mid = (lo + hi) / 2; const half = ((hi - lo) / 2) * st.yScale;
      return [mid - half + st.yShift, mid + half + st.yShift];
    }
    function clampView() {
      const n = st.bars.length;
      if (!n) return;
      st.bw = Math.min(40, Math.max(1.5, st.bw));
      const maxRight = n - 1 + PAD_RIGHT_BARS;
      const minRight = Math.min(maxRight, (plotW() / st.bw) * 0.3 - 1 + 0); // garde toujours un peu de données visibles
      st.right = Math.min(maxRight, Math.max(minRight, st.right));
    }
    function fit(days) {
      const n = st.bars.length;
      if (!n) return;
      const step = (TFS.find((t) => t.k === st.tf) || TFS[1]).step;
      let cnt = days ? Math.max(20, Math.round((days * 86400) / step * (step >= 86400 ? 5 / 7 : 1))) : n;
      cnt = Math.min(n, cnt);
      st.bw = plotW() / (cnt + PAD_RIGHT_BARS);
      st.right = n - 1 + PAD_RIGHT_BARS;
      st.yScale = 1; st.yShift = 0; st.auto = true;
      clampView();
    }

    /* dessin */
    function niceTicks(lo, hi, target) {
      const span = hi - lo; const raw = span / target; const mag = Math.pow(10, Math.floor(Math.log10(raw)));
      const r = raw / mag; const step = (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * mag;
      const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
      return { out, step };
    }
    const decimals = (step) => Math.max(0, Math.min(4, Math.ceil(-Math.log10(step)) + (step < 1 ? 0 : 0)));
    function timeLabel(t, prev, tfStep) {
      if (tfStep >= 604800) return F.md.format(new Date(t * 1000));
      if (tfStep >= 86400) { const ds = new Date(t * 1000); return F.y.format(ds) !== F.y.format(new Date(prev * 1000)) ? F.y.format(ds) : (F.mo.format(ds) !== F.mo.format(new Date(prev * 1000)) ? F.mo.format(ds) : F.d.format(ds)); }
      return parisDay(t) !== parisDay(prev) ? F.d.format(new Date(t * 1000)) + ' ' + F.mo.format(new Date(t * 1000)) : F.hm.format(new Date(t * 1000));
    }
    function draw() {
      const W = st.w; const H = st.h;
      if (!W || !H) return;
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const bg = cssVar('--mw-chart-bg', '#161616'); const grid = cssVar('--mw-grid', '#2a2a2a'); const txt = cssVar('--mw-text', '#9a9a9a');
      const up = cssVar('--mw-up', '#089981'); const dn = cssVar('--mw-down', '#f23645'); const cross = cssVar('--mw-cross', '#9598a1');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      const pw = plotW(); const ph = plotH();
      if (!st.bars.length) {
        ctx.fillStyle = txt; ctx.font = '13px ' + mono(); ctx.textAlign = 'center'; ctx.fillText(st.msg, pw / 2, ph / 2); return;
      }
      const [lo, hi] = priceRange();
      const Y = (v) => ((hi - v) / (hi - lo)) * ph;
      const tf = TFS.find((t) => t.k === st.tf) || TFS[1];
      ctx.font = '11px ' + mono();
      // quadrillage + échelle de prix
      const tk = niceTicks(lo, hi, Math.max(3, Math.round(ph / 55)));
      const dec = decimals(tk.step);
      ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.fillStyle = txt; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      tk.out.forEach((v) => { const y = Math.round(Y(v)) + 0.5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(pw, y); ctx.stroke(); ctx.fillText(v.toFixed(dec), pw + 8, y); });
      // échelle de temps
      const [a, b] = visRange(); const minPx = 84;
      const every = Math.max(1, Math.ceil(minPx / st.bw));
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let i = Math.ceil(a / every) * every; i <= b; i += every) {
        const x = Math.round(xOf(i)) + 0.5; if (x < 20 || x > pw - 20) continue;
        ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ph); ctx.stroke();
        const k = st.bars[i]; if (!k) continue;
        ctx.fillStyle = txt; ctx.fillText(timeLabel(k.t, st.bars[Math.max(0, i - every)].t, tf.step), x, ph + AXIS_H / 2 + 1);
      }
      // séries
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, pw, ph); ctx.clip();
      const wick = cssVar('--mw-wick', ''); const bodyW = Math.max(1, Math.floor(st.bw * 0.7));
      if (st.style === 'candles') {
        for (let i = a; i <= b; i++) {
          const k = st.bars[i]; if (!k) continue;
          const x = Math.round(xOf(i)); const upc = k.c >= k.o; const col = upc ? up : dn;
          ctx.strokeStyle = wick || col; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x + 0.5, Y(k.h)); ctx.lineTo(x + 0.5, Y(k.l)); ctx.stroke();
          const yt = Y(Math.max(k.o, k.c)); const yb = Y(Math.min(k.o, k.c));
          ctx.fillStyle = col; ctx.fillRect(Math.round(x - bodyW / 2), Math.round(yt), bodyW, Math.max(1, Math.round(yb - yt)));
        }
      } else {
        const lineCol = cssVar('--mw-line', '#2962ff');
        ctx.beginPath();
        let first = true; let lx = 0;
        for (let i = a; i <= b; i++) { const k = st.bars[i]; if (!k) continue; const x = xOf(i); if (first) { ctx.moveTo(x, Y(k.c)); first = false; } else ctx.lineTo(x, Y(k.c)); lx = x; }
        if (st.style === 'area') {
          ctx.save(); ctx.lineTo(lx, ph); ctx.lineTo(xOf(a), ph); ctx.closePath();
          const g = ctx.createLinearGradient(0, 0, 0, ph); g.addColorStop(0, lineCol + '66'); g.addColorStop(1, lineCol + '05'); ctx.fillStyle = g; ctx.fill(); ctx.restore();
          ctx.beginPath(); first = true;
          for (let i = a; i <= b; i++) { const k = st.bars[i]; if (!k) continue; const x = xOf(i); if (first) { ctx.moveTo(x, Y(k.c)); first = false; } else ctx.lineTo(x, Y(k.c)); }
        }
        ctx.strokeStyle = lineCol; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
      }
      ctx.restore();
      // dernier cours
      const last = st.bars[st.bars.length - 1]; const lastUp = last.c >= last.o; const lc = lastUp ? up : dn;
      const ly = Math.round(Y(last.c)) + 0.5;
      if (ly >= 0 && ly <= ph) {
        ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = lc; ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(pw, ly); ctx.stroke(); ctx.restore();
        ctx.fillStyle = lc; ctx.fillRect(pw, ly - 9, AXIS_W, 18); ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(last.c.toFixed(dec + 1 > 3 ? 3 : dec + 1), pw + 8, ly);
      }
      // bordures des échelles
      ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(pw + 0.5, 0); ctx.lineTo(pw + 0.5, H); ctx.moveTo(0, ph + 0.5); ctx.lineTo(W, ph + 0.5); ctx.stroke();
      // curseur
      const cr = st.cross;
      if (cr && cr.x >= 0 && cr.x <= pw && cr.y >= 0 && cr.y <= ph) {
        const idx = Math.max(0, Math.min(st.bars.length - 1, Math.round(iOf(cr.x))));
        const cx = Math.round(xOf(idx)) + 0.5; const cy = Math.round(cr.y) + 0.5;
        ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = cross; ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, ph); ctx.moveTo(0, cy); ctx.lineTo(pw, cy); ctx.stroke(); ctx.restore();
        const lab = cssVar('--mw-label-bg', '#2a2e39'); const labT = cssVar('--mw-label-text', '#ffffff');
        const pv = hi - (cr.y / ph) * (hi - lo);
        ctx.fillStyle = lab; ctx.fillRect(pw, cy - 9, AXIS_W, 18); ctx.fillStyle = labT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(pv.toFixed(dec + 1 > 3 ? 3 : dec + 1), pw + 8, cy);
        const k = st.bars[idx];
        const tl = tf.step >= 86400 ? F.fullD.format(new Date(k.t * 1000)) : F.full.format(new Date(k.t * 1000));
        const tw = ctx.measureText(tl).width + 14; const tx = Math.max(0, Math.min(pw - tw, cx - tw / 2));
        ctx.fillStyle = lab; ctx.fillRect(tx, ph + 1, tw, AXIS_H - 2); ctx.fillStyle = labT; ctx.textAlign = 'center'; ctx.fillText(tl, tx + tw / 2, ph + AXIS_H / 2 + 1);
        setLegend(idx);
      } else setLegend(st.bars.length - 1);
    }
    function setLegend(idx) {
      const k = st.bars[idx]; if (!k) { legend.innerHTML = `<b>${o.name}</b>`; return; }
      const prev = st.bars[idx - 1]; const chg = prev ? k.c - prev.c : 0; const pct = prev ? (chg / prev.c) * 100 : 0;
      const up = cssVar('--mw-up', '#089981'); const dn = cssVar('--mw-down', '#f23645');
      const col = k.c >= k.o ? up : dn; const ccol = chg >= 0 ? up : dn;
      const tf = TFS.find((t) => t.k === st.tf) || TFS[1];
      const v = (x) => x.toFixed(3);
      legend.innerHTML = `<span class="fxc-l-name">${o.name}</span><span class="fxc-l-tf">${tf.label}</span>`
        + `<span class="fxc-l-o">O <i style="color:${col}">${v(k.o)}</i></span><span>H <i style="color:${col}">${v(k.h)}</i></span><span>L <i style="color:${col}">${v(k.l)}</i></span><span>C <i style="color:${col}">${v(k.c)}</i></span>`
        + `<span><i style="color:${ccol}">${chg >= 0 ? '+' : ''}${chg.toFixed(3)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)</i></span>`;
    }
    let raf = 0;
    const redraw = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; draw(); }); };

    /* interactions */
    const pos = (ev) => { const r = cv.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
    cv.style.touchAction = 'none';
    cv.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      if (!st.bars.length) return;
      const p = pos(ev);
      if (p.x > plotW()) { st.yScale = Math.min(20, Math.max(0.05, st.yScale * (ev.deltaY < 0 ? 0.9 : 1.1))); redraw(); return; }
      const anchor = iOf(p.x);
      st.bw = Math.min(40, Math.max(1.5, st.bw * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)));
      st.right = anchor + (plotW() - p.x - st.bw / 2) / st.bw;
      clampView(); redraw();
    }, { passive: false });
    cv.addEventListener('pointerdown', (ev) => {
      const p = pos(ev);
      st.pointers.set(ev.pointerId, p);
      try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      if (st.pointers.size === 2) { const [p1, p2] = [...st.pointers.values()]; st.drag = { pinch: true, d: Math.hypot(p1.x - p2.x, p1.y - p2.y), bw: st.bw }; return; }
      st.drag = { x: p.x, y: p.y, right: st.right, yShift: st.yShift, yScale: st.yScale, onAxis: p.x > plotW(), onTime: p.y > plotH() && p.x <= plotW(), bw: st.bw, moved: false };
    });
    cv.addEventListener('pointermove', (ev) => {
      const p = pos(ev);
      if (st.pointers.has(ev.pointerId)) st.pointers.set(ev.pointerId, p);
      const d = st.drag;
      if (d && d.pinch && st.pointers.size === 2) {
        const [p1, p2] = [...st.pointers.values()]; const nd = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        st.bw = Math.min(40, Math.max(1.5, d.bw * (nd / (d.d || 1)))); clampView(); redraw(); return;
      }
      if (d && !d.pinch) {
        const dx = p.x - d.x; const dy = p.y - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
        if (d.onAxis) { st.yScale = Math.min(20, Math.max(0.05, d.yScale * Math.exp(-dy / 200))); st.auto = false; }
        else if (d.onTime) { st.bw = Math.min(40, Math.max(1.5, d.bw * Math.exp(dx / 200))); }
        else {
          st.right = d.right - dx / st.bw;
          // le glissé vertical ne déplace pas l'échelle : elle s'ajuste seule aux bougies visibles
        }
        clampView(); st.cross = d.onAxis || d.onTime ? null : p; redraw(); return;
      }
      st.cross = p; redraw();
    });
    const up = (ev) => { st.pointers.delete(ev.pointerId); if (st.pointers.size < 2 && st.drag && st.drag.pinch) st.drag = null; if (!st.pointers.size) st.drag = null; };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse' && !st.drag) { st.cross = null; redraw(); } });
    cv.addEventListener('dblclick', (ev) => {
      const p = pos(ev);
      if (p.x > plotW()) { st.yScale = 1; st.yShift = 0; st.auto = true; } else fit(0);
      redraw();
    });
    bar.addEventListener('click', (ev) => {
      const t = ev.target.closest('button'); if (!t) return;
      if (t.dataset.tf) { st.tf = t.dataset.tf; syncBtns(); load(true, true); }
      else if (t.dataset.style) { st.style = t.dataset.style; syncBtns(); redraw(); }
      else if (t.hasAttribute('data-fs')) { const el = host; if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen(); }
    });
    ranges.addEventListener('click', (ev) => { const t = ev.target.closest('[data-rng]'); if (!t) return; fit(Number(t.dataset.rng)); redraw(); });

    const defDays = () => ({ '15': o.big ? 3 : 2, '60': o.big ? 10 : 5, '240': 30, D: 180, W: 0 }[st.tf] || 5);
    /* chargement */
    let busy = false;
    async function load(force, refit) {
      if (busy) return;
      busy = true;
      try {
        const wasEnd = st.bars.length === 0 || st.right >= st.bars.length - 1 + PAD_RIGHT_BARS - 0.5;
        const prevN = st.bars.length;
        const bars = await loadBars(o.currency, st.tf, force);
        if (!bars || bars.length < 2) { st.bars = []; st.msg = bars === null ? 'Données indisponibles (connecte-toi ou attends le robot).' : 'Pas encore de données.'; redraw(); return; }
        st.bars = bars; st.ready = true;
        if (refit || !prevN) fit(defDays());
        else if (wasEnd) st.right = bars.length - 1 + PAD_RIGHT_BARS;
        clampView(); redraw();
      } catch (e) { console.warn('fxchart', e); } finally { busy = false; }
    }
    const ro = window.ResizeObserver ? new ResizeObserver(() => {
      const r = main.getBoundingClientRect(); const w = Math.round(r.width); const h = Math.round(r.height);
      if (w === st.w && h === st.h) return;
      const first = !st.w; st.w = w; st.h = h;
      if (first && st.bars.length) fit(defDays());
      clampView(); redraw();
    }) : null;
    if (ro) ro.observe(main);
    syncBtns();
    load(false, true);
    return { reload: () => load(true, false), redraw, destroy() { if (ro) ro.disconnect(); }, el: host };
  }

  window.FXChart = { create, TFS };
})();
