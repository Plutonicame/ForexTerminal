'use strict';

/**
 * macro.js — fenêtre « Données macro » : inflation (CPI sur 1 an), chômage et PIB (trimestre sur trimestre)
 * des 8 devises, sous forme de tableau. Données lues dans la table macro_data (edge function macro-bot :
 * FRED, Eurostat, ONS, Statistique Canada).
 */
(function () {
  const PANEL_ID = 'tab-macro';
  const CCYS = [['USD', 'États-Unis'], ['EUR', 'Zone euro'], ['GBP', 'Royaume-Uni'], ['JPY', 'Japon'], ['CAD', 'Canada'], ['AUD', 'Australie'], ['NZD', 'Nouvelle-Zélande'], ['CHF', 'Suisse']];
  const IND = [['cpi', 'Inflation (CPI, sur 1 an)'], ['unemp', 'Chômage'], ['gdp', 'PIB (trimestre sur trimestre)']];
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  let wrap = null; let loading = false; let sig = '';

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtVal = (v) => (v == null ? '–' : `${Number(v).toFixed(1)} %`);
  function fmtRef(d, quarterly) {
    if (!d) return '–';
    const [y, m] = d.split('-').map(Number);
    return quarterly ? `T${Math.floor((m - 1) / 3) + 1} ${y}` : `${MOIS[m - 1]} ${y}`;
  }
  function cell(row, ind, ccy) {
    if (!row || row.value == null) return '<td class="mc-v">–</td><td class="mc-p">–</td><td class="mc-d">–</td>';
    const diff = row.previous == null ? 0 : Number(row.value) - Number(row.previous);
    const cls = Math.abs(diff) < 0.005 ? 'mc-flat' : diff > 0 ? 'mc-up' : 'mc-down';
    const arrow = cls === 'mc-up' ? '▲' : cls === 'mc-down' ? '▼' : '■';
    return `<td class="mc-v ${cls}"><span class="mc-arrow">${arrow}</span>${fmtVal(row.value)}</td><td class="mc-p">${fmtVal(row.previous)}</td><td class="mc-d" title="${esc(row.source || '')}">${esc(fmtRef(row.ref_date, ind === 'gdp' || (ind === 'unemp' && (ccy === 'NZD' || ccy === 'CHF'))))}</td>`;
  }

  function ensure() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return null;
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'macro-wrap';
      wrap.innerHTML = `<div class="calendar-toolbar"><span class="calendar-toolbar-title">Données macro</span></div>
        <div class="macro-scroll"><table class="macro-table"><thead>
          <tr class="mt-groups"><th rowspan="2" class="mt-ccy">Devise</th>${IND.map(([, l]) => `<th colspan="3">${l}</th>`).join('')}</tr>
          <tr class="mt-sub">${IND.map(() => '<th>Actuel</th><th>Précédent</th><th>Période</th>').join('')}</tr></thead>
          <tbody><tr><td colspan="10" class="mc-empty">Chargement…</td></tr></tbody></table></div>
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
      wrap.querySelector('tbody').innerHTML = CCYS.map(([k, name]) => `<tr><td class="mt-ccy"><b>${k}</b><span>${esc(name)}</span></td>${IND.map(([i]) => cell(by[`${k}.${i}`], i, k)).join('')}</tr>`).join('');
      const upd = rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), '');
      const srcs = [...new Set(rows.map((r) => r.source).filter(Boolean))].join(', ');
      wrap.querySelector('.macro-foot').textContent = `Sources : ${srcs || '–'}.${upd ? ' Mis à jour le ' + new Date(upd).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + '.' : ''} Flèche : variation par rapport à la publication précédente. Les chiffres du PIB sont en variation trimestrielle.`;
    } catch (e) { console.warn('macro.js', e); } finally { loading = false; }
  }

  window.Macro = { refresh: load };
  document.addEventListener('DOMContentLoaded', () => {
    ensure();
    if (window.Auth) window.Auth.onAuthStateChange((s) => { if (s) load(); });
    setInterval(() => { const p = document.getElementById(PANEL_ID); if (!document.hidden && p && !p.hidden) load(); }, 30 * 60 * 1000);
  });
})();
