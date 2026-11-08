'use strict';

/**
 * bankpos.js
 * Fenêtre « Position des banques » : positions en actions / ETF des grands gestionnaires et banques,
 * d'après leurs déclarations 13F à la SEC (table bank_13f, alimentée par l'edge function bank-bot).
 *  - Vue « Toutes » : une ligne par banque (valeur du portefeuille, variation, nombre de lignes, 3 plus grosses positions),
 *    les plus gros titres cumulés et les plus gros achats / ventes cumulés du trimestre.
 *  - Vue d'une banque : ses 30 plus grosses positions avec la variation du nombre de titres depuis le trimestre précédent,
 *    et ses 10 plus gros achats / ventes.
 * Limites : un 13F ne couvre que les actions, ETF et obligations convertibles américaines (pas le FX), il est publié
 * environ 45 jours après la fin du trimestre, et on ne conserve que les 300 plus grosses lignes de chaque banque.
 * Couleurs : style.css (variables --bp-*) ou Paramètres > Thème > Position des banques.
 */
(function () {
  const PANEL_ID = 'tab-bankpos';
  const NAMES = { BLK: 'BlackRock', VAN: 'Vanguard', JPM: 'JPMorgan', STT: 'State Street', GS: 'Goldman Sachs', MS: 'Morgan Stanley', BAC: 'Bank of America' };
  const ORDER = ['BLK', 'VAN', 'STT', 'JPM', 'BAC', 'MS', 'GS'];
  const LS_SEL = 'fxt-bankpos-sel';

  let built = false;
  let loading = false;
  let loadedAt = 0;
  let data = {}; // bank -> [dernier trimestre, trimestre précédent]
  let sel = 'ALL';
  let bar = null;
  let body = null;

  try { const s = localStorage.getItem(LS_SEL); if (s) sel = s; } catch (e) { /* stockage indisponible */ }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (v) => {
    const a = Math.abs(v);
    if (a >= 1e12) return (v / 1e12).toFixed(2) + ' T$';
    if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e10 ? 0 : 1) + ' Md$';
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + ' M$';
    return Math.round(v / 1e3) + ' k$';
  };
  const num = (v) => {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + ' Md';
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 1 : 2) + ' M';
    if (a >= 1e3) return (v / 1e3).toFixed(0) + ' k';
    return String(Math.round(v));
  };
  const pct = (v, d = 1) => (v >= 0 ? '+' : '') + v.toFixed(d) + ' %';
  const cls = (v) => (v > 0 ? 'bp-pos' : v < 0 ? 'bp-neg' : '');
  const qLabel = (p) => { const d = new Date(p + 'T00:00:00Z'); return 'T' + (Math.floor(d.getUTCMonth() / 3) + 1) + ' ' + d.getUTCFullYear(); };
  const fmtDate = (s) => { const [y, m, d] = String(s).split('-'); return d + '/' + m + '/' + y; };
  const nice = (n) => esc(String(n || '').replace(/\s+/g, ' ').trim());

  // holdings : [cusip, émetteur, valeur $, titres]
  function maps(rows) {
    const m = new Map();
    rows.forEach((r) => m.set(r[0], r));
    return m;
  }

  // positions d'une banque avec variation vs trimestre précédent
  function analyse(bank) {
    const cur = data[bank] && data[bank][0];
    if (!cur) return null;
    const prev = data[bank][1] || null;
    const pm = prev ? maps(prev.holdings) : null;
    const pmin = prev && prev.holdings.length ? prev.holdings[prev.holdings.length - 1][2] : 0;
    const rows = cur.holdings.map((r, i) => {
      const [cusip, name, value, shares] = r;
      let dShares = null;
      let flow = null;
      let isNew = false;
      if (pm) {
        const p = pm.get(cusip);
        const price = shares > 0 ? value / shares : 0;
        if (p) {
          dShares = p[3] > 0 ? ((shares - p[3]) / p[3]) * 100 : null;
          flow = (shares - p[3]) * price;
        } else if (value > pmin) { // absent du précédent top 300 alors qu'assez gros pour y être : vraie nouvelle ligne
          isNew = true;
          flow = value;
        }
      }
      return { rank: i + 1, cusip, name, value, shares, share: cur.total_value ? (value / cur.total_value) * 100 : 0, dShares, flow, isNew };
    });
    const dTotal = prev && prev.total_value ? ((cur.total_value - prev.total_value) / prev.total_value) * 100 : null;
    return { cur, prev, rows, dTotal };
  }

  function movers(rows, n) {
    const f = rows.filter((r) => r.flow != null && Math.abs(r.flow) > 0);
    return {
      buys: f.filter((r) => r.flow > 0).sort((a, b) => b.flow - a.flow).slice(0, n),
      sells: f.filter((r) => r.flow < 0).sort((a, b) => a.flow - b.flow).slice(0, n),
    };
  }

  function moversTable(title, list, sign) {
    if (!list.length) return '';
    return `<div class="bp-card"><h3 class="bp-h">${title}</h3><table class="bp-table"><tbody>${list.map((r) =>
      `<tr><td class="bp-name">${nice(r.name)}${r.isNew ? ' <span class="bp-tag">nouveau</span>' : ''}</td><td class="bp-num ${sign > 0 ? 'bp-pos' : 'bp-neg'}">${(sign > 0 ? '+' : '−') + money(Math.abs(r.flow))}</td><td class="bp-num bp-dim">${r.dShares == null ? '' : pct(r.dShares, 1)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderOne(bank) {
    const a = analyse(bank);
    if (!a) return '<p class="bp-empty">Pas encore de données pour cette banque.</p>';
    const { cur, prev, rows, dTotal } = a;
    const mv = movers(rows, 10);
    const head = `<div class="bp-summary">
      <div><span class="bp-k">Portefeuille actions (13F)</span><b>${money(cur.total_value)}</b>${dTotal == null ? '' : ` <span class="${cls(dTotal)}">${pct(dTotal)} vs ${qLabel(prev.period)}</span>`}</div>
      <div><span class="bp-k">Lignes</span><b>${cur.n_positions.toLocaleString('fr-FR')}</b></div>
      <div><span class="bp-k">Trimestre</span><b>${qLabel(cur.period)}</b> <span class="bp-dim">déposé le ${fmtDate(cur.filed)}</span></div>
    </div>`;
    const trs = rows.slice(0, 30).map((r) => `<tr>
      <td class="bp-rank">${r.rank}</td><td class="bp-name">${nice(r.name)}${r.isNew ? ' <span class="bp-tag">nouveau</span>' : ''}</td>
      <td class="bp-num">${money(r.value)}</td><td class="bp-num bp-dim">${r.share.toFixed(2)} %</td>
      <td class="bp-num bp-dim">${num(r.shares)}</td>
      <td class="bp-num ${r.dShares == null ? '' : cls(r.dShares)}">${r.dShares == null ? '—' : pct(r.dShares, 1)}</td></tr>`).join('');
    return `${head}
      <div class="bp-card"><h3 class="bp-h">Plus grosses positions</h3><div class="bp-scroll"><table class="bp-table">
        <thead><tr><th>#</th><th>Titre</th><th class="bp-num">Valeur</th><th class="bp-num">Poids</th><th class="bp-num">Titres</th><th class="bp-num">Δ titres</th></tr></thead>
        <tbody>${trs}</tbody></table></div></div>
      <div class="bp-two">${moversTable('Plus gros achats du trimestre', mv.buys, 1)}${moversTable('Plus grosses ventes du trimestre', mv.sells, -1)}</div>`;
  }

  function renderAll() {
    const banks = ORDER.filter((b) => data[b] && data[b][0]);
    if (!banks.length) return '<p class="bp-empty">Pas encore de données : le robot lit les déclarations 13F de la SEC chaque matin.</p>';
    const an = {};
    banks.forEach((b) => { an[b] = analyse(b); });

    const trs = banks.map((b) => {
      const a = an[b];
      const top3 = a.rows.slice(0, 3).map((r) => nice(r.name)).join(' · ');
      return `<tr class="bp-click" data-bank="${b}"><td class="bp-name"><b>${NAMES[b]}</b></td>
        <td class="bp-num">${money(a.cur.total_value)}</td>
        <td class="bp-num ${a.dTotal == null ? '' : cls(a.dTotal)}">${a.dTotal == null ? '—' : pct(a.dTotal)}</td>
        <td class="bp-num bp-dim">${a.cur.n_positions.toLocaleString('fr-FR')}</td>
        <td class="bp-dim bp-top3">${top3}</td>
        <td class="bp-num bp-dim">${qLabel(a.cur.period)}</td></tr>`;
    }).join('');

    // cumul de toutes les banques : titres les plus détenus et plus gros flux (banques ayant les 2 trimestres comparables)
    const hold = new Map();
    const flows = new Map();
    banks.forEach((b) => {
      an[b].rows.forEach((r) => {
        const h = hold.get(r.cusip) || { name: r.name, value: 0 };
        h.value += r.value; hold.set(r.cusip, h);
        if (r.flow != null) { const f = flows.get(r.cusip) || { name: r.name, flow: 0, isNew: false }; f.flow += r.flow; flows.set(r.cusip, f); }
      });
    });
    const topHold = [...hold.values()].sort((x, y) => y.value - x.value).slice(0, 15);
    const fl = [...flows.values()];
    const buys = fl.filter((x) => x.flow > 0).sort((x, y) => y.flow - x.flow).slice(0, 10);
    const sells = fl.filter((x) => x.flow < 0).sort((x, y) => x.flow - y.flow).slice(0, 10);
    const simple = (title, list, sign) => (list.length ? `<div class="bp-card"><h3 class="bp-h">${title}</h3><table class="bp-table"><tbody>${list.map((r) =>
      `<tr><td class="bp-name">${nice(r.name)}</td><td class="bp-num ${sign > 0 ? 'bp-pos' : 'bp-neg'}">${(sign > 0 ? '+' : '−') + money(Math.abs(r.flow))}</td></tr>`).join('')}</tbody></table></div>` : '');

    return `<div class="bp-card"><h3 class="bp-h">Les banques et gestionnaires <span class="bp-dim">(clique sur une ligne pour le détail)</span></h3><div class="bp-scroll"><table class="bp-table">
        <thead><tr><th>Banque</th><th class="bp-num">Portefeuille</th><th class="bp-num">Variation</th><th class="bp-num">Lignes</th><th class="bp-top3">3 plus grosses positions</th><th class="bp-num">Trimestre</th></tr></thead>
        <tbody>${trs}</tbody></table></div></div>
      <div class="bp-two">
        <div class="bp-card"><h3 class="bp-h">Titres les plus détenus (cumul des banques)</h3><table class="bp-table"><tbody>${topHold.map((r, i) =>
          `<tr><td class="bp-rank">${i + 1}</td><td class="bp-name">${nice(r.name)}</td><td class="bp-num">${money(r.value)}</td></tr>`).join('')}</tbody></table></div>
        <div>${simple('Plus gros achats cumulés du trimestre', buys, 1)}${simple('Plus grosses ventes cumulées du trimestre', sells, -1)}</div>
      </div>`;
  }

  function render() {
    if (!body) return;
    bar.querySelectorAll('.seas-chip').forEach((c) => c.classList.toggle('is-active', c.dataset.bank === sel));
    body.innerHTML = sel === 'ALL' ? renderAll() : renderOne(sel);
  }

  function build() {
    if (built) return;
    const sec = document.getElementById(PANEL_ID);
    if (!sec) return;
    built = true;
    sec.innerHTML = '';
    bar = document.createElement('div');
    bar.className = 'calendar-toolbar seas-toolbar';
    bar.innerHTML = '<span class="calendar-toolbar-title">Position des banques</span><div class="calendar-toolbar-tools">' +
      [['ALL', 'Toutes']].concat(ORDER.map((b) => [b, NAMES[b]])).map(([k, l]) => `<button type="button" class="seas-chip" data-bank="${k}">${l}</button>`).join('') + '</div>';
    sec.appendChild(bar);
    const note = document.createElement('p');
    note.className = 'seas-note bp-note';
    note.textContent = 'Source : déclarations 13F déposées à la SEC (actions, ETF et obligations convertibles américaines, hors options). Publiées environ 45 jours après la fin du trimestre, donc pas en temps réel. Les banques ne publient pas leurs positions de change. Variation d\'un titre = évolution du nombre de titres détenus ; achats / ventes = variation du nombre de titres × prix du titre, estimés sur les 300 plus grosses lignes.';
    sec.appendChild(note);
    body = document.createElement('div');
    body.className = 'bp-body';
    sec.appendChild(body);
    bar.addEventListener('click', (ev) => {
      const b = ev.target.closest('.seas-chip');
      if (!b) return;
      sel = b.dataset.bank;
      try { localStorage.setItem(LS_SEL, sel); } catch (e) { /* ignore */ }
      render();
    });
    body.addEventListener('click', (ev) => {
      const tr = ev.target.closest('tr[data-bank]');
      if (!tr) return;
      sel = tr.dataset.bank;
      try { localStorage.setItem(LS_SEL, sel); } catch (e) { /* ignore */ }
      render();
      window.scrollTo({ top: 0 });
    });
    body.innerHTML = '<p class="bp-empty">Chargement…</p>';
  }

  async function load() {
    if (loading || (loadedAt && Date.now() - loadedAt < 30 * 60 * 1000)) return;
    const client = window.Auth && window.Auth.getClient && window.Auth.getClient();
    if (!client) return;
    loading = true;
    try {
      const { data: rows, error } = await client.from('bank_13f').select('bank,period,filed,total_value,n_positions,holdings').order('period', { ascending: false });
      if (error) throw error;
      data = {};
      (rows || []).forEach((r) => { (data[r.bank] = data[r.bank] || []).push(r); });
      Object.keys(data).forEach((b) => data[b].sort((x, y) => (x.period < y.period ? 1 : -1)));
      loadedAt = Date.now();
      if (!ORDER.includes(sel) && sel !== 'ALL') sel = 'ALL';
      render();
    } catch (e) {
      if (body) body.innerHTML = '<p class="bp-empty">Impossible de charger les données (' + esc(e && e.message || e) + ').</p>';
    } finally { loading = false; }
  }

  window.BankPos = { refresh() { build(); render(); load(); } };
})();
