'use strict';

/**
 * newsfeed.js
 * Fenêtres d'actualité en direct :
 *   - News Feed     : six colonnes — investingLive | FinancialJuice (annonces rouges) | Investing.com | Bloomberg | Reuters | New York Times
 *                     (Investing.com, Bloomberg, Reuters et NYT : uniquement ce qui touche les marchés / la finance mondiale, traduit)
 *   - Bank Research : FX Daily d'ING (traduit en français + lien vers l'original)
 *   - Squawk        : voix de synthèse qui lit en français les nouvelles annonces rouges de FinancialJuice + historique
 *                     (bouton d'activation aussi dans la barre de navigation, à côté de New York)
 *   - Nouveau       : tout ce qui est nouveau depuis ta dernière visite (posts de Trump, FX Daily ING, annonces, news)
 * Données : tables news_items (news-bot, press-bot), bank_research (ing-bot) et trump_posts (trump-bot).
 * Seuls des titres + liens sont repris ; ING est traduit avec un lien vers l'original.
 */
(function () {
  const FEED_WINDOW = 'tab-newsfeed';
  const BANK_WINDOW = 'tab-bankresearch';
  const SQUAWK_WINDOW = 'tab-squawk';
  const HOME_WINDOW = 'tab-4';
  const SQUAWK_URL = 'https://www.financialjuice.com/home';
  const POLL_MS = 60 * 1000;
  const FEED_HOURS = 72; // période par défaut (le week-end, 24 h ne montrait presque rien)
  const KEEP_DAYS = 30;  // durée de conservation des news en base
  const LS_RANGE = 'fxt-nf-range';
  const PRESETS = [['today', "Aujourd'hui"], ['24h', '24 h'], ['72h', '72 h'], ['7d', '7 jours'], ['30d', '30 jours']];

  // Colonnes du News Feed. red : on n'affiche que les lignes retenues par le tri (red = true).
  const SOURCES = [
    { key: 'investinglive', title: 'investingLive', sub: 'News & articles · titres en anglais', red: false },
    { key: 'fj', title: 'FinancialJuice', sub: 'Annonces rouges uniquement · traduites', red: true },
    { key: 'investing', title: 'Investing.com', sub: 'Marchés & macro · traduit', red: true },
    { key: 'bloomberg', title: 'Bloomberg', sub: 'Marchés & macro, hors actions · traduit', red: true },
    { key: 'reuters', title: 'Reuters', sub: 'Marchés & macro, hors actions · traduit', red: true },
    { key: 'nyt', title: 'New York Times', sub: 'Marchés & macro, hors actions · traduit', red: true },
  ];

  const busy = {};
  const signatures = {};
  let homeFilter = null;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function safeUrl(u) { return /^https:\/\//i.test(u || '') ? u : ''; }
  function fmtTime(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  function fmtDay(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function fmtDateTime(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  }
  function dayKey(iso) { return new Date(iso).toLocaleDateString('fr-FR'); }
  function isVisible(id) {
    const p = document.getElementById(id);
    return !!p && !p.hidden && !document.hidden;
  }

  async function client() {
    if (!window.Auth || !window.Auth.isConfigured()) return null;
    const c = window.Auth.getClient();
    if (!c) return null;
    try { if (!(await window.Auth.getSession())) return null; } catch (e) { return null; }
    return c;
  }

  // Lecture protégée contre les appels simultanés ; ne redessine que si les données ont changé.
  async function guarded(key, task) {
    if (busy[key]) return;
    busy[key] = true;
    try { await task(); } catch (e) { console.warn('newsfeed.js', key, e); } finally { busy[key] = false; }
  }
  function changed(key, sig) {
    if (signatures[key] === sig) return false;
    signatures[key] = sig;
    return true;
  }

  /* ---------------- Période du News Feed (boutons + calendrier) ---------------- */
  let feedRange = { mode: '72h', from: '', to: '' };
  try { const r = JSON.parse(localStorage.getItem(LS_RANGE) || 'null'); if (r && r.mode) feedRange = r; } catch (e) { /* défaut */ }

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dmy = (v) => { const [y, m, d] = String(v).split('-'); return `${d}/${m}/${y}`; };

  // bornes de la période choisie : { since, until (ISO), label }
  function rangeBounds() {
    const now = new Date();
    const m = feedRange.mode;
    if (m === 'custom' && feedRange.from && feedRange.to) {
      const a = new Date(feedRange.from + 'T00:00:00');
      const b = new Date(feedRange.to + 'T23:59:59.999');
      if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())) {
        return { since: a.toISOString(), until: b.toISOString(), label: feedRange.from === feedRange.to ? dmy(feedRange.from) : `${dmy(feedRange.from)} → ${dmy(feedRange.to)}` };
      }
    }
    const hours = { '24h': 24, '72h': 72, '7d': 168, '30d': 720 }[m];
    if (m === 'today') { const d0 = new Date(now); d0.setHours(0, 0, 0, 0); return { since: d0.toISOString(), until: new Date(now.getTime() + 3600e3).toISOString(), label: "Aujourd'hui" }; }
    const h = hours || FEED_HOURS;
    return { since: new Date(now.getTime() - h * 3600e3).toISOString(), until: new Date(now.getTime() + 3600e3).toISOString(), label: 'Depuis ' + (PRESETS.find((x) => x[0] === m) || [0, '72 h'])[1] };
  }

  function syncRangeUi() {
    const sec = document.getElementById(FEED_WINDOW);
    if (!sec) return;
    const lab = sec.querySelector('[data-nf-range-label]');
    if (lab) lab.textContent = rangeBounds().label;
    sec.querySelectorAll('[data-nf-preset]').forEach((b) => b.classList.toggle('is-active', feedRange.mode === b.dataset.nfPreset));
  }

  function setRange(r) {
    feedRange = r;
    try { localStorage.setItem(LS_RANGE, JSON.stringify(r)); } catch (e) { /* ignore */ }
    signatures.feed = null;
    syncRangeUi();
    loadFeed();
  }

  /* ---------------- News Feed ---------------- */
  function ensureFeedLayout() {
    const sec = document.getElementById(FEED_WINDOW);
    if (!sec) return null;
    if (!sec.querySelector('.nf-grid')) {
      sec.innerHTML = `
        <div class="calendar-toolbar nf-toolbar">
          <span class="calendar-toolbar-title">News Feed</span>
          <div class="calendar-toolbar-tools">
            <span class="nf-range-label" data-nf-range-label></span>
            <button type="button" class="nf-cal-btn" data-nf-cal-btn aria-haspopup="dialog" aria-expanded="false" aria-label="Choisir la période des news" title="Choisir la période">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>
            </button>
          </div>
          <div class="nf-cal" data-nf-cal role="dialog" aria-label="Période des news" hidden>
            <div class="nf-cal-presets">${PRESETS.map(([k, l]) => `<button type="button" class="seas-chip" data-nf-preset="${k}">${l}</button>`).join('')}</div>
            <div class="nf-cal-custom">
              <label>Du <input type="date" data-nf-from></label>
              <label>au <input type="date" data-nf-to></label>
              <button type="button" class="seas-chip" data-nf-apply>Afficher</button>
            </div>
            <p class="nf-cal-note">Les news sont gardées ${KEEP_DAYS} jours.</p>
          </div>
        </div>
        <div class="nf-grid">${SOURCES.map((x) => `
          <section class="nf-col" aria-label="${esc(x.title)}">
            <header class="nf-col-head"><span class="nf-col-title">${esc(x.title)}</span><span class="nf-col-sub">${esc(x.sub)}</span></header>
            <div class="nf-list" data-nf="${x.key}"><p class="nf-empty">Chargement…</p></div>
          </section>`).join('')}
        </div>`;
      const cal = sec.querySelector('[data-nf-cal]');
      const btn = sec.querySelector('[data-nf-cal-btn]');
      const from = sec.querySelector('[data-nf-from]');
      const to = sec.querySelector('[data-nf-to]');
      const today = new Date();
      const min = new Date(today.getTime() - KEEP_DAYS * 86400e3);
      [from, to].forEach((i) => { i.min = ymd(min); i.max = ymd(today); });
      const toggle = (open) => {
        cal.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
        if (open) { const b = rangeBounds(); from.value = feedRange.from || ymd(new Date(b.since)); to.value = feedRange.to || ymd(today); }
      };
      btn.addEventListener('click', (ev) => { ev.stopPropagation(); toggle(cal.hidden); });
      cal.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const pre = ev.target.closest('[data-nf-preset]');
        if (pre) { setRange({ mode: pre.dataset.nfPreset, from: '', to: '' }); toggle(false); return; }
        if (ev.target.closest('[data-nf-apply]')) {
          if (!from.value || !to.value) return;
          let a = from.value; let b = to.value;
          if (a > b) [a, b] = [b, a];
          setRange({ mode: 'custom', from: a, to: b });
          toggle(false);
        }
      });
      document.addEventListener('click', () => { if (!cal.hidden) toggle(false); });
      syncRangeUi();
    }
    return sec;
  }

  function renderRows(rows, kind) {
    if (!rows.length) return '<p class="nf-empty">Rien pour le moment.</p>';
    let html = '';
    let lastDay = '';
    rows.forEach((r) => {
      const dk = dayKey(r.published_at);
      if (dk !== lastDay) { lastDay = dk; html += `<p class="nf-day">${esc(fmtDay(r.published_at))}</p>`; }
      const url = safeUrl(r.url);
      const title = kind === 'investinglive' ? r.title : (r.title_fr || r.title);
      const tag = kind === 'fj' ? '<span class="nf-tag nf-tag--red">Rouge</span>' : (r.feed ? `<span class="nf-tag">${esc(r.feed)}</span>` : '');
      const orig = kind !== 'investinglive' && r.title_fr && r.title_fr !== r.title ? `<span class="nf-orig">${esc(r.title)}</span>` : '';
      const body = url
        ? `<a class="nf-title" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>`
        : `<span class="nf-title">${esc(title)}</span>`;
      html += `<div class="nf-row"><span class="nf-time">${esc(fmtTime(r.published_at))}</span><div class="nf-body">${tag}${body}${orig}</div></div>`;
    });
    return html;
  }

  async function loadFeed() {
    await guarded('feed', async () => {
      const sec = ensureFeedLayout();
      const c = await client();
      if (!sec || !c) return;
      const { since, until } = rangeBounds();
      const res = await Promise.all(SOURCES.map((x) => {
        let q = c.from('news_items').select('id,feed,title,title_fr,url,published_at').eq('source', x.key).gte('published_at', since).lt('published_at', until);
        if (x.red) q = q.eq('red', true);
        return q.order('published_at', { ascending: false }).limit(500);
      }));
      const bad = res.find((r) => r.error);
      if (bad) throw bad.error;
      const sig = res.map((r) => (r.data || []).map((d) => d.id + (d.title_fr ? 1 : 0)).join('|')).join('#') + '@' + since;
      if (!changed('feed', sig)) return;
      SOURCES.forEach((x, i) => {
        const box = sec.querySelector(`[data-nf="${x.key}"]`);
        if (box) box.innerHTML = renderRows(res[i].data || [], x.key);
      });
    });
  }

  /* ---------------- Bank Research ---------------- */
  function paragraphs(text) {
    return String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => {
      if (p.startsWith('## ')) return `<h4>${esc(p.slice(3))}</h4>`;
      if (p.startsWith('- ')) return `<p class="br-li">• ${esc(p.slice(2))}</p>`;
      return `<p>${esc(p)}</p>`;
    }).join('');
  }

  function bankCard(r) {
    const url = safeUrl(r.url);
    const done = !!r.analyzed_at;
    const bullets = Array.isArray(r.summary) ? r.summary : [];
    return `
    <article class="br-card" data-br="${esc(r.id)}">
      <div class="br-head"><span class="br-bank">${esc(r.bank)} · FX Daily</span><span class="br-date">${esc(fmtDateTime(r.published_at))}</span></div>
      <h3 class="br-title">${esc((done && r.title_fr) || r.title)}</h3>
      ${done && r.title_fr ? `<p class="br-orig">${esc(r.title)}</p>` : ''}
      ${bullets.length ? `<ul class="br-bullets">${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      ${done ? '' : '<p class="br-pending">Traduction en cours…</p>'}
      <div class="br-actions">
        ${done && r.text_fr ? '<button type="button" class="speech-btn" data-br-toggle aria-expanded="false">Lire en français</button>' : ''}
        ${url ? `<a class="br-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Article original (ING Think)</a>` : ''}
      </div>
      ${done && r.text_fr ? `<div class="br-text" hidden>${paragraphs(r.text_fr)}</div>` : ''}
    </article>`;
  }

  async function loadBank() {
    await guarded('bank', async () => {
      const sec = document.getElementById(BANK_WINDOW);
      const c = await client();
      if (!sec || !c) return;
      if (!sec.querySelector('.br-list')) {
        sec.innerHTML = `
          <div class="calendar-toolbar"><span class="calendar-toolbar-title">Bank Research</span></div>
          <div class="br-list"><p class="nf-empty">Chargement…</p></div>`;
        sec.addEventListener('click', (event) => {
          const btn = event.target.closest('[data-br-toggle]');
          if (!btn) return;
          const box = btn.closest('.br-card').querySelector('.br-text');
          const open = box.hidden;
          box.hidden = !open;
          btn.setAttribute('aria-expanded', String(open));
          btn.textContent = open ? 'Masquer' : 'Lire en français';
        });
      }
      const { data, error } = await c.from('bank_research')
        .select('id,bank,title,title_fr,url,published_at,text_fr,summary,analyzed_at')
        .order('published_at', { ascending: false }).limit(15);
      if (error) throw error;
      const sig = (data || []).map((r) => r.id + (r.analyzed_at ? 1 : 0)).join('|');
      if (!changed('bank', sig)) return;
      // On garde ouvertes les notes que l'utilisateur est en train de lire.
      const open = new Set([...sec.querySelectorAll('.br-card')].filter((el) => el.querySelector('.br-text:not([hidden])')).map((el) => el.dataset.br));
      const list = sec.querySelector('.br-list');
      list.innerHTML = (data || []).length ? data.map(bankCard).join('') : '<p class="nf-empty">Aucun FX Daily pour le moment. Le prochain apparaîtra ici dès sa publication le matin.</p>';
      open.forEach((id) => {
        const card = [...list.querySelectorAll('.br-card')].find((el) => el.dataset.br === id);
        const box = card && card.querySelector('.br-text');
        const btn = card && card.querySelector('[data-br-toggle]');
        if (box && btn) { box.hidden = false; btn.setAttribute('aria-expanded', 'true'); btn.textContent = 'Masquer'; }
      });
    });
  }

  /* ---------------- Squawk : voix de synthèse + historique ---------------- */
  // Lit à voix haute, en français, chaque nouvelle annonce rouge de FinancialJuice (déjà traduite par news-bot).
  // La vraie voix du squawk FinancialJuice est un flux propriétaire : impossible de l'intégrer ou de la transcrire ici.
  const LS_SQUAWK = 'fxt-squawk-on';
  const squawk = { on: false, primed: false, spoken: new Set(), timer: null, voice: null, status: '' };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } }
  const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  function pickVoice() {
    if (!canSpeak()) return null;
    const list = window.speechSynthesis.getVoices() || [];
    const fr = list.filter((v) => /^fr/i.test(v.lang));
    squawk.voice = fr.find((v) => /fr[-_]FR/i.test(v.lang) && !v.localService) || fr.find((v) => /fr[-_]FR/i.test(v.lang)) || fr[0] || null;
    return squawk.voice;
  }

  function speak(text) {
    if (!canSpeak() || !text) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'fr-FR';
      if (squawk.voice || pickVoice()) u.voice = squawk.voice;
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    } catch (e) { console.warn('squawk', e); }
  }

  function syncSquawkUi() {
    const nav = document.getElementById('squawkToggle');
    if (nav) {
      nav.setAttribute('aria-pressed', String(squawk.on));
      nav.classList.toggle('is-on', squawk.on);
      nav.title = squawk.on ? 'Squawk activé (clique pour couper)' : 'Squawk coupé (clique pour activer)';
    }
    const btn = document.querySelector('[data-sq-toggle]');
    if (btn) { btn.textContent = squawk.on ? 'Couper la voix' : 'Activer la voix'; btn.classList.toggle('is-on', squawk.on); }
    const st = document.querySelector('[data-sq-status]');
    if (st) st.textContent = squawk.status || (squawk.on ? 'Voix activée : les nouvelles annonces rouges sont lues en français.' : 'Voix coupée.');
  }

  async function squawkPoll(first) {
    const c = await client();
    if (!c) return;
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data, error } = await c.from('news_items').select('id,title,title_fr,published_at').eq('source', 'fj').eq('red', true).gte('published_at', since).order('published_at', { ascending: true }).limit(30);
    if (error || !data) return;
    const fresh = data.filter((r) => !squawk.spoken.has(r.id));
    fresh.forEach((r) => squawk.spoken.add(r.id));
    const wasPrimed = squawk.primed;
    squawk.primed = true;
    if (first || !wasPrimed) return; // à l'activation : on ne relit pas ce qui est déjà tombé
    fresh.slice(-5).forEach((r) => speak(r.title_fr || r.title));
  }

  function setSquawk(on, byUser) {
    if (on && !canSpeak()) { squawk.status = 'Ce navigateur ne sait pas lire à voix haute.'; squawk.on = false; syncSquawkUi(); return; }
    squawk.on = on;
    squawk.primed = false;
    squawk.status = '';
    lsSet(LS_SQUAWK, on ? '1' : '0');
    clearInterval(squawk.timer);
    squawk.timer = null;
    if (on) {
      pickVoice();
      if (byUser) speak('Squawk activé.'); // ce premier son, déclenché par un clic, débloque la voix du navigateur
      squawkPoll(true);
      squawk.timer = setInterval(() => squawkPoll(false), 15 * 1000);
    } else if (canSpeak()) {
      window.speechSynthesis.cancel();
    }
    syncSquawkUi();
  }

  async function loadSquawkHistory() {
    await guarded('squawk', async () => {
      const box = document.querySelector('[data-sq-history]');
      const c = await client();
      if (!box || !c) return;
      const since = new Date(Date.now() - FEED_HOURS * 3600 * 1000).toISOString();
      const { data, error } = await c.from('news_items').select('id,title,title_fr,url,published_at').eq('source', 'fj').eq('red', true).gte('published_at', since).order('published_at', { ascending: false }).limit(80);
      if (error) throw error;
      const sig = (data || []).map((r) => r.id + (r.title_fr ? 1 : 0)).join('|');
      if (!changed('squawk', sig)) return;
      box.innerHTML = renderRows(data || [], 'fj');
    });
  }

  function buildSquawk() {
    const sec = document.getElementById(SQUAWK_WINDOW);
    if (!sec) return;
    if (!sec.querySelector('.sq-card')) {
      sec.innerHTML = `
        <div class="calendar-toolbar"><span class="calendar-toolbar-title">Squawk</span></div>
        <div class="sq-card">
          <p class="sq-title">Squawk en français</p>
          <p class="sq-text">Chaque nouvelle annonce rouge de FinancialJuice est lue à voix haute, en français, dès qu'elle est traduite (quelques secondes à une minute après sa publication). Les annonces lues restent en historique ci-dessous. Le même bouton existe dans la barre du haut, à côté de New York.</p>
          <div class="sq-actions">
            <button type="button" class="sq-btn" data-sq-toggle>Activer la voix</button>
            <button type="button" class="sq-btn" data-sq-test>Tester la voix</button>
            <a class="sq-btn" href="${SQUAWK_URL}" target="_blank" rel="noopener noreferrer">Squawk FinancialJuice d'origine</a>
          </div>
          <p class="sq-status" data-sq-status></p>
        </div>
        <div class="nf-col sq-history"><header class="nf-col-head"><span class="nf-col-title">Historique</span><span class="nf-col-sub">Annonces rouges traduites · du plus récent au plus ancien</span></header>
          <div class="nf-list" data-sq-history><p class="nf-empty">Chargement…</p></div></div>`;
      sec.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-sq-toggle]')) setSquawk(!squawk.on, true);
        else if (ev.target.closest('[data-sq-test]')) { pickVoice(); speak('Test du squawk. Les annonces seront lues ainsi, en français.'); }
      });
    }
    syncSquawkUi();
  }

  function initSquawkNav() {
    const nav = document.getElementById('squawkToggle');
    if (nav) nav.addEventListener('click', () => setSquawk(!squawk.on, true));
    if (canSpeak()) window.speechSynthesis.addEventListener('voiceschanged', pickVoice);
    if (lsGet(LS_SQUAWK) === '1') setSquawk(true, false);
    else syncSquawkUi();
  }

  /* ---------------- Nouveau : ce qui est nouveau depuis ta dernière visite ---------------- */
  // Un bouton par source (n'apparaît que s'il y a du nouveau). Pour chaque source on retient, dans ce navigateur,
  // la date de la dernière annonce vue dès qu'on déroule le bouton. À la visite suivante (rechargement de l'appli, ou retour
  // après plus de 2 minutes d'absence), seules les annonces plus récentes sont affichées.
  // Les posts de Trump restent affichés directement.
  const SECTIONS = [
    { key: 'fj', label: 'FinancialJuice' },
    { key: 'il', label: 'Investing Live' },
    { key: 'investing', label: 'Investing.com' },
    { key: 'bloomberg', label: 'Bloomberg' },
    { key: 'reuters', label: 'Reuters' },
    { key: 'nyt', label: 'New York Times' },
    { key: 'bank', label: 'Banques · FX Daily' },
  ];
  const PRESS = { investing: 'Investing.com', bloomberg: 'Bloomberg', reuters: 'Reuters', nyt: 'New York Times' };
  const LS_SEEN = 'fxt-nx-seen';
  const openSections = new Set();
  let showAll = false;
  let maxAtByKey = {};
  const readSeen = () => { try { return JSON.parse(lsGet(LS_SEEN) || '{}') || {}; } catch (e) { return {}; } };
  let baseline = readSeen();   // « dernière visite » : figé pendant la visite pour que la liste ne disparaisse pas sous les yeux
  let hiddenAt = 0;

  function markSeen(key) {
    const m = maxAtByKey[key];
    if (!m) return;
    const seen = readSeen();
    if (!seen[key] || m > seen[key]) { seen[key] = m; lsSet(LS_SEEN, JSON.stringify(seen)); }
  }

  function ensureHome() {
    let box = document.getElementById('newsExtras');
    if (!box) {
      const anchor = document.getElementById('newsCalendar');
      if (!anchor) return null;
      box = document.createElement('div');
      box.id = 'newsExtras';
      anchor.parentNode.insertBefore(box, anchor);
      box.addEventListener('click', (event) => {
        if (event.target.closest('[data-nx-all]')) { showAll = !showAll; signatures.home = null; loadHome(); return; }
        const sec = event.target.closest('[data-nx-sec]');
        if (sec) {
          const key = sec.dataset.nxSec;
          const body = box.querySelector(`[data-nx-body="${key}"]`);
          const open = !openSections.has(key);
          if (open) { openSections.add(key); markSeen(key); } else openSections.delete(key);
          sec.setAttribute('aria-expanded', String(open));
          sec.classList.toggle('is-open', open);
          if (body) body.hidden = !open;
          return;
        }
        const btn = event.target.closest('[data-nx-toggle]');
        if (!btn) return;
        const body = btn.closest('.nx-item').querySelector('.nx-more');
        const open = body.hidden;
        body.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
        btn.textContent = open ? 'Masquer' : 'Lire';
      });
    }
    return box;
  }

  function homeItem(it) {
    const url = safeUrl(it.url);
    const link = url ? `<a class="nx-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(it.linkLabel)}</a>` : '';
    const more = it.more ? `<button type="button" class="speech-btn nx-btn" data-nx-toggle aria-expanded="false">Lire</button>` : '';
    return `
    <div class="nx-item nx-item--${esc(it.kind)}">
      <span class="nx-time">${esc(fmtTime(it.at))}</span>
      <div class="nx-body">
        ${it.tag ? `<span class="nf-tag${it.kind === 'fj' ? ' nf-tag--red' : ''}">${esc(it.tag)}</span>` : ''}
        <span class="nx-title">${esc(it.title)}</span>
        <div class="nx-actions">${more}${link}</div>
        ${it.more ? `<div class="nx-more" hidden>${it.more}</div>` : ''}
      </div>
    </div>`;
  }

  async function loadHome(filter) {
    if (filter) homeFilter = filter;
    await guarded('home', async () => {
      const box = ensureHome();
      const c = await client();
      const f = homeFilter;
      if (!box || !c || !f) return;
      const startIso = new Date(f.startMs).toISOString();
      const endIso = new Date(f.endMs).toISOString();
      const wantUsd = !f.currencies || !f.currencies.size || f.currencies.has('USD');
      const news = (source, withRed) => {
        let q = c.from('news_items').select('id,feed,title,title_fr,url,published_at').eq('source', source).gte('published_at', startIso).lt('published_at', endIso);
        if (withRed) q = q.eq('red', true);
        return q.order('published_at', { ascending: false }).limit(150);
      };
      const [fj, il, inv, bbg, reu, nyt, ing, trump] = await Promise.all([
        news('fj', true), news('investinglive', false), news('investing', true), news('bloomberg', true), news('reuters', true), news('nyt', true),
        c.from('bank_research').select('id,bank,title,title_fr,url,published_at,summary,analyzed_at').gte('published_at', startIso).lt('published_at', endIso).order('published_at', { ascending: false }).limit(10),
        wantUsd
          ? c.from('trump_posts').select('id,posted_at,text_en,text_fr,title_fr,stars,url').gte('posted_at', startIso).lt('posted_at', endIso).gte('stars', 2).order('posted_at', { ascending: false }).limit(60)
          : Promise.resolve({ data: [], error: null }),
      ]);
      const lists = { fj: [], il: [], investing: [], bloomberg: [], reuters: [], nyt: [], bank: [], trump: [] };
      (fj.data || []).forEach((r) => lists.fj.push({ kind: 'fj', tag: '', at: r.published_at, title: r.title_fr || r.title, url: r.url, linkLabel: 'Source' }));
      (il.data || []).forEach((r) => lists.il.push({ kind: 'il', tag: r.feed || '', at: r.published_at, title: r.title, url: r.url, linkLabel: 'Article' }));
      [['investing', inv], ['bloomberg', bbg], ['reuters', reu], ['nyt', nyt]].forEach(([k, res]) => {
        (res.data || []).forEach((r) => lists[k].push({ kind: 'press', tag: r.feed || PRESS[k], at: r.published_at, title: r.title_fr || r.title, url: r.url, linkLabel: 'Article' }));
      });
      (ing.data || []).forEach((r) => lists.bank.push({
        kind: 'ing', tag: 'ING · FX Daily', at: r.published_at, title: (r.analyzed_at && r.title_fr) || r.title, url: r.url, linkLabel: 'Article original',
        more: r.analyzed_at && Array.isArray(r.summary) && r.summary.length ? `<ul class="br-bullets">${r.summary.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : '',
      }));
      (trump.data || []).forEach((r) => lists.trump.push({
        kind: 'trump', tag: 'Trump', at: r.posted_at, title: r.title_fr || (r.text_fr || r.text_en || '').slice(0, 140), url: r.url, linkLabel: 'Post original',
        more: paragraphs(r.text_fr || r.text_en),
      }));

      // plus récente annonce de chaque source ; si la section est déroulée, elle compte comme vue
      SECTIONS.forEach((s) => { maxAtByKey[s.key] = lists[s.key].reduce((m, i) => (i.at > m ? i.at : m), ''); if (openSections.has(s.key)) markSeen(s.key); });
      // seulement le nouveau par rapport à la dernière visite
      const shown = {};
      let hiddenCount = 0;
      SECTIONS.forEach((s) => {
        const base = baseline[s.key];
        shown[s.key] = showAll || !base ? lists[s.key] : lists[s.key].filter((i) => i.at > base);
        hiddenCount += lists[s.key].length - shown[s.key].length;
      });

      const sig = SECTIONS.map((s) => shown[s.key].map((i) => i.at + i.title).join('|')).join('#') + '|' + lists.trump.map((i) => i.at + i.title).join('|') + '@' + startIso + endIso + showAll;
      if (!changed('home', sig)) return;
      const visible = SECTIONS.filter((s) => shown[s.key].length);
      const buttons = visible.map((s) => {
        const open = openSections.has(s.key);
        return `<button type="button" class="nx-sec-btn${open ? ' is-open' : ''}" data-nx-sec="${s.key}" aria-expanded="${open}">${esc(s.label)}<span class="nx-count">${shown[s.key].length}</span></button>`;
      }).join('');
      const bodies = visible.map((s) =>
        `<div class="nx-list" data-nx-body="${s.key}"${openSections.has(s.key) ? '' : ' hidden'}>${shown[s.key].map(homeItem).join('')}</div>`).join('');
      const nothing = !lists.trump.length && !buttons;
      const allBtn = (hiddenCount > 0 || showAll) ? `<button type="button" class="speech-btn nx-all" data-nx-all>${showAll ? 'Seulement le nouveau' : `Tout afficher (+${hiddenCount} déjà vues)`}</button>` : '';
      box.innerHTML = `
        <div class="speeches-toolbar">
          <span class="speeches-toolbar-title">Nouveautés</span>
          <span class="speeches-toolbar-info">${esc(f.label || '')}${showAll ? '' : ' · depuis ta dernière visite'}</span>
          ${allBtn}
        </div>
        ${lists.trump.length ? `<div class="nx-list">${lists.trump.map(homeItem).join('')}</div>` : ''}
        ${buttons ? `<div class="nx-sec-bar">${buttons}</div>${bodies}` : ''}
        ${nothing ? `<p class="speeches-empty">${showAll ? 'Rien sur cette période.' : 'Rien de nouveau depuis ta dernière visite.'}</p>` : ''}`;
    });
  }

  /* ---------------- Navigation + rafraîchissement ---------------- */
  function refresh(tabId) {
    if (tabId === FEED_WINDOW) { ensureFeedLayout(); loadFeed(); }
    else if (tabId === BANK_WINDOW) loadBank();
    else if (tabId === SQUAWK_WINDOW) { buildSquawk(); loadSquawkHistory(); }
    else if (tabId === HOME_WINDOW) loadHome();
  }

  window.NewsWindows = { refresh, renderHome: loadHome };

  document.addEventListener('DOMContentLoaded', () => {
    ensureFeedLayout();
    buildSquawk();
    ensureHome();
    initSquawkNav();
    // retour dans l'appli après une absence : la « dernière visite » est mise à jour
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt > 2 * 60 * 1000) { baseline = readSeen(); showAll = false; signatures.home = null; if (isVisible(HOME_WINDOW)) loadHome(); }
    });
    if (window.Auth) window.Auth.onAuthStateChange((s) => { if (s) { loadFeed(); loadBank(); loadHome(); } });
    setInterval(() => {
      if (isVisible(FEED_WINDOW)) loadFeed();
      if (isVisible(SQUAWK_WINDOW)) loadSquawkHistory();
      if (isVisible(BANK_WINDOW)) loadBank();
      if (isVisible(HOME_WINDOW)) loadHome();
    }, POLL_MS);
  });
})();
