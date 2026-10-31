'use strict';

/**
 * retail.js — cartes « COT Retail » (intraday) dans la zone « COT · Positionnement » de chaque devise.
 *
 * Données : table Supabase "retail_sentiment", remplie par le bot "retail-bot" à partir de Myfxbook + FXSSI (par paire : la lecture la plus récente, ou la moyenne si même moment)
 * (communauté de traders particuliers : lots, positions, prix moyens d'entrée) et de cours gratuits
 * sans compte (Yahoo Finance). Les paires sont agrégées par devise.
 *   - Carte « COT Retail » : camembert acheteurs / vendeurs de la devise, volumes, et position moyenne
 *     des acheteurs / vendeurs (en gain ou en perte) comparée au cours actuel.
 *   - Carte « COT Retail inversé » : l'INVERSE du retail (les traders particuliers perdent le plus souvent).
 *     C'est une déduction, pas le positionnement réel des institutionnels (non publié en intraday).
 * Couleurs : style.css (variables --intra-*) ou Paramètres > Analyse.
 */
(function () {
  const REFRESH_MS = 60 * 1000;

  let rows = {};
  let loaded = false;
  let failed = false;
  let loading = false;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const pct = (v) => (Number.isFinite(v)
    ? v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %'
    : '—');
  const SRC = { myfxbook: 'Myfxbook', fxssi: 'FXSSI' };
  const SRC_PRICE = { yahoo: 'Yahoo Finance', stooq: 'Stooq', 'bce-quotidien': 'BCE (quotidien)', direct: 'direct' };
  const int = (n) => Number.isFinite(n) ? Math.round(n).toLocaleString('fr-FR') : '—';
  const px = (v, pair) => (Number.isFinite(v) ? v.toLocaleString('fr-FR', { minimumFractionDigits: pair.endsWith('JPY') ? 3 : 4, maximumFractionDigits: pair.endsWith('JPY') ? 3 : 5 }) : '—');
  function pipsHtml(v) {
    if (!Number.isFinite(v)) return '';
    const n = Math.abs(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
    return `<span class="intra-pnl ${v < 0 ? 'intra-pnl--loss' : 'intra-pnl--gain'}">${v < 0 ? '−' : '+'}${n} pips</span>`;
  }

  function ageText(ms) {
    if (!Number.isFinite(ms)) return '';
    const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (min < 1) return 'à l\'instant';
    if (min < 60) return `il y a ${min} min`;
    const h = Math.floor(min / 60);
    return h < 24 ? `il y a ${h} h ${String(min % 60).padStart(2, '0')}` : `il y a ${Math.floor(h / 24)} j`;
  }

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

  function pieSvg(long, short, cls, ariaLabel) {
    const total = long + short;
    const R = 86, C = 100;
    if (!(total > 0)) return '<div class="intra-pie-empty">—</div>';
    let angle = -Math.PI / 2;
    let out = '';
    [{ key: 'long', v: long, name: 'Long' }, { key: 'short', v: short, name: 'Short' }].forEach((s) => {
      if (!(s.v > 0)) return;
      const share = s.v / total;
      const a0 = angle;
      const a1 = angle + share * 2 * Math.PI;
      angle = a1;
      const tip = `${s.name} : ${pct(share * 100)}`;
      if (share >= 0.9999) {
        out += `<circle class="intra-slice intra-slice--${cls}-${s.key}" cx="${C}" cy="${C}" r="${R}"><title>${esc(tip)}</title></circle>`;
      } else {
        const x0 = C + R * Math.cos(a0), y0 = C + R * Math.sin(a0);
        const x1 = C + R * Math.cos(a1), y1 = C + R * Math.sin(a1);
        out += `<path class="intra-slice intra-slice--${cls}-${s.key}" d="M${C} ${C} L${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${share > 0.5 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z"><title>${esc(tip)}</title></path>`;
      }
      if (share >= 0.06) {
        const mid = (a0 + a1) / 2;
        out += `<text class="intra-slice-label" x="${(C + R * 0.6 * Math.cos(mid)).toFixed(1)}" y="${(C + R * 0.6 * Math.sin(mid) + 4).toFixed(1)}" text-anchor="middle">${pct(share * 100)}</text>`;
      }
    });
    return `<svg class="intra-pie" viewBox="0 0 200 200" role="img" aria-label="${esc(ariaLabel)}">${out}</svg>`;
  }

  const row = (labelHtml, valueHtml, extra) =>
    `<div class="intra-row${extra ? ' ' + extra : ''}"><span class="intra-row-label">${labelHtml}</span><span class="intra-row-value">${valueHtml}</span></div>`;

  function retailBias(l) {
    if (l >= 52) return `Retail majoritairement acheteur (${pct(l)} long)`;
    if (l <= 48) return `Retail majoritairement vendeur (${pct(100 - l)} short)`;
    return 'Retail équilibré';
  }

  function contraSignal(retailLong) {
    const strong = retailLong >= 70 || retailLong <= 30;
    if (retailLong >= 60) return `Biais contrarien baissier${strong ? ' (fort)' : ''} : le retail est très acheteur`;
    if (retailLong <= 40) return `Biais contrarien haussier${strong ? ' (fort)' : ''} : le retail est très vendeur`;
    return 'Pas de biais contrarien net : le retail est partagé';
  }

  function sideLine(side, label) {
    if (!side || !(side.pairs_total > 0)) return row(label, 'cours indisponible pour le moment');
    const lossShare = Number.isFinite(side.loss_lots_pct) ? ` (${pct(side.loss_lots_pct)} des lots)` : '';
    const state = side.pairs_in_loss === 0 ? 'gain' : (side.pairs_in_loss === side.pairs_total ? 'perte' : 'mixte');
    const txt = side.pairs_in_loss === 0
      ? `en gain sur les ${side.pairs_total} paires`
      : `en perte sur <b class="intra-pnl--${state === 'perte' ? 'loss' : 'mixed'}">${side.pairs_in_loss} paire${side.pairs_in_loss > 1 ? 's' : ''} sur ${side.pairs_total}</b>${lossShare}`;
    return row(label, txt);
  }

  function cards(r, infoHtml) {
    const L = Number(r.long_pct);
    const S = Number(r.short_pct);
    const d = r.details || {};
    const pairs = Array.isArray(r.pairs) ? r.pairs : [];
    const ccy = r.currency;
    const lots = d.lots || null;
    const pos = d.positions || null;
    const posLong = Number.isFinite(Number(d.long_pct_positions)) ? Number(d.long_pct_positions) : NaN;
    const b = d.buyers || null;
    const sl = d.sellers || null;

    // Source(s) retenue(s) pour la paire : la plus récente, ou la moyenne des deux si elles datent du même moment
    const pairSrcTxt = (p) => {
      const list = Array.isArray(p.src) ? p.src : [];
      if (!list.length) return '';
      const names = list.map((x) => SRC[x] || x);
      return list.length > 1 ? ` · moyenne ${esc(names.join(' + '))}` : ` · ${esc(names[0])}`;
    };

    const pairList = pairs.map((p) => {
      const lotsTxt = Number.isFinite(p.lots_long) && Number.isFinite(p.lots_short) ? ` · ${int(p.lots_long + p.lots_short)} lots` : '';
      const priceTxt = Number.isFinite(p.price)
        ? `Cours ${px(p.price, p.pair)}`
          + (Number.isFinite(p.buyers_entry) ? ` · acheteurs ${esc(ccy)} : entrée moy. ${px(p.buyers_entry, p.pair)} ${pipsHtml(p.buyers_pips)}` : '')
          + (Number.isFinite(p.sellers_entry) ? ` · vendeurs ${esc(ccy)} : entrée moy. ${px(p.sellers_entry, p.pair)} ${pipsHtml(p.sellers_pips)}` : '')
        : 'Cours indisponible';
      return `
      <li class="intra-pair">
        <span class="intra-pair-name">${esc(p.pair)}</span>
        <span class="intra-pair-val">${pct(Number(p.long_pct))} long · ${pct(Number(p.short_pct))} short${lotsTxt}${pairSrcTxt(p)}</span>
        <span class="intra-pair-px">${priceTxt}</span>
      </li>`;
    }).join('');

    const subParts = [
      `Traders particuliers (${(Array.isArray(r.sources) && r.sources.length ? r.sources.map((x) => SRC[x] || x).join(' + ') : 'Myfxbook')}, lecture la plus récente)`,
      `intraday · moyenne sur ${esc(r.n_pairs)} paire${r.n_pairs > 1 ? 's' : ''}`,
    ];
    if (b && b.pairs_total > 0 && sl && sl.pairs_total > 0) {
      subParts.push(`positions moyennes en perte : acheteurs ${b.pairs_in_loss}/${b.pairs_total} paires, vendeurs ${sl.pairs_in_loss}/${sl.pairs_total}`);
    }

    const retail = `
      <div class="intra-card">
        <div class="intra-card-head">
          <h3 class="intra-card-title">COT Retail · majorité perdante</h3>
          <span class="intra-card-sub">${subParts.join(' · ')}</span>
        </div>
        <div class="intra-body">
          <div class="intra-pie-wrap">${pieSvg(L, S, 'retail', 'COT Retail : acheteurs et vendeurs')}</div>
          <div class="intra-details">
            ${row('<i class="intra-dot intra-dot--retail-long"></i>Long (acheteurs)', `<b>${pct(L)}</b> des lots${Number.isFinite(posLong) ? ` · ${pct(posLong)} des positions` : ''}`)}
            ${row('<i class="intra-dot intra-dot--retail-short"></i>Short (vendeurs)', `<b>${pct(S)}</b> des lots${Number.isFinite(posLong) ? ` · ${pct(100 - posLong)} des positions` : ''}`)}
            ${lots ? row('Volume', `${int(lots.long)} lots acheteurs · ${int(lots.short)} lots vendeurs`, 'intra-row--sep') : ''}
            ${pos ? row('Positions ouvertes', `${int(pos.long)} acheteuses · ${int(pos.short)} vendeuses`) : ''}
            ${sideLine(b, 'Acheteurs : position moyenne')}
            ${sideLine(sl, 'Vendeurs : position moyenne')}
            <p class="intra-bias">${esc(retailBias(L))}</p>
            <p class="intra-note">Pour chaque paire, on garde la lecture la plus récente entre Myfxbook et FXSSI (Oanda, Dukascopy, FXBlue...) ; si elles datent du même moment (30 min d'écart max), c'est la moyenne des deux. Volumes, positions et position moyenne viennent de Myfxbook (prix moyen d'entrée de tous les acheteurs ou vendeurs, comparé au cours actuel) : ils sont absents d'une paire quand FXSSI est la seule lecture retenue. Ce n'est pas un pourcentage de traders : Myfxbook ne publie pas la part de traders perdants.</p>
            <details class="intra-pairs">
              <summary>Voir les ${pairs.length} paire${pairs.length > 1 ? 's' : ''} prises en compte</summary>
              <ul class="intra-pair-list">${pairList}</ul>
            </details>
            <p class="intra-note">${infoHtml}</p>
          </div>
        </div>
      </div>`;

    const contra = `
      <div class="intra-card">
        <div class="intra-card-head">
          <h3 class="intra-card-title">COT Retail inversé</h3>
          <span class="intra-card-sub">Inverse du COT Retail ci-dessus (déduction, pas une mesure)</span>
        </div>
        <div class="intra-body">
          <div class="intra-pie-wrap">${pieSvg(S, L, 'contra', 'COT Retail inversé')}</div>
          <div class="intra-details">
            ${row('<i class="intra-dot intra-dot--contra-long"></i>Lecture haussière', `<b>${pct(S)}</b>`)}
            ${row('<i class="intra-dot intra-dot--contra-short"></i>Lecture baissière', `<b>${pct(L)}</b>`)}
            <p class="intra-bias">${esc(contraSignal(L))}</p>
            <p class="intra-note">Les traders particuliers perdent le plus souvent (les avertissements obligatoires des brokers l'indiquent) : cette carte retourne simplement leur positionnement. Ce n'est pas le positionnement réel des institutionnels, qui n'est pas publié en intraday ; pour les institutionnels, voir le COT hebdomadaire.</p>
          </div>
        </div>
      </div>`;
    return retail + contra;
  }

  function renderPanel(panel) {
    const code = panel.dataset.currency;
    const slot = ensureCotShell(panel).querySelector('.cot-retail');
    const r = rows[code];
    const anyRow = Object.keys(rows).length > 0;

    const empty = (msg) => {
      const sig = `empty:${msg}`;
      if (slot.dataset.sig === sig) return;
      slot.dataset.sig = sig;
      slot.innerHTML = `<p class="intra-empty">COT Retail : ${esc(msg)}</p>`;
    };

    if (!loaded) return empty(failed ? 'impossible de charger le positionnement retail pour le moment.' : 'chargement…');
    if (!r) {
      return empty(anyRow
        ? 'pas de lecture récente pour cette devise (aucune paire disponible).'
        : 'aucune source connectée pour le moment. Ajoute tes accès Myfxbook dans Supabase (Edge Functions > Secrets) pour l\'activer.');
    }

    const asOfMs = Date.parse(r.as_of);
    const stale = Number.isFinite(asOfMs) && Date.now() - asOfMs > 60 * 60 * 1000;
    const sources = (Array.isArray(r.sources) ? r.sources : []).map((x) => SRC[x] || x).join(' + ');
    const pxSources = ((r.details && r.details.price_sources) || []).map((x) => SRC_PRICE[x] || x).join(' + ');
    const info = [
      `Source : ${esc(sources)}${pxSources ? ` · cours : ${esc(pxSources)}` : ''}`,
      `<span class="intra-age" data-asof="${Number.isFinite(asOfMs) ? asOfMs : ''}">lecture ${esc(ageText(asOfMs))}</span>`,
      stale ? '⚠ lecture ancienne (marché fermé ?)' : '',
    ].filter(Boolean).join(' · ');

    const sig = `${r.updated_at}|${r.as_of}`;
    if (slot.dataset.sig === sig) return;
    slot.dataset.sig = sig;
    slot.innerHTML = cards(r, info);
  }

  function renderAll() {
    document.querySelectorAll('.currency-panel[data-currency]').forEach(renderPanel);
  }

  // Les « il y a X min » se mettent à jour toutes les 30 s sans relire la base.
  function refreshAges() {
    document.querySelectorAll('.intra-age[data-asof]').forEach((el) => {
      const ms = Number(el.dataset.asof);
      if (Number.isFinite(ms)) el.textContent = `lecture ${ageText(ms)}`;
    });
    document.querySelectorAll('.intra-pair-src[data-asof]').forEach((el) => {
      const ms = Number(el.dataset.asof);
      if (!Number.isFinite(ms)) return;
      const name = el.textContent.split(' · ')[0];
      el.textContent = `${name} · ${ageText(ms)}`;
    });
  }

  async function load() {
    if (loading) return;
    const client = window.Auth && window.Auth.getClient ? window.Auth.getClient() : null;
    if (!client) return;
    loading = true;
    try {
      const { data, error } = await client.from('retail_sentiment').select('*');
      if (error) throw error;
      rows = {};
      (data || []).forEach((r) => { rows[r.currency] = r; });
      loaded = true;
      failed = false;
    } catch (err) {
      console.error('[FX-RETAIL] Lecture impossible :', err);
      if (!loaded) failed = true;
    } finally {
      loading = false;
      renderAll();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderAll();
    if (window.Auth) window.Auth.onAuthStateChange((session) => { if (session) load(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
    setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    setInterval(refreshAges, 30 * 1000);
  });

  window.Retail = { reload: load };
})();
