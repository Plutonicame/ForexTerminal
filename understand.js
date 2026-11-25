'use strict';

/**
 * understand.js
 * Fenêtre « Compréhension fondamentale » : compare, pour chaque devise, le biais noté dans
 * Note fondamentale (Analyse fondamentale > année > mois > semaine en cours > onglet devise, compteur 0-100)
 * avec la force réelle de la devise (indicateur de force des devises, fx_strength).
 *  - biais respecté : on montre seulement le compteur et la courbe de force de la devise ;
 *  - biais non respecté : l'edge function fx-insight (mode bias) passe en revue news, données éco, discours,
 *    Trump, banques, taux, macro et sentiment du risque, et liste les raisons probables de l'écart
 *    + celles qui pourraient quand même aller dans le sens du biais. Un clic sur une raison ouvre son analyse.
 * Exclus de l'analyse : calculateur de risque, paramètres, notes.
 * Expose aussi Understand.getBiases() (utilisé par Session Recap).
 * Couleurs : style.css (variables --un-*) ou Paramètres > Thème > Compréhension fondamentale.
 */
(function () {
  const PANEL_ID = 'tab-understand';
  const CCYS = ['USD', 'EUR', 'JPY', 'GBP', 'CHF', 'CAD', 'AUD', 'NZD'];
  const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  const LS_SEL = 'fxt-understand-sel';
  const DEAD = 0.05;   // % : en dessous, la devise est considérée « à plat »
  const STRONG = 0.2;  // % : mouvement jugé fort face à un biais neutre

  let built = false;
  let loading = false;
  let sel = 'USD';
  let state = null; // { path, nodes: {ccy: id}, bias: {ccy: v|null}, series, weekName }
  let tabsEl = null;
  let bodyEl = null;
  const insights = {}; // ccy -> { key, result, loading, error }

  try { const s = localStorage.getItem(LS_SEL); if (CCYS.includes(s)) sel = s; } catch (e) { /* stockage indisponible */ }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const client = () => window.Auth && window.Auth.getClient && window.Auth.getClient();

  function parisParts(d) {
    const f = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' });
    const o = {};
    f.formatToParts(d).forEach((p) => { if (p.type !== 'literal') o[p.type] = Number(p.value); });
    return o;
  }

  // Arbre : Analyse fondamentale > année > mois > semaine (la plus récente dont le 1er jour est passé) > devises
  async function loadTree() {
    const c = client();
    if (!c) throw new Error('non connecté');
    const { data, error } = await c.from('fundamental_nodes').select('id,parent_id,name');
    if (error) throw error;
    const kids = (pid) => (data || []).filter((n) => n.parent_id === pid);
    const norm = (s) => String(s || '').trim().toLowerCase();
    const now = parisParts(new Date());
    const group = kids(null).find((n) => norm(n.name) === 'analyse fondamentale');
    if (!group) throw new Error('groupe « Analyse fondamentale » introuvable');
    const year = kids(group.id).find((n) => norm(n.name) === String(now.year));
    if (!year) throw new Error('année ' + now.year + ' introuvable dans Analyse fondamentale');
    const mName = MONTHS[now.month - 1];
    const month = kids(year.id).find((n) => norm(n.name) === norm(mName));
    if (!month) throw new Error('mois « ' + mName + ' » introuvable');
    let best = null;
    kids(month.id).forEach((w) => {
      const m = /^\s*(\d{1,2})\s*[-–—]\s*(\d{1,2})\s*$/.exec(w.name || '');
      if (!m) return;
      const start = Number(m[1]);
      if (start <= now.day && (!best || start > best.start)) best = { node: w, start };
    });
    if (!best) throw new Error('semaine en cours introuvable dans « ' + mName + ' »');
    const nodes = {};
    kids(best.node.id).forEach((n) => { const code = String(n.name || '').trim().toUpperCase(); if (CCYS.includes(code)) nodes[code] = n.id; });
    return { weekName: best.node.name, month: mName, year: now.year, nodes };
  }

  async function loadStrength() {
    const c = client();
    const { data, error } = await c.from('fx_strength').select('week_start,series').eq('id', 'current').limit(1);
    if (error) throw error;
    return data && data[0] ? data[0].series : null;
  }

  function currentBiases(nodes) {
    const F = window.Fundamental;
    const out = {};
    CCYS.forEach((c) => { out[c] = nodes[c] && F && F.getMeter ? F.getMeter(nodes[c]) : null; });
    return out;
  }

  async function getBiases() {
    try {
      const t = await loadTree();
      return currentBiases(t.nodes);
    } catch (e) { return {}; }
  }

  function strengthOf(series, ccy) {
    const a = series && series[ccy];
    return Array.isArray(a) && a.length ? Number(a[a.length - 1]) : null;
  }

  // 'ok' | 'bad' | 'none'
  function verdictOf(bias, s) {
    if (bias == null || s == null) return 'none';
    if (bias < 40) return s >= -DEAD ? 'ok' : 'bad';
    if (bias > 60) return s <= DEAD ? 'ok' : 'bad';
    return Math.abs(s) >= STRONG ? 'bad' : 'ok';
  }
  const biasWord = (b) => (b < 40 ? 'haussier' : b > 60 ? 'baissier' : 'neutre');
  const pct = (v) => (v > 0 ? '+' : '') + v.toFixed(2) + ' %';

  function curveSvg(series, ccy) {
    const t = series && series.t; const a = series && series[ccy];
    if (!Array.isArray(t) || !Array.isArray(a) || a.length < 2) return '<p class="un-dim">Courbe indisponible.</p>';
    const W = 640; const H = 200; const pl = 44; const pr = 10; const pt = 12; const pb = 22;
    const lo = Math.min(0, ...a); const hi = Math.max(0, ...a);
    const span = (hi - lo) || 1;
    const x = (i) => pl + (i / (a.length - 1)) * (W - pl - pr);
    const y = (v) => pt + (1 - (v - lo) / span) * (H - pt - pb);
    const pts = a.map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
    const days = [];
    let lastDay = null;
    t.forEach((ts, i) => {
      const d = new Date(ts * 1000);
      const key = d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short' });
      if (key !== lastDay) { days.push([i, key]); lastDay = key; }
    });
    const ticks = [lo, (lo + hi) / 2, hi].map((v) => `<text class="un-axis" x="${pl - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${v.toFixed(2)}</text><line class="un-grid" x1="${pl}" x2="${W - pr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`).join('');
    const dl = days.map(([i, k]) => `<text class="un-axis" x="${x(i).toFixed(1)}" y="${H - 6}">${esc(k)}</text>`).join('');
    return `<svg class="un-curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="Force de ${ccy}">${ticks}<line class="un-zero" x1="${pl}" x2="${W - pr}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/><polyline class="un-line" points="${pts}" fill="none"/>${dl}</svg>`;
  }

  function renderTabs() {
    tabsEl.innerHTML = CCYS.map((c) => {
      const v = state ? verdictOf(state.bias[c], strengthOf(state.series, c)) : 'none';
      return `<button type="button" class="un-tab${c === sel ? ' is-active' : ''}" data-ccy="${c}" role="tab" aria-selected="${c === sel}"><span class="un-dot un-dot--${v}"></span>${c}</button>`;
    }).join('');
  }

  function itemsHtml(list, kind) {
    if (!list || !list.length) return '<p class="un-dim">Rien de notable dans les données.</p>';
    return list.map((it, i) => `<div class="un-item un-item--${kind}"><button type="button" class="un-item-head" aria-expanded="false" data-i="${kind}-${i}"><span class="un-chev">▸</span>${esc(it.title)}</button><div class="un-item-body" hidden>${esc(it.analysis)}</div></div>`).join('');
  }

  function renderBody() {
    if (!state) return;
    const ccy = sel;
    const b = state.bias[ccy];
    const s = strengthOf(state.series, ccy);
    const v = verdictOf(b, s);
    const F = window.Fundamental;
    let html = `<div class="un-head"><div class="un-gauge" data-un-gauge></div><div class="un-facts">
      <div class="un-ccy">${ccy}</div>
      <div class="un-line-fact"><span class="un-dim">Biais</span> <b>${b == null ? 'non défini' : biasWord(b) + ' (' + Math.round(b) + ')'}</b></div>
      <div class="un-line-fact"><span class="un-dim">Force depuis lundi</span> <b class="${s == null ? '' : s >= 0 ? 'un-up' : 'un-down'}">${s == null ? '–' : pct(s)}</b></div>
      <div class="un-ctx un-dim">Semaine ${esc(state.weekName)} · ${esc(state.month)} ${state.year}</div></div></div>`;
    if (v === 'none') {
      html += b == null
        ? `<p class="un-note">Aucun compteur sur l'onglet ${ccy} de la semaine ${esc(state.weekName)}. Dans Note fondamentale : clic droit sur l'onglet > Compteur.</p>`
        : '<p class="un-note">Force des devises indisponible.</p>';
    } else if (v === 'ok') {
      html += '<div class="un-banner un-banner--ok">Biais respecté : le marché va dans ton sens.</div>';
    } else {
      const why = b < 40 ? 'ton biais est haussier mais la devise recule' : b > 60 ? 'ton biais est baissier mais la devise monte' : 'ton biais est neutre mais la devise bouge fortement';
      html += `<div class="un-banner un-banner--bad">Biais non respecté : ${why}.</div><div class="un-ai" data-un-ai></div>`;
    }
    html += `<div class="un-card">${curveSvg(state.series, ccy)}</div>`;
    bodyEl.innerHTML = html;
    const gh = bodyEl.querySelector('[data-un-gauge]');
    if (gh && F && F.gauge && b != null) gh.appendChild(F.gauge(b));
    else if (gh) gh.remove();
    if (v === 'bad') renderAi(false);
  }

  function renderAi(force) {
    const host = bodyEl.querySelector('[data-un-ai]');
    if (!host) return;
    const ccy = sel;
    const b = state.bias[ccy];
    const key = ccy + '|' + b + '|' + (strengthOf(state.series, ccy) || 0).toFixed(1);
    let st = insights[ccy];
    if (!st || st.key !== key || force) {
      st = insights[ccy] = { key, result: null, loading: true, error: null };
      const c = client();
      c.functions.invoke('fx-insight', { body: { mode: 'bias', ccy, bias: b, force: !!force } }).then(({ data, error }) => {
        if (error || !data || !data.ok) throw new Error((data && data.error) || (error && error.message) || 'analyse indisponible');
        st.result = data.result;
      }).catch((e) => { st.error = e.message || String(e); }).finally(() => {
        st.loading = false;
        if (sel === ccy && bodyEl.querySelector('[data-un-ai]')) renderAi(false);
      });
    }
    if (st.loading) { host.innerHTML = '<p class="un-dim">Analyse en cours (news, données éco, discours, risque…)</p>'; return; }
    if (st.error) { host.innerHTML = `<p class="un-note">${esc(st.error)}</p><button type="button" class="un-btn" data-un-redo>Réessayer</button>`; return; }
    const r = st.result || {};
    host.innerHTML = `<p class="un-verdict">${esc(r.verdict || '')}</p>
      <h3 class="un-h">Pourquoi le biais n'est probablement pas respecté</h3>${itemsHtml(r.against, 'against')}
      <h3 class="un-h">Pourquoi ça pourrait quand même aller dans ton sens</h3>${itemsHtml(r.for_you, 'for')}
      <button type="button" class="un-btn" data-un-redo>Réanalyser</button>`;
  }

  async function load() {
    if (loading) return;
    loading = true;
    try {
      const [t, series] = await Promise.all([loadTree(), loadStrength()]);
      state = { weekName: t.weekName, month: t.month, year: t.year, nodes: t.nodes, bias: currentBiases(t.nodes), series };
      renderTabs();
      renderBody();
    } catch (e) {
      state = null;
      tabsEl.innerHTML = '';
      bodyEl.innerHTML = `<p class="un-note">Impossible de lire l'analyse fondamentale : ${esc(e && e.message || e)}.</p>`;
    } finally { loading = false; }
  }

  function build() {
    if (built) return;
    const sec = document.getElementById(PANEL_ID);
    if (!sec) return;
    built = true;
    sec.innerHTML = `<div class="calendar-toolbar"><span class="calendar-toolbar-title">Compréhension fondamentale</span></div><div class="un-wrap"><div class="un-tabs" role="tablist" aria-label="Devises"></div><div class="un-body"></div></div>`;
    tabsEl = sec.querySelector('.un-tabs');
    bodyEl = sec.querySelector('.un-body');
    tabsEl.addEventListener('click', (ev) => {
      const b = ev.target.closest('.un-tab');
      if (!b) return;
      sel = b.dataset.ccy;
      try { localStorage.setItem(LS_SEL, sel); } catch (e) { /* ignore */ }
      renderTabs(); renderBody();
    });
    bodyEl.addEventListener('click', (ev) => {
      const h = ev.target.closest('.un-item-head');
      if (h) {
        const open = h.getAttribute('aria-expanded') !== 'true';
        h.setAttribute('aria-expanded', String(open));
        h.querySelector('.un-chev').textContent = open ? '▾' : '▸';
        h.nextElementSibling.hidden = !open;
        return;
      }
      if (ev.target.closest('[data-un-redo]')) renderAi(true);
    });
    bodyEl.innerHTML = '<p class="un-dim">Chargement…</p>';
  }

  window.Understand = { refresh() { build(); load(); }, getBiases };
})();
