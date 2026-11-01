'use strict';

/**
 * speeches.js
 * Section « Discours » sous le calendrier de chaque devise.
 *
 * UN SEUL GABARIT DE CASE, rempli à partir d'une « fiche » par discours :
 *   - bandeau : statut (Votant / Non votant) à gauche, importance en étoiles à droite
 *   - carte   : prénom, nom, poste, date, silhouette
 *   - boutons : Discours (texte traduit) et Résumé -> ouvrent une pop-up
 *
 * Forme d'une fiche (c'est ce que l'IA devra produire plus tard) :
 *   {
 *     id:      'identifiant-unique',
 *     currency:'USD',                      // OBLIGATOIRE : onglet de destination
 *     bank:    'FED',                      // OBLIGATOIRE : banque de l'orateur
 *     first:   'Prénom',
 *     last:    'Nom',
 *     role:    'Poste dans la banque centrale',
 *     voting:  true,                       // true = Votant, false = Non votant
 *     stars:   4,                          // importance de 0 à 5
 *     date:    '2026-10-06T14:30:00',      // date/heure du discours
 *     speech:  ['paragraphe 1', '...'],    // discours traduit en français
 *     title:   'Titre en français',        // facultatif (« Entretien : … », « Conférence de presse : … »)
 *     source:  'https://…',                // lien du discours officiel (facultatif)
 *     summary: [                           // résumé, en blocs
 *       { heading: 'Axes principaux', items: ['...', '...'] },
 *       { heading: 'Ton', text: '...' },
 *     ],
 *   }
 *
 * ROUTAGE : chaque fiche va UNIQUEMENT dans l'onglet de sa devise.
 *   - `currency` et `bank` doivent être renseignés par le bot (qui sait de quelle
 *     banque vient le discours), jamais devinés par l'IA.
 *   - Si `bank` ne correspond pas à la banque de la devise (ex. BOJ avec USD),
 *     ou si la devise est inconnue, la fiche est REFUSÉE : elle n'apparaît dans
 *     aucun onglet, et elle est listée dans  window.Speeches.rejected  avec la
 *     raison, pour que tu puisses la vérifier.
 *   Codes de banque : FED (USD), BCE (EUR), BOJ (JPY), BOE (GBP), BNS (CHF),
 *   BOC (CAD), RBA (AUD), RBNZ (NZD).
 *
 * Les fiches sont lues automatiquement dans la table Supabase "speeches" (remplie
 * par le bot) dès que tu es connecté, puis toutes les 5 minutes. Pour afficher
 * une liste de fiches à la main :  window.Speeches.setEntries(fiches).
 * Tant qu'aucune fiche n'est fournie, chaque onglet affiche « Aucun discours
 * pour le moment » : les cases n'apparaissent que pour de vrais discours.
 */

// Banque centrale par devise : `code` = ce que doit contenir le champ `bank`
// des fiches, `label` = ce qui est affiché dans le bandeau « Discours ».
const SPEECH_BANKS = {
  USD: { code: 'FED',  label: 'Fed' },
  EUR: { code: 'BCE',  label: 'BCE' },
  JPY: { code: 'BOJ',  label: 'BoJ' },
  GBP: { code: 'BOE',  label: 'BoE' },
  CHF: { code: 'BNS',  label: 'BNS' },
  CAD: { code: 'BOC',  label: 'Banque du Canada' },
  AUD: { code: 'RBA',  label: 'RBA' },
  NZD: { code: 'RBNZ', label: 'RBNZ' },
};

// Texte du bandeau selon le statut.
const SPEECH_STATUS = { true: 'Votant', false: 'Non votant' };

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
const speechStore = new Map(); // "USD:<id>" -> fiche

function speechEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function speechFormatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function speechStarsHtml(value) {
  const n = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
  let html = '';
  for (let i = 1; i <= 5; i += 1) {
    html += `<span class="speech-star${i <= n ? ' is-on' : ''}">★</span>`;
  }
  return `<span class="speech-stars" role="img" aria-label="Importance ${n} sur 5">${html}</span>`;
}

// ---------------------------------------------------------------------------
// Gabarit unique de la case
// ---------------------------------------------------------------------------
function buildSpeechCard(code, entry) {
  const key = `${code}:${entry.id}`;
  speechStore.set(key, entry);
  return `
    <div class="speech-item">
      <div class="speech-badge">
        <span class="speech-badge-status">${speechEscape(SPEECH_STATUS[Boolean(entry.voting)])}</span>
        ${speechStarsHtml(entry.stars)}
      </div>
      <article class="speech-card">
        <div class="speech-card-name">
          <span class="speech-card-first">${speechEscape(entry.first)}</span>
          <span class="speech-card-last">${speechEscape(entry.last)}</span>
          <span class="speech-card-role">${speechEscape(entry.role)}</span>
        </div>
        <span class="speech-card-date">${speechEscape(speechFormatDate(entry.date))}</span>
        <div class="speech-card-photo" aria-hidden="true"></div>
      </article>
      <div class="speech-card-actions">
        <button type="button" class="speech-btn" data-open="speech" data-key="${speechEscape(key)}">Discours</button>
        <button type="button" class="speech-btn" data-open="summary" data-key="${speechEscape(key)}">Résumé</button>
      </div>
    </div>`;
}

function renderSpeechSection(code, entries, failed = false) {
  const bank = SPEECH_BANKS[code] && SPEECH_BANKS[code].label;
  const panel = document.querySelector(`.currency-panel[data-currency="${code}"]`);
  if (!bank || !panel) return;

  let section = panel.querySelector('.speeches');
  if (!section) {
    section = document.createElement('div');
    section.className = 'speeches';
    panel.appendChild(section);
    section.addEventListener('click', (event) => {
      const btn = event.target.closest('.speech-btn[data-open]');
      if (!btn) return;
      openSpeechPopup(btn.dataset.key, btn.dataset.open, btn);
    });
  }

  const list = Array.isArray(entries) ? entries : [];
  const count = list.length;
  section.innerHTML = `
    <div class="speeches-toolbar">
      <span class="speeches-toolbar-title">Discours</span>
      <span class="speeches-toolbar-info">${speechEscape(bank)} · ${count} discours</span>
    </div>
    ${count
      ? `<div class="speeches-grid">${list.map((e) => buildSpeechCard(code, e)).join('')}</div>`
      : `<p class="speeches-empty">${failed ? 'Impossible de charger les discours pour le moment.' : 'Aucun discours pour le moment.'}</p>`}`;
}

// ---------------------------------------------------------------------------
// Pop-up (une seule, réutilisée)
// ---------------------------------------------------------------------------
let speechPopup = null;
let speechLastTrigger = null;

function ensureSpeechPopup() {
  if (speechPopup) return speechPopup;
  const el = document.createElement('div');
  el.className = 'speech-popup';
  el.hidden = true;
  el.innerHTML = `
    <div class="speech-popup-card" role="dialog" aria-modal="true" aria-labelledby="speechPopupTitle">
      <header class="speech-popup-head">
        <div class="speech-popup-heading">
          <span class="speech-popup-kind" id="speechPopupKind"></span>
          <h2 class="speech-popup-title" id="speechPopupTitle"></h2>
          <span class="speech-popup-subtitle" id="speechPopupSubtitle"></span>
          <span class="speech-popup-meta" id="speechPopupMeta"></span>
          <a class="speech-popup-source" id="speechPopupSource" target="_blank" rel="noopener noreferrer" hidden>Voir le discours original (site officiel)</a>
        </div>
        <button type="button" class="speech-popup-close" id="speechPopupClose" aria-label="Fermer">✕</button>
      </header>
      <div class="speech-popup-body" id="speechPopupBody" tabindex="0"></div>
    </div>`;
  document.body.appendChild(el);

  el.addEventListener('click', (event) => { if (event.target === el) closeSpeechPopup(); });
  el.querySelector('#speechPopupClose').addEventListener('click', closeSpeechPopup);
  document.addEventListener('keydown', (event) => {
    if (el.hidden) return;
    if (event.key === 'Escape') { closeSpeechPopup(); return; }
    if (event.key !== 'Tab') return;
    const first = el.querySelector('#speechPopupClose');
    const last = el.querySelector('#speechPopupBody');
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  speechPopup = el;
  return el;
}

function speechSummaryHtml(blocks) {
  return (blocks || []).map((b) => `
    <section class="speech-block">
      <h3>${speechEscape(b.heading)}</h3>
      ${b.text ? `<p>${speechEscape(b.text)}</p>` : ''}
      ${Array.isArray(b.items) && b.items.length
        ? `<ul>${b.items.map((i) => `<li>${speechEscape(i)}</li>`).join('')}</ul>` : ''}
    </section>`).join('');
}

function openSpeechPopup(key, kind, trigger) {
  const entry = speechStore.get(key);
  if (!entry) return;
  const el = ensureSpeechPopup();
  const isSummary = kind === 'summary';

  el.querySelector('#speechPopupKind').textContent = isSummary ? 'Résumé' : 'Discours (traduit en français)';
  el.querySelector('#speechPopupTitle').textContent = `${entry.first} ${entry.last}`;
  const sub = el.querySelector('#speechPopupSubtitle');
  sub.textContent = entry.title || '';
  sub.hidden = !entry.title;
  el.querySelector('#speechPopupMeta').textContent =
    [entry.role, speechFormatDate(entry.date)].filter(Boolean).join(' · ');
  const link = el.querySelector('#speechPopupSource');
  if (/^https:\/\//i.test(entry.source || '')) { link.href = entry.source; link.hidden = false; }
  else { link.removeAttribute('href'); link.hidden = true; }
  el.querySelector('#speechPopupBody').innerHTML = isSummary
    ? speechSummaryHtml(entry.summary)
    : (entry.speech || []).map((p) => `<p>${speechEscape(p)}</p>`).join('');
  el.querySelector('#speechPopupBody').scrollTop = 0;

  speechLastTrigger = trigger || null;
  el.hidden = false;
  document.documentElement.classList.add('speech-popup-open');
  el.querySelector('#speechPopupClose').focus();
}

function closeSpeechPopup() {
  if (!speechPopup || speechPopup.hidden) return;
  speechPopup.hidden = true;
  document.documentElement.classList.remove('speech-popup-open');
  if (speechLastTrigger && speechLastTrigger.isConnected) speechLastTrigger.focus();
}

// ---------------------------------------------------------------------------
// Routage : chaque fiche dans l'onglet de SA devise, ou refusée
// ---------------------------------------------------------------------------
const speechRejected = []; // { entry, reason } : fiches refusées, à vérifier

function speechCheckEntry(entry) {
  if (!entry || typeof entry !== 'object') return 'fiche invalide';
  if (!entry.id) return 'identifiant manquant';
  const code = String(entry.currency || '').trim().toUpperCase();
  if (!SPEECH_BANKS[code]) return `devise inconnue ou manquante (« ${entry.currency ?? ''} »)`;
  const bank = String(entry.bank || '').trim().toUpperCase();
  if (bank !== SPEECH_BANKS[code].code) {
    return `banque « ${entry.bank ?? ''} » incompatible avec la devise ${code} (attendu : ${SPEECH_BANKS[code].code})`;
  }
  return '';
}

function routeSpeechEntries(entries) {
  const byCurrency = {};
  Object.keys(SPEECH_BANKS).forEach((c) => { byCurrency[c] = []; });
  speechRejected.length = 0;

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const reason = speechCheckEntry(entry);
    if (reason) { speechRejected.push({ entry, reason }); return; }
    const code = String(entry.currency).trim().toUpperCase();
    if (byCurrency[code].some((e) => e.id === entry.id)) return; // doublon
    byCurrency[code].push(entry);
  });

  Object.values(byCurrency).forEach((list) => {
    list.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)); // récent d'abord
  });
  if (speechRejected.length) {
    console.warn(`${speechRejected.length} fiche(s) de discours refusée(s) :`, speechRejected);
  }
  return byCurrency;
}

// ---------------------------------------------------------------------------
// Onglet « Nouveau » : tous les discours du jour, toutes devises confondues
// ---------------------------------------------------------------------------
let speechAllEntries = [];   // toutes les fiches valides, toutes devises
let speechLoadFailed = false;
// Filtre de l'onglet Nouveau, fourni par app.js : { currencies: Set|null,
// startMs, endMs, label, isToday }. null = aujourd'hui, toutes devises.
let speechNewsFilter = null;

function speechIsToday(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return false;
  const n = new Date();
  return t.getFullYear() === n.getFullYear() && t.getMonth() === n.getMonth() && t.getDate() === n.getDate();
}

function renderNewsSpeeches() {
  const container = document.getElementById('newsSpeeches');
  if (!container) return;

  let section = container.querySelector('.speeches');
  if (!section) {
    section = document.createElement('div');
    section.className = 'speeches';
    container.appendChild(section);
    section.addEventListener('click', (event) => {
      const btn = event.target.closest('.speech-btn[data-open]');
      if (!btn) return;
      openSpeechPopup(btn.dataset.key, btn.dataset.open, btn);
    });
  }

  const now = Date.now();
  const f = speechNewsFilter;
  const today = speechAllEntries
    .filter((e) => {
      const t = Date.parse(e.date);
      if (Number.isNaN(t) || t > now) return false; // seulement les discours déjà prononcés
      if (!f) return speechIsToday(e.date);
      if (t < f.startMs || t >= f.endMs) return false;
      return !f.currencies || f.currencies.has(String(e.currency).trim().toUpperCase());
    })
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)); // récent d'abord
  const count = today.length;
  const label = f && f.label ? f.label : 'Aujourd\'hui';
  const isToday = !f || f.isToday;

  const cards = today.map((e) => {
    const code = String(e.currency).trim().toUpperCase();
    const bank = SPEECH_BANKS[code] ? SPEECH_BANKS[code].label : '';
    return `<div class="news-speech">
      <span class="news-speech-cur">${speechEscape(code)} · ${speechEscape(bank)}</span>
      ${buildSpeechCard(code, e)}
    </div>`;
  }).join('');

  section.innerHTML = `
    <div class="speeches-toolbar">
      <span class="speeches-toolbar-title">Discours</span>
      <span class="speeches-toolbar-info">${speechEscape(label)} · ${count} discours</span>
    </div>
    ${count
      ? `<div class="speeches-grid">${cards}</div>`
      : `<p class="speeches-empty">${speechLoadFailed ? 'Impossible de charger les discours pour le moment.' : (isToday ? 'Aucun discours aujourd\'hui.' : 'Aucun discours sur cette période.')}</p>`}`;
}

function setSpeechEntries(entries, options = {}) {
  speechStore.clear();
  const byCurrency = routeSpeechEntries(entries);
  Object.keys(SPEECH_BANKS).forEach((code) => renderSpeechSection(code, byCurrency[code], Boolean(options.failed)));
  speechAllEntries = Object.values(byCurrency).flat();
  speechLoadFailed = Boolean(options.failed);
  renderNewsSpeeches();
}

window.Speeches = {
  setEntries: setSpeechEntries,
  open: openSpeechPopup,
  close: closeSpeechPopup,
  rejected: speechRejected,
  // Redessine les discours de l'onglet Nouveau ; avec un filtre, le mémorise.
  renderNews: (filter) => { if (filter !== undefined) speechNewsFilter = filter; renderNewsSpeeches(); },
};

// ---------------------------------------------------------------------------
// Lecture dans Supabase (table "speeches", remplie par le bot)
// ---------------------------------------------------------------------------
const SPEECH_COLUMNS = 'id, currency, bank, first_name, last_name, role, voting, stars, spoken_at, title, speech, summary, source_url';
let speechLoading = false;
let speechSignature = null;

function speechRowToEntry(row) {
  return {
    id: row.id,
    currency: row.currency,
    bank: row.bank,
    first: row.first_name,
    last: row.last_name,
    role: row.role,
    voting: row.voting,
    stars: row.stars,
    date: row.spoken_at,
    title: row.title || '',
    speech: Array.isArray(row.speech) ? row.speech : [],
    summary: Array.isArray(row.summary) ? row.summary : [],
    source: row.source_url,
  };
}

async function loadSpeechesFromSupabase() {
  if (speechLoading || !window.Auth || !window.Auth.isConfigured()) return;
  const client = window.Auth.getClient();
  if (!client) return;
  speechLoading = true;
  try {
    if (!(await window.Auth.getSession())) return; // pas connecté : la table n'est lisible qu'une fois connecté
    const { data, error } = await client
      .from('speeches')
      .select(SPEECH_COLUMNS)
      .order('spoken_at', { ascending: false })
      .limit(300);
    if (error) throw error;
    const entries = (data || []).map(speechRowToEntry);
    // un discours dont le résumé ou la traduction arrive après coup doit aussi être redessiné
    const signature = entries.map((e) => `${e.id}:${e.summary.length}:${e.speech.length}:${e.title}`).join('|');
    if (signature !== speechSignature) { // on ne redessine que s'il y a du nouveau
      speechSignature = signature;
      setSpeechEntries(entries);
    }
  } catch (err) {
    console.error('Chargement des discours impossible :', err);
    if (speechSignature === null) setSpeechEntries([], { failed: true });
  } finally {
    speechLoading = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setSpeechEntries([]); // sections vides en attendant la lecture
  if (window.Auth) window.Auth.onAuthStateChange((session) => { if (session) loadSpeechesFromSupabase(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadSpeechesFromSupabase(); });
  setInterval(() => { if (!document.hidden) loadSpeechesFromSupabase(); }, 5 * 60 * 1000);
});
