// ═══════════════════════════════════════════════════════════════════════
// BOUTON CALENDRIER DE PÉRIODE — version autonome (copie du bouton de TJP)
// ═══════════════════════════════════════════════════════════════════════
// Un seul fichier, aucune dépendance. Il recrée le bouton calendrier qui se
// trouve à côté des boutons J / SEM / MOIS / TRIM / AN / TOUT des graphiques :
//
//   • un petit bouton carré avec une icône de calendrier ;
//   • un clic ouvre un calendrier : on clique le jour de DÉBUT, puis le jour
//     de FIN (aperçu de la plage au survol pendant le choix) ;
//   • la plage choisie est renvoyée à ton code (onChange) ; à toi de filtrer
//     tes données — l'application d'origine ne garde que ce qui est compris
//     entre les deux jours, inclus ;
//   • le bouton « s'allume » tant qu'une plage est active, et son infobulle
//     indique les dates (« Période analysée : du 01/10/2026 au 15/10/2026 ») ;
//   • « Effacer » remet la période à « aucune plage » (onChange(null)) ;
//   • flèches « ‹ › » (mois) et « « » » (année), semaine qui commence le lundi,
//     toujours 6 lignes (hauteur stable), aujourd'hui entouré ;
//   • se ferme avec Échap, un clic à l'extérieur, ou un 2e clic sur le bouton ;
//     suit son bouton quand on fait défiler / redimensionne la page.
//
// ── Utilisation ────────────────────────────────────────────────────────
//   <div id="mes-boutons-de-periode"> ...tes boutons J / SEM / MOIS... </div>
//   <script src="period-calendar-standalone.js"></script>
//   <script>
//     var cal = PeriodCalendar.create({
//       container: document.getElementById('mes-boutons-de-periode'), // le bouton y est ajouté
//       onChange: function (range) {
//         // range = {from: '2026-10-01', to: '2026-10-15'}  ou  null (si « Effacer »)
//         monGraphique.filtrer(range);
//       }
//     });
//   </script>
//
// Options de create() :
//   container     élément où ajouter le bouton                       (ou…)
//   button        un <button> existant à transformer en bouton calendrier
//   size          côté du bouton carré en px (défaut 20) ; mets 'auto' pour qu'il
//                 prenne la hauteur des boutons voisins (mesurée en direct)
//   value         plage de départ : {from:'AAAA-MM-JJ', to:'AAAA-MM-JJ'}
//   onChange      function (range|null) appelée à chaque choix / effacement
//   showLabel     true → affiche « du 01/10/2026 au 15/10/2026 » à côté du bouton
//   labels        textes (en français par défaut), voir DEFAULT_LABELS plus bas
//
// Objet renvoyé : {button, getRange(), setRange(from, to), clear(), open(),
//                  close(), destroy()}
// Outils : PeriodCalendar.filter(liste, fonctionDate, range) → éléments dont la
//          date (AAAA-MM-JJ) est dans la plage (ou toute la liste si range = null).
//
// ── Couleurs ───────────────────────────────────────────────────────────
// Tout passe par des variables CSS (mêmes noms que dans TJP) : redéfinis-les
// dans ton CSS (ex. :root { --pcal-sel-bg: #ff9900; }) pour changer le look.
// ═══════════════════════════════════════════════════════════════════════
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.PeriodCalendar = factory(root);
})(typeof window !== 'undefined' ? window : this, function (window) {
  'use strict';
  if (typeof document === 'undefined') return {};

  var DEFAULT_LABELS = {
    months: [
      'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
      'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'
    ],
    weekdays: ['L', 'M', 'M', 'J', 'V', 'S', 'D'], // la semaine commence le lundi
    prevYear: 'Année précédente',
    prevMonth: 'Mois précédent',
    nextMonth: 'Mois suivant',
    nextYear: 'Année suivante',
    clear: 'Effacer',
    clearTitle: 'Revenir à la période TOUT',
    dialog: 'Choisir la période à analyser',
    btnIdle: 'Choisir une période dans le calendrier',
    btnActive: function (from, to) {
      return 'Période analysée : du ' + from + ' au ' + to + ' (clic pour modifier)';
    },
    rangeLabel: function (from, to) {
      return 'du ' + from + ' au ' + to;
    },
    hintFirst: 'Choisis le jour de début',
    hintSecond: 'Choisis maintenant le jour de fin',
    hintCurrent: function (from, to) {
      return 'Du ' + from + ' au ' + to + ' — choisis un nouveau jour de début';
    }
  };

  // ── Couleurs par défaut (variables CSS, modifiables) ────────────────
  var THEME = {
    '--pcal-btn-bg': '#111827',
    '--pcal-btn-bd': '#1e2d45',
    '--pcal-btn-ic': '#64748b',
    '--pcal-btn-hover-bd': '#00e5a0',
    '--pcal-btn-hover-ic': '#00e5a0',
    '--pcal-btn-active-bg': '#00e5a0',
    '--pcal-btn-active-bd': '#00e5a0',
    '--pcal-btn-active-ic': '#0b0f1a',
    '--pcal-bg': '#111827',
    '--pcal-bd': '#1e2d45',
    '--pcal-title': '#e2e8f0',
    '--pcal-nav': '#64748b',
    '--pcal-nav-hover': '#00e5a0',
    '--pcal-wd': '#64748b',
    '--pcal-day-tx': '#e2e8f0',
    '--pcal-day-hover-bg': '#1e2d45',
    '--pcal-today-bd': '#00e5a0',
    '--pcal-sel-bg': '#00e5a0',
    '--pcal-sel-tx': '#0b0f1a',
    '--pcal-range-bg': '#0f3b34',
    '--pcal-range-tx': '#e2e8f0',
    '--pcal-hint-tx': '#64748b',
    '--pcal-clear-bg': '#111827',
    '--pcal-clear-bd': '#1e2d45',
    '--pcal-clear-tx': '#e2e8f0'
  };

  // ── Style ───────────────────────────────────────────────────────────
  // Les valeurs par défaut sont posées avec une spécificité minimale (:where)
  // pour qu'un :root { --pcal-... } de ta page les remplace toujours.
  var CSS =
    ':where(:root) {\n' +
    Object.keys(THEME)
      .map(function (k) {
        return '  ' + k + ': ' + THEME[k] + ';';
      })
      .join('\n') +
    '\n}\n' +
    `
.pcal-btn {
  flex-shrink: 0; box-sizing: border-box;
  width: var(--pcal-size, 20px); height: var(--pcal-size, 20px); padding: 0; margin: 0 0 0 4px;
  display: inline-flex; align-items: center; justify-content: center; align-self: center;
  border-radius: 3px;
  border: 1px solid var(--pcal-btn-bd);
  background: var(--pcal-btn-bg);
  color: var(--pcal-btn-ic);
  cursor: pointer;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
}
.pcal-btn svg { width: 74%; height: 74%; display: block; pointer-events: none; }
.pcal-range-label { margin-left: 8px; font-family: var(--mono, monospace); font-size: 9px; color: var(--pcal-hint-tx); white-space: nowrap; }
.pcal-btn:hover { border-color: var(--pcal-btn-hover-bd); color: var(--pcal-btn-hover-ic); }
.pcal-btn.active,
.pcal-btn.active:hover {
  background: var(--pcal-btn-active-bg);
  border-color: var(--pcal-btn-active-bd);
  color: var(--pcal-btn-active-ic);
}

.pcal-pop {
  position: fixed; z-index: 4500; box-sizing: border-box;
  width: 232px; padding: 10px;
  background: var(--pcal-bg);
  border: 1px solid var(--pcal-bd);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  font-family: var(--mono, monospace);
  user-select: none; -webkit-user-select: none;
}
.pcal-head { display: flex; align-items: center; gap: 2px; margin-bottom: 8px; }
.pcal-title {
  flex: 1; text-align: center; font-size: 11px; font-weight: 700;
  letter-spacing: 0.5px; text-transform: capitalize; color: var(--pcal-title);
}
.pcal-nav {
  width: 22px; height: 22px; padding: 0; border: 0; border-radius: 4px;
  background: transparent; color: var(--pcal-nav);
  font-family: inherit; font-size: 14px; line-height: 1; cursor: pointer;
}
.pcal-nav:hover { color: var(--pcal-nav-hover); }
.pcal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.pcal-wd { text-align: center; font-size: 9px; padding: 2px 0 4px; color: var(--pcal-wd); }
.pcal-blank, .pcal-day { height: 26px; }
.pcal-day {
  padding: 0; border: 1px solid transparent; border-radius: 4px;
  background: transparent; color: var(--pcal-day-tx);
  font-family: inherit; font-size: 10px; cursor: pointer;
}
.pcal-day:hover { background: var(--pcal-day-hover-bg); }
.pcal-day.today { border-color: var(--pcal-today-bd); }
.pcal-day.inrange { background: var(--pcal-range-bg); color: var(--pcal-range-tx); border-radius: 0; }
.pcal-day.sel { background: var(--pcal-sel-bg); color: var(--pcal-sel-tx); font-weight: 700; }
.pcal-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
.pcal-hint { font-size: 9px; line-height: 1.35; color: var(--pcal-hint-tx); }
.pcal-clear {
  flex-shrink: 0; padding: 3px 8px; border-radius: 4px; white-space: nowrap;
  border: 1px solid var(--pcal-clear-bd);
  background: var(--pcal-clear-bg); color: var(--pcal-clear-tx);
  font-family: inherit; font-size: 9px; cursor: pointer;
}
`;
  if (!document.getElementById('pcal-standalone-style')) {
    var styleTag = document.createElement('style');
    styleTag.id = 'pcal-standalone-style';
    styleTag.textContent = CSS;
    (document.head || document.documentElement).appendChild(styleTag);
  }

  // ── Dates ───────────────────────────────────────────────────────────
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }
  function ymd(y, m, d) {
    return y + '-' + pad(m + 1) + '-' + pad(d);
  }
  function fr(ds) {
    return ds.slice(8, 10) + '/' + ds.slice(5, 7) + '/' + ds.slice(0, 4);
  }
  function todayStr() {
    var n = new Date();
    return ymd(n.getFullYear(), n.getMonth(), n.getDate());
  }
  function normRange(a, b) {
    if (!DATE_RE.test(a) || !DATE_RE.test(b)) return null;
    return a <= b ? {from: a, to: b} : {from: b, to: a};
  }

  var ICON =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 7h12M5.5 1.5v3M10.5 1.5v3"/></svg>';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // Un seul calendrier ouvert à la fois, dans toute la page
  var openInstance = null;

  // ── Création d'un bouton calendrier ─────────────────────────────────
  function create(opts) {
    opts = opts || {};
    var L = {};
    var k;
    for (k in DEFAULT_LABELS) L[k] = DEFAULT_LABELS[k];
    if (opts.labels) for (k in opts.labels) L[k] = opts.labels[k];

    var range = null;
    if (opts.value) range = normRange(opts.value.from, opts.value.to);

    var btn = opts.button || el('button');
    btn.type = 'button';
    btn.classList.add('pcal-btn');
    btn.innerHTML = ICON;
    if (opts.size && opts.size !== 'auto') btn.style.setProperty('--pcal-size', parseInt(opts.size, 10) + 'px');
    if (opts.container && !opts.button) opts.container.appendChild(btn);

    var label = null;
    if (opts.showLabel) {
      label = el('span', 'pcal-range-label');
      btn.parentNode && btn.parentNode.insertBefore(label, btn.nextSibling);
    }

    var pop = null,
      view = null,
      startDay = null,
      ro = null;

    // Taille « auto » : carré de la hauteur des boutons voisins
    function fit() {
      if (opts.size !== 'auto' || !btn.parentNode) return;
      var sib = null,
        n = btn.parentNode.firstElementChild;
      for (; n; n = n.nextElementSibling) {
        if (n !== btn && n !== label && n.offsetHeight) {
          sib = n;
          break;
        }
      }
      if (!sib) return;
      btn.style.setProperty('--pcal-size', '0px');
      var h = sib.offsetHeight;
      btn.style.setProperty('--pcal-size', h + 'px');
    }
    if (opts.size === 'auto') {
      fit();
      if (window.ResizeObserver && btn.parentNode) {
        ro = new ResizeObserver(fit);
        ro.observe(btn.parentNode);
      }
    }

    function sync() {
      btn.classList.toggle('active', !!range);
      btn.title = range ? L.btnActive(fr(range.from), fr(range.to)) : L.btnIdle;
      if (label) label.textContent = range ? L.rangeLabel(fr(range.from), fr(range.to)) : '';
    }

    function close() {
      if (!pop) return;
      pop.remove();
      pop = startDay = null;
      if (openInstance === api) openInstance = null;
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    }
    function onOutside(e) {
      if (!pop) return;
      if (pop.contains(e.target) || btn.contains(e.target)) return;
      close();
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
    }
    function onReflow(e) {
      if (!pop) return;
      if (e && e.target && e.target.nodeType === 1 && pop.contains(e.target)) return;
      if (!document.body.contains(btn)) {
        close();
        return;
      }
      var r = btn.getBoundingClientRect();
      if (r.bottom < 0 || r.top > document.documentElement.clientHeight) {
        close();
        return;
      }
      place();
    }
    function place() {
      if (!pop) return;
      var r = btn.getBoundingClientRect();
      var w = pop.offsetWidth,
        h = pop.offsetHeight;
      var vw = document.documentElement.clientWidth,
        vh = document.documentElement.clientHeight;
      var left = Math.min(Math.max(8, r.right - w), Math.max(8, vw - w - 8));
      var top = r.bottom + 6;
      if (top + h > vh - 8) top = Math.max(8, r.top - h - 6);
      pop.style.left = left + 'px';
      pop.style.top = top + 'px';
    }

    // Surligne début / fin / jours entre les deux (aperçu au survol pendant le choix du 2e jour)
    function paint(hover) {
      if (!pop) return;
      var a = null,
        b = null;
      if (startDay) {
        a = startDay;
        b = hover || startDay;
      } else if (range) {
        a = range.from;
        b = range.to;
      }
      if (a && b && a > b) {
        var t = a;
        a = b;
        b = t;
      }
      pop.querySelectorAll('.pcal-day').forEach(function (c) {
        var d = c.dataset.d;
        c.classList.toggle('sel', !!a && (d === a || d === b));
        c.classList.toggle('inrange', !!a && d > a && d < b);
      });
    }
    function hintText() {
      if (startDay) return L.hintSecond;
      return range ? L.hintCurrent(fr(range.from), fr(range.to)) : L.hintFirst;
    }
    function navBtn(txt, delta, title) {
      var b = el('button', 'pcal-nav', txt);
      b.type = 'button';
      b.title = title;
      b.dataset.nav = String(delta);
      return b;
    }

    function render() {
      pop.textContent = '';
      var y = view.y,
        m = view.m;
      var head = el('div', 'pcal-head');
      head.appendChild(navBtn('«', -12, L.prevYear));
      head.appendChild(navBtn('‹', -1, L.prevMonth));
      head.appendChild(el('div', 'pcal-title', L.months[m] + ' ' + y));
      head.appendChild(navBtn('›', 1, L.nextMonth));
      head.appendChild(navBtn('»', 12, L.nextYear));
      pop.appendChild(head);

      var grid = el('div', 'pcal-grid');
      L.weekdays.forEach(function (j) {
        grid.appendChild(el('div', 'pcal-wd', j));
      });
      var lead = (new Date(y, m, 1).getDay() + 6) % 7;
      var nd = new Date(y, m + 1, 0).getDate();
      var today = todayStr();
      var i, d;
      for (i = 0; i < lead; i++) grid.appendChild(el('div', 'pcal-blank'));
      for (d = 1; d <= nd; d++) {
        var ds = ymd(y, m, d);
        var c = el('button', 'pcal-day' + (ds === today ? ' today' : ''), String(d));
        c.type = 'button';
        c.dataset.d = ds;
        grid.appendChild(c);
      }
      for (var q = lead + nd; q < 42; q++) grid.appendChild(el('div', 'pcal-blank')); // toujours 6 lignes
      pop.appendChild(grid);

      var foot = el('div', 'pcal-foot');
      foot.appendChild(el('div', 'pcal-hint', hintText()));
      var clear = el('button', 'pcal-clear', L.clear);
      clear.type = 'button';
      clear.title = L.clearTitle;
      foot.appendChild(clear);
      pop.appendChild(foot);
      paint();
    }

    function open() {
      if (openInstance && openInstance !== api) openInstance.close();
      if (pop && !document.body.contains(pop)) close();
      if (pop) {
        close(); // 2e clic sur le bouton : on referme
        return;
      }
      startDay = null;
      var ref = range ? range.from : todayStr();
      view = {y: parseInt(ref.slice(0, 4), 10), m: parseInt(ref.slice(5, 7), 10) - 1};
      pop = el('div', 'pcal-pop');
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', L.dialog);
      document.body.appendChild(pop);
      openInstance = api;
      render();
      place();
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', onReflow);
      window.addEventListener('scroll', onReflow, true);

      pop.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var nav = t.closest('.pcal-nav');
        if (nav) {
          var total = view.y * 12 + view.m + parseInt(nav.dataset.nav, 10);
          view = {y: Math.floor(total / 12), m: ((total % 12) + 12) % 12};
          render();
          return;
        }
        if (t.closest('.pcal-clear')) {
          api.clear();
          return;
        }
        var day = t.closest('.pcal-day');
        if (day) {
          if (!startDay) {
            startDay = day.dataset.d;
            pop.querySelector('.pcal-hint').textContent = hintText();
            paint();
          } else {
            api.setRange(startDay, day.dataset.d);
          }
        }
      });
      pop.addEventListener('mouseover', function (e) {
        if (!startDay || !e.target.closest) return;
        var day = e.target.closest('.pcal-day');
        if (day && pop.contains(day)) paint(day.dataset.d);
      });
    }

    function onBtnClick(e) {
      e.preventDefault();
      open();
    }
    btn.addEventListener('click', onBtnClick);

    var api = {
      button: btn,
      getRange: function () {
        return range ? {from: range.from, to: range.to} : null;
      },
      // Choisit une plage (les deux jours dans n'importe quel ordre) et prévient onChange
      setRange: function (a, b, silent) {
        var r = normRange(a, b);
        if (!r) return;
        close();
        range = r;
        sync();
        if (!silent && opts.onChange) opts.onChange(api.getRange());
      },
      // Efface la plage (onChange(null))
      clear: function (silent) {
        close();
        range = null;
        sync();
        if (!silent && opts.onChange) opts.onChange(null);
      },
      open: open,
      close: close,
      destroy: function () {
        close();
        btn.removeEventListener('click', onBtnClick);
        if (ro) ro.disconnect();
        if (label) label.remove();
        if (!opts.button) btn.remove();
        else btn.classList.remove('pcal-btn', 'active');
      }
    };
    sync();
    return api;
  }

  // Filtre une liste d'éléments : ne garde que ceux dont la date (AAAA-MM-JJ) est dans la plage, bornes incluses
  function filter(list, getDate, range) {
    if (!range) return list.slice();
    return list.filter(function (x) {
      var d = typeof getDate === 'function' ? getDate(x) : x[getDate];
      return d && d >= range.from && d <= range.to;
    });
  }

  return {create: create, filter: filter, version: '1.0'};
});
