'use strict';

/**
 * cot.js — zone « COT · Positionnement » dans chaque onglet de devise de l'analyse
 * (carte institutionnelle issue du rapport hebdomadaire de la CFTC ; les cartes retail viennent de retail.js).
 *
 * Données : table Supabase "cot_positions", remplie par le bot "cot-bot" qui lit le rapport
 * hebdomadaire « Traders in Financial Futures » de la CFTC (publié le vendredi, chiffres du mardi).
 * Un camembert (Long / Short), précisions à droite :
 *   - COT Institutionnels : gestionnaires d'actifs + fonds à effet de levier.
 * (Le COT « non déclarables » de la CFTC n'est plus affiché : on ne sait pas si ces traders gagnent ou perdent.
 *  Le retail à majorité perdante est dans retail.js.)
 * Les couleurs se changent dans style.css (variables --cot-*) ou dans Paramètres > Analyse.
 */
(function () {
  const REFRESH_MS = 5 * 60 * 1000; // le bot vérifie la CFTC toutes les 5 minutes
  const NF = new Intl.NumberFormat('fr-FR');

  let rows = {};
  let loaded = false;
  let failed = false;
  let loading = false;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const int = (n) => NF.format(Math.round(n));
  const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + NF.format(Math.abs(Math.round(n)));
  const pct = (v) => (Number.isFinite(v)
    ? v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %'
    : '—');

  // La flèche suit le chiffre ; la couleur suit l'effet sur la devise :
  // plus de Long / de Net = vert (haussier), plus de Short = rouge (baissier) -> bearishWhenUp.
  function delta(n, bearishWhenUp) {
    if (!Number.isFinite(n)) return '';
    if (n === 0) return '<span class="cot-delta">= 0</span>';
    const good = bearishWhenUp ? n < 0 : n > 0;
    return `<span class="cot-delta ${good ? 'cot-delta--up' : 'cot-delta--down'}">${n > 0 ? '▲' : '▼'} ${signed(n)}</span>`;
  }

  function parseDay(iso) { // 'YYYY-MM-DD' -> Date locale à midi (évite les décalages de fuseau)
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
  }
  const fmtDate = (d) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fmtShortDay = (d) => d.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit' });
  const fmtTime = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  // Instant correspondant à hh:mm à New York le jour y-m-d (la CFTC publie à 15h30 heure de New York).
  function newYorkInstant(y, m, d, hh, mm) {
    const guess = Date.UTC(y, m - 1, d, hh, mm);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    }).formatToParts(new Date(guess)).reduce((a, p) => { a[p.type] = Number(p.value); return a; }, {});
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    return guess + (guess - asUtc);
  }

  // Prochain rapport = date du rapport (mardi) + 10 jours = vendredi suivant, 15h30 à New York.
  function nextRelease(reportIso) {
    const base = parseDay(reportIso);
    base.setDate(base.getDate() + 10);
    return { day: base, at: newYorkInstant(base.getFullYear(), base.getMonth() + 1, base.getDate(), 15, 30) };
  }

  // -------------------------------------------------------------------------
  // Emplacement dans le panneau : après le calendrier et les attentes de taux, avant les discours
  // -------------------------------------------------------------------------
  // Zone « COT · Positionnement » partagée avec retail.js : un bandeau, la carte institutionnelle (cot.js),
  // puis les cartes retail (retail.js). Chaque script n'écrit que dans son propre emplacement.
  function ensureCotShell(panel) {
    let section = panel.querySelector('.cot');
    if (!section) {
      section = document.createElement('div');
      section.className = 'cot';
      section.innerHTML = '<div class="cot-head"></div><div class="cot-institutional"></div><div class="cot-retail"></div>';
      const anchor = panel.querySelector('.rates') || panel.querySelector('.calendar');
      panel.insertBefore(section, anchor ? anchor.nextSibling : panel.firstChild);
    }
    return section;
  }

  // -------------------------------------------------------------------------
  // Camembert Long / Short
  // -------------------------------------------------------------------------
  function pieSvg(long, short, cls, labels) {
    const total = long + short;
    const R = 86, C = 100;
    if (!(total > 0)) return '<div class="cot-pie-empty">—</div>';
    const slices = [
      { key: 'long', v: long, name: labels.long },
      { key: 'short', v: short, name: labels.short },
    ];
    let angle = -Math.PI / 2;
    let out = '';
    slices.forEach((s) => {
      if (!(s.v > 0)) return;
      const share = s.v / total;
      const a0 = angle;
      const a1 = angle + share * 2 * Math.PI;
      angle = a1;
      const tip = `${s.name} : ${int(s.v)} contrats (${pct(share * 100)})`;
      if (share >= 0.9999) {
        out += `<circle class="cot-slice cot-slice--${cls}-${s.key}" cx="${C}" cy="${C}" r="${R}"><title>${esc(tip)}</title></circle>`;
      } else {
        const x0 = C + R * Math.cos(a0), y0 = C + R * Math.sin(a0);
        const x1 = C + R * Math.cos(a1), y1 = C + R * Math.sin(a1);
        const large = share > 0.5 ? 1 : 0;
        out += `<path class="cot-slice cot-slice--${cls}-${s.key}" d="M${C} ${C} L${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z"><title>${esc(tip)}</title></path>`;
      }
      if (share >= 0.06) {
        const mid = (a0 + a1) / 2;
        const lx = C + R * 0.6 * Math.cos(mid), ly = C + R * 0.6 * Math.sin(mid);
        out += `<text class="cot-slice-label" x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="middle">${pct(share * 100)}</text>`;
      }
    });
    return `<svg class="cot-pie" viewBox="0 0 200 200" role="img" aria-label="${esc(labels.aria)}">${out}</svg>`;
  }

  // -------------------------------------------------------------------------
  // Cartes
  // -------------------------------------------------------------------------
  const net = (s) => (s ? s.long - s.short : NaN);
  const sum = (a, b) => ({ long: a.long + b.long, short: a.short + b.short });

  function biasText(side) {
    const total = side.long + side.short;
    if (!(total > 0)) return '';
    const l = (side.long / total) * 100;
    if (l >= 52) return `Majoritairement acheteur (${pct(l)} long)`;
    if (l <= 48) return `Majoritairement vendeur (${pct(100 - l)} short)`;
    return 'Positionnement équilibré';
  }

  function detailRow(labelHtml, valueHtml, extra) {
    return `<div class="cot-row${extra ? ' ' + extra : ''}"><span class="cot-row-label">${labelHtml}</span><span class="cot-row-value">${valueHtml}</span></div>`;
  }

  function totalsDetails(cur, prev, oi, cls) {
    const t = cur.long + cur.short;
    const dLong = prev ? cur.long - prev.long : NaN;
    const dShort = prev ? cur.short - prev.short : NaN;
    const n = net(cur);
    const dNet = prev ? n - net(prev) : NaN;
    return [
      detailRow(`<i class="cot-dot cot-dot--${cls}-long"></i>Long`, `${int(cur.long)} contrats · <b>${pct(t > 0 ? (cur.long / t) * 100 : NaN)}</b> ${delta(dLong)}`),
      detailRow(`<i class="cot-dot cot-dot--${cls}-short"></i>Short`, `${int(cur.short)} contrats · <b>${pct(t > 0 ? (cur.short / t) * 100 : NaN)}</b> ${delta(dShort, true)}`),
      detailRow('Position nette', `<b>${signed(n)}</b> contrats ${delta(dNet)}`, 'cot-row--sep'),
      oi > 0 ? detailRow('Part de l\'intérêt ouvert', `Long ${pct((cur.long / oi) * 100)} · Short ${pct((cur.short / oi) * 100)}`) : '',
    ].join('');
  }

  function cardInstitutional(c, prevSnap, snap) {
    const cur = sum(snap.asset_mgr, snap.lev_funds);
    const prev = prevSnap ? sum(prevSnap.asset_mgr, prevSnap.lev_funds) : null;
    const labels = { long: 'Long', short: 'Short', aria: 'Institutionnels : répartition long / short' };
    const cat = (name, s, p) => {
      const n = net(s);
      const dn = p ? n - net(p) : NaN;
      return `
        <div class="cot-cat">
          <span class="cot-cat-name">${esc(name)}</span>
          <span class="cot-cat-line">Long ${int(s.long)} · Short ${int(s.short)}</span>
          <span class="cot-cat-line">Net <b>${signed(n)}</b> ${delta(dn)}</span>
        </div>`;
    };
    return `
      <div class="cot-card">
        <div class="cot-card-head">
          <h3 class="cot-card-title">COT Institutionnels</h3>
          <span class="cot-card-sub">Gestionnaires d'actifs + fonds à effet de levier · hebdomadaire · ${esc(c.contract_name)}</span>
        </div>
        <div class="cot-body">
          <div class="cot-pie-wrap">${pieSvg(cur.long, cur.short, 'inst', labels)}</div>
          <div class="cot-details">
            ${totalsDetails(cur, prev, snap.open_interest, 'inst')}
            <p class="cot-bias">${esc(biasText(cur))}</p>
            <div class="cot-cats">
              ${cat('Gestionnaires d\'actifs', snap.asset_mgr, prevSnap ? prevSnap.asset_mgr : null)}
              ${cat('Fonds à effet de levier', snap.lev_funds, prevSnap ? prevSnap.lev_funds : null)}
            </div>
          </div>
        </div>
      </div>`;
  }

  function validSnap(s) {
    const ok = (x) => x && Number.isFinite(x.long) && Number.isFinite(x.short);
    return s && ok(s.retail) && ok(s.asset_mgr) && ok(s.lev_funds) && Number.isFinite(s.open_interest);
  }

  function renderPanel(panel) {
    const code = panel.dataset.currency;
    const section = ensureCotShell(panel);
    const headEl = section.querySelector('.cot-head');
    const bodyEl = section.querySelector('.cot-institutional');
    const c = rows[code];

    const head = (info) => `
      <div class="cot-toolbar">
        <span class="cot-toolbar-title">COT · Positionnement</span>
        <span class="cot-toolbar-info">${info}</span>
      </div>`;

    if (!loaded || !c) {
      const msg = !loaded
        ? (failed ? 'Impossible de charger les données COT pour le moment.' : 'Chargement…')
        : `Pas de données COT pour cette devise (la CFTC ne publie pas de contrat à terme pour ${code}).`;
      const sig = `empty:${msg}`;
      if (section.dataset.sig === sig) return;
      section.dataset.sig = sig;
      headEl.innerHTML = head('');
      bodyEl.innerHTML = `<p class="cot-empty">${esc(msg)}</p>`;
      return;
    }

    const snap = c.data && c.data.current;
    const prevSnap = c.data && validSnap(c.data.previous) ? c.data.previous : null;
    const checkedMs = Date.parse(c.checked_at);
    const checkedTxt = Number.isFinite(checkedMs) ? `vérifié à ${fmtTime(checkedMs)}` : '';

    const sig = `${c.report_date}|${c.updated_at}`;
    if (section.dataset.sig === sig) {
      const el = section.querySelector('.cot-checked');
      if (el) el.textContent = checkedTxt;
      return;
    }
    section.dataset.sig = sig;

    if (!validSnap(snap)) {
      headEl.innerHTML = head('');
      bodyEl.innerHTML = '<p class="cot-empty">Données COT illisibles pour le moment.</p>';
      return;
    }

    const rep = parseDay(c.report_date);
    const nxt = nextRelease(c.report_date);
    const waiting = Date.now() > nxt.at + 2 * 3600 * 1000;
    const info = [
      `Dernière mise à jour : le ${esc(fmtDate(rep))}`,
      `prochain rapport : ${esc(fmtShortDay(nxt.day))} vers ${esc(fmtTime(nxt.at))}${waiting ? ' (en attente de la CFTC)' : ''}`,
      `<span class="cot-checked">${esc(checkedTxt)}</span>`,
    ].filter(Boolean).join(' · ');

    headEl.innerHTML = head(info);
    bodyEl.innerHTML = cardInstitutional(c, prevSnap, snap);
  }

  function renderAll() {
    document.querySelectorAll('.currency-panel[data-currency]').forEach(renderPanel);
  }

  // -------------------------------------------------------------------------
  // Lecture dans Supabase
  // -------------------------------------------------------------------------
  async function loadCot() {
    if (loading) return;
    const client = window.Auth && window.Auth.getClient ? window.Auth.getClient() : null;
    if (!client) return;
    loading = true;
    try {
      const { data, error } = await client.from('cot_positions').select('*');
      if (error) throw error;
      rows = {};
      (data || []).forEach((r) => { rows[r.currency] = r; });
      loaded = true;
      failed = false;
    } catch (err) {
      console.error('[FX-COT] Lecture impossible :', err);
      if (!loaded) failed = true;
    } finally {
      loading = false;
      renderAll();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderAll();
    if (window.Auth) window.Auth.onAuthStateChange((session) => { if (session) loadCot(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadCot(); });
    setInterval(() => { if (!document.hidden) loadCot(); }, REFRESH_MS);
  });

  window.Cot = { reload: loadCot };
})();
