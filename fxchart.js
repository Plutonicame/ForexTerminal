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
  // unités de temps proposées dans la barre ; n'importe quelle autre (ex. 3, 10, 90, 2H, 3D) se tape au clavier, comme dans TradingView
  const TFS = [
    { k: '1', label: '1 min' }, { k: '5', label: '5 min' }, { k: '15', label: '15 min' }, { k: '60', label: '1 h' },
    { k: '240', label: '4 h' }, { k: 'D', label: '1 j' }, { k: 'W', label: '1 sem.' },
  ];
  // 'k' : minutes (« 90 »), ou « nD », « nW », « nM » (jours, semaines, mois). Renvoie { k, minutes|days|weeks|months, label, step, src } ou null.
  function parseTf(txt) {
    const t = String(txt || '').trim();
    const m = t.match(/^(\d*)\s*([a-zA-Z]?)$/);
    if (!m || (!m[1] && !m[2])) return null;
    const n = m[1] === '' ? 1 : parseInt(m[1], 10);
    if (!(n >= 1) || n > 100000) return null;
    const u = m[2];
    let mins = null; let days = 0; let weeks = 0; let months = 0;
    if (u === '' || u === 'm') mins = n;
    else if (u === 'h' || u === 'H') mins = n * 60;
    else if (u === 'd' || u === 'D') days = n;
    else if (u === 'w' || u === 'W') weeks = n;
    else if (u === 'M') months = n;
    else return null;
    if (mins !== null && mins >= 1440 && mins % 1440 === 0) { days = mins / 1440; mins = null; }
    if (mins !== null) {
      const src = mins % 60 === 0 ? '1h' : mins % 15 === 0 ? '15m' : mins % 5 === 0 ? '5m' : '1m';
      const label = mins % 60 === 0 ? (mins / 60) + ' h' : mins + ' min';
      return { k: String(mins), mins, label, step: mins * 60, src };
    }
    if (days) return { k: days === 1 ? 'D' : days + 'D', days, label: days + ' j', step: days * 86400, src: '1d' };
    if (weeks) return { k: weeks === 1 ? 'W' : weeks + 'W', weeks, label: weeks + ' sem.', step: weeks * 604800, src: '1d' };
    return { k: months === 1 ? 'M' : months + 'M', months, label: months + ' mois', step: months * 2592000, src: '1d' };
  }
  const tfOf = (k) => parseTf(k === 'D' ? '1D' : k === 'W' ? '1W' : k === 'M' ? '1M' : k) || parseTf('60');
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
  function aggregate(bars, tf) {
    const out = [];
    let cur = null; let key = null;
    for (const b of bars) {
      let k;
      if (tf.months) { const d = new Date(b.t * 1000); k = Math.floor((d.getUTCFullYear() * 12 + d.getUTCMonth()) / tf.months); }
      else if (tf.weeks) { const d0 = Math.floor(b.t / 86400); k = Math.floor((d0 + 3) / (7 * tf.weeks)); }
      else if (tf.days) k = Math.floor(b.t / 86400 / tf.days);
      else k = Math.floor(b.t / tf.step);
      if (k !== key) { cur = { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c }; out.push(cur); key = k; } else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; }
    }
    return out;
  }
  async function loadBars(cur, tfk, force) {
    const tf = tfOf(tfk);
    const base = await loadSrc(cur, tf.src, force);
    if (!base) return null;
    const native = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '1d': 86400 }[tf.src];
    if (tf.step === native && !tf.months && !tf.weeks && !(tf.days > 1)) return base;
    return aggregate(base, tf);
  }

  /* ---------- graphique ---------- */
  const tfLabel = (k) => tfOf(k).label;
  function create(host, opts) {
    const o = Object.assign({ currency: 'USD', name: 'USD', big: false, tf: '60' }, opts || {});
    const st = { tf: o.tf, style: 'candles', bars: [], right: 0, bw: 8, auto: true, log: false, man: [0, 1], cross: null, drag: null, pointers: new Map(), w: 0, h: 0, msg: 'Chargement…' };
    host.classList.add('fxc');
    host.tabIndex = 0;
    host.innerHTML = '';
    const bar = document.createElement('div'); bar.className = 'fxc-bar';
    const main = document.createElement('div'); main.className = 'fxc-main';
    const cv = document.createElement('canvas'); cv.className = 'fxc-canvas';
    const legend = document.createElement('div'); legend.className = 'fxc-legend';
    const kb = document.createElement('div'); kb.className = 'fxc-kb'; kb.hidden = true;
    kb.innerHTML = '<div class="fxc-kb-title">Intervalle</div><input class="fxc-kb-in" type="text" maxlength="8" autocomplete="off" spellcheck="false"><div class="fxc-kb-hint">Ex. 1, 5, 15, 1H, 4H, D, W, M (Entrée pour valider)</div>';
    main.append(cv, legend, kb);
    const ranges = document.createElement('div'); ranges.className = 'fxc-ranges';
    if (o.big) host.append(bar, main, ranges); else host.append(main);
    const ctx = cv.getContext('2d');
    const kbIn = kb.querySelector('input');

    if (o.big) {
      bar.innerHTML = `<span class="fxc-sym">${o.name}</span><span class="fxc-sep"></span>`
        + TFS.map((t) => `<button type="button" class="fxc-btn" data-tf="${t.k}">${t.label}</button>`).join('')
        + '<button type="button" class="fxc-btn is-active" data-tf-custom hidden></button>'
        + '<span class="fxc-sep"></span>'
        + '<button type="button" class="fxc-btn" data-style="candles" title="Bougies">Bougies</button><button type="button" class="fxc-btn" data-style="line" title="Ligne">Ligne</button><button type="button" class="fxc-btn" data-style="area" title="Aire">Aire</button>'
        + '<span class="fxc-grow"></span><button type="button" class="fxc-btn" data-fs title="Plein écran">⛶</button>';
      ranges.innerHTML = RANGES.map((r) => `<button type="button" class="fxc-btn fxc-rng" data-rng="${r.d}">${r.l}</button>`).join('') + '<span class="fxc-grow"></span><span class="fxc-tz">Paris (UTC+1/+2)</span>';
    }
    const syncBtns = () => {
      let known = false;
      bar.querySelectorAll('[data-tf]').forEach((b) => { const on = b.dataset.tf === st.tf; if (on) known = true; b.classList.toggle('is-active', on); });
      const cu = bar.querySelector('[data-tf-custom]');
      if (cu) { cu.hidden = known; cu.textContent = tfLabel(st.tf); }
      bar.querySelectorAll('[data-style]').forEach((b) => b.classList.toggle('is-active', b.dataset.style === st.style));
    };

    /* géométrie : aucune limite de déplacement (comme TradingView) */
    const plotW = () => Math.max(10, st.w - AXIS_W);
    const plotH = () => Math.max(10, st.h - AXIS_H);
    const xOf = (i) => plotW() - (st.right - i) * st.bw - st.bw / 2;
    const iOf = (x) => st.right - (plotW() - x - st.bw / 2) / st.bw;
    const T = (v) => (st.log ? Math.log(Math.max(v, 1e-9)) : v);
    const TI = (v) => (st.log ? Math.exp(v) : v);
    const visRange = () => {
      const n = st.bars.length;
      return [Math.max(0, Math.floor(iOf(0)) - 1), Math.min(n - 1, Math.ceil(iOf(plotW())) + 1)];
    };
    function autoRange() {
      const [a, b] = visRange();
      let lo = Infinity; let hi = -Infinity;
      for (let i = a; i <= b; i++) {
        const k = st.bars[i]; if (!k) continue;
        const l = T(st.style === 'candles' ? k.l : k.c); const h = T(st.style === 'candles' ? k.h : k.c);
        if (l < lo) lo = l; if (h > hi) hi = h;
      }
      if (!isFinite(lo)) { const c = st.bars.length ? T(st.bars[st.bars.length - 1].c) : T(100); lo = c - 1; hi = c + 1; }
      if (hi - lo < 1e-9) { hi += 0.01; lo -= 0.01; }
      const pad = (hi - lo) * 0.1;
      return [lo - pad, hi + pad];
    }
    const priceRange = () => (st.auto ? autoRange() : st.man);
    const goManual = (r) => { st.auto = false; st.man = r; };
    function clampView() { st.bw = Math.min(60, Math.max(0.5, st.bw)); }
    function fit(days) {
      const n = st.bars.length;
      if (!n) return;
      const step = tfOf(st.tf).step;
      let cnt = days ? Math.max(20, Math.round((days * 86400) / step * (step >= 86400 ? 5 / 7 : 1))) : n;
      cnt = Math.min(n, cnt);
      st.bw = plotW() / (cnt + PAD_RIGHT_BARS);
      st.right = n - 1 + PAD_RIGHT_BARS;
      st.auto = true;
      clampView();
    }

    /* dessin */
    function niceTicks(lo, hi, target) {
      const span = hi - lo; const raw = span / target; const mag = Math.pow(10, Math.floor(Math.log10(raw)));
      const r = raw / mag; const step = (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * mag;
      const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
      return { out, step };
    }
    const decimals = (step) => Math.max(0, Math.min(4, Math.ceil(-Math.log10(step))));
    const dfmt = (v, dec) => v.toFixed(Math.min(4, Math.max(dec, 2)));
    function timeLabel(t, prev, tfStep) {
      if (tfStep >= 2592000) return F.md.format(new Date(t * 1000));
      if (tfStep >= 604800) return F.md.format(new Date(t * 1000));
      if (tfStep >= 86400) { const ds = new Date(t * 1000); return F.y.format(ds) !== F.y.format(new Date(prev * 1000)) ? F.y.format(ds) : (F.mo.format(ds) !== F.mo.format(new Date(prev * 1000)) ? F.mo.format(ds) : F.d.format(ds)); }
      return parisDay(t) !== parisDay(prev) ? F.d.format(new Date(t * 1000)) + ' ' + F.mo.format(new Date(t * 1000)) : F.hm.format(new Date(t * 1000));
    }
    // boutons A (échelle automatique) et L (échelle logarithmique), au bas de l'échelle de prix
    const btnRect = (which) => ({ x: plotW() + (which === 'A' ? 6 : 33), y: plotH() - 26, w: 24, h: 20 });
    const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    function draw() {
      const W = st.w; const H = st.h;
      if (!W || !H) return;
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const bg = cssVar('--mw-chart-bg', '#161616'); const grid = cssVar('--mw-grid', '#2a2a2a'); const txt = cssVar('--mw-text', '#9a9a9a');
      const up = cssVar('--mw-up', '#2962ff'); const dn = cssVar('--mw-down', '#f23645'); const cross = cssVar('--mw-cross', '#9598a1');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      const pw = plotW(); const ph = plotH();
      if (!st.bars.length) {
        ctx.fillStyle = txt; ctx.font = '13px ' + mono(); ctx.textAlign = 'center'; ctx.fillText(st.msg, pw / 2, ph / 2); return;
      }
      const [lo, hi] = priceRange();
      const Y = (v) => ((hi - T(v)) / (hi - lo)) * ph;
      const yToPrice = (y) => TI(hi - (y / ph) * (hi - lo));
      const tf = tfOf(st.tf);
      ctx.font = '11px ' + mono();
      // échelle de prix (sans quadrillage)
      const pLo = TI(lo); const pHi = TI(hi);
      const tk = niceTicks(Math.min(pLo, pHi), Math.max(pLo, pHi), Math.max(3, Math.round(ph / 55)));
      const dec = decimals(tk.step);
      ctx.fillStyle = txt; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      tk.out.forEach((v) => { const y = Math.round(Y(v)) + 0.5; if (y > 6 && y < ph - 6) ctx.fillText(dfmt(v, dec), pw + 8, y); });
      // échelle de temps
      const [a, b] = visRange(); const every = Math.max(1, Math.ceil(84 / st.bw));
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = txt;
      for (let i = Math.ceil(a / every) * every; i <= b; i += every) {
        const x = Math.round(xOf(i)) + 0.5; if (x < 20 || x > pw - 20) continue;
        const k = st.bars[i]; if (!k) continue;
        ctx.fillText(timeLabel(k.t, st.bars[Math.max(0, i - every)].t, tf.step), x, ph + AXIS_H / 2 + 1);
      }
      // séries
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, pw, ph); ctx.clip();
      const wickU = cssVar('--mw-up-wick', up); const wickD = cssVar('--mw-down-wick', dn); const bordU = cssVar('--mw-up-border', up); const bordD = cssVar('--mw-down-border', dn); const bodyW = Math.max(1, Math.floor(st.bw * 0.7));
      const lineCol = cssVar('--mw-line', '#2962ff');
      if (st.style === 'candles') {
        for (let i = a; i <= b; i++) {
          const k = st.bars[i]; if (!k) continue;
          const x = Math.round(xOf(i)); const upc = k.c >= k.o;
          ctx.strokeStyle = upc ? wickU : wickD; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x + 0.5, Y(k.h)); ctx.lineTo(x + 0.5, Y(k.l)); ctx.stroke();
          const yt = Math.round(Y(Math.max(k.o, k.c))); const bh = Math.max(1, Math.round(Y(Math.min(k.o, k.c))) - yt);
          const bx = Math.round(x - bodyW / 2);
          ctx.fillStyle = upc ? up : dn; ctx.fillRect(bx, yt, bodyW, bh);
          if (bodyW > 2) { ctx.strokeStyle = upc ? bordU : bordD; ctx.strokeRect(bx + 0.5, yt + 0.5, Math.max(0, bodyW - 1), Math.max(0, bh - 1)); }
        }
      } else {
        const path = () => { ctx.beginPath(); let first = true; for (let i = a; i <= b; i++) { const k = st.bars[i]; if (!k) continue; const x = xOf(i); if (first) { ctx.moveTo(x, Y(k.c)); first = false; } else ctx.lineTo(x, Y(k.c)); } };
        if (st.style === 'area') {
          path(); ctx.lineTo(xOf(b), ph); ctx.lineTo(xOf(a), ph); ctx.closePath();
          const g = ctx.createLinearGradient(0, 0, 0, ph); g.addColorStop(0, lineCol + '66'); g.addColorStop(1, lineCol + '05'); ctx.fillStyle = g; ctx.fill();
        }
        path(); ctx.strokeStyle = lineCol; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
      }
      ctx.restore();
      // dernier cours
      const last = st.bars[st.bars.length - 1]; const lc = cssVar('--mw-last', '#ffffff');
      const ly = Math.round(Y(last.c)) + 0.5;
      if (ly >= 0 && ly <= ph) {
        ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = lc; ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(pw, ly); ctx.stroke(); ctx.restore();
        ctx.fillStyle = lc; ctx.fillRect(pw, ly - 9, AXIS_W, 18); ctx.fillStyle = '#000'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(dfmt(last.c, 3), pw + 8, ly);
      }
      // bordures des échelles
      ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(pw + 0.5, 0); ctx.lineTo(pw + 0.5, H); ctx.moveTo(0, ph + 0.5); ctx.lineTo(W, ph + 0.5); ctx.stroke();
      // boutons A / L : visibles quand la souris est sur l'échelle de prix
      const cr = st.cross;
      if (cr && cr.x > pw) {
        ctx.font = '700 11px ' + mono(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        [['A', st.auto], ['L', st.log]].forEach(([w, on]) => {
          const r = btnRect(w);
          ctx.fillStyle = on ? cssVar('--mw-btn-active-bg', '#2a2e39') : bg; ctx.fillRect(r.x, r.y, r.w, r.h);
          ctx.strokeStyle = on ? cssVar('--mw-btn-active-text', '#ffffff') : grid; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
          ctx.fillStyle = on ? cssVar('--mw-btn-active-text', '#ffffff') : txt; ctx.fillText(w, r.x + r.w / 2, r.y + r.h / 2 + 1);
        });
        ctx.font = '11px ' + mono();
      }
      // curseur en croix
      if (cr && cr.x >= 0 && cr.x <= pw && cr.y >= 0 && cr.y <= ph) {
        const idx = Math.max(0, Math.min(st.bars.length - 1, Math.round(iOf(cr.x))));
        const cx = Math.round(xOf(idx)) + 0.5; const cy = Math.round(cr.y) + 0.5;
        ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = cross; ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, ph); ctx.moveTo(0, cy); ctx.lineTo(pw, cy); ctx.stroke(); ctx.restore();
        const lab = cssVar('--mw-label-bg', '#2a2e39'); const labT = cssVar('--mw-label-text', '#ffffff');
        ctx.fillStyle = lab; ctx.fillRect(pw, cy - 9, AXIS_W, 18); ctx.fillStyle = labT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(dfmt(yToPrice(cr.y), 3), pw + 8, cy);
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
      const col = cssVar('--mw-text', '#9a9a9a');
      const v = (x) => x.toFixed(3);
      legend.innerHTML = `<span class="fxc-l-name">${o.name}</span><span class="fxc-l-tf">${tfLabel(st.tf)}</span>`
        + `<span class="fxc-l-o">O <i style="color:${col}">${v(k.o)}</i></span><span>H <i style="color:${col}">${v(k.h)}</i></span><span>L <i style="color:${col}">${v(k.l)}</i></span><span>C <i style="color:${col}">${v(k.c)}</i></span>`
        + `<span><i style="color:${col}">${chg >= 0 ? '+' : ''}${chg.toFixed(3)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)</i></span>`;
    }
    let raf = 0;
    const redraw = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; draw(); }); };

    /* interactions */
    const pos = (ev) => { const r = cv.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
    const scaleAround = (r, k) => { const mid = (r[0] + r[1]) / 2; const half = ((r[1] - r[0]) / 2) * k; return [mid - half, mid + half]; };
    cv.style.touchAction = 'none';
    cv.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      if (!st.bars.length) return;
      const p = pos(ev);
      if (p.x > plotW()) { goManual(scaleAround(priceRange(), ev.deltaY < 0 ? 0.9 : 1.1)); redraw(); return; }
      const anchor = iOf(p.x);
      st.bw = Math.min(60, Math.max(0.5, st.bw * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)));
      st.right = anchor + (plotW() - p.x - st.bw / 2) / st.bw;
      redraw();
    }, { passive: false });
    cv.addEventListener('pointerdown', (ev) => {
      host.focus({ preventScroll: true });
      const p = pos(ev);
      if (p.x > plotW()) {
        if (inRect(p, btnRect('A'))) { st.auto = true; redraw(); return; }
        if (inRect(p, btnRect('L'))) { const r = priceRange(); const pl = TI(r[0]); const ph2 = TI(r[1]); st.log = !st.log; if (!st.auto) st.man = [T(pl), T(ph2)]; redraw(); return; }
      }
      st.pointers.set(ev.pointerId, p);
      try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      if (st.pointers.size === 2) { const [p1, p2] = [...st.pointers.values()]; st.drag = { pinch: true, d: Math.hypot(p1.x - p2.x, p1.y - p2.y), bw: st.bw }; return; }
      st.drag = { x: p.x, y: p.y, right: st.right, range: priceRange().slice(), onAxis: p.x > plotW(), onTime: p.y > plotH() && p.x <= plotW(), bw: st.bw, vert: false };
    });
    cv.addEventListener('pointermove', (ev) => {
      const p = pos(ev);
      if (st.pointers.has(ev.pointerId)) st.pointers.set(ev.pointerId, p);
      const d = st.drag;
      if (d && d.pinch && st.pointers.size === 2) {
        const [p1, p2] = [...st.pointers.values()]; const nd = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        st.bw = Math.min(60, Math.max(0.5, d.bw * (nd / (d.d || 1)))); redraw(); return;
      }
      if (d && !d.pinch) {
        const dx = p.x - d.x; const dy = p.y - d.y;
        if (d.onAxis) goManual(scaleAround(d.range, Math.exp(dy / 200)));
        else if (d.onTime) st.bw = Math.min(60, Math.max(0.5, d.bw * Math.exp(dx / 200)));
        else {
          st.right = d.right - dx / st.bw; // déplacement horizontal libre
          if (Math.abs(dy) > 4) d.vert = true;
          if (d.vert) { const k = ((d.range[1] - d.range[0]) / plotH()) * dy; goManual([d.range[0] + k, d.range[1] + k]); } // déplacement vertical libre
        }
        st.cross = d.onAxis || d.onTime ? p : p; redraw(); return;
      }
      st.cross = p; cv.style.cursor = p.x > plotW() ? ((inRect(p, btnRect('A')) || inRect(p, btnRect('L'))) ? 'pointer' : 'ns-resize') : 'crosshair'; redraw();
    });
    const up = (ev) => { st.pointers.delete(ev.pointerId); if (st.pointers.size < 2 && st.drag && st.drag.pinch) st.drag = null; if (!st.pointers.size) st.drag = null; };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse' && !st.drag) { st.cross = null; redraw(); } });
    cv.addEventListener('dblclick', (ev) => {
      const p = pos(ev);
      if (p.x > plotW()) st.auto = true; else fit(0);
      redraw();
    });
    function setTf(k) { if (!parseTf(k === 'D' ? '1D' : k === 'W' ? '1W' : k)) return; st.tf = k; syncBtns(); load(true, true); }
    bar.addEventListener('click', (ev) => {
      const t = ev.target.closest('button'); if (!t) return;
      if (t.dataset.tf) setTf(t.dataset.tf);
      else if (t.dataset.style) { st.style = t.dataset.style; syncBtns(); redraw(); }
      else if (t.hasAttribute('data-fs')) { if (document.fullscreenElement) document.exitFullscreen(); else if (host.requestFullscreen) host.requestFullscreen(); }
    });
    ranges.addEventListener('click', (ev) => { const t = ev.target.closest('[data-rng]'); if (!t) return; fit(Number(t.dataset.rng)); redraw(); });

    /* clavier : taper une unité de temps (1, 5, 15, 1H, 4H, D, W, M…) puis Entrée, comme dans TradingView */
    function closeKb() { kb.hidden = true; kbIn.value = ''; kb.classList.remove('is-bad'); }
    function normTf(txt) {
      const t = txt.trim();
      if (/^d$/i.test(t)) return 'D'; if (/^w$/i.test(t)) return 'W';
      if (/^\d*[dD]$/.test(t)) return (t.replace(/\D/g, '') || '1') === '1' ? 'D' : t.replace(/\D/g, '') + 'D';
      if (/^\d*[wW]$/.test(t)) return (t.replace(/\D/g, '') || '1') === '1' ? 'W' : t.replace(/\D/g, '') + 'W';
      if (/^\d*M$/.test(t)) return (t.replace(/\D/g, '') || '1') === '1' ? 'M' : t.replace(/\D/g, '') + 'M';
      const p = parseTf(t); return p ? p.k : null;
    }
    host.addEventListener('keydown', (ev) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.target === kbIn) {
        if (ev.key === 'Enter') { ev.preventDefault(); const k = normTf(kbIn.value); if (k) { closeKb(); setTf(k); } else { kb.classList.add('is-bad'); } }
        else if (ev.key === 'Escape') { ev.preventDefault(); closeKb(); host.focus({ preventScroll: true }); }
        else kb.classList.remove('is-bad');
        ev.stopPropagation();
        return;
      }
      if (/^[0-9a-zA-Z]$/.test(ev.key)) {
        ev.preventDefault();
        kb.hidden = false; kbIn.value = ev.key; kbIn.focus(); try { kbIn.setSelectionRange(kbIn.value.length, kbIn.value.length); } catch (e) { /* ignore */ }
      }
    });
    kbIn.addEventListener('blur', () => { setTimeout(() => { if (document.activeElement !== kbIn) closeKb(); }, 120); });

    /* chargement */
    const defDays = () => { const t = tfOf(st.tf); const m = t.mins; if (m !== undefined) return m <= 1 ? 0.5 : m <= 5 ? 1 : m <= 15 ? (o.big ? 3 : 2) : m <= 60 ? (o.big ? 10 : 5) : 30; return t.months ? 0 : t.weeks ? 0 : 180; };
    let busy = false;
    async function load(force, refit) {
      if (busy) return;
      busy = true;
      try {
        const wasEnd = st.bars.length === 0 || st.right >= st.bars.length - 1 + PAD_RIGHT_BARS - 0.5;
        const prevN = st.bars.length;
        const bars = await loadBars(o.currency, st.tf, force);
        if (!bars || bars.length < 2) { st.bars = []; st.msg = bars === null ? 'Données indisponibles (connecte-toi ou attends le robot).' : 'Pas encore de données.'; redraw(); return; }
        st.bars = bars;
        if (refit || !prevN) fit(defDays());
        else if (wasEnd) st.right = bars.length - 1 + PAD_RIGHT_BARS;
        redraw();
      } catch (e) { console.warn('fxchart', e); } finally { busy = false; }
    }
    const ro = window.ResizeObserver ? new ResizeObserver(() => {
      const r = main.getBoundingClientRect(); const w = Math.round(r.width); const h = Math.round(r.height);
      if (w === st.w && h === st.h) return;
      const first = !st.w; st.w = w; st.h = h;
      if (first && st.bars.length) fit(defDays());
      redraw();
    }) : null;
    if (ro) ro.observe(main);
    syncBtns();
    load(false, true);
    return { reload: () => load(true, false), redraw, destroy() { if (ro) ro.disconnect(); }, el: host, setTf };
  }

  window.FXChart = { create, TFS, parseTf };
})();
