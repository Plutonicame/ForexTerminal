'use strict';

/**
 * devise.js
 * Fenêtre « Devise » (menu Macroéconomique) : 8 cases (2 lignes de 4), une par économie.
 * Chaque case affiche le nom de la devise et son code, le pays, et en fond une photo qui évoque le pays.
 *
 *  - Les photos viennent de Wikimedia Commons (licences libres), lues directement depuis leur adresse.
 *    Si une photo ne se charge pas, la case garde son dégradé aux couleurs du pays.
 *  - Un clic sur une case envoie l'événement « fx-devise-open » (detail.code = 'USD'...) :
 *    c'est là que se branchera la page de données de l'économie.
 * Couleurs : style.css (variables --dv-*) ou Paramètres > Thème > Devise.
 */
(function () {
  const PANEL_ID = 'tab-devise';
  const COMMONS = 'https://commons.wikimedia.org/wiki/Special:FilePath/';
  const photo = (file) => COMMONS + encodeURIComponent(file) + '?width=900';

  // code, devise, pays, photo (nom du fichier sur Commons), cadrage de la photo, dégradé de secours
  const DEVISES = [
    { code: 'USD', name: 'Dollar américain', country: 'États-Unis', file: 'Statue of Liberty, NY.jpg', pos: '50% 30%', a: '#0a3161', b: '#b31942' },
    { code: 'EUR', name: 'Euro', country: 'Zone euro', file: 'Tour eiffel at sunrise from the trocadero.jpg', pos: '50% 35%', a: '#003399', b: '#ffcc00' },
    { code: 'JPY', name: 'Yen', country: 'Japon', file: 'Tokyo Tower M4854.jpg', pos: '50% 40%', a: '#bc002d', b: '#f2f2f2' },
    { code: 'GBP', name: 'Livre sterling', country: 'Royaume-Uni', file: 'Clock Tower - Palace of Westminster, London - September 2006.jpg', pos: '50% 25%', a: '#012169', b: '#c8102e' },
    { code: 'CHF', name: 'Franc suisse', country: 'Suisse', file: 'Matterhorn-EastAndNorthside-viewedFromZermatt landscapeformat-2.jpg', pos: '50% 50%', a: '#d52b1e', b: '#7a1710' },
    { code: 'CAD', name: 'Dollar canadien', country: 'Canada', file: 'Toronto Skyline.jpg', pos: '50% 55%', a: '#d80621', b: '#6e0310' },
    { code: 'AUD', name: 'Dollar australien', country: 'Australie', file: 'Sydney Opera House and Harbour Bridge Dusk (3) 2019-06-21.jpg', pos: '50% 55%', a: '#00008b', b: '#e4002b' },
    { code: 'NZD', name: 'Dollar néo-zélandais', country: 'Nouvelle-Zélande', file: '00 1373 Milford Sound -New Zealand.jpg', pos: '50% 45%', a: '#00247d', b: '#cc142b' },
  ];

  let built = false;

  function tile(d) {
    return `<button type="button" class="dv-tile" data-currency="${d.code}" aria-label="${d.name} (${d.code}) — ${d.country}" style="--dv-a:${d.a};--dv-b:${d.b}">
      <img class="dv-img" src="${photo(d.file)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" style="object-position:${d.pos}">
      <span class="dv-shade"></span>
      <span class="dv-text">
        <span class="dv-line"><b class="dv-name">${d.name}</b><span class="dv-code">${d.code}</span></span>
        <span class="dv-country">${d.country}</span>
      </span>
    </button>`;
  }

  function build() {
    if (built) return;
    const sec = document.getElementById(PANEL_ID);
    if (!sec) return;
    built = true;
    sec.innerHTML = `<div class="calendar-toolbar"><span class="calendar-toolbar-title">Devise</span></div>
      <div class="dv-grid" role="list" aria-label="Économies">${DEVISES.map(tile).join('')}</div>`;
    // photo introuvable : on la retire, la case garde son dégradé
    sec.querySelectorAll('.dv-img').forEach((img) => img.addEventListener('error', () => img.remove()));
    sec.querySelector('.dv-grid').addEventListener('click', (ev) => {
      const t = ev.target.closest('.dv-tile');
      if (!t) return;
      document.dispatchEvent(new CustomEvent('fx-devise-open', { detail: { code: t.dataset.currency } }));
    });
  }

  build();
  window.Devise = { list: DEVISES.map((d) => ({ code: d.code, name: d.name, country: d.country })) };
})();
