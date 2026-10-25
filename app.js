'use strict';

/**
 * app.js
 * Squelette de la PWA : nav bar (horloges + session), menu burger,
 * navigation entre les 2 onglets. Aucune donnée métier pour l'instant.
 */

/* =========================================================
   1. Horloges de sessions (New York / London / Tokyo)
   ========================================================= */
const CLOCKS = [
  { id: 'clock-ny', timeZone: 'America/New_York' },
  { id: 'clock-ldn', timeZone: 'Europe/London' },
  { id: 'clock-tky', timeZone: 'Asia/Tokyo' },
];

const MOBILE_QUERY = window.matchMedia('(max-width: 640px)');

function formatTime(date, timeZone) {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: MOBILE_QUERY.matches ? undefined : '2-digit',
    hour12: false,
  }).format(date);
}

function updateClocks() {
  const now = new Date();
  for (const clock of CLOCKS) {
    const el = document.getElementById(clock.id);
    if (!el) continue;
    el.textContent = formatTime(now, clock.timeZone);
  }
}

/* =========================================================
   2. Session de trading active (basé sur l'heure UTC)
   Plages indicatives standard du marché Forex :
   - Tokyo   : 00:00–09:00 UTC
   - London  : 08:00–17:00 UTC
   - New York: 13:00–22:00 UTC
   ========================================================= */
function getActiveSession(date) {
  const h = date.getUTCHours();

  const tokyoOpen = h >= 0 && h < 9;
  const londonOpen = h >= 8 && h < 17;
  const nyOpen = h >= 13 && h < 22;

  const open = [];
  if (tokyoOpen) open.push('Tokyo');
  if (londonOpen) open.push('London');
  if (nyOpen) open.push('New York');

  if (open.length === 0) return 'Marché calme';
  if (open.length === 1) return open[0];
  return open.join(' + ');
}

function updateSessionBadge() {
  const label = document.getElementById('sessionLabel');
  if (!label) return;
  label.textContent = getActiveSession(new Date());
}

/* =========================================================
   3. Boucle de mise à jour (1x / seconde)
   ========================================================= */
function tick() {
  updateClocks();
  updateSessionBadge();
}

/* =========================================================
   4. Menu burger
   ========================================================= */
function initBurgerMenu() {
  const burgerBtn = document.getElementById('burgerBtn');
  const sideMenu = document.getElementById('sideMenu');
  const closeBtn = document.getElementById('menuCloseBtn');

  if (!burgerBtn || !sideMenu || !closeBtn) return;

  function openMenu() {
    sideMenu.classList.add('is-open');
    sideMenu.setAttribute('aria-hidden', 'false');
    burgerBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeMenu() {
    sideMenu.classList.remove('is-open');
    sideMenu.setAttribute('aria-hidden', 'true');
    burgerBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  function toggleMenu() {
    const isOpen = sideMenu.classList.contains('is-open');
    if (isOpen) closeMenu(); else openMenu();
  }

  burgerBtn.addEventListener('click', toggleMenu);
  closeBtn.addEventListener('click', closeMenu);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && sideMenu.classList.contains('is-open')) {
      closeMenu();
    }
  });

  return { closeMenu };
}

/* =========================================================
   5. Navigation entre les onglets
   ========================================================= */
function initTabs(onNavigate) {
  const tabButtons = Array.from(document.querySelectorAll('.menu-tab[data-tab]'));
  const panels = Array.from(document.querySelectorAll('.tab-panel'));

  function activateTab(tabId) {
    for (const btn of tabButtons) {
      const isActive = btn.dataset.tab === tabId;
      btn.classList.toggle('is-active', isActive);
      if (isActive) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    }
    for (const panel of panels) {
      const isActive = panel.id === tabId;
      panel.classList.toggle('is-active', isActive);
      panel.hidden = !isActive;
    }
  }

  for (const btn of tabButtons) {
    btn.addEventListener('click', () => {
      activateTab(btn.dataset.tab);
      if (typeof onNavigate === 'function') onNavigate(btn.dataset.tab);
    });
  }
}

/* =========================================================
   6. Authentification (Supabase + Google)
   ========================================================= */
async function initAuth() {
  const loginScreen = document.getElementById('loginScreen');
  const appShell = document.getElementById('appShell');
  const googleBtn = document.getElementById('googleSignInBtn');
  const loginNote = document.getElementById('loginNote');
  const logoutBtn = document.getElementById('logoutBtn');

  if (!loginScreen || !appShell || !googleBtn) return;

  if (!window.Auth || !window.Auth.isConfigured()) {
    if (loginNote) {
      loginNote.hidden = false;
      loginNote.textContent = 'Supabase non configuré — renseigne supabase-config.js.';
    }
    googleBtn.disabled = true;
    return;
  }

  function showApp() {
    loginScreen.hidden = true;
    appShell.hidden = false;
  }

  function showLogin() {
    loginScreen.hidden = false;
    appShell.hidden = true;
  }

  // IMPORTANT : on met en place l'écouteur AVANT de vérifier la session
  // initiale. Si on faisait l'inverse, l'événement de connexion déclenché
  // par le retour de redirection Google pourrait arriver pendant qu'on
  // attend getSession(), et on le raterait complètement.
  window.Auth.onAuthStateChange((newSession) => {
    if (newSession) showApp();
    else showLogin();
  });

  const session = await window.Auth.getSession();
  if (session) {
    showApp();
  } else {
    showLogin();
  }

  googleBtn.addEventListener('click', () => {
    window.Auth.signInWithGoogle();
  });

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      window.Auth.signOut();
    });
  }
}

/* =========================================================
   7. Panneau Thème & Mode Stylo
   ========================================================= */
function initThemePanel() {
  const openBtn = document.getElementById('themeBtn');
  const closeBtn = document.getElementById('themePanelToggleBtn');
  const panel = document.getElementById('themePanel');

  if (!openBtn || !closeBtn || !panel) return;

  function openPanel() {
    panel.classList.add('is-open');
  }

  function closePanel() {
    panel.classList.remove('is-open');
    // Referme tout ce qui aurait pu rester ouvert (menus dépliés,
    // sélecteur de couleur), pour repartir sur une base propre la
    // prochaine fois qu'on rouvre le panneau.
    document.querySelectorAll('.theme-accordion-row.is-open').forEach((row) => {
      row.classList.remove('is-open');
    });
    document.querySelectorAll('.theme-accordion.is-open').forEach((wrapper) => {
      wrapper.classList.remove('is-open');
    });
    const cpOverlay = document.getElementById('cpOverlay');
    if (cpOverlay) cpOverlay.classList.remove('is-open');
  }

  openBtn.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panel.classList.contains('is-open')) {
      closePanel();
    }
  });

  // Accordéons : bascule la ligne ET son conteneur parent (qui contrôle
  // l'affichage du contenu dépliable via CSS).
  const rows = Array.from(document.querySelectorAll('.theme-accordion-row'));
  for (const row of rows) {
    row.addEventListener('click', () => {
      row.classList.toggle('is-open');
      const wrapper = row.closest('.theme-accordion');
      if (wrapper) wrapper.classList.toggle('is-open');
    });
  }

  // "Replier les couleurs" : referme les menus dépliés ET ferme le
  // panneau entier (même effet que de recliquer sur "Thème").
  const collapseBtn = document.getElementById('collapseColorsBtn');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      for (const row of rows) {
        row.classList.remove('is-open');
        const wrapper = row.closest('.theme-accordion');
        if (wrapper) wrapper.classList.remove('is-open');
      }
      closePanel();
    });
  }

  // "Appliquer" et "Réinitialiser" pilotent désormais le vrai système de
  // couleurs personnalisables (voir theme-colors.js). La sauvegarde
  // cloud (Supabase) n'est pas encore branchée à ce stade — pour
  // l'instant, tout est sauvegardé en local sur l'appareil.
  const applyBtn = document.getElementById('applySettingsBtn');
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      if (window.ThemeColors) window.ThemeColors.apply();
    });
  }

  const resetBtn = document.getElementById('resetSettingsBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (window.ThemeColors) window.ThemeColors.reset();
    });
  }

  // Permet à la navigation entre onglets de tout refermer (voir DOMContentLoaded).
  return { close: closePanel };
}

/* =========================================================
   8. Enregistrement du Service Worker (installabilité PWA)
   ========================================================= */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.error('Échec de l\'enregistrement du service worker :', err);
    });
  });
}

/* =========================================================
   6bis. Barre des devises + calendrier économique
   (onglet Analyse par devise). Un clic sur une devise affiche sa
   propre fenêtre, avec les événements importants (impact rouge et
   orange) lus dans la table Supabase "calendar_events".
   ========================================================= */
const CALENDAR_REFRESH_MS = 60000;

// Filtre d'impact (orange seul / les deux / rouge seul) : partagé entre
// TOUTES les devises (le curseur ne fait pas partie d'une fenêtre de
// devise en particulier, voir index.html). Mémorisé sur l'appareil pour
// rester d'une session à l'autre.
const CALENDAR_IMPACT_STORAGE_KEY = 'fx-calendar-impact-filter';
let calendarImpactFilter = 'both'; // 'medium' | 'both' | 'high'
try {
  const stored = localStorage.getItem(CALENDAR_IMPACT_STORAGE_KEY);
  if (stored === 'medium' || stored === 'both' || stored === 'high') calendarImpactFilter = stored;
} catch (e) { /* stockage indisponible : on garde la valeur par défaut */ }

function getCalendarImpacts() {
  if (calendarImpactFilter === 'medium') return ['medium'];
  if (calendarImpactFilter === 'high') return ['high'];
  return ['high', 'medium'];
}

// Cases à cocher « vue » (barre Calendrier). Les cases cochées s'additionnent :
// un événement est affiché s'il correspond à AU MOINS une case cochée.
//   released : déjà sorti (valeur publiée, ou heure passée), quel que soit le jour
//   nearby   : prévu aujourd'hui ou demain (sorti ou non)
//   forecast : prévu à partir d'après-demain, jusqu'à la prochaine réunion
//              de la banque centrale (voir limitUpcomingEvents)
// Tout coché = tous les événements. Mémorisé sur l'appareil.
const CALENDAR_VIEW_STORAGE_KEY = 'fx-calendar-view-filters-v2';
const CALENDAR_VIEW_KEYS = ['released', 'nearby', 'forecast'];
const calendarViewFilters = { released: true, nearby: true, forecast: true };
try {
  const raw = localStorage.getItem(CALENDAR_VIEW_STORAGE_KEY);
  if (raw) {
    const saved = JSON.parse(raw);
    for (const key of CALENDAR_VIEW_KEYS) {
      if (typeof saved[key] === 'boolean') calendarViewFilters[key] = saved[key];
    }
  }
} catch (e) { /* stockage indisponible ou illisible : tout reste coché */ }

function applyCalendarViewFilters(events) {
  if (CALENDAR_VIEW_KEYS.every((key) => calendarViewFilters[key])) return events;

  // Les limites « aujourd'hui / demain » suivent l'heure locale de l'appareil.
  const now = Date.now();
  const d = new Date();
  const todayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayAfterTomorrowStart = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 2).getTime();

  return events.filter((ev) => {
    const t = new Date(ev.event_time).getTime();
    const hasActual = ev.actual !== null && ev.actual !== undefined && String(ev.actual).trim() !== '';
    const released = hasActual || t <= now;
    if (calendarViewFilters.released && released) return true;
    if (calendarViewFilters.nearby && t >= todayStart && t < dayAfterTomorrowStart) return true;
    if (calendarViewFilters.forecast && t >= dayAfterTomorrowStart) return true;
    return false;
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Renvoie { events } (tableau, éventuellement vide) ou { events: null, error }
// si la lecture est impossible (session expirée, réseau coupé...).
async function fetchCalendarEvents(code) {
  const client = window.Auth && window.Auth.getClient ? window.Auth.getClient() : null;
  if (!client) return { events: null, error: 'connexion indisponible' };
  const { data, error } = await client
    .from('calendar_events')
    .select('title, impact, previous, forecast_low, forecast_mid, forecast_high, actual, event_time')
    .eq('currency', code)
    .in('impact', getCalendarImpacts())
    .order('event_time', { ascending: true });
  if (error) {
    console.error('Calendrier économique : lecture impossible :', error);
    return { events: null, error: (error && error.message) || 'erreur inconnue' };
  }
  return { events: data || [] };
}

// Convertit "73K", "-40.8K", "4.3%", "3.85B"... en nombre. Renvoie null si
// la valeur n'est pas un simple nombre (ex. "5-4-0", vide).
function parseCalendarNumber(value) {
  if (value === null || value === undefined) return null;
  const m = String(value).trim().match(/^(-?\d+(?:\.\d+)?)\s*([KMBT])?\s*%?$/i);
  if (!m) return null;
  const multipliers = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
  return parseFloat(m[1]) * (m[2] ? multipliers[m[2].toUpperCase()] : 1);
}

// Sens de la valeur sortie par rapport à la prévision moyenne :
// 'up' (au-dessus), 'down' (en dessous) ou '' (égale / non comparable).
function actualDirection(ev) {
  const actual = parseCalendarNumber(ev.actual);
  const forecast = parseCalendarNumber(ev.forecast_mid);
  if (actual === null || forecast === null) return '';
  if (actual > forecast) return 'up';
  if (actual < forecast) return 'down';
  return '';
}

// Noms des événements en français. Les clés sont les noms d'origine
// (en anglais, tels que Forex Factory les publie). Un événement absent de
// cette liste s'affiche avec son nom d'origine. Le nom d'origine reste
// visible en maintenant le doigt (ou en survolant) le nom. Pour ajouter
// une traduction, ajouter simplement une ligne à cette liste.
const CALENDAR_TRANSLATIONS = {
  "Non-Farm Employment Change": "NFP",
  "Unemployment Rate": "Taux de chômage",
  "Average Hourly Earnings m/m": "Salaire horaire moyen (mensuel)",
  "Unemployment Claims": "Demandes d'allocations chômage",
  "CPI m/m": "Inflation (CPI) mensuelle",
  "Core CPI m/m": "Inflation de base (CPI) mensuelle",
  "Core Retail Sales m/m": "Ventes au détail de base (mensuel)",
  "Federal Funds Rate": "Taux directeur de la Fed",
  "FOMC Statement": "Communiqué de la Fed (FOMC)",
  "German Flash Manufacturing PMI": "PMI manufacturier allemand (flash)",
  "German ZEW Economic Sentiment": "Confiance des investisseurs allemands (ZEW)",
  "Core CPI Flash Estimate y/y": "Inflation de base (CPI), estimation flash annuelle",
  "CPI Flash Estimate y/y": "Inflation (CPI), estimation flash annuelle",
  "ECB Main Refinancing Rate": "Taux directeur de la BCE",
  "ECB Press Conference": "Conférence de presse de la BCE",
  "Tokyo Core CPI y/y": "Inflation de base de Tokyo (CPI) annuelle",
  "Average Cash Earnings y/y": "Salaires moyens en espèces (annuel)",
  "National Core CPI y/y": "Inflation de base nationale (CPI) annuelle",
  "Prelim GDP q/q": "PIB (GDP) préliminaire trimestriel",
  "Tankan Manufacturing Index": "Enquête Tankan, industrie manufacturière",
  "BOJ Policy Rate": "Taux directeur de la BoJ",
  "BOJ Press Conference": "Conférence de presse de la BoJ",
  "Average Earnings Index 3m/y": "Salaires moyens sur 3 mois (annuel)",
  "Claimant Count Change": "Variation du nombre de demandeurs d'emploi",
  "CPI y/y": "Inflation (CPI) annuelle",
  "GDP m/m": "PIB (GDP) mensuel",
  "Retail Sales m/m": "Ventes au détail (mensuel)",
  "MPC Official Bank Rate Votes": "Votes du comité de politique monétaire",
  "Official Bank Rate": "Taux directeur de la BoE",
  "Trade Balance": "Balance commerciale",
  "KOF Economic Barometer": "Baromètre économique KOF",
  "Retail Sales y/y": "Ventes au détail (annuel)",
  "SNB Policy Rate": "Taux directeur de la BNS",
  "SNB Monetary Policy Assessment": "Évaluation de politique monétaire de la BNS",
  "Employment Change": "Variation de l'emploi",
  "Ivey PMI": "PMI Ivey",
  "Overnight Rate": "Taux directeur de la Banque du Canada",
  "BOC Rate Statement": "Communiqué de la Banque du Canada",
  "Westpac Consumer Sentiment": "Confiance des consommateurs Westpac",
  "Wage Price Index q/q": "Indice des salaires (trimestriel)",
  "Cash Rate": "Taux directeur de la Banque d'Australie",
  "RBA Rate Statement": "Communiqué de la Banque d'Australie",
  "GDT Price Index": "Prix des produits laitiers (GDT)",
  "CPI q/q": "Inflation (CPI) trimestrielle",
  "GDP q/q": "PIB (GDP) trimestriel",
  "Official Cash Rate": "Taux directeur de la Banque de Nouvelle-Zélande",
  "RBNZ Rate Statement": "Communiqué de la Banque de Nouvelle-Zélande",
  "Manufacturing PMI": "PMI manufacturier",
  "Non-Manufacturing PMI": "PMI non manufacturier",
  "Caixin Manufacturing PMI": "PMI manufacturier Caixin",
  "GDP q/y": "PIB (GDP) annuel",
};

function translateEventTitle(title) {
  return CALENDAR_TRANSLATIONS[title] || String(title);
}

// =========================================================
// Traduction automatique (bouton "Traduire" de la barre d'outils).
// Complète les titres absents de CALENDAR_TRANSLATIONS ci-dessus, via
// un service gratuit mais NON officiel de Google (aucune clé, aucune
// inscription) : il peut ralentir, se limiter ou changer sans préavis,
// contrairement à une vraie API de traduction payante. Les traductions
// obtenues sont mémorisées (jamais redemandées deux fois pour le même
// texte) et persistées sur l'appareil.
// =========================================================
const CALENDAR_AUTO_TRANSLATE_STORAGE_KEY = 'fx-calendar-auto-translate';
const CALENDAR_TRANSLATE_CACHE_STORAGE_KEY = 'fx-calendar-translate-cache';
let calendarAutoTranslate = false;
let calendarTranslateCache = new Map();
try {
  calendarAutoTranslate = localStorage.getItem(CALENDAR_AUTO_TRANSLATE_STORAGE_KEY) === '1';
  const rawCache = localStorage.getItem(CALENDAR_TRANSLATE_CACHE_STORAGE_KEY);
  if (rawCache) calendarTranslateCache = new Map(Object.entries(JSON.parse(rawCache)));
} catch (e) { /* stockage indisponible : on repart sans historique */ }

function saveCalendarTranslateCache() {
  try {
    localStorage.setItem(CALENDAR_TRANSLATE_CACHE_STORAGE_KEY, JSON.stringify(Object.fromEntries(calendarTranslateCache)));
  } catch (e) { /* stockage indisponible : tant pis, on retraduira la prochaine fois */ }
}

// Titre affiché : dictionnaire connu en priorité, sinon (si la
// traduction automatique est activée) une traduction déjà en cache,
// sinon le titre d'origine en attendant.
// Dans les intitulés traduits en français, les périodes s'écrivent toujours avec les
// abréviations de l'appli : m/m (mensuel), y/y (annuel, « sur un an »), q/q (trimestriel).
function shortenPeriods(text) {
  return String(text)
    .replace(/\s*\(\s*mensuel(?:le)?s?\s*\)/gi, ' m/m')
    .replace(/\s*\(\s*annuel(?:le)?s?\s*\)/gi, ' y/y')
    .replace(/\s*\(\s*trimestriel(?:le)?s?\s*\)/gi, ' q/q')
    .replace(/\s*\(\s*(?:sur (?:un|1) an|en glissement annuel)\s*\)/gi, ' y/y')
    .replace(/\b(?:en glissement mensuel|sur (?:un|1) mois|d'un mois sur l'autre)\b/gi, 'm/m')
    .replace(/\b(?:en glissement annuel|sur (?:un|1) an|d'une année sur l'autre)\b/gi, 'y/y')
    .replace(/\b(?:en glissement trimestriel|sur (?:un|1) trimestre|d'un trimestre sur l'autre)\b/gi, 'q/q')
    .replace(/\bmensuel(?:le)?s?\b/gi, 'm/m')
    .replace(/\bannuel(?:le)?s?\b/gi, 'y/y')
    .replace(/\btrimestriel(?:le)?s?\b/gi, 'q/q')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function resolveEventTitle(title) {
  if (CALENDAR_TRANSLATIONS[title]) return shortenPeriods(CALENDAR_TRANSLATIONS[title]);
  if (calendarAutoTranslate && calendarTranslateCache.has(title)) return shortenPeriods(calendarTranslateCache.get(title));
  return String(title);
}

// =========================================================
// Présentation de certains événements : CPI, PPI, NFP, ISM
//   - CPI et PPI : quatre intitulés fixes, dans cet ordre (seuls ceux qui
//     sortent sont affichés) :
//         CPI m/m · Core CPI m/m · CPI y/y · Core CPI y/y
//         PPI m/m · Core PPI m/m · PPI y/y · Core PPI y/y
//     Pour un indice national de la zone euro (« French CPI », « German PPI »...),
//     le pays est ajouté à droite.
//   - Non-Farm Payrolls, quel que soit le nom d'origine : « NFP »
//     (« Private Nonfarm Payrolls » : « NFP privé » ; ADP : « ADP NFP »).
//   - ISM : « ISM PMI manufacturier » et « ISM PMI services » (« ISM Services PMI »
//     et « ISM Non-Manufacturing PMI » désignent le même indice).
//   Le nom d'origine reste visible au survol / maintien. Une sortie publiée sous
//   plusieurs noms n'est affichée qu'une fois.
//   Ne sont PAS concernés (autres indicateurs) : HICP, PCE, anticipations
//   d'inflation, CPI « Trimmed / Median / Common », CPI de Tokyo, IPPI, sous-indices
//   ISM (emploi, prix), PMI S&P Global / HCOB.
//   Certains CPI/PPI n'indiquent pas leur période dans leur nom (« French CPI »,
//   « CPI »...). Elle est alors déduite ainsi :
//     1. une ligne du même jour, même devise, même pays avec une période
//        explicite et les mêmes chiffres = la même sortie : doublon masqué ;
//     2. sinon, pour les indices nationaux seulement : toutes les valeurs sous 1
//        = m/m, une valeur à partir de 2 = y/y ;
//     3. sinon la période reste inconnue et le nom s'affiche sans période.
// =========================================================
const EVENT_COUNTRY_FR = { french: 'France', german: 'Allemagne', spanish: 'Espagne', italian: 'Italie' };
const INDEX_EXCLUDED = /\b(hicp|pce|expectations?|trimmed|median|common|tokyo|price index|prices)\b/i;
const INDEX_LABEL_ORDER = [
  'CPI m/m', 'Core CPI m/m', 'CPI y/y', 'Core CPI y/y',
  'PPI m/m', 'Core PPI m/m', 'PPI y/y', 'Core PPI y/y',
];
const FIXED_EVENT_NAMES = [
  { re: /^non-?farm (employment change|payrolls)$/i, label: 'NFP', currency: 'USD' },
  { re: /^private non-?farm payrolls$/i, label: 'NFP privé', currency: 'USD' },
  { re: /^adp non-?farm employment change$/i, label: 'ADP NFP', currency: 'USD' },
  { re: /^ism manufacturing pmi$/i, label: 'ISM PMI manufacturier', currency: 'USD' },
  { re: /^ism (services|non-manufacturing) pmi$/i, label: 'ISM PMI services', currency: 'USD' },
];

function parseEventTitle(ev) {
  const t = String(ev.title || '').trim();
  for (const f of FIXED_EVENT_NAMES) {
    if (f.currency === ev.currency && f.re.test(t)) return { fixed: true, label: f.label, country: null };
  }
  const k = t.match(/\b(cpi|ppi)\b/i);
  if (!k || INDEX_EXCLUDED.test(t)) return null;
  let period = null;
  if (/\bm\/m\b/i.test(t)) period = 'm/m';
  else if (/\by\/y\b/i.test(t)) period = 'y/y';
  else if (/\bq\/q\b/i.test(t)) period = 'q/q';
  const c = t.match(/\b(french|german|spanish|italian)\b/i);
  return { kind: k[1].toUpperCase(), core: /\bcore\b/i.test(t), period, country: c ? EVENT_COUNTRY_FR[c[1].toLowerCase()] : null };
}

function eventSameNumber(a, b) {
  const x = parseCalendarNumber(a);
  const y = parseCalendarNumber(b);
  return x !== null && y !== null && Math.abs(x - y) < 1e-9;
}

function eventHasValue(v) {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

// Même sortie publiée sous deux noms ? Prévision identique, et « Sortie » ou « Avant » identique.
// Deux « Sortie » différentes = deux données différentes : jamais un doublon.
function eventSameRelease(a, b) {
  if (eventHasValue(a.actual) && eventHasValue(b.actual) && !eventSameNumber(a.actual, b.actual)) return false;
  return eventSameNumber(a.forecast_mid, b.forecast_mid)
    && (eventSameNumber(a.actual, b.actual) || eventSameNumber(a.previous, b.previous));
}

function indexPeriodFromValues(ev) {
  const vals = [ev.previous, ev.forecast_mid, ev.actual].map(parseCalendarNumber).filter((v) => v !== null);
  if (!vals.length) return null;
  if (vals.every((v) => Math.abs(v) < 1)) return 'm/m';
  if (vals.some((v) => Math.abs(v) >= 2)) return 'y/y';
  return null;
}

function eventLabel(info) {
  if (info.fixed) return info.label;
  return `${info.core ? 'Core ' : ''}${info.kind}${info.period ? ' ' + info.period : ''}`;
}

function applyEventPresentation(events) {
  if (!Array.isArray(events)) return events;
  const items = events.map((ev) => ({ ev, info: parseEventTitle(ev), explicit: false }));
  if (!items.some((i) => i.info)) return events;

  const day = (ev) => String(ev.event_time).slice(0, 10);
  const sameGroup = (a, b) => a.ev.currency === b.ev.currency && a.info.kind === b.info.kind
    && a.info.core === b.info.core && a.info.country === b.info.country && day(a.ev) === day(b.ev);

  items.forEach((it) => { if (it.info && (it.info.fixed || it.info.period)) it.explicit = true; });
  const explicit = items.filter((i) => i.explicit && !i.info.fixed);

  // 1) Période des CPI/PPI qui ne l'indiquent pas
  for (const it of items) {
    if (!it.info || it.info.fixed || it.info.period) continue;
    const twin = explicit.find((e) => sameGroup(e, it) && eventSameRelease(e.ev, it.ev));
    let period = twin ? twin.info.period : null;
    if (!period && it.info.country) period = indexPeriodFromValues(it.ev);
    it.info = { ...it.info, period };
  }

  // 2) Doublons : même devise / intitulé / pays / jour -> une seule ligne
  //    (celle dont le nom indiquait la période, sinon celle qui a une « Sortie »)
  const kept = new Map();
  const dropped = new Set();
  for (const it of items) {
    if (!it.info || (!it.info.fixed && !it.info.period)) continue;
    const key = [it.ev.currency, it.info.country, eventLabel(it.info), day(it.ev)].join('|');
    const rep = kept.get(key);
    if (!rep) { kept.set(key, it); continue; }
    const better = (!rep.explicit && it.explicit) || (rep.explicit === it.explicit && !eventHasValue(rep.ev.actual) && eventHasValue(it.ev.actual));
    const [winner, loser] = better ? [it, rep] : [rep, it];
    if (!eventHasValue(winner.ev.actual) && eventHasValue(loser.ev.actual)) winner.actualFrom = loser.ev.actual;
    dropped.add(loser);
    kept.set(key, winner);
  }

  // 3) Résultat : lignes concernées remplacées par une copie portant l'intitulé fixe
  const out = [];
  for (const it of items) {
    if (dropped.has(it)) continue;
    if (!it.info) { out.push(it.ev); continue; }
    const ev = { ...it.ev, shown: { label: eventLabel(it.info), country: it.info.country } };
    if (it.actualFrom !== undefined) ev.actual = it.actualFrom;
    out.push(ev);
  }

  // 4) Ordre : pour une même devise et une même heure, CPI m/m, Core CPI m/m, CPI y/y, Core CPI y/y (idem PPI)
  const rank = (ev) => {
    const i = INDEX_LABEL_ORDER.indexOf(ev.shown.label);
    return i === -1 ? INDEX_LABEL_ORDER.length : i;
  };
  const result = [];
  const done = new Set();
  for (const ev of out) {
    if (!ev.shown) { result.push(ev); continue; }
    const k = `${ev.currency}|${ev.event_time}`;
    if (done.has(k)) continue;
    done.add(k);
    const group = out.filter((x) => x.shown && x.currency === ev.currency && x.event_time === ev.event_time);
    group.sort((a, b) => rank(a) - rank(b) || String(a.shown.country || '').localeCompare(String(b.shown.country || '')));
    result.push(...group);
  }
  return result;
}

// Pays à droite du nom (CPI/PPI nationaux de la zone euro uniquement).
function eventCountryTag(ev) {
  return ev.shown && ev.shown.country ? `<span class="calendar-country">${escapeHtml(ev.shown.country)}</span>` : '';
}

async function translateToFrench(text) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=fr&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Traduction : HTTP ${res.status}`);
  const data = await res.json();
  return data[0].map((chunk) => chunk[0]).join('');
}

// Traduit tous les titres de la liste qui ne sont ni dans le
// dictionnaire ni déjà en cache, puis redessine le calendrier une fois
// que c'est fait (peu importe l'ordre d'arrivée des réponses).
async function autoTranslateMissingTitles(code, events) {
  const missing = [...new Set(
    events
      .map((ev) => ev.title)
      .filter((title) => !CALENDAR_TRANSLATIONS[title] && !calendarTranslateCache.has(title)),
  )];
  if (!missing.length) return;

  await Promise.all(missing.map(async (title) => {
    try {
      const translated = await translateToFrench(title);
      calendarTranslateCache.set(title, translated);
    } catch (e) {
      console.error('Traduction automatique impossible pour « ' + title + ' » :', e);
    }
  }));

  saveCalendarTranslateCache();
  if (calendarAutoTranslate && lastCalendarEventsByCurrency[code] === events) {
    renderCalendar(code, events);
  }
}

// Icône "calendrier" — reprise à l'identique de period-calendar.js (TJP).
const CALENDAR_DATE_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 7h12M5.5 1.5v3M10.5 1.5v3"/></svg>';

// "Prévue le ..." si l'événement n'a pas encore eu lieu, "Publiée le ..."
// sinon (Forex Factory ne donne jamais l'heure exacte de publication de
// la donnée sortie, seulement l'heure prévue de l'annonce).
function formatCalendarDateTime(iso) {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const timePart = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const label = d.getTime() > Date.now() ? 'Prévue le' : 'Publiée le';
  return `${label} ${datePart} à ${timePart}`;
}

// Date + heure affichées directement dans le tableau sur grand écran
// (sur téléphone, c'est le bouton calendrier + bulle qui est utilisé).
function formatCalendarDateInline(iso) {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const timePart = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
}

// Une seule bulle réutilisée pour tous les boutons calendrier du tableau.
let calendarDatePopup = null;
let calendarDateOpenBtn = null;

function closeCalendarDatePopup() {
  if (calendarDateOpenBtn) calendarDateOpenBtn.classList.remove('is-open');
  calendarDateOpenBtn = null;
  if (calendarDatePopup) calendarDatePopup.hidden = true;
}

function openCalendarDatePopup(btn) {
  if (calendarDateOpenBtn === btn) { closeCalendarDatePopup(); return; }
  closeCalendarDatePopup();

  if (!calendarDatePopup) {
    calendarDatePopup = document.createElement('div');
    calendarDatePopup.className = 'calendar-date-popup';
    calendarDatePopup.hidden = true;
    document.body.appendChild(calendarDatePopup);
  }

  calendarDatePopup.textContent = formatCalendarDateTime(btn.dataset.eventTime);
  calendarDatePopup.hidden = false;
  btn.classList.add('is-open');
  calendarDateOpenBtn = btn;

  // Positionnée juste sous le bouton, sans déborder de l'écran.
  const rect = btn.getBoundingClientRect();
  const popupRect = calendarDatePopup.getBoundingClientRect();
  let left = rect.left;
  if (left + popupRect.width > window.innerWidth - 8) left = window.innerWidth - popupRect.width - 8;
  if (left < 8) left = 8;
  calendarDatePopup.style.left = `${left}px`;
  calendarDatePopup.style.top = `${rect.bottom + 6}px`;
}

// Délégation sur tout le document : les lignes du calendrier sont
// régénérées à chaque rafraîchissement, un écouteur par bouton serait
// donc perdu à chaque fois.
document.addEventListener('click', (event) => {
  const btn = event.target.closest('.calendar-date-btn');
  if (btn) { openCalendarDatePopup(btn); return; }
  if (calendarDateOpenBtn && !event.target.closest('.calendar-date-popup')) closeCalendarDatePopup();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeCalendarDatePopup();
});

function calendarCell(value, extraClass) {
  const text = value === null || value === undefined || value === '' ? '—' : escapeHtml(value);
  return `<td class="calendar-value${extraClass ? ' ' + extraClass : ''}">${text}</td>`;
}

// events : tableau, ou null s'il n'y a encore aucune donnée à montrer.
// errorNote : message affiché en haut si la dernière lecture a échoué.
function renderCalendar(code, events, errorNote) {
  const container = document.querySelector(`.calendar[data-currency="${code}"]`);
  if (!container) return;

  let html = '';
  if (errorNote) {
    html += `<p class="calendar-note">${escapeHtml(errorNote)}</p>`;
  }

  if (events === null) {
    html += '<div class="calendar-scroll"><p class="calendar-empty">Données indisponibles pour le moment</p></div>';
    container.innerHTML = html;
    return;
  }

  if (!events.length) {
    html += '<div class="calendar-scroll"><p class="calendar-empty">Aucun événement important</p></div>';
    container.innerHTML = html;
    return;
  }

  const visibleEvents = applyEventPresentation(applyCalendarViewFilters(events));
  if (!visibleEvents.length) {
    html += '<div class="calendar-scroll"><p class="calendar-empty">Aucun événement pour ces filtres</p></div>';
    container.innerHTML = html;
    return;
  }

  const rows = visibleEvents.map((ev) => {
    const impact = ev.impact === 'high' ? 'high' : 'medium';
    return `<tr>
      <td class="calendar-col-date">${escapeHtml(formatCalendarDateInline(ev.event_time))}</td>
      <td class="calendar-col-name">
        <button type="button" class="calendar-date-btn" data-event-time="${escapeHtml(ev.event_time)}" aria-label="Voir la date et l'heure">${CALENDAR_DATE_ICON}</button>
        <span class="calendar-impact calendar-impact--${impact}"></span><span class="calendar-name" title="${escapeHtml(ev.title)}">${escapeHtml(ev.shown ? ev.shown.label : resolveEventTitle(ev.title))}</span>${eventCountryTag(ev)}
      </td>
      ${calendarCell(ev.actual, 'calendar-value--actual' + (actualDirection(ev) ? ' calendar-value--' + actualDirection(ev) : ''))}
      ${calendarCell(ev.forecast_mid)}
      ${calendarCell(ev.previous)}
    </tr>`;
  }).join('');

  html += `<div class="calendar-scroll">
    <table class="calendar-table">
      <thead>
        <tr>
          <th scope="col" class="calendar-col-date">Date</th>
          <th scope="col" class="calendar-col-name">Événement</th>
          <th scope="col">Sortie</th>
          <th scope="col">Prévision</th>
          <th scope="col">Avant</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
  container.innerHTML = html;
}

const calendarRequestId = {};

// =========================================================
// Ce que le calendrier affiche, par devise :
//   1. tout ce qui est déjà sorti depuis la dernière réunion de la banque
//      centrale de cette devise (elle reste incluse), et qui reste
//      affiché jusqu'à la réunion suivante ;
//   2. tout ce qui doit sortir dans les 7 prochains jours.
// Point de réinitialisation : la dernière réunion déjà passée. Tout ce
// qui la précède n'est plus affiché.
const CENTRAL_BANK_ANCHORS = {
  USD: 'FOMC Statement',
  EUR: 'ECB Press Conference',
  JPY: 'BOJ Press Conference',
  GBP: 'Official Bank Rate',
  CHF: 'SNB Monetary Policy Assessment',
  CAD: 'BOC Rate Statement',
  AUD: 'RBA Rate Statement',
  NZD: 'RBNZ Rate Statement',
};

// Ne garde que les événements arrivés depuis la dernière réunion déjà
// passée de la banque centrale de cette devise (elle reste incluse).
// Si aucune réunion n'a encore été repérée dans les données reçues
// (le bot ne tourne peut-être pas encore depuis assez longtemps),
// on garde tout en attendant.
function filterSinceLastCentralBankMeeting(code, events) {
  const anchorTitle = CENTRAL_BANK_ANCHORS[code];
  if (!anchorTitle) return events;

  const now = Date.now();
  let cutoff = null;
  for (const ev of events) {
    if (!ev.title || !ev.title.toLowerCase().includes(anchorTitle.toLowerCase())) continue;
    const t = new Date(ev.event_time).getTime();
    if (t <= now && (cutoff === null || t > cutoff)) cutoff = t;
  }
  if (cutoff === null) return events;

  return events.filter((ev) => new Date(ev.event_time).getTime() >= cutoff);
}

// Les prises de parole (discours, auditions : "Fed Chair Powell Speaks",
// "ECB President Lagarde Speaks", "BOE Gov Bailey Testifies"...) ne sont
// pas des données économiques : elles sont masquées du calendrier (elles
// restent en base, pour une future section dédiée aux discours).
// Les conférences de presse ("ECB Press Conference"...) et les communiqués
// ne sont PAS concernés : certains servent de repère de réunion ci-dessus.
// Ce filtre s'applique après filterSinceLastCentralBankMeeting() et limitUpcomingEvents().
const SPEECH_TITLE_PATTERN = /\b(speaks|speech|testifies|testimony)\b/i;

function hideSpeechEvents(events) {
  return events.filter((ev) => !SPEECH_TITLE_PATTERN.test(ev.title || ''));
}

// Événements à venir : on garde tout jusqu'à la fin de la journée de la
// PROCHAINE réunion de la banque centrale de la devise (FOMC pour l'USD,
// etc., voir CENTRAL_BANK_ANCHORS). Si aucune prochaine réunion n'est
// connue dans les données, repli sur les 7 prochains jours.
const CALENDAR_LOOKAHEAD_MS = 7 * 24 * 60 * 60 * 1000;

function limitUpcomingEvents(code, events) {
  const now = Date.now();
  let max = now + CALENDAR_LOOKAHEAD_MS;

  const anchorTitle = CENTRAL_BANK_ANCHORS[code];
  if (anchorTitle) {
    let nextMeeting = null;
    for (const ev of events) {
      if (!ev.title || !ev.title.toLowerCase().includes(anchorTitle.toLowerCase())) continue;
      const t = new Date(ev.event_time).getTime();
      if (t > now && (nextMeeting === null || t < nextMeeting)) nextMeeting = t;
    }
    if (nextMeeting !== null) {
      const d = new Date(nextMeeting);
      max = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1;
    }
  }
  return events.filter((ev) => new Date(ev.event_time).getTime() <= max);
}

const lastCalendarEventsByCurrency = {};

async function loadCalendar(code) {
  const requestId = (calendarRequestId[code] || 0) + 1;
  calendarRequestId[code] = requestId;

  const result = await fetchCalendarEvents(code);
  // Une réponse plus récente est déjà arrivée : on ignore celle-ci.
  if (calendarRequestId[code] !== requestId) return;

  // Lecture impossible : on garde les dernières vraies données affichées
  // (jamais de données fictives) et on signale le problème. La lecture
  // est retentée automatiquement à chaque rafraîchissement.
  if (result.events === null) {
    const previous = lastCalendarEventsByCurrency[code] || null;
    renderCalendar(code, previous, `⚠ Lecture impossible (${result.error}). Nouvelle tentative dans une minute.`);
    return;
  }

  const events = hideSpeechEvents(limitUpcomingEvents(code, filterSinceLastCentralBankMeeting(code, result.events)));

  lastCalendarEventsByCurrency[code] = events;
  renderCalendar(code, events);
  if (calendarAutoTranslate) autoTranslateMissingTitles(code, events);
}

// Devise actuellement affichée : au niveau du module, pour que la barre
// d'outils partagée (filtre d'impact, traduction) sache quelle fenêtre
// rafraîchir quand on la manipule.
let currentCalendarCurrency = null;

function initCurrencyTabs() {
  const buttons = Array.from(document.querySelectorAll('.currency-card[data-currency]'));
  const panels = Array.from(document.querySelectorAll('.currency-panel'));
  if (!buttons.length) return;

  function selectCurrency(code) {
    currentCalendarCurrency = code;
    for (const btn of buttons) {
      const isActive = btn.dataset.currency === code;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.currency !== code;
    }
    loadCalendar(code);
  }

  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      selectCurrency(btn.dataset.currency);
      btn.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    });
  }

  // Les valeurs "sortie" arrivent après la publication : on rafraîchit
  // la devise affichée toutes les minutes. Le statut du bot (fraîcheur
  // des données) est vérifié en même temps.
  window.setInterval(() => {
    if (currentCalendarCurrency && !document.hidden) loadCalendar(currentCalendarCurrency);
    if (!document.hidden) refreshCalendarStatus();
  }, CALENDAR_REFRESH_MS);
  refreshCalendarStatus();

  // Au démarrage, la session peut ne pas être encore restaurée : on
  // recharge dès qu'elle l'est (sinon les règles d'accès renverraient 0 ligne).
  if (window.Auth && window.Auth.onAuthStateChange) {
    window.Auth.onAuthStateChange((session) => {
      if (session && currentCalendarCurrency) loadCalendar(currentCalendarCurrency);
    });
  }

  // Devise affichée au démarrage : la première de la liste (USD).
  selectCurrency(buttons[0].dataset.currency);
}

// Fraîcheur du calendrier : lit l'heure de dernière exécution du bot
// (table "bot_status") et prévient si elle date de plus de 40 minutes
// (le bot tourne toutes les 30 minutes normalement) — un moyen simple
// de voir si le bot s'est arrêté de tourner, sans avoir à vérifier sur
// Supabase à chaque fois.
const CALENDAR_STATUS_STALE_MS = 40 * 60 * 1000;

async function refreshCalendarStatus() {
  const el = document.getElementById('calendarStatus');
  if (!el) return;
  const client = window.Auth && window.Auth.getClient ? window.Auth.getClient() : null;
  if (!client) return;

  const { data, error } = await client
    .from('bot_status')
    .select('last_run, ok, events_written, errors')
    .eq('id', 'fetch-calendar')
    .maybeSingle();

  if (error || !data) { el.hidden = true; return; }

  const elapsedMs = Date.now() - new Date(data.last_run).getTime();
  const elapsedMin = Math.max(0, Math.round(elapsedMs / 60000));
  const isStale = elapsedMs > CALENDAR_STATUS_STALE_MS || !data.ok;
  // Le bot marque d'un "[INVESTING]" en tête de "errors" une panne d'Investing.com
  // (source des « Sortie » et des prévisions au-delà de la semaine).
  const investingDown = [].concat(data.errors || []).some((e) => String(e).startsWith('[INVESTING]'));

  el.hidden = false;
  el.classList.toggle('is-stale', isStale || investingDown);
  el.textContent = isStale
    ? `⚠ Calendrier peut-être en retard — dernière mise à jour il y a ${elapsedMin} min`
    : investingDown
      ? `⚠ Investing.com en défaut : « Sortie » et prévisions au-delà de la semaine possiblement manquantes — dernière mise à jour il y a ${elapsedMin} min`
      : `Calendrier à jour — dernière mise à jour il y a ${elapsedMin} min`;
}

// =========================================================
// Barre d'outils partagée du calendrier (filtre d'impact, traduction).
// Ne dépend d'aucune devise en particulier : son état est le même quel
// que soit l'onglet affiché (voir currentCalendarCurrency ci-dessus).
// =========================================================
function initCalendarToolbar() {
  // Le filtre d'impact et le bouton de traduction existent en deux exemplaires
  // (onglet Nouveau et onglet Analyse) : ils partagent le même état et restent
  // synchronisés, quel que soit celui sur lequel on clique.
  const impactToggles = Array.from(document.querySelectorAll('.calendar-impact-toggle'));
  const translateBtns = Array.from(document.querySelectorAll('.calendar-translate-btn'));

  function syncImpactToggles() {
    for (const toggle of impactToggles) {
      toggle.dataset.value = calendarImpactFilter;
      for (const b of toggle.querySelectorAll('.calendar-impact-toggle-btn')) {
        b.setAttribute('aria-checked', String(b.dataset.value === calendarImpactFilter));
      }
    }
  }
  syncImpactToggles();

  for (const btn of document.querySelectorAll('.calendar-impact-toggle-btn')) {
    btn.addEventListener('click', () => {
      const value = btn.dataset.value;
      if (value === calendarImpactFilter) return;
      calendarImpactFilter = value;
      syncImpactToggles();
      try { localStorage.setItem(CALENDAR_IMPACT_STORAGE_KEY, value); } catch (e) { /* tant pis */ }
      if (currentCalendarCurrency) loadCalendar(currentCalendarCurrency);
      if (isNewsTabActive()) loadNews();
    });
  }

  const viewFilters = document.getElementById('calendarViewFilters');
  if (viewFilters) {
    for (const input of viewFilters.querySelectorAll('input[data-filter]')) {
      input.checked = !!calendarViewFilters[input.dataset.filter];
      input.addEventListener('change', () => {
        calendarViewFilters[input.dataset.filter] = input.checked;
        try { localStorage.setItem(CALENDAR_VIEW_STORAGE_KEY, JSON.stringify(calendarViewFilters)); } catch (e) { /* tant pis */ }
        // Filtrage local : pas besoin de relire Supabase, on réaffiche
        // simplement les dernières données de la devise affichée.
        if (!currentCalendarCurrency) return;
        const events = lastCalendarEventsByCurrency[currentCalendarCurrency];
        if (events) renderCalendar(currentCalendarCurrency, events);
      });
    }
  }

  for (const translateBtn of translateBtns) {
    translateBtn.setAttribute('aria-pressed', String(calendarAutoTranslate));
    translateBtn.addEventListener('click', () => {
      calendarAutoTranslate = !calendarAutoTranslate;
      for (const b of translateBtns) b.setAttribute('aria-pressed', String(calendarAutoTranslate));
      try { localStorage.setItem(CALENDAR_AUTO_TRANSLATE_STORAGE_KEY, calendarAutoTranslate ? '1' : '0'); } catch (e) { /* tant pis */ }

      if (currentCalendarCurrency) {
        const events = lastCalendarEventsByCurrency[currentCalendarCurrency];
        if (events) {
          renderCalendar(currentCalendarCurrency, events);
          if (calendarAutoTranslate) autoTranslateMissingTitles(currentCalendarCurrency, events);
        }
      }
      if (newsLastEvents) {
        renderNewsCalendar(newsLastEvents);
        if (calendarAutoTranslate) newsTranslateMissing(newsLastEvents);
      }
    });
  }
}

// =========================================================
// Barre de défilement « discrète » (PC uniquement).
// La barre native est masquée (voir style.css) pour qu'elle ne décale plus
// la page vers la gauche quand le contenu devient long. À la place, une
// barre superposée apparaît quand la souris s'approche du bord droit de
// l'écran, et disparaît dès qu'on s'en éloigne. Sur téléphone/tablette
// tactile, on garde le comportement natif.
// =========================================================
function initEdgeScrollbar() {
  if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  const EDGE_ZONE_PX = 40;   // distance du bord droit qui fait apparaître la barre
  const MIN_THUMB_PX = 40;
  const HIDE_DELAY_MS = 500;

  const track = document.createElement('div');
  track.className = 'edge-scrollbar';
  track.setAttribute('aria-hidden', 'true');
  const thumb = document.createElement('div');
  thumb.className = 'edge-scrollbar-thumb';
  track.appendChild(thumb);
  document.body.appendChild(track);

  const scroller = () => document.scrollingElement || document.documentElement;
  let hideTimer = null;
  let dragging = false;
  let overTrack = false;
  let thumbHeight = 0;
  let maxThumbTop = 0;
  let maxScroll = 0;

  function update() {
    const el = scroller();
    const viewport = window.innerHeight;
    maxScroll = Math.max(0, el.scrollHeight - viewport);
    const scrollable = maxScroll > 1;
    track.classList.toggle('is-scrollable', scrollable);
    if (!scrollable) return;
    thumbHeight = Math.max(MIN_THUMB_PX, (viewport / el.scrollHeight) * viewport);
    maxThumbTop = viewport - thumbHeight;
    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translateY(${(el.scrollTop / maxScroll) * maxThumbTop}px)`;
  }

  function show() {
    clearTimeout(hideTimer);
    update();
    track.classList.add('is-visible');
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!dragging && !overTrack) track.classList.remove('is-visible');
    }, HIDE_DELAY_MS);
  }

  document.addEventListener('mousemove', (e) => {
    if (dragging) return;
    if (e.clientX >= window.innerWidth - EDGE_ZONE_PX) show();
    else if (track.classList.contains('is-visible')) scheduleHide();
  }, { passive: true });

  document.documentElement.addEventListener('mouseleave', () => {
    if (!dragging) scheduleHide();
  });

  window.addEventListener('scroll', () => {
    if (track.classList.contains('is-visible')) update();
  }, { passive: true });
  window.addEventListener('resize', update);

  track.addEventListener('mouseenter', () => { overTrack = true; clearTimeout(hideTimer); });
  track.addEventListener('mouseleave', () => { overTrack = false; if (!dragging) scheduleHide(); });

  // Glisser la poignée
  let startY = 0;
  let startScroll = 0;
  thumb.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dragging = true;
    startY = e.clientY;
    startScroll = scroller().scrollTop;
    thumb.setPointerCapture(e.pointerId);
    track.classList.add('is-dragging');
  });
  thumb.addEventListener('pointermove', (e) => {
    if (!dragging || maxThumbTop <= 0) return;
    const delta = e.clientY - startY;
    scroller().scrollTop = startScroll + (delta / maxThumbTop) * maxScroll;
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    track.classList.remove('is-dragging');
    scheduleHide();
  };
  thumb.addEventListener('pointerup', endDrag);
  thumb.addEventListener('pointercancel', endDrag);

  // Clic dans la piste (hors poignée) : défile d'une page vers le haut/bas
  track.addEventListener('pointerdown', (e) => {
    if (e.target === thumb) return;
    const thumbTop = thumb.getBoundingClientRect().top;
    const direction = e.clientY < thumbTop ? -1 : 1;
    scroller().scrollBy({ top: direction * window.innerHeight * 0.9, behavior: 'smooth' });
  });

  // Le contenu change de hauteur (filtres, changement de devise...) : on
  // recalcule la poignée si elle est visible.
  const main = document.querySelector('.app-main');
  if (main && 'ResizeObserver' in window) {
    new ResizeObserver(() => {
      if (track.classList.contains('is-visible')) update();
    }).observe(main);
  }
}

/* =========================================================
   Onglet « Nouveau » : tout ce qui est SORTI sur la période choisie (par
   défaut : aujourd'hui), pour les devises cochées. Un seul tableau pour les
   événements économiques (rouge et orange, selon le même filtre d'impact que
   l'onglet Analyse, triés par heure), puis les discours (voir speeches.js).
   Seul ce qui est DÉJÀ SORTI est affiché : un événement prévu plus tard
   n'apparaît qu'à partir de son heure de sortie.
   Les jours suivent l'heure locale de l'appareil.
   ========================================================= */
const NEWS_CURRENCIES = ['USD', 'EUR', 'JPY', 'GBP', 'CHF', 'CAD', 'AUD', 'NZD'];
const NEWS_REFRESH_MS = 60000;
const NEWS_CURRENCY_STORAGE_KEY = 'fx-news-currencies';
let newsRequestId = 0;
let newsLastEvents = null;

function newsStartOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function newsAddDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function newsSameDay(a, b) { return a.getTime() === b.getTime(); }
function newsDayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function newsParseDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// État des filtres de l'onglet Nouveau.
//  - currencies : devises cochées (mémorisées sur l'appareil) ;
//  - from / to  : première et dernière journée de la période (incluses) ;
//  - auto       : tant que la période est « aujourd'hui », elle suit le jour
//                 qui change (appli laissée ouverte après minuit).
const newsFilter = {
  currencies: new Set(NEWS_CURRENCIES),
  from: newsStartOfDay(new Date()),
  to: newsStartOfDay(new Date()),
  auto: true,
};
try {
  const saved = JSON.parse(localStorage.getItem(NEWS_CURRENCY_STORAGE_KEY));
  if (Array.isArray(saved)) newsFilter.currencies = new Set(saved.filter((c) => NEWS_CURRENCIES.includes(c)));
} catch (e) { /* stockage indisponible ou illisible : toutes les devises */ }

function newsCurrentRange() {
  if (newsFilter.auto) {
    const today = newsStartOfDay(new Date());
    newsFilter.from = today;
    newsFilter.to = today;
  }
  return { from: newsFilter.from, to: newsFilter.to };
}

function newsRangeBounds() {
  const { from, to } = newsCurrentRange();
  return { startMs: from.getTime(), endMs: newsAddDays(to, 1).getTime() };
}

function newsRangeIsToday() {
  const { from, to } = newsCurrentRange();
  const today = newsStartOfDay(new Date());
  return newsSameDay(from, today) && newsSameDay(to, today);
}

function newsShortDate(d) {
  const opts = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('fr-FR', opts);
}

// Texte court de la période (à côté du bouton calendrier).
function newsPeriodText() {
  const { from, to } = newsCurrentRange();
  if (newsRangeIsToday()) return 'Aujourd\'hui';
  if (newsSameDay(from, to)) return newsShortDate(from);
  return `${newsShortDate(from)} → ${newsShortDate(to)}`;
}

function newsSelectedCurrencies() {
  return NEWS_CURRENCIES.filter((c) => newsFilter.currencies.has(c));
}

function isNewsTabActive() {
  const panel = document.getElementById('tab-4');
  return !!panel && panel.classList.contains('is-active');
}

async function fetchNewsCalendarEvents() {
  const selected = newsSelectedCurrencies();
  if (!selected.length) return { events: [] };

  const client = window.Auth && window.Auth.getClient ? window.Auth.getClient() : null;
  if (!client) return { events: null, error: 'connexion indisponible' };

  const { startMs, endMs } = newsRangeBounds();
  const { data, error } = await client
    .from('calendar_events')
    .select('currency, title, impact, previous, forecast_mid, actual, event_time')
    .in('currency', selected)
    .in('impact', getCalendarImpacts()) // même filtre rouge / orange que l'onglet Analyse
    .gte('event_time', new Date(startMs).toISOString())
    .lt('event_time', new Date(endMs).toISOString())
    .order('event_time', { ascending: true });
  if (error) {
    console.error('Nouveau : lecture du calendrier impossible :', error);
    return { events: null, error: (error && error.message) || 'erreur inconnue' };
  }
  return { events: data || [] };
}

function newsIsReleased(ev) {
  const hasActual = ev.actual !== null && ev.actual !== undefined && String(ev.actual).trim() !== '';
  return hasActual || new Date(ev.event_time).getTime() <= Date.now();
}

function renderNewsCalendar(events, errorNote) {
  const container = document.getElementById('newsCalendar');
  const info = document.getElementById('newsInfo');
  if (!container) return;

  const { from, to } = newsCurrentRange();
  const multi = !newsSameDay(from, to);
  const periodLabel = multi
    ? `${newsShortDate(from)} → ${newsShortDate(to)}`
    : from.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  let html = '';
  if (errorNote) html += `<p class="calendar-note">${escapeHtml(errorNote)}</p>`;

  if (events === null) {
    if (info) info.textContent = periodLabel;
    html += '<div class="calendar-scroll"><p class="calendar-empty">Données indisponibles pour le moment</p></div>';
    container.innerHTML = html;
    return;
  }

  if (info) info.textContent = `${periodLabel} · ${events.length} événement${events.length > 1 ? 's' : ''} sorti${events.length > 1 ? 's' : ''}`;

  if (!newsFilter.currencies.size) {
    html += '<div class="calendar-scroll"><p class="calendar-empty">Aucune devise sélectionnée</p></div>';
    container.innerHTML = html;
    return;
  }

  if (!events.length) {
    const msg = newsRangeIsToday() ? 'Rien de sorti pour le moment aujourd\'hui' : 'Aucun événement important sur cette période';
    html += `<div class="calendar-scroll"><p class="calendar-empty">${msg}</p></div>`;
    container.innerHTML = html;
    return;
  }

  // Un seul tableau continu, du plus ancien au plus récent, sans séparation
  // entre les jours. Sur plusieurs jours, la colonne affiche « date + heure ».
  const rows = applyEventPresentation(events).map((ev) => {
    const d = new Date(ev.event_time);
    const impact = ev.impact === 'high' ? 'high' : 'medium';
    const clock = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const time = multi ? `${newsShortDate(d)} ${clock}` : clock;

    return `<tr>
      <td class="calendar-col-date news-col-time">${escapeHtml(time)}</td>
      <td class="calendar-col-name">
        <button type="button" class="calendar-date-btn" data-event-time="${escapeHtml(ev.event_time)}" aria-label="Voir la date et l'heure">${CALENDAR_DATE_ICON}</button>
        <span class="calendar-impact calendar-impact--${impact}"></span><span class="news-cur">${escapeHtml(ev.currency)}</span><span class="calendar-name" title="${escapeHtml(ev.title)}">${escapeHtml(ev.shown ? ev.shown.label : resolveEventTitle(ev.title))}</span>${eventCountryTag(ev)}
      </td>
      ${calendarCell(ev.actual, 'calendar-value--actual' + (actualDirection(ev) ? ' calendar-value--' + actualDirection(ev) : ''))}
      ${calendarCell(ev.forecast_mid)}
      ${calendarCell(ev.previous)}
    </tr>`;
  }).join('');

  html += `<div class="calendar-scroll">
    <table class="calendar-table">
      <thead>
        <tr>
          <th scope="col" class="calendar-col-date">${multi ? 'Date' : 'Heure'}</th>
          <th scope="col" class="calendar-col-name">Événement</th>
          <th scope="col">Sortie</th>
          <th scope="col">Prévision</th>
          <th scope="col">Avant</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
  container.innerHTML = html;
}

// Traduction automatique (si activée dans la barre d'outils) des titres
// absents du dictionnaire, comme pour le calendrier des devises.
async function newsTranslateMissing(events) {
  if (!calendarAutoTranslate) return;
  const missing = [...new Set(
    events.map((ev) => ev.title)
      .filter((title) => !CALENDAR_TRANSLATIONS[title] && !calendarTranslateCache.has(title)),
  )];
  if (!missing.length) return;
  await Promise.all(missing.map(async (title) => {
    try { calendarTranslateCache.set(title, await translateToFrench(title)); }
    catch (e) { console.error('Traduction automatique impossible pour « ' + title + ' » :', e); }
  }));
  saveCalendarTranslateCache();
  if (newsLastEvents === events && isNewsTabActive()) renderNewsCalendar(events);
}

async function loadNews() {
  const requestId = ++newsRequestId;

  // Discours : même période et mêmes devises que le tableau.
  const { startMs, endMs } = newsRangeBounds();
  if (window.Speeches && window.Speeches.renderNews) {
    window.Speeches.renderNews({
      currencies: new Set(newsSelectedCurrencies()),
      startMs,
      endMs,
      label: newsPeriodText(),
      isToday: newsRangeIsToday(),
    });
  }

  const result = await fetchNewsCalendarEvents();
  if (requestId !== newsRequestId) return; // une réponse plus récente est déjà arrivée

  if (result.events === null) {
    renderNewsCalendar(newsLastEvents, `⚠ Lecture impossible (${result.error}). Nouvelle tentative dans une minute.`);
    return;
  }
  // Les discours ont leur propre section ; et on ne garde que ce qui est déjà sorti.
  const events = hideSpeechEvents(result.events).filter(newsIsReleased)
    .sort((a, b) => new Date(a.event_time) - new Date(b.event_time)); // du plus ancien au plus récent
  newsLastEvents = events;
  renderNewsCalendar(events);
  newsTranslateMissing(events);
}

/* ---------- Barre de filtres (menu des devises + période) ---------- */
let newsCalMonth = null;   // premier jour du mois affiché dans le calendrier
let newsCalAnchor = null;  // premier jour cliqué, en attente d'un 2e clic

function closeNewsCurrencyMenu() {
  const menu = document.getElementById('newsCurrencyMenu');
  const btn = document.getElementById('newsCurrencyBtn');
  if (menu) menu.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function closeNewsCalendar() {
  const cal = document.getElementById('newsCal');
  const btn = document.getElementById('newsDateBtn');
  if (cal) cal.hidden = true;
  if (btn) { btn.setAttribute('aria-expanded', 'false'); btn.classList.remove('is-open'); }
  newsCalAnchor = null;
}

function closeNewsPopups() {
  closeNewsCurrencyMenu();
  closeNewsCalendar();
}

function updateNewsFilterUI() {
  const label = document.getElementById('newsCurrencyLabel');
  const count = newsFilter.currencies.size;
  if (label) {
    // Tout coché : « All » ; une seule : son code ; plusieurs : la première
    // (de haut en bas dans le menu) suivie de « ... ».
    if (count === NEWS_CURRENCIES.length) label.textContent = 'All';
    else if (count === 0) label.textContent = 'Aucune';
    else if (count === 1) label.textContent = newsSelectedCurrencies()[0];
    else label.textContent = `${newsSelectedCurrencies()[0]}...`;
  }
  for (const input of document.querySelectorAll('#newsCurrencyMenu input[type="checkbox"]')) {
    input.checked = newsFilter.currencies.has(input.value);
  }
  const period = document.getElementById('newsPeriodLabel');
  if (period) period.textContent = newsPeriodText();
}

function saveNewsCurrencies() {
  try { localStorage.setItem(NEWS_CURRENCY_STORAGE_KEY, JSON.stringify(newsSelectedCurrencies())); } catch (e) { /* tant pis */ }
}

function setNewsRange(from, to) {
  const today = newsStartOfDay(new Date());
  newsFilter.from = from;
  newsFilter.to = to;
  newsFilter.auto = newsSameDay(from, today) && newsSameDay(to, today);
  updateNewsFilterUI();
  loadNews();
}

// Calendrier de sélection de période : 1 clic = 1 jour, 2 clics = période.
function renderNewsCalendarPicker() {
  const el = document.getElementById('newsCal');
  if (!el || !newsCalMonth) return;

  const today = newsStartOfDay(new Date());
  const { from, to } = newsCurrentRange();
  const y = newsCalMonth.getFullYear();
  const m = newsCalMonth.getMonth();
  const monthLabel = newsCalMonth.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // semaine commençant le lundi
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const nextDisabled = new Date(y, m + 1, 1).getTime() > today.getTime();

  let cells = '';
  for (let i = 0; i < lead; i += 1) cells += '<span class="news-cal-blank"></span>';
  for (let d = 1; d <= daysInMonth; d += 1) {
    const day = new Date(y, m, d);
    const t = day.getTime();
    const cls = ['news-cal-day'];
    if (t === today.getTime()) cls.push('is-today');
    if (t >= from.getTime() && t <= to.getTime()) cls.push('is-in-range');
    if (t === from.getTime() || t === to.getTime()) cls.push('is-edge');
    cells += `<button type="button" class="${cls.join(' ')}" data-day="${newsDayKey(day)}"${t > today.getTime() ? ' disabled' : ''}>${d}</button>`;
  }

  el.innerHTML = `
    <div class="news-cal-head">
      <button type="button" class="news-cal-nav" data-nav="-1" aria-label="Mois précédent">‹</button>
      <span class="news-cal-month">${escapeHtml(monthLabel)}</span>
      <button type="button" class="news-cal-nav" data-nav="1" aria-label="Mois suivant"${nextDisabled ? ' disabled' : ''}>›</button>
    </div>
    <div class="news-cal-grid">
      ${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((w) => `<span class="news-cal-wd">${w}</span>`).join('')}
      ${cells}
    </div>
    <div class="news-cal-foot">
      <span class="news-cal-hint">${newsCalAnchor ? 'Choisis le dernier jour de la période' : '1 clic = 1 jour · 2 clics = période'}</span>
      <button type="button" class="news-cal-today">Aujourd'hui</button>
    </div>`;
}

function openNewsCalendar() {
  const cal = document.getElementById('newsCal');
  const btn = document.getElementById('newsDateBtn');
  if (!cal || !btn) return;
  closeNewsCurrencyMenu();
  const { from } = newsCurrentRange();
  newsCalMonth = new Date(from.getFullYear(), from.getMonth(), 1);
  newsCalAnchor = null;
  renderNewsCalendarPicker();
  cal.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  btn.classList.add('is-open');
}

function initNewsFilters() {
  const bar = document.getElementById('newsFilterbar');
  const ddBtn = document.getElementById('newsCurrencyBtn');
  const menu = document.getElementById('newsCurrencyMenu');
  const dateBtn = document.getElementById('newsDateBtn');
  const cal = document.getElementById('newsCal');
  if (!bar || !ddBtn || !menu || !dateBtn || !cal) return;

  dateBtn.innerHTML = CALENDAR_DATE_ICON;

  // Menu des devises : une case par devise + un bouton « All » tout en bas.
  menu.innerHTML =
    NEWS_CURRENCIES.map((c) => `<label class="filter-dd-item"><input type="checkbox" value="${c}"><span>${c}</span></label>`).join('') +
    '<button type="button" class="filter-dd-all" id="newsCurrencyAll">All</button>';

  menu.addEventListener('change', (event) => {
    const input = event.target.closest('input[type="checkbox"]');
    if (!input) return;
    if (input.checked) newsFilter.currencies.add(input.value);
    else newsFilter.currencies.delete(input.value);
    saveNewsCurrencies();
    updateNewsFilterUI();
    loadNews();
  });
  menu.querySelector('#newsCurrencyAll').addEventListener('click', () => {
    newsFilter.currencies = new Set(NEWS_CURRENCIES);
    saveNewsCurrencies();
    updateNewsFilterUI();
    loadNews();
  });

  ddBtn.addEventListener('click', () => {
    if (menu.hidden) {
      closeNewsCalendar();
      menu.hidden = false;
      ddBtn.setAttribute('aria-expanded', 'true');
    } else {
      closeNewsCurrencyMenu();
    }
  });

  dateBtn.addEventListener('click', () => {
    if (cal.hidden) openNewsCalendar();
    else closeNewsCalendar();
  });

  // Clics dans le calendrier. stopPropagation : le calendrier se redessine à
  // chaque clic, et le gestionnaire « clic à l'extérieur » ci-dessous croirait
  // sinon que le clic vient de l'extérieur (le bouton cliqué n'existe plus).
  cal.addEventListener('click', (event) => {
    event.stopPropagation();

    const nav = event.target.closest('.news-cal-nav');
    if (nav && !nav.disabled) {
      newsCalMonth = new Date(newsCalMonth.getFullYear(), newsCalMonth.getMonth() + Number(nav.dataset.nav), 1);
      renderNewsCalendarPicker();
      return;
    }

    if (event.target.closest('.news-cal-today')) {
      const today = newsStartOfDay(new Date());
      setNewsRange(today, today);
      closeNewsCalendar();
      return;
    }

    const dayBtn = event.target.closest('.news-cal-day');
    if (!dayBtn || dayBtn.disabled) return;
    const day = newsParseDayKey(dayBtn.dataset.day);
    if (newsCalAnchor === null) {
      // 1er clic : un seul jour (appliqué tout de suite), en attente d'un 2e.
      newsCalAnchor = day;
      setNewsRange(day, day);
      renderNewsCalendarPicker();
    } else {
      // 2e clic : période entre les deux jours (dans n'importe quel ordre).
      const a = newsCalAnchor;
      newsCalAnchor = null;
      const [start, end] = a.getTime() <= day.getTime() ? [a, day] : [day, a];
      setNewsRange(start, end);
      closeNewsCalendar();
    }
  });

  // Clic à l'extérieur : referme le menu ou le calendrier ouvert.
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#newsCurrencyDd')) closeNewsCurrencyMenu();
    if (!event.target.closest('#newsCal') && !event.target.closest('#newsDateBtn')) closeNewsCalendar();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeNewsPopups();
  });

  updateNewsFilterUI();
}

function initNewsTab() {
  loadNews(); // onglet d'accueil : affiché dès l'ouverture de l'appli
  window.setInterval(() => {
    if (isNewsTabActive() && !document.hidden) loadNews();
  }, NEWS_REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isNewsTabActive()) loadNews();
  });
  if (window.Auth && window.Auth.onAuthStateChange) {
    window.Auth.onAuthStateChange((session) => {
      if (session && isNewsTabActive()) loadNews();
    });
  }
}

/* =========================================================
   Init
   ========================================================= */
document.addEventListener('DOMContentLoaded', () => {
  tick();
  window.setInterval(tick, 1000);

  const menu = initBurgerMenu();
  let themePanel = null; // renseigné plus bas, par initThemePanel()
  // Changer d'onglet referme tout ce qui était resté ouvert dans l'ancien :
  // le menu latéral, le panneau Thème (avec ses menus dépliés et son sélecteur
  // de couleur) et la bulle de date du calendrier.
  initTabs((tabId) => {
    if (menu) menu.closeMenu();
    if (themePanel) themePanel.close();
    closeCalendarDatePopup();
    // La barre de filtres n'existe que dans l'onglet Nouveau.
    const filterbar = document.getElementById('newsFilterbar');
    if (filterbar) filterbar.hidden = tabId !== 'tab-4';
    closeNewsPopups();
    if (tabId === 'tab-4') loadNews(); // onglet Nouveau : données fraîches à chaque ouverture
    if (tabId === 'tab-5' && window.Fundamental) window.Fundamental.refresh(); // Analyse fondamentale
  });
  initNewsFilters();
  initNewsTab();
  initCalendarToolbar();
  initCurrencyTabs();
  initEdgeScrollbar();

  initAuth();
  themePanel = initThemePanel();
  registerServiceWorker();
});
