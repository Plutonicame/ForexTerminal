'use strict';

/**
 * marketwatch.js
 * Fenêtre « Market Watch » : un graphique par devise, dessiné par fxchart.js (style TradingView). L'indice de chaque devise est calculé
 * en la comparant aux 7 autres (28 paires, moyenne géométrique) par le robot fx-index-bot.
 *   - Onglet d'une devise : grand graphique de son indice.
 *   - Onglet « All » : les 8 indices en 4 colonnes x 2 lignes (2 colonnes sur tablette, 1 sur téléphone).
 * Chaque graphique n'est créé qu'à la première fois qu'il est visible (un widget créé dans un panneau masqué
 * aurait une taille nulle). Le fond des graphiques se règle dans Paramètres > Thème > Market Watch
 * (pris en compte au rechargement : il est fixé à la création du widget).
 */
(function () {
  const PANEL_ID = 'tab-marketwatch';
  const WIN = 'marketwatch';
  const ORDER = ['USD', 'EUR', 'JPY', 'GBP', 'CHF', 'CAD', 'AUD', 'NZD'];
  const INDEX = {
    USD: { name: 'USD index', label: 'Indice dollar américain' },
    EUR: { name: 'EUR index', label: 'Indice euro' },
    JPY: { name: 'JPY index', label: 'Indice yen' },
    GBP: { name: 'GBP index', label: 'Indice livre sterling' },
    CHF: { name: 'CHF index', label: 'Indice franc suisse' },
    CAD: { name: 'CAD index', label: 'Indice dollar canadien' },
    AUD: { name: 'AUD index', label: 'Indice dollar australien' },
    NZD: { name: 'NZD index', label: 'Indice dollar néo-zélandais' },
  };

  let built = false;

  const cssVar = (n, d) => { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d; } catch (e) { return d; } };

  function tile(code, big) {
    const ix = INDEX[code];
    return `<div class="mw-tile${big ? ' mw-tile--big' : ''}" data-code="${code}">
      <div class="mw-tile-head" data-open="${big ? 'ALL' : code}" title="${big ? 'Revenir à la vue All' : 'Ouvrir ' + code + ' en grand'}"><b>${ix.name}</b><span>${ix.label}</span></div>
      <div class="mw-chart" data-big="${big ? 1 : 0}"></div>
    </div>`;
  }

  function build() {
    if (built) return;
    const sec = document.getElementById(PANEL_ID);
    const host = sec && sec.querySelector('.currency-panels');
    if (!host) return;
    built = true;

    const bar = document.createElement('div');
    bar.className = 'calendar-toolbar';
    bar.innerHTML = '<span class="calendar-toolbar-title">Market Watch</span><span class="speeches-toolbar-info">Indice de chaque devise · calculé sur les 28 paires (moyenne géométrique)</span>';
    sec.insertBefore(bar, host);

    host.querySelectorAll('.currency-panel').forEach((p) => {
      const code = p.dataset.currency;
      if (code === 'ALL') p.innerHTML = `<div class="mw-grid">${ORDER.map((c) => tile(c, false)).join('')}</div>`;
      else if (INDEX[code]) p.innerHTML = `<div class="mw-single">${tile(code, true)}</div>`;
    });

    // un clic sur le titre d'une tuile ouvre la devise en grand
    host.addEventListener('click', (ev) => {
      const h = ev.target.closest('[data-open]');
      if (h && window.FXWindows) window.FXWindows.select(WIN, h.dataset.open);
    });
  }

  const charts = [];
  function mount(box) {
    if (box.dataset.ready) return;
    box.dataset.ready = '1';
    const big = box.dataset.big === '1';
    const code = box.closest('.mw-tile').dataset.code;
    if (!window.FXChart) { box.textContent = 'Graphique indisponible.'; return; }
    charts.push(window.FXChart.create(box, { currency: code, name: INDEX[code].name, big, tf: '60' }));
  }

  // Crée les graphiques des panneaux réellement visibles (fenêtre ouverte, onglet de devise affiché).
  function ensure() {
    const sec = document.getElementById(PANEL_ID);
    if (!sec || sec.hidden) return;
    build();
    fitHeights();
    sec.querySelectorAll(`.currency-panel[data-win="${WIN}"]`).forEach((p) => {
      if (p.hidden) return;
      p.querySelectorAll('.mw-chart:not([data-ready])').forEach(mount);
    });
  }

  // Les graphiques se partagent toute la place disponible : 4 colonnes x 2 lignes sur grand écran, un seul graphique plein cadre sinon.
  function fitHeights() {
    const sec = document.getElementById(PANEL_ID);
    if (!sec || sec.hidden) return;
    sec.querySelectorAll('.mw-grid, .mw-single').forEach((g) => {
      if (g.closest('.currency-panel') && g.closest('.currency-panel').hidden) return;
      const top = g.getBoundingClientRect().top;
      const h = Math.max(300, Math.floor(window.innerHeight - top - 14));
      const wide = g.classList.contains('mw-single') || window.innerWidth >= 1000;
      g.style.height = wide ? h + 'px' : '';
    });
  }
  window.addEventListener('resize', fitHeights);
  document.addEventListener('fx-currency-select', () => setTimeout(fitHeights, 0));

  window.MarketWatch = { refresh() { build(); ensure(); fitHeights(); setTimeout(fitHeights, 150); charts.forEach((c) => c.reload()); } };
  setInterval(() => { const sec = document.getElementById(PANEL_ID); if (sec && !sec.hidden && !document.hidden) charts.forEach((c) => c.reload()); }, 60000);

  document.addEventListener('DOMContentLoaded', () => {
    build();
    document.addEventListener('fx-currency-select', (e) => { if (e.detail && e.detail.win === WIN) ensure(); });
  });
})();
