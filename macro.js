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
  function fmtVal(v, kind) {
    const n = Number(v);
    if (kind === 'k') return `${n > 0 ? '+' : ''}${Math.round(n)} k`;
    if (kind === 'idx') return n.toFixed(1);
    return `${n.toFixed(1)} %`;
  }
  function fmtRef(d, quarterly) {
    if (!d) return '';
    const [y, m] = d.split('-').map(Number);
    return quarterly ? `T${Math.floor((m - 1) / 3) + 1} ${y}` : `${MOIS[m - 1]} ${y}`;
  }
  function cell(row, ind, kind, ccy, first) {
    const g = first ? ' mt-gstart' : '';
    if (!row || row.value == null) return `<td class="mc-v mc-none${g}">–</td>`;
    const diff = row.previous == null ? 0 : Number(row.value) - Number(row.previous);
    const cls = Math.abs(diff) < 0.005 ? 'mc-flat' : diff > 0 ? 'mc-up' : 'mc-down';
    const arrow = cls === 'mc-up' ? '▲' : cls === 'mc-down' ? '▼' : '■';
    const quarterly = ind === 'gdp' || (ind === 'unemp' && (ccy === 'NZD' || ccy === 'CHF'));
    const tip = `${fmtRef(row.ref_date, quarterly)} · précédent ${fmtVal(row.previous, kind)} · ${row.source || ''}`;
    return `<td class="mc-v ${cls}${g}" title="${esc(tip)}"><span class="mc-arrow">${arrow}</span>${fmtVal(row.value, kind)}</td>`;
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
      const { data, error } = await c.from('macro_data').select('ccy,indicator,value,previous,ref_date,prev_date,source,updated_at');
      if (error) throw error;
      const rows = data || [];
      const s = rows.map((r) => `${r.ccy}${r.indicator}${r.value}${r.ref_date}`).join('|');
      if (s === sig) return; sig = s;
      const by = {}; rows.forEach((r) => { by[`${r.ccy}.${r.indicator}`] = r; });
      wrap.querySelector('tbody').innerHTML = CCYS.map(([k, name]) => `<tr><td class="mt-ccy"><b>${k}</b><span>${esc(name)}</span></td>${GROUPS.map(([, cols]) => cols.map(([i, , kind], n) => cell(by[`${k}.${i}`], i, kind, k, n === 0)).join('')).join('')}</tr>`).join('');
      const upd = rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), '');
      const srcs = [...new Set(rows.map((r) => r.source).filter(Boolean))].join(', ');
      wrap.querySelector('.macro-foot').textContent = `Sources : ${srcs || '–'}.${upd ? ' Mis à jour le ' + new Date(upd).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + '.' : ''} Flèche : variation par rapport à la publication précédente (survolez une case pour la période et la valeur précédente). PIB : variation trimestrielle ; CPI et PPI : sur 1 an ; NFP : variation mensuelle de l'emploi américain.`;
    } catch (e) { console.warn('macro.js', e); } finally { loading = false; }
  }

  window.Macro = { refresh: load };
  document.addEventListener('DOMContentLoaded', () => {
    ensure();
    if (window.Auth) window.Auth.onAuthStateChange((s) => { if (s) load(); });
    setInterval(() => { const p = document.getElementById(PANEL_ID); if (!document.hidden && p && !p.hidden) load(); }, 30 * 60 * 1000);
  });
})();
