'use strict';

/**
 * marketwatch.js
 * Fenêtre « Market Watch » : les vrais graphiques TradingView (widget gratuit « Advanced Chart »), un par devise.
 *   - Onglet d'une devise : grand graphique de son indice (USD = DXY, EUR = EXY, GBP = BXY, JPY = JXY,
 *     CAD = CXY, CHF = SXY, AUD = AXY, NZD = ZXY, tous TVC).
 *   - Onglet « All » : les 8 indices en 4 colonnes x 2 lignes (2 colonnes sur tablette, 1 sur téléphone).
 * Chaque graphique n'est créé qu'à la première fois qu'il est visible (un widget créé dans un panneau masqué
 * aurait une taille nulle). Le fond des graphiques se règle dans Paramètres > Thème > Market Watch
 * (pris en compte au rechargement : il est fixé à la création du widget).
 */
(function () {
  const PANEL_ID = 'tab-marketwatch';
  const WIN = 'marketwatch';
  const SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
  const ORDER = ['USD', 'EUR', 'JPY', 'GBP', 'CHF', 'CAD', 'AUD', 'NZD'];
  const INDEX = {
    USD: { name: 'DXY', symbol: 'TVC:DXY', label: 'Indice dollar américain' },
    EUR: { name: 'EXY', symbol: 'TVC:EXY', label: 'Indice euro' },
    JPY: { name: 'JXY', symbol: 'TVC:JXY', label: 'Indice yen' },
    GBP: { name: 'BXY', symbol: 'TVC:BXY', label: 'Indice livre sterling' },
    CHF: { name: 'SXY', symbol: 'TVC:SXY', label: 'Indice franc suisse' },
    CAD: { name: 'CXY', symbol: 'TVC:CXY', label: 'Indice dollar canadien' },
    AUD: { name: 'AXY', symbol: 'TVC:AXY', label: 'Indice dollar australien' },
    NZD: { name: 'ZXY', symbol: 'TVC:ZXY', label: 'Indice dollar néo-zélandais' },
  };

  let built = false;

  const cssVar = (n, d) => { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d; } catch (e) { return d; } };

  function tile(code, big) {
    const ix = INDEX[code];
    return `<div class="mw-tile${big ? ' mw-tile--big' : ''}" data-code="${code}">
      <div class="mw-tile-head"${big ? '' : ` data-open="${code}" title="Ouvrir ${code} en grand"`}><b>${code} · ${ix.name}</b><span>${ix.label}</span></div>
      <div class="mw-chart" data-symbol="${ix.symbol}" data-big="${big ? 1 : 0}"></div>
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
    bar.innerHTML = '<span class="calendar-toolbar-title">Market Watch</span><span class="speeches-toolbar-info">Graphiques TradingView · indices des devises (ICE)</span>';
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

  function mount(box) {
    if (box.dataset.ready) return;
    box.dataset.ready = '1';
    const big = box.dataset.big === '1';
    const bg = cssVar('--mw-chart-bg', '#161616');
    box.innerHTML = '<div class="tradingview-widget-container" style="height:100%;width:100%"><div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div></div>';
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.text = JSON.stringify({
      autosize: true,
      symbol: box.dataset.symbol,
      interval: '60',
      timezone: 'Europe/Paris',
      theme: 'dark',
      style: '1',
      locale: 'fr',
      backgroundColor: bg,
      gridColor: cssVar('--mw-grid', 'rgba(42, 42, 42, 0.6)'),
      allow_symbol_change: false,
      hide_side_toolbar: !big,
      hide_volume: true,
      withdateranges: big,
      save_image: false,
      calendar: false,
      details: false,
      hotlist: false,
      support_host: 'https://www.tradingview.com',
    });
    box.firstChild.appendChild(s);
  }

  // Crée les graphiques des panneaux réellement visibles (fenêtre ouverte, onglet de devise affiché).
  function ensure() {
    const sec = document.getElementById(PANEL_ID);
    if (!sec || sec.hidden) return;
    build();
    sec.querySelectorAll(`.currency-panel[data-win="${WIN}"]`).forEach((p) => {
      if (p.hidden) return;
      p.querySelectorAll('.mw-chart:not([data-ready])').forEach(mount);
    });
  }

  window.MarketWatch = { refresh() { build(); ensure(); } };

  document.addEventListener('DOMContentLoaded', () => {
    build();
    document.addEventListener('fx-currency-select', (e) => { if (e.detail && e.detail.win === WIN) ensure(); });
  });
})();
