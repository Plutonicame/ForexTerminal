'use strict';

/**
 * rates.js — « Attentes de taux » (Polymarket) dans chaque onglet de devise de l'analyse.
 *
 * Données : table Supabase "rate_expectations", remplie par le bot "polymarket-rates"
 * (UNE ligne par devise ET par réunion : réunion de ce mois-ci, puis celle du mois suivant).
 * Des boutons dans le bandeau (« Octobre », « Novembre »...) permettent de passer de l'une à l'autre.
 * Affiche : 4 cases KPI (aucun changement / hausse de 25 pb / baisse de 25 pb / autre = 50 pb ou plus)
 * et un graphique de l'évolution des probabilités ; l'infobulle apparaît au survol (ou au toucher).
 * Si Polymarket n'a pas de marché pour la banque, l'onglet l'indique.
 *
 * La section s'insère dans le panneau de la devise, juste après le calendrier, avant les discours.
 * Les couleurs se changent dans style.css (variables --rates-*).
 */
(function () {
  const BANKS = {
    USD: 'Fed', EUR: 'BCE', JPY: 'BoJ', GBP: 'BoE',
    CHF: 'BNS', CAD: 'Banque du Canada', AUD: 'RBA', NZD: 'RBNZ',
  };

  const OUTCOMES = [
    { key: 'none',   label: 'Aucun changement',     css: 'none' },
    { key: 'up25',   label: 'Hausse de 25 pb',      css: 'up' },
    { key: 'down25', label: 'Baisse de 25 pb',      css: 'down' },
    { key: 'other',  label: 'Autre (50 pb ou plus)', css: 'other' },
  ];

  const REFRESH_MS = 60 * 1000; // le bot met les prix à jour chaque minute
  const STALE_MS = 2 * 3600 * 1000;

  // rows[devise] = liste des marchés Polymarket (un par réunion), triés par date de réunion :
  // [0] = réunion de ce mois-ci, [1] = réunion du mois suivant...
  let rows = {};
  const selected = {}; // devise -> index de la réunion affichée
  let loaded = false;
  let failed = false;
  let loading = false;

  const fmtMonth = (ms) => {
    const m = new Date(ms).toLocaleDateString('fr-FR', { month: 'long' });
    return m.charAt(0).toUpperCase() + m.slice(1);
  };

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const pct = (v) => (Number.isFinite(v)
    ? v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %'
    : '—');

  const fmtDay = (ms) => new Date(ms).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fmtShort = (ms) => new Date(ms).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const fmtTime = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const fmtDateTime = (ms) => `${fmtShort(ms)} ${fmtTime(ms)}`;

  // -------------------------------------------------------------------------
  // Section dans le panneau d'une devise
  // -------------------------------------------------------------------------
  function ensureSection(code) {
    const panel = document.querySelector(`.currency-panel[data-currency="${code}"]`);
    if (!panel) return null;
    let section = panel.querySelector('.rates');
    if (!section) {
      section = document.createElement('div');
      section.className = 'rates';
      section.dataset.code = code;
      // Bouton de choix de la réunion (écouteur unique : la barre est redessinée à chaque mise à jour)
      section.addEventListener('click', (ev) => {
        const btn = ev.target.closest('.rates-meeting-btn[data-idx]');
        if (!btn || btn.disabled) return;
        selected[code] = Number(btn.dataset.idx);
        renderCode(code);
      });
      const calendar = panel.querySelector('.calendar');
      panel.insertBefore(section, calendar ? calendar.nextSibling : panel.firstChild);
    }
    return section;
  }

  function validPoint(p) {
    return p && Number.isFinite(p.t) && OUTCOMES.every((o) => Number.isFinite(p[o.key]));
  }

  // Variation sur ~24 h pour une issue (en points de pourcentage).
  function delta24(series, key) {
    const last = series[series.length - 1];
    let prev = series[0];
    for (let i = series.length - 1; i >= 0; i -= 1) {
      if (series[i].t <= last.t - 86400) { prev = series[i]; break; }
    }
    return last[key] - prev[key];
  }

  function deltaText(d) {
    if (!Number.isFinite(d)) return '';
    if (Math.abs(d) < 0.05) return '= 0,0 pt sur 24 h';
    const sign = d > 0 ? '▲ +' : '▼ −';
    return `${sign}${Math.abs(d).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pt sur 24 h`;
  }

  function renderCode(code) {
    const section = ensureSection(code);
    if (!section) return;
    const bank = BANKS[code];
    const list = rows[code] || [];
    const idx = Math.max(0, Math.min(selected[code] || 0, list.length - 1));
    const row = list[idx];

    // Boutons « mois en cours / mois suivant », comme sur Polymarket.
    // S'il n'y a qu'un marché, le bouton du mois suivant est affiché grisé.
    const meetingToggle = () => {
      if (!list.length) return '';
      const label = (r, i) => {
        const t = Date.parse(r.meeting_at);
        return Number.isFinite(t) ? fmtMonth(t) : (i === 0 ? 'Prochaine réunion' : 'Réunion suivante');
      };
      const btns = list.map((r, i) => `<button type="button" class="rates-meeting-btn${i === idx ? ' is-active' : ''}" data-idx="${i}" aria-pressed="${i === idx}">${esc(label(r, i))}</button>`);
      if (list.length === 1) {
        btns.push('<button type="button" class="rates-meeting-btn" disabled title="Marché de la réunion suivante pas encore disponible sur Polymarket">Réunion suivante</button>');
      }
      return `<div class="rates-meetings" role="group" aria-label="Réunion de la banque centrale">${btns.join('')}</div>`;
    };

    const head = (info) => `
      <div class="rates-toolbar">
        <span class="rates-toolbar-title">Attentes de taux · Polymarket</span>
        ${meetingToggle()}
        <span class="rates-toolbar-info">${esc(info)}</span>
      </div>`;

    if (!loaded || !row) {
      const msg = !loaded
        ? (failed ? 'Impossible de charger les attentes de taux pour le moment.' : 'Chargement…')
        : `Pas de marché Polymarket sur la prochaine réunion de ${bank} pour le moment.`;
      const sig = `empty:${msg}`;
      if (section.dataset.sig === sig) return;
      section.dataset.sig = sig;
      section.innerHTML = `${head(bank)}<p class="rates-empty">${esc(msg)}</p>`;
      return;
    }

    const sig = `${idx}/${list.length}|${row.event_slug}|${row.updated_at}`;
    if (section.dataset.sig === sig) return;
    // Pendant qu'on survole le graphique, on ne le redessine pas (l'infobulle resterait coupée) :
    // la mise à jour est appliquée dès que le curseur le quitte.
    const liveChart = section.querySelector('.rates-chart');
    if (liveChart && liveChart._hover) { section._pending = true; return; }
    section.dataset.sig = sig;

    const cur = row.current || {};
    const series = (Array.isArray(row.series) ? row.series : []).filter(validPoint);
    const updMs = Date.parse(row.updated_at);
    const stale = Number.isFinite(updMs) && Date.now() - updMs > STALE_MS;
    const endMs = Date.parse(row.meeting_at);
    const volume = Number(row.volume);
    const info = [
      bank,
      Number.isFinite(updMs) ? `mis à jour à ${fmtTime(updMs)}` : '',
      stale ? '⚠ données anciennes' : '',
    ].filter(Boolean).join(' · ');

    const kpis = OUTCOMES.map((o) => {
      const v = Number(cur[o.key]);
      let sub = series.length > 1 ? deltaText(delta24(series, o.key)) : '';
      if (o.key === 'other' && Number.isFinite(Number(cur.otherUp)) && Number.isFinite(Number(cur.otherDown))) {
        sub = `Hausse ${pct(Number(cur.otherUp))} · Baisse ${pct(Number(cur.otherDown))}`;
      }
      return `
        <div class="rates-kpi rates-kpi--${o.css}">
          <span class="rates-kpi-label">${esc(o.label)}</span>
          <span class="rates-kpi-value">${pct(v)}</span>
          <span class="rates-kpi-sub">${esc(sub)}</span>
        </div>`;
    }).join('');

    const legend = OUTCOMES.map((o) => `<span class="rates-legend-item"><i class="rates-dot rates-dot--${o.css}"></i>${esc(o.label)}</span>`).join('');
    const sub = [
      'Probabilité par issue',
      Number.isFinite(endMs) ? `échéance ${fmtDay(endMs)}` : '',
      Number.isFinite(volume) && volume > 0 ? `volume ${volume.toLocaleString('fr-FR', { notation: 'compact', maximumFractionDigits: 1 })} $` : '',
    ].filter(Boolean).join(' · ');

    section.innerHTML = `
      ${head(info)}
      <div class="rates-kpis">${kpis}</div>
      <div class="rates-chart-card">
        <div class="rates-chart-head">
          <div class="rates-chart-titles">
            <h3 class="rates-chart-title">${esc(row.event_title)}</h3>
            <span class="rates-chart-sub">${esc(sub)}</span>
          </div>
          ${row.event_url ? `<a class="rates-link" href="${esc(row.event_url)}" target="_blank" rel="noopener noreferrer">Voir sur Polymarket</a>` : ''}
        </div>
        <div class="rates-chart"></div>
        <div class="rates-legend">${legend}</div>
      </div>`;
    if (section._ro) section._ro.disconnect();
    section._ro = setupChart(section.querySelector('.rates-chart'), series);
  }

  function renderAll() {
    Object.keys(BANKS).forEach(renderCode);
  }

  // -------------------------------------------------------------------------
  // Graphique (SVG) + infobulle au survol
  // -------------------------------------------------------------------------
  function setupChart(host, series) {
    if (series.length < 2) {
      host.innerHTML = '<p class="rates-empty">Historique insuffisant pour tracer le graphique.</p>';
      return null;
    }
    host._series = series;
    const draw = () => {
      const w = Math.floor(host.clientWidth);
      if (w < 80) return; // panneau masqué : on redessinera quand il devient visible
      host._w = w;
      paint(host);
    };
    let ro = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(() => { if (Math.floor(host.clientWidth) !== host._w) draw(); });
      ro.observe(host);
    }
    draw();
    return ro;
  }

  function paint(host) {
    const series = host._series;
    const W = host._w;
    const H = W < 520 ? 230 : 280;
    const ml = 42, mr = 12, mt = 12, mb = 26;
    const pw = W - ml - mr;
    const ph = H - mt - mb;
    const t0 = series[0].t;
    const t1 = series[series.length - 1].t;
    const span = Math.max(1, t1 - t0);
    const x = (t) => ml + ((t - t0) / span) * pw;
    const y = (v) => mt + (1 - Math.max(0, Math.min(100, v)) / 100) * ph;

    let grid = '';
    [0, 25, 50, 75, 100].forEach((v) => {
      grid += `<line class="rates-grid" x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}"/>` +
        `<text class="rates-axis" x="${ml - 6}" y="${y(v) + 3}" text-anchor="end">${v} %</text>`;
    });

    const showDays = span > 2 * 86400;
    let xticks = '';
    for (let i = 0; i < 5; i += 1) {
      const t = t0 + (span * i) / 4;
      const label = showDays ? fmtShort(t * 1000) : fmtTime(t * 1000);
      const anchor = i === 0 ? 'start' : i === 4 ? 'end' : 'middle';
      xticks += `<text class="rates-axis" x="${x(t)}" y="${H - 8}" text-anchor="${anchor}">${label}</text>`;
    }

    const lines = OUTCOMES.map((o) => {
      const d = series.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p[o.key]).toFixed(1)}`).join('');
      return `<path class="rates-line rates-line--${o.css}" d="${d}"/>`;
    }).join('');

    const dots = OUTCOMES.map((o) => `<circle class="rates-hdot rates-hdot--${o.css}" r="4" cx="0" cy="0" visibility="hidden" data-k="${o.key}"/>`).join('');

    host.innerHTML = `
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution des probabilités">
        ${grid}${xticks}${lines}
        <line class="rates-cursor" x1="0" x2="0" y1="${mt}" y2="${mt + ph}" visibility="hidden"/>
        ${dots}
        <rect class="rates-hit" x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="transparent"/>
      </svg>
      <div class="rates-tooltip" hidden></div>`;

    const svg = host.querySelector('svg');
    const cursor = host.querySelector('.rates-cursor');
    const tip = host.querySelector('.rates-tooltip');
    const hdots = Array.from(host.querySelectorAll('.rates-hdot'));

    host._hover = false;
    const hide = () => {
      host._hover = false;
      const sec = host.closest('.rates');
      if (sec && sec._pending) { sec._pending = false; renderCode(sec.dataset.code); }
      cursor.setAttribute('visibility', 'hidden');
      hdots.forEach((c) => c.setAttribute('visibility', 'hidden'));
      tip.hidden = true;
    };

    const show = (ev) => {
      host._hover = true;
      const rect = svg.getBoundingClientRect();
      const px = Math.max(ml, Math.min(W - mr, ev.clientX - rect.left));
      const t = t0 + ((px - ml) / pw) * span;
      // point le plus proche (recherche dichotomique)
      let lo = 0, hi = series.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (series[mid].t <= t) lo = mid; else hi = mid;
      }
      const p = Math.abs(series[lo].t - t) <= Math.abs(series[hi].t - t) ? series[lo] : series[hi];
      const cx = x(p.t);
      cursor.setAttribute('x1', cx);
      cursor.setAttribute('x2', cx);
      cursor.setAttribute('visibility', 'visible');
      hdots.forEach((c) => {
        c.setAttribute('cx', cx);
        c.setAttribute('cy', y(p[c.dataset.k]));
        c.setAttribute('visibility', 'visible');
      });
      tip.innerHTML = `<div class="rates-tip-date">${esc(fmtDateTime(p.t * 1000))}</div>` +
        OUTCOMES.map((o) => `<div class="rates-tip-row"><span><i class="rates-dot rates-dot--${o.css}"></i>${esc(o.label)}</span><b>${pct(p[o.key])}</b></div>`).join('');
      tip.hidden = false;
      const tw = tip.offsetWidth;
      const left = cx + 14 + tw > W ? cx - 14 - tw : cx + 14;
      tip.style.left = `${Math.max(4, left)}px`;
      tip.style.top = `${mt + 4}px`;
    };

    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('pointercancel', hide);
  }

  // -------------------------------------------------------------------------
  // Lecture dans Supabase
  // -------------------------------------------------------------------------
  async function loadRates() {
    if (loading) return;
    const client = window.Auth && window.Auth.getClient ? window.Auth.getClient() : null;
    if (!client) return;
    loading = true;
    try {
      const { data, error } = await client.from('rate_expectations').select('*');
      if (error) throw error;
      rows = {};
      (data || []).forEach((r) => { (rows[r.currency] = rows[r.currency] || []).push(r); });
      Object.values(rows).forEach((list) => list.sort((a, b) => {
        const ta = Date.parse(a.meeting_at);
        const tb = Date.parse(b.meeting_at);
        return (Number.isFinite(ta) ? ta : Infinity) - (Number.isFinite(tb) ? tb : Infinity);
      }));
      loaded = true;
      failed = false;
    } catch (err) {
      console.error('[FX-RATES] Lecture impossible :', err);
      if (!loaded) failed = true;
    } finally {
      loading = false;
      renderAll();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderAll(); // « Chargement… » en attendant la lecture
    if (window.Auth) window.Auth.onAuthStateChange((session) => { if (session) loadRates(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadRates(); });
    setInterval(() => { if (!document.hidden) loadRates(); }, REFRESH_MS);
  });

  window.Rates = { reload: loadRates };
})();
