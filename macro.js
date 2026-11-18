'use strict';

/**
 * macro.js — fenêtre « Données macro » : inflation (CPI sur 1 an), chômage et PIB (trimestre sur trimestre)
 * des 8 devises, sous forme de tableau. Données lues dans la table macro_data (edge function macro-bot :
 * FRED, Eurostat, ONS, Statistique Canada).
 */
(function () {
  const PANEL_ID = 'tab-macro';
  const CCYS = [['USD', 'États-Unis'], ['EUR', 'Zone euro'], ['GBP', 'Royaume-Uni'], ['JPY', 'Japon'], ['CAD', 'Canada'], ['AUD', 'Australie'], ['NZD', 'Nouvelle-Zélande'], ['CHF', 'Suisse']];
  // Colonnes principales (toujours visibles) et colonnes de détail (dépliées par le triangle du titre du groupe).
  const GROUPS = [
    { id: 'growth', label: 'Croissance', main: [['gdp', 'PIB'], ['pmi', 'PMI manuf.']],
      extra: [['pmi_svc', 'PMI services'], ['pmi_comp', 'PMI composite'], ['retail', 'Ventes au détail'], ['indprod', 'Prod. industrielle'], ['sentiment', 'Confiance conso.'], ['regional', 'Enquête régionale']] },
    { id: 'jobs', label: 'Emploi', main: [['unemp', 'Chômage'], ['nfp', 'NFP']],
      extra: [['adp', 'ADP'], ['claims', 'Inscriptions chômage'], ['jolts', 'Offres d\'emploi'], ['wages', 'Salaires']] },
    { id: 'infl', label: 'Inflation', main: [['cpi', 'CPI'], ['ppi', 'PPI']],
      extra: [['core_cpi', 'CPI core'], ['core_ppi', 'PPI core'], ['pce', 'PCE core'], ['infl_exp', 'Attentes d\'inflation']] },
    { id: 'rates', label: 'Taux', main: [['rate', 'Prochaine réunion']], extra: [] },
  ];
  const OPEN_KEY = 'fxt-macro-open';
  let openG = {};
  try { openG = JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') || {}; } catch (e) { openG = {}; }
  const cols = (g) => g.main.concat(openG[g.id] ? g.extra : []);
  let model = null; // dernières données reçues (pour redessiner au dépliage sans recharger)
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  let wrap = null; let loading = false; let sig = '';

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Sens de lecture : +1 = plus haut c'est bon (bleu), -1 = plus haut c'est mauvais (donc plus bas = bon, bleu).
  const POLARITY = { gdp: 1, pmi: 1, pmi_svc: 1, pmi_comp: 1, retail: 1, indprod: 1, sentiment: 1, regional: 1, unemp: -1, nfp: 1, adp: 1, claims: -1, jolts: 1, wages: 1, cpi: 1, ppi: 1, core_cpi: 1, core_ppi: 1, pce: 1, infl_exp: 1 };
  const UNIT_DEFAULT = { nfp: 'K', pmi: '' };
  const num = (v) => String(parseFloat(Number(v).toFixed(2)));
  function fmtVal(v, unit, ind) {
    const n = Number(v);
    const signed = ind === 'nfp' || ind === 'adp';
    if (unit === 'K') return `${signed && n > 0 ? '+' : ''}${num(n)} k`;
    if (unit === 'M' || unit === 'B') return `${num(n)} ${unit}`;
    if (unit === '%') return `${signed && n > 0 ? '+' : ''}${num(n)} %`;
    return num(n);
  }
  function fmtRef(d, quarterly) {
    if (!d) return '';
    const [y, m] = d.split('-').map(Number);
    return quarterly ? `T${Math.floor((m - 1) / 3) + 1} ${y}` : `${MOIS[m - 1]} ${y}`;
  }
  // calendrier (temps réel, prioritaire s'il donne la mesure habituelle) sinon dernières données publiques
  function pick(cal, fb, ind) {
    const useCal = cal && (cal.score >= 3 || !fb);
    if (useCal) {
      const t = cal.event_title || '';
      return { value: cal.value, previous: cal.previous, unit: cal.unit, tag: /3m\/y$/.test(t) ? '3m/a' : /m\/m$/.test(t) ? 'm/m' : (/q\/q$/.test(t) && ind !== 'gdp' ? 'q/q' : ''), tip: `${t} · ${new Date(cal.event_time).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short' })} (calendrier)` };
    }
    if (!fb) return null;
    const quarterly = ind === 'gdp';
    return { value: fb.value, previous: fb.previous, unit: UNIT_DEFAULT[ind] != null ? UNIT_DEFAULT[ind] : '%', tag: '', tip: `${fmtRef(fb.ref_date, quarterly)} · ${fb.source || ''}` };
  }
  function cell(row, ind, first, extra) {
    const g = (first ? ' mt-gstart' : '') + (extra ? ' mt-extra' : '');
    if (!row || row.value == null) return `<td class="mc-v mc-none${g}">–</td>`;
    const diff = row.previous == null ? 0 : Number(row.value) - Number(row.previous);
    const move = Math.abs(diff) < 0.005 ? 0 : diff > 0 ? 1 : -1;
    const good = move * POLARITY[ind];
    const cls = move === 0 ? 'mc-flat' : good > 0 ? 'mc-good' : 'mc-bad';
    const arrow = move > 0 ? '▲' : move < 0 ? '▼' : '■';
    const tip = `${row.tip} · précédent ${row.previous == null ? '–' : fmtVal(row.previous, row.unit, ind)}`;
    return `<td class="mc-v ${cls}${g}" title="${esc(tip)}"><span class="mc-arrow">${arrow}</span>${fmtVal(row.value, row.unit, ind)}${row.tag ? `<span class="mc-tag">${row.tag}</span>` : ''}</td>`;
  }

  // Taux : issue la plus probable pour la prochaine réunion (Polymarket)
  function rateCell(r, first) {
    const g = first ? ' mt-gstart' : '';
    if (!r) return `<td class="mc-v mc-none${g}">–</td>`;
    const c = r.current || {};
    const opts = [['hold', 'Maintien', c.none, 0], ['up', '25 bps', c.up25, 1], ['down', '25 bps', c.down25, -1], ['up', '50 bps+', c.otherUp, 1], ['down', '50 bps+', c.otherDown, -1]]
      .filter((o) => Number.isFinite(Number(o[2])));
    if (!opts.length) return `<td class="mc-v mc-none${g}">–</td>`;
    const best = opts.reduce((m, o) => (Number(o[2]) > Number(m[2]) ? o : m));
    const cls = best[0] === 'up' ? 'mc-rup' : best[0] === 'down' ? 'mc-rdown' : 'mc-rflat';
    const arrow = best[0] === 'up' ? '▲' : best[0] === 'down' ? '▼' : '■';
    const when = new Date(r.meeting_at).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short' });
    const tip = `${r.bank} · réunion du ${when} · ` + opts.map((o) => `${o[1]}${o[0] === 'up' ? ' (hausse)' : o[0] === 'down' ? ' (baisse)' : ''} ${Math.round(Number(o[2]))} %`).join(' · ') + ' (Polymarket)';
    return `<td class="mc-v ${cls}${g}" title="${esc(tip)}"><span class="mc-arrow">${arrow}</span>${best[1]}<span class="mc-tag mc-prob">${Math.round(Number(best[2]))} %</span></td>`;
  }

  function headHtml() {
    const g1 = GROUPS.map((g) => {
      const n = cols(g).length;
      const toggle = g.extra.length ? `<button type="button" class="mt-toggle${openG[g.id] ? ' is-open' : ''}" data-g="${g.id}" aria-expanded="${openG[g.id] ? 'true' : 'false'}" title="${openG[g.id] ? 'Masquer' : 'Afficher'} les détails (${g.extra.map((e) => e[1]).join(', ')})"><span class="mt-tri">▶</span></button>` : '';
      return `<th colspan="${n}" class="mt-gstart"><span class="mt-gname">${g.label}</span>${toggle}</th>`;
    }).join('');
    const g2 = GROUPS.map((g) => cols(g).map(([, l], i) => `<th class="${i === 0 ? 'mt-gstart' : ''}${i >= g.main.length ? ' mt-extra' : ''}">${l}</th>`).join('')).join('');
    return `<tr class="mt-groups"><th rowspan="2" class="mt-ccy">Devise</th>${g1}</tr><tr class="mt-sub">${g2}</tr>`;
  }

  function render() {
    if (!wrap) return;
    wrap.querySelector('thead').innerHTML = headHtml();
    if (!model) return;
    wrap.querySelector('tbody').innerHTML = CCYS.map(([k, name]) => `<tr><td class="mt-ccy"><b>${k}</b><span>${esc(name)}</span></td>${GROUPS.map((g) => cols(g).map(([i], n) => (i === 'rate' ? rateCell(model.rates[k], n === 0) : cell(model.by[`${k}.${i}`], i, n === 0, n >= g.main.length))).join('')).join('')}</tr>`).join('');
    wrap.querySelector('.macro-foot').textContent = model.foot;
  }

  function ensure() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return null;
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'macro-wrap';
      wrap.innerHTML = `<div class="calendar-toolbar"><span class="calendar-toolbar-title">Données macro</span></div>
        <div class="macro-scroll"><table class="macro-table"><thead></thead>
          <tbody><tr><td colspan="9" class="mc-empty">Chargement…</td></tr></tbody></table></div>
        <p class="macro-foot"></p>`;
      panel.appendChild(wrap);
      wrap.addEventListener('click', (ev) => {
        const b = ev.target.closest('.mt-toggle'); if (!b) return;
        openG[b.dataset.g] = !openG[b.dataset.g];
        try { localStorage.setItem(OPEN_KEY, JSON.stringify(openG)); } catch (e) { /* ignore */ }
        render();
      });
      render();
    }
    return wrap;
  }

  async function load() {
    if (!ensure() || loading || !window.Auth || !window.Auth.isConfigured()) return;
    const c = window.Auth.getClient(); if (!c) return;
    loading = true;
    try {
      if (!(await window.Auth.getSession())) return;
      const [fbRes, calRes, rtRes] = await Promise.all([
        c.from('macro_data').select('ccy,indicator,value,previous,ref_date,prev_date,source,updated_at'),
        c.from('macro_calendar').select('ccy,indicator,value,previous,unit,event_time,event_title,score,updated_at'),
        c.from('rate_expectations').select('currency,bank,meeting_at,current').gte('meeting_at', new Date().toISOString()).order('meeting_at', { ascending: true }),
      ]);
      if (fbRes.error) throw fbRes.error;
      const fbRows = fbRes.data || []; const calRows = calRes.error ? [] : (calRes.data || []); const rtRows = rtRes.error ? [] : (rtRes.data || []);
      const s = fbRows.map((r) => `${r.ccy}${r.indicator}${r.value}${r.ref_date}`).join('|') + '#' + calRows.map((r) => `${r.ccy}${r.indicator}${r.value}${r.event_time}`).join('|') + '#' + rtRows.map((r) => `${r.currency}${r.meeting_at}${JSON.stringify(r.current)}`).join('|');
      if (s === sig) return; sig = s;
      const fb = {}; fbRows.forEach((r) => { fb[`${r.ccy}.${r.indicator}`] = r; });
      const cal = {}; calRows.forEach((r) => { cal[`${r.ccy}.${r.indicator}`] = r; });
      const by = {};
      CCYS.forEach(([k]) => GROUPS.forEach((g) => g.main.concat(g.extra).forEach(([i]) => { by[`${k}.${i}`] = pick(cal[`${k}.${i}`], fb[`${k}.${i}`], i); })));
      const rates = {}; rtRows.forEach((r) => { if (!rates[r.currency]) rates[r.currency] = r; }); // réunion la plus proche
      const rows = fbRows.concat(calRows);
      const upd = rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), '');
      const srcs = ['Calendrier économique (temps réel)', ...new Set(fbRows.map((r) => r.source).filter(Boolean)), 'Polymarket (taux)'].join(', ');
      model = { by, rates, foot: `Sources : ${srcs}.${upd ? ' Mis à jour le ' + new Date(upd).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + '.' : ''} Flèche : sens de la variation depuis la publication précédente. Bleu = bon signe, rouge = mauvais signe (le chômage est inversé : plus bas = bleu). Taux : issue la plus probable pour la prochaine réunion de la banque centrale. Le triangle à droite d'un titre affiche plus de données. Survolez une case pour le détail.` };
      render();
    } catch (e) { console.warn('macro.js', e); } finally { loading = false; }
  }

  window.Macro = { refresh: load };
  document.addEventListener('DOMContentLoaded', () => {
    ensure();
    if (window.Auth) window.Auth.onAuthStateChange((s) => {
      if (!s) return;
      load();
      try { const c = window.Auth.getClient(); if (c && c.channel && !window.__macroRt) { window.__macroRt = c.channel('macro-calendar').on('postgres_changes', { event: '*', schema: 'public', table: 'macro_calendar' }, () => load()).subscribe(); } } catch (e) { /* le rafraîchissement régulier prend le relais */ }
    });
    setInterval(() => { const p = document.getElementById(PANEL_ID); if (!document.hidden && p && !p.hidden) load(); }, 60 * 1000);
  });
})();
