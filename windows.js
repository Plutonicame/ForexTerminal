'use strict';

/**
 * windows.js
 * Architecture des fenêtres de FXT.
 *
 * Construit, à partir de la liste MENU ci-dessous :
 *   - le menu burger (titres de groupes + fenêtres) ;
 *   - les fenêtres « À venir » (sections vides) ;
 *   - le sélecteur de devises (8 devises + All) des fenêtres liées aux devises.
 *
 * POUR AJOUTER UNE FENÊTRE OU UN GROUPE : modifier uniquement MENU.
 *
 * Champs d'une fenêtre :
 *   id        : identifiant de la section (data-tab du bouton)
 *   label     : texte du bouton du menu
 *   exists    : true si la section existe déjà dans index.html (sinon elle est créée ici)
 *   soon      : true pour afficher « À venir » (fenêtre sans contenu pour l'instant)
 *   menuClass : classe CSS du bouton du menu (couleurs propres), sinon celle des fenêtres
 *   currency  : { win, all, calendar } pour une fenêtre avec sélecteur de devises
 *       win      : nom court utilisé par les scripts (ex. 'rates')
 *       all      : 'panels' -> « All » affiche les 8 devises l'une sous l'autre
 *                  'own'    -> « All » a son propre panneau
 *       calendar : true -> chaque panneau contient un conteneur .calendar (voir app.js)
 *
 * Chaque panneau de devise est un <section class="currency-panel" data-win data-currency>.
 * Les scripts de données (rates.js, cot.js, retail.js, speeches.js, trump.js) y écrivent
 * en filtrant sur data-win, pour que deux fenêtres ne se mélangent jamais.
 */
(function () {
  const CURRENCIES = ['USD', 'EUR', 'JPY', 'GBP', 'CHF', 'CAD', 'AUD', 'NZD'];
  const ALL = 'ALL';

  const MENU = [
    {
      title: 'News',
      items: [
        { id: 'tab-4', label: 'Nouveau', exists: true, menuClass: 'menu-tab--nouveau' },
        { id: 'tab-calendar', label: 'Calendar', exists: true, currency: { win: 'calendar', all: 'own', calendar: true } },
        { id: 'tab-newsfeed', label: 'News Feed', soon: true },
        { id: 'tab-bankresearch', label: 'Bank Research', soon: true },
        { id: 'tab-squawk', label: 'Squawk', soon: true },
        { id: 'tab-speeches', label: 'Discours', currency: { win: 'speeches', all: 'panels' } },
      ],
    },
    {
      title: 'Macroéconomique',
      items: [
        { id: 'tab-globe', label: 'Globe', soon: true },
        { id: 'tab-rates', label: 'Taux d\'intérêt', currency: { win: 'rates', all: 'panels' } },
      ],
    },
    {
      title: 'Sentiment et positionnement',
      items: [
        { id: 'tab-retail', label: 'Sentiment retail', soon: true, currency: { win: 'retail', all: 'own' } },
        { id: 'tab-cot', label: 'COT', currency: { win: 'cot', all: 'panels' } },
        { id: 'tab-bankpos', label: 'Position des banques', soon: true, currency: { win: 'bankpos', all: 'own' } },
        { id: 'tab-risk', label: 'Sentiment du risque' },
      ],
    },
    {
      title: 'Market Analyse',
      items: [
        { id: 'tab-marketwatch', label: 'Market Watch', soon: true, currency: { win: 'marketwatch', all: 'own' } },
        { id: 'tab-seasonality', label: 'Saisonnalité', soon: true, currency: { win: 'seasonality', all: 'own' } },
        { id: 'tab-fundheat', label: 'Fondamental heatmap', soon: true, currency: { win: 'fundheat', all: 'own' } },
        { id: 'tab-techheat', label: 'Technical heatmap', soon: true, currency: { win: 'techheat', all: 'own' } },
        { id: 'tab-indicator', label: 'Indicator' },
      ],
    },
    {
      title: 'Outils',
      items: [
        { id: 'tab-riskcalc', label: 'Calculateur de risque', soon: true },
        { id: 'tab-5', label: 'Note fondamentale', exists: true, menuClass: 'menu-tab--fondamentale' },
        { id: 'tab-3', label: 'Paramètres', exists: true, menuClass: 'menu-tab--parametres' },
      ],
    },
  ];

  const main = document.querySelector('.app-main');
  const menuList = document.getElementById('menuList');
  const windows = {}; // win -> { sec, host, cfg, bar }
  const current = {}; // win -> devise sélectionnée

  function getSection(item) {
    let sec = document.getElementById(item.id);
    if (!sec && main) {
      sec = document.createElement('section');
      sec.className = 'tab-panel';
      sec.id = item.id;
      sec.setAttribute('role', 'tabpanel');
      sec.setAttribute('aria-label', item.label);
      sec.hidden = true;
      main.appendChild(sec);
    }
    return sec;
  }

  function titleToolbar(label) {
    return `<div class="calendar-toolbar"><span class="calendar-toolbar-title">${label}</span></div>`;
  }

  function select(win, code) {
    const w = windows[win];
    if (!w) return;
    const showAll = code === ALL;
    current[win] = code;

    w.bar.querySelectorAll('.currency-card').forEach((btn) => {
      const on = btn.dataset.currency === code;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    const stacked = w.cfg.all === 'panels';
    w.host.classList.toggle('is-all', showAll && stacked);
    w.host.querySelectorAll('.currency-panel').forEach((panel) => {
      panel.hidden = stacked ? !(showAll || panel.dataset.currency === code) : panel.dataset.currency !== code;
    });

    document.dispatchEvent(new CustomEvent('fx-currency-select', { detail: { win, code } }));
  }

  function buildCurrencyWindow(sec, item) {
    const cfg = item.currency;
    const panelCodes = cfg.all === 'own' ? [ALL].concat(CURRENCIES) : CURRENCIES;

    const bar = document.createElement('div');
    bar.className = 'currency-bar';
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', 'Devises');
    bar.innerHTML = [ALL].concat(CURRENCIES).map((c) =>
      `<button type="button" class="currency-card" role="tab" data-currency="${c}" aria-selected="false">${c === ALL ? 'All' : c}</button>`
    ).join('');
    sec.insertBefore(bar, sec.firstChild);

    if (item.soon) bar.insertAdjacentHTML('afterend', titleToolbar(item.label));

    let host = sec.querySelector('.currency-panels');
    if (!host) {
      host = document.createElement('div');
      host.className = 'currency-panels';
      sec.appendChild(host);
    }

    host.innerHTML = panelCodes.map((c) => {
      let inner = '';
      if (cfg.calendar) inner = `<div class="calendar" data-currency="${c}" aria-live="polite"></div>`;
      else if (item.soon) inner = '<p class="cw-soon">À venir</p>';
      const title = cfg.all === 'panels' ? `<h3 class="cw-title">${c}</h3>` : '';
      return `<section class="currency-panel" role="tabpanel" data-currency="${c}" data-win="${cfg.win}" aria-label="${item.label} ${c}" hidden>${title}${inner}</section>`;
    }).join('');

    windows[cfg.win] = { sec, host, cfg, bar };

    bar.addEventListener('click', (event) => {
      const btn = event.target.closest('.currency-card[data-currency]');
      if (!btn) return;
      select(cfg.win, btn.dataset.currency);
      btn.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    });
  }

  function buildWindows() {
    MENU.forEach((group) => {
      group.items.forEach((item) => {
        const sec = getSection(item);
        if (!sec) return;
        if (item.currency) {
          buildCurrencyWindow(sec, item);
        } else if (item.soon) {
          sec.innerHTML = `${titleToolbar(item.label)}<p class="cw-soon">À venir</p>`;
        }
      });
    });
    Object.keys(windows).forEach((win) => select(win, ALL)); // « All » sélectionné par défaut
  }

  function buildMenu() {
    if (!menuList) return;
    menuList.innerHTML = MENU.map((group) => {
      const buttons = group.items.map((item) => {
        const home = item.id === 'tab-4';
        const cls = `menu-tab ${item.menuClass || 'menu-tab--win'}${home ? ' is-active' : ''}`;
        return `<button type="button" class="${cls}" data-tab="${item.id}"${home ? ' aria-current="true"' : ''}>${item.label}</button>`;
      }).join('');
      return `<div class="menu-group"><p class="menu-group-title">${group.title}</p>${buttons}</div>`;
    }).join('');
  }

  // Fenêtres qui ont leur propre onglet dans Paramètres > Thème (Nouveau et Paramètres
  // ont les leurs, fixes, dans index.html). La clé relie la fenêtre à THEME_FIELDS
  // (theme-colors.js) ; par défaut c'est l'identifiant sans « tab- ».
  const THEME_KEYS = { 'tab-5': 'fondamentale' };
  function themeWindows() {
    const list = [];
    MENU.forEach((group) => group.items.forEach((item) => {
      if (item.id === 'tab-4' || item.id === 'tab-3') return;
      list.push({ key: THEME_KEYS[item.id] || item.id.replace(/^tab-/, ''), label: item.label });
    }));
    return list;
  }

  buildWindows();
  buildMenu();

  window.FXWindows = {
    currencies: CURRENCIES.slice(),
    current: (win) => current[win] || null,
    select,
    themeWindows,
  };
})();
