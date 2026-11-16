'use strict';

/**
 * macro.js — fenêtre « Données macro » : inflation (CPI sur 1 an), chômage et PIB (trimestre sur trimestre)
 * des 8 devises, sous forme de tableau. Données lues dans la table macro_data (edge function macro-bot :
 * FRED, Eurostat, ONS, Statistique Canada).
 */
(function () {
  const PANEL_ID = 'tab-macro';
  const CCYS = [['USD', 'États-Unis'], ['EUR', 'Zone euro'], ['GBP', 'Royaume-Uni'], ['JPY', 'Japon'], ['CAD', 'Canada'], ['AUD', 'Australie'], ['NZD', 'Nouvelle-Zélande'], ['CHF', 'Suisse']];
  // une colonne par donnée, rangées par thème : Croissance / Emploi / Inflation
  const GROUPS = [
    ['Croissance', [['gdp', 'PIB', 'pct'], ['pmi', 'PMI', 'idx']]],
    ['Emploi', [['unemp', 'Chômage', 'pct'], ['nfp', 'NFP', 'k']]],
    ['Inflation', [['cpi', 'CPI', 'pct'], ['ppi', 'PPI', 'pct']]],
  ];
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  let wrap = null; let loading = false; let sig = '';

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Sens de lecture : +1 = plus haut c'est bon (bleu), -1 = plus haut c'est mauvais (donc plus bas = bon, bleu).
  const POLARITY = { gdp: 1, pmi: 1, unemp: -1, nfp: 1, cpi: 1, ppi: 1 };
  const UNIT_DEFAULT = { nfp: 'K', pmi: '' };
  const num = (v) => String(parseFloat(Number(v).toFixed(2)));
  function fmtVal(v, unit, ind) {
    const n = Number(v);
    if (unit === 'K') return `${n > 0 ? '+' : ''}${num(n)} k`;
    if (unit === 'M' || unit === 'B') return `${num(n)} ${unit}`;
    if (unit === '%') return `${ind === 'nfp' && n > 0 ? '+' : ''}${num(n)} %`;
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
      return { value: cal.value, previous: cal.previous, unit: cal.unit, tag: /m\/m$/.test(t) ? 'm/m' : (/q\/q$/.test(t) && ind !== 'gdp' ? 'q/q' : ''), tip: `${t} · ${new Date(cal.event_time).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short' })} (calendrier)` };
    }
    if (!fb) return null;
    const quarterly = ind === 'gdp';
    return { value: fb.value, previous: fb.previous, unit: UNIT_DEFAULT[ind] != null ? UNIT_DEFAULT[ind] : '%', tag: '', tip: `${fmtRef(fb.ref_date, quarterly)} · ${fb.source || ''}` };
  }
  function cell(row, ind, first) {
    const g = first ? ' mt-gstart' : '';
    if (!row || row.value == null) return `<td class="mc-v mc-none${g}">–</td>`;
    const diff = row.previous == null ? 0 : Number(row.value) - Number(row.previous);
    const move = Math.abs(diff) < 0.005 ? 0 : diff > 0 ? 1 : -1;
    const good = move * POLARITY[ind];
    const cls = move === 0 ? 'mc-flat' : good > 0 ? 'mc-good' : 'mc-bad';
    const arrow = move > 0 ? '▲' : move < 0 ? '▼' : '■';
    const tip = `${row.tip} · précédent ${row.previous == null ? '–' : fmtVal(row.previous, row.unit, ind)}`;
    return `<td class="mc-v ${cls}${g}" title="${esc(tip)}"><span class="mc-arrow">${arrow}</span>${fmtVal(row.value, row.unit, ind)}${row.tag ? `<span class="mc-tag">${row.tag}</span>` : ''}</td>`;
  }

  function ensure() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return null;
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'macro-wrap';
      wrap.innerHTML = `<div class="calendar-toolbar"><span class="calendar-toolbar-title">Données macro</span></div>
        <div class="macro-scroll"><table class="macro-table"><thead>
          <tr class="mt-groups"><th rowspan="2" class="mt-ccy">Devise</th>${GROUPS.map(([g, cols]) => `<th colspan="${cols.length}" class="mt-gstart">${g}</th>`).join('')}</tr>
          <tr class="mt-sub">${GROUPS.map(([, cols]) => cols.map(([, l], i) => `<th class="${i === 0 ? 'mt-gstart' : ''}">${l}</th>`).join('')).join('')}</tr></thead>
          <tbody><tr><td colspan="7" class="mc-empty">Chargement…</td></tr></tbody></table></div>
        <p class="macro-foot"></p>`;
      panel.appendChild(wrap);
    }
    return wrap;
  }

  async function load() {
    if (!ensure() || loading || !window.Auth || !window.Auth.isConfigured()) return;
    const c = window.Auth.getClient(); if (!c) return;
    loading = true;
    try {
      if (!(await window.Auth.getSession())) return;
      const [fbRes, calRes] = await Promise.all([
        c.from('macro_data').select('ccy,indicator,value,previous,ref_date,prev_date,source,updated_at'),
        c.from('macro_calendar').select('ccy,indicator,value,previous,unit,event_time,event_title,score,updated_at'),
      ]);
      if (fbRes.error) throw fbRes.error;
      const fbRows = fbRes.data || []; const calRows = calRes.error ? [] : (calRes.data || []);
      const s = fbRows.map((r) => `${r.ccy}${r.indicator}${r.value}${r.ref_date}`).join('|') + '#' + calRows.map((r) => `${r.ccy}${r.indicator}${r.value}${r.event_time}`).join('|');
      if (s === sig) return; sig = s;
      const fb = {}; fbRows.forEach((r) => { fb[`${r.ccy}.${r.indicator}`] = r; });
      const cal = {}; calRows.forEach((r) => { cal[`${r.ccy}.${r.indicator}`] = r; });
      const by = {};
      CCYS.forEach(([k]) => GROUPS.forEach(([, cols]) => cols.forEach(([i]) => { by[`${k}.${i}`] = pick(cal[`${k}.${i}`], fb[`${k}.${i}`], i); })));
      const rows = fbRows.concat(calRows);
      wrap.querySelector('tbody').innerHTML = CCYS.map(([k, name]) => `<tr><td class="mt-ccy"><b>${k}</b><span>${esc(name)}</span></td>${GROUPS.map(([, cols]) => cols.map(([i], n) => cell(by[`${k}.${i}`], i, n === 0)).join('')).join('')}</tr>`).join('');
      const upd = rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), '');
      const srcs = ['Calendrier économique (temps réel)', ...new Set(fbRows.map((r) => r.source).filter(Boolean))].join(', ');
      wrap.querySelector('.macro-foot').textContent = `Sources : ${srcs || '–'}.${upd ? ' Mis à jour le ' + new Date(upd).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + '.' : ''} Flèche : sens de la variation depuis la publication précédente. Bleu = bon signe, rouge = mauvais signe (le chômage est inversé : plus bas = bleu). Survolez une case pour voir l'événement, la date et la valeur précédente.`;
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
