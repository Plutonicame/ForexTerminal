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
  const FEED_HOURS = 72; // période par défaut, sans dates choisies (le week-end, 24 h ne montrait presque rien)
  const LS_RANGE = 'fxt-nf-range';

  const SRC_LABEL = { fj: 'FinancialJuice', investinglive: 'Investing Live', investing: 'Investing.com', bloomberg: 'Bloomberg', reuters: 'Reuters', nyt: 'New York Times' };
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

  /* ---------------- Période du News Feed (bouton calendrier) ---------------- */
  // Un clic sur le bouton ouvre le calendrier (period-calendar.js) : on clique le jour de début, puis le jour de fin
  // (même jour deux fois = ce seul jour). Le bouton « Aujourd'hui » du calendrier revient à aujourd'hui, qui est aussi
  // l'affichage par défaut à chaque ouverture de l'appli (la période choisie n'est pas conservée).
  let feedRange = null; // { from: 'AAAA-MM-JJ', to: 'AAAA-MM-JJ' } ou null = aujourd'hui
  let feedCal = null;
  try { localStorage.removeItem(LS_RANGE); } catch (e) { /* ignore */ } // ancienne version : période mémorisée

  const dmy = (v) => { const [y, m, d] = String(v).split('-'); return `${d}/${m}/${y}`; };
  const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // bornes de la période choisie : { since, until (ISO), label }
  function rangeBounds() {
    if (feedRange) {
      const a = new Date(feedRange.from + 'T00:00:00');
      const b = new Date(feedRange.to + 'T23:59:59.999');
      if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())) {
        const today = ymdLocal(new Date());
        const label = feedRange.from === feedRange.to ? (feedRange.from === today ? "Aujourd'hui" : dmy(feedRange.from)) : `${dmy(feedRange.from)} → ${dmy(feedRange.to)}`;
        return { since: a.toISOString(), until: b.toISOString(), label };
      }
    }
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    return { since: d0.toISOString(), until: new Date(Date.now() + 3600e3).toISOString(), label: "Aujourd'hui" };
  }

  function syncRangeUi() {
    const sec = document.getElementById(FEED_WINDOW);
    const lab = sec && sec.querySelector('[data-nf-range-label]');
    if (lab) lab.textContent = rangeBounds().label;
  }

  function setRange(r) {
    feedRange = r;
    signatures.feed = null;
    syncRangeUi();
    loadFeed();
  }

  /* ---------------- Casque : lecture à voix haute de toutes les news d'une colonne ---------------- */
  const feedRows = {};
  const reader = { key: null, token: 0 };
  function spokenTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const h = d.getHours(); const m = d.getMinutes();
    const hs = h === 0 ? 'minuit' : h === 12 ? 'midi' : `${h} heure${h > 1 ? 's' : ''}`;
    return m ? `${hs} ${m}` : hs;
  }
  function syncListenUi() {
    document.querySelectorAll('[data-nf-listen]').forEach((b) => {
      const on = reader.key === b.dataset.nfListen;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }
  function stopReading() {
    reader.token++; reader.key = null;
    if (reader.clear) reader.clear();
    if (canSpeak()) window.speechSynthesis.cancel();
    syncListenUi();
  }
  function startReading(key) {
    if (!canSpeak()) { alert('Ce navigateur ne sait pas lire à voix haute.'); return; }
    const src = SOURCES.find((s) => s.key === key);
    const rows = feedRows[key] || [];
    if (reader.clear) reader.clear();
    window.speechSynthesis.cancel();
    const token = ++reader.token; reader.key = key;
    syncListenUi();
    if (!squawk.voice) pickVoice();
    const box = document.querySelector(`[data-nf="${key}"]`);
    const rowEls = box ? Array.from(box.querySelectorAll('.nf-row')) : [];
    const items = [];
    const say = (text, lang, el) => { if (text) items.push({ text, lang: lang || 'fr-FR', el: el || null }); };
    if (!rows.length) say(`Aucune news de ${src.title} pour le moment.`);
    // Du plus ancien au plus récent (l'affichage, lui, va du plus récent au plus ancien)
    let lastDay = '';
    let first = true;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      const dk = dayKey(r.published_at);
      if (first) say(`News de ${src.title} du ${fmtDay(r.published_at)}.`);
      else if (dk !== lastDay) say(`Le ${fmtDay(r.published_at)}.`);
      first = false;
      lastDay = dk;
      const el = rowEls[i] || null;
      const en = key === 'investinglive';
      const title = en ? r.title : (r.title_fr || r.title);
      if (en) { say(spokenTime(r.published_at) + '.', 'fr-FR', el); say(title, 'en-US', el); }
      else say(`${spokenTime(r.published_at)}. ${title}`, 'fr-FR', el);
    }
    let idx = 0;
    let current = null;
    const mark = (el) => {
      if (current === el) return;
      if (current) current.classList.remove('nf-row--reading');
      current = el;
      if (el) { el.classList.add('nf-row--reading'); try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* ignoré */ } }
    };
    reader.clear = () => mark(null);
    const next = () => {
      if (token !== reader.token) { mark(null); return; }
      if (idx >= items.length) { mark(null); reader.key = null; syncListenUi(); return; }
      const it = items[idx++];
      mark(it.el);
      try {
        const u = new SpeechSynthesisUtterance(it.text);
        u.lang = it.lang; u.rate = 1.05; u.volume = squawk.vol;
        const voices = window.speechSynthesis.getVoices() || [];
        const v = it.lang === 'fr-FR' ? squawk.voice : voices.find((x) => /^en[-_]US/i.test(x.lang)) || voices.find((x) => /^en/i.test(x.lang));
        if (v) u.voice = v;
        u.onend = next; u.onerror = next;
        window.speechSynthesis.speak(u);
      } catch (e) { next(); }
    };
    next();
  }
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest && ev.target.closest('[data-nf-listen]');
    if (!b) return;
    if (reader.key === b.dataset.nfListen) stopReading(); else startReading(b.dataset.nfListen);
  });

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
            <button type="button" class="nf-cal-btn" data-nf-cal-btn aria-label="Choisir la période des news">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>
            </button>
          </div>
        </div>
        <div class="nf-grid">${SOURCES.map((x) => `
          <section class="nf-col" aria-label="${esc(x.title)}">
            <header class="nf-col-head"><div class="nf-col-text"><span class="nf-col-title">${esc(x.title)}</span><span class="nf-col-sub">${esc(x.sub)}</span></div><button type="button" class="nf-listen" data-nf-listen="${x.key}" aria-pressed="false" title="Écouter toutes les news de ${esc(x.title)}" aria-label="Écouter toutes les news de ${esc(x.title)}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 14v-2a9 9 0 0 1 18 0v2"/><path d="M3 14h3a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2z"/><path d="M21 14h-3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h1a2 2 0 0 0 2-2z"/></svg></button></header>
            <div class="nf-list" data-nf="${x.key}"><p class="nf-empty">Chargement…</p></div>
          </section>`).join('')}
        </div>`;
      const btn = sec.querySelector('[data-nf-cal-btn]');
      if (window.PeriodCalendar && btn) {
        feedCal = window.PeriodCalendar.create({
          button: btn, size: 34, value: feedRange, onChange: (r) => setRange(r),
          labels: { clear: "Aujourd'hui", clearTitle: "Revenir à aujourd'hui", btnIdle: 'Aujourd\'hui — clique pour choisir une autre période', hintFirst: 'Choisis le jour de début (deux clics sur le même jour = ce jour seul)' },
        });
      }
      syncRangeUi();
    }
    return sec;
  }

  /* ---------- pop-up d'une news : infos + résumé en français (quand la page d'origine est lisible) ---------- */
  let popEl = null; let popToken = 0;
  function closePop() { if (popEl) { popEl.remove(); popEl = null; } popToken += 1; }
  async function openPop(a) {
    closePop();
    const tok = popToken;
    const id = a.dataset.nid; const href = a.getAttribute('href');
    popEl = document.createElement('div');
    popEl.className = 'nf-pop';
    const when = new Date(a.dataset.at); const whenTxt = isNaN(when) ? '' : `${fmtDay(a.dataset.at)} · ${fmtTime(a.dataset.at)}`;
    popEl.innerHTML = `<div class="nf-pop-card" role="dialog" aria-modal="true">
      <button type="button" class="nf-pop-x" aria-label="Fermer">×</button>
      <p class="nf-pop-meta">${esc(a.dataset.src)}${a.dataset.feed ? ' · ' + esc(a.dataset.feed) : ''}${whenTxt ? ' · ' + esc(whenTxt) : ''}</p>
      <h3 class="nf-pop-title">${esc(a.dataset.ttl)}</h3>
      ${a.dataset.orig ? `<p class="nf-pop-orig">${esc(a.dataset.orig)}</p>` : ''}
      <div class="nf-pop-body"><p class="nf-pop-wait">Lecture de l'article et résumé en français…</p></div>
      <div class="nf-pop-foot"><a class="nf-pop-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Ouvrir l'article d'origine ↗</a></div></div>`;
    document.body.appendChild(popEl);
    popEl.addEventListener('click', (ev) => { if (ev.target === popEl || ev.target.closest('.nf-pop-x')) closePop(); });
    const body = popEl.querySelector('.nf-pop-body');
    try {
      const c = await client();
      const { data, error } = await c.functions.invoke('article-summary', { body: { id } });
      if (tok !== popToken) return;
      if (error) throw error;
      if (data && data.status === 'ok') {
        body.innerHTML = String(data.summary).split(/\n+/).filter(Boolean).map((t) => `<p>${esc(t)}</p>`).join('') + '<p class="nf-pop-note">Résumé automatique en français (l\'article n\'est pas recopié).</p>';
      } else {
        body.innerHTML = `<p class="nf-pop-wait">Pas de résumé pour cette news : ${esc((data && data.reason) || 'article indisponible')} Utilisez le lien ci-dessous pour la lire sur le site d'origine.</p>`;
      }
    } catch (e) {
      if (tok === popToken) body.innerHTML = '<p class="nf-pop-wait">Résumé indisponible pour le moment. Utilisez le lien ci-dessous pour lire l\'article d\'origine.</p>';
    }
  }
  document.addEventListener('click', (ev) => {
    if (ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    const a = ev.target.closest && ev.target.closest('a.nf-title[data-nid]');
    if (!a) return;
    ev.preventDefault(); openPop(a);
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closePop(); });

  function renderRows(rows, kind) {
    if (!rows.length) return '<p class="nf-empty">Rien pour le moment.</p>';
    let html = '';
    let lastDay = '';
    rows.forEach((r) => {
      const dk = dayKey(r.published_at);
      if (dk !== lastDay) { lastDay = dk; html += `<p class="nf-day">${esc(fmtDay(r.published_at))}</p>`; }
      const url = safeUrl(r.url);
      const title = kind === 'investinglive' ? r.title : (r.title_fr || r.title);
      const tag = kind === 'mixed' ? `<span class="nf-tag">${esc(SRC_LABEL[r.source] || r.source)}</span>`
        : kind === 'fj' ? '<span class="nf-tag nf-tag--red">Rouge</span>' : (r.feed ? `<span class="nf-tag">${esc(r.feed)}</span>` : '');
      const orig = kind !== 'investinglive' && r.title_fr && r.title_fr !== r.title ? `<span class="nf-orig">${esc(r.title)}</span>` : '';
      const body = url
        ? `<a class="nf-title" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-nid="${esc(r.id)}" data-src="${esc(SRC_LABEL[r.source] || r.source || '')}" data-feed="${esc(r.feed || '')}" data-at="${esc(r.published_at)}" data-orig="${esc(r.title_fr && r.title_fr !== r.title ? r.title : '')}" data-ttl="${esc(title)}">${esc(title)}</a>`
        : `<span class="nf-title">${esc(title)}</span>`;
      html += `<div class="nf-row${r.top ? ' nf-row--top' : ''}"${r.top ? ' title="Dans l\'onglet Nouveau et lue par le Squawk"' : ''}><span class="nf-time">${esc(fmtTime(r.published_at))}</span><div class="nf-body">${tag}${body}${orig}</div></div>`;
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
        let q = c.from('news_items').select('id,feed,title,title_fr,url,published_at,top').eq('source', x.key).gte('published_at', since).lt('published_at', until);
        if (x.red) q = q.eq('red', true);
        return q.order('published_at', { ascending: false }).limit(500);
      }));
      const bad = res.find((r) => r.error);
      if (bad) throw bad.error;
      SOURCES.forEach((x, i) => { feedRows[x.key] = res[i].data || []; });
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
  // Lit à voix haute, en français, chaque nouvelle news « top » (celles de l'onglet Nouveau, toutes sources) déjà traduite par les robots.
  // La vraie voix du squawk FinancialJuice est un flux propriétaire : impossible de l'intégrer ou de la transcrire ici.
  const LS_SQUAWK = 'fxt-squawk-on';
  const LS_VOL = 'fxt-squawk-vol';
  const squawk = { vol: 1, on: false, primed: false, spoken: new Set(), timer: null, voice: null, status: '' };

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
      u.volume = squawk.vol;
      window.speechSynthesis.speak(u);
    } catch (e) { console.warn('squawk', e); }
  }

  function syncSquawkUi() {
    const nav = document.getElementById('squawkToggle');
    if (nav) {
      nav.setAttribute('aria-pressed', String(squawk.on));
      nav.classList.toggle('is-on', squawk.on);
      nav.title = squawk.on ? 'Squawk activé (clic = couper · clic droit = volume)' : 'Squawk coupé (clic = activer · clic droit = volume)';
    }
    const btn = document.querySelector('[data-sq-toggle]');
    if (btn) { btn.textContent = squawk.on ? 'Couper la voix' : 'Activer la voix'; btn.classList.toggle('is-on', squawk.on); }
    const st = document.querySelector('[data-sq-status]');
    if (st) st.textContent = squawk.status || (squawk.on ? 'Voix activée : news importantes, données éco publiées et posts de Trump sont lus en français.' : 'Voix coupée.');
  }

  const CUR_FR = { USD: 'dollar américain', EUR: 'euro', JPY: 'yen', GBP: 'livre sterling', CHF: 'franc suisse', CAD: 'dollar canadien', AUD: 'dollar australien', NZD: 'dollar néo-zélandais' };
  const spokenText = (v) => (v === null || v === undefined || String(v).trim() === '' ? 'non communiqué' : String(v).trim());

  function eventSentence(ev) {
    const cal = window.FXT_Calendar;
    const title = cal ? cal.title(ev.title) : ev.title;
    return `${CUR_FR[ev.currency] || ev.currency} : ${title}. Sortie ${spokenText(ev.actual)}. Prévision ${spokenText(ev.forecast_mid)}. Précédent ${spokenText(ev.previous)}.`;
  }

  // Squawk : news importantes + données éco publiées + posts de Trump. Rattrape aussi ce qui est tombé pendant que l'app dormait en arrière-plan.
  async function squawkPoll(first) {
    const c = await client();
    if (!c) return;
    const now = Date.now();
    const wasPrimed = squawk.primed;
    const since = new Date(Math.min(now - 10 * 60 * 1000, wasPrimed && squawk.lastPoll ? squawk.lastPoll - 60 * 1000 : now)).toISOString();
    const cal = window.FXT_Calendar;
    const [nRes, tRes, eRes] = await Promise.all([
      c.from('news_items').select('id,title,title_fr,published_at').eq('top', true).gte('published_at', since).order('published_at', { ascending: true }).limit(40),
      c.from('trump_posts').select('id,posted_at,text_en,text_fr,title_fr,stars').gte('posted_at', since).gte('stars', 2).order('posted_at', { ascending: true }).limit(20),
      c.from('calendar_events').select('currency,title,impact,previous,forecast_mid,actual,event_time').in('impact', cal ? cal.impacts() : ['high', 'medium']).gte('event_time', new Date(now - 6 * 3600 * 1000).toISOString()).lte('event_time', new Date(now + 3600 * 1000).toISOString()).order('event_time', { ascending: true }).limit(60),
    ]);
    squawk.lastPoll = now;
    const queue = [];
    (nRes.data || []).forEach((r) => {
      const k = 'n' + r.id;
      if (squawk.spoken.has(k) || squawk.spoken.has(r.id)) return;
      squawk.spoken.add(k);
      queue.push({ at: Date.parse(r.published_at), text: r.title_fr || r.title });
    });
    (tRes.data || []).forEach((r) => {
      const k = 't' + r.id;
      if (squawk.spoken.has(k)) return;
      squawk.spoken.add(k);
      const body = String(r.title_fr || r.text_fr || r.text_en || '').replace(/https?:\/\/\S+/g, '').trim().slice(0, 300);
      if (body) queue.push({ at: Date.parse(r.posted_at), text: 'Trump : ' + body });
    });
    let evs = eRes.data || [];
    if (cal && cal.keep) evs = cal.keep(evs);
    evs.filter((ev) => ev.actual !== null && ev.actual !== undefined && String(ev.actual).trim() !== '').forEach((ev) => {
      const k = `e${ev.currency}|${ev.title}|${ev.event_time}|${ev.actual}`;
      if (squawk.spoken.has(k)) return;
      squawk.spoken.add(k);
      queue.push({ at: Date.parse(ev.event_time), text: eventSentence(ev) });
    });
    if (first || !wasPrimed) { squawk.primed = true; return; } // à l'activation : on ne relit pas ce qui est déjà tombé
    squawk.primed = true;
    queue.sort((x, y) => x.at - y.at).slice(-8).forEach((q) => speak(q.text));
  }

  /* Arrière-plan : un son silencieux en boucle + session média gardent la lecture active quand l'app n'est plus au premier plan. */
  let keepAudio = null;
  function silentWavUrl() {
    const n = 8000; const buf = new ArrayBuffer(44 + n * 2); const dv = new DataView(buf);
    const w = (o, str) => { for (let i = 0; i < str.length; i += 1) dv.setUint8(o + i, str.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, 8000, true); dv.setUint32(28, 16000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 2, true);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }
  function startKeepAlive() {
    try {
      if (!keepAudio) { keepAudio = new Audio(silentWavUrl()); keepAudio.loop = true; keepAudio.volume = 0.01; keepAudio.setAttribute('playsinline', ''); }
      const p = keepAudio.play(); if (p && p.catch) p.catch(() => {});
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: 'Squawk FXT', artist: 'Forex Terminal', album: 'News, données éco et Trump' });
        navigator.mediaSession.playbackState = 'playing';
        navigator.mediaSession.setActionHandler('pause', () => setSquawk(false, false));
        navigator.mediaSession.setActionHandler('stop', () => setSquawk(false, false));
        navigator.mediaSession.setActionHandler('play', () => setSquawk(true, false));
      }
    } catch (e) { console.warn('squawk keepalive', e); }
  }
  function stopKeepAlive() {
    try { if (keepAudio) keepAudio.pause(); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none'; } catch (e) { /* ignoré */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (!squawk.on) return;
    startKeepAlive();
    if (canSpeak()) window.speechSynthesis.resume();
    squawkPoll(false);
  });
  // Chrome met parfois la synthèse en pause au bout d'un moment : on la relance
  setInterval(() => { if (squawk.on && canSpeak() && window.speechSynthesis.speaking) window.speechSynthesis.resume(); }, 10000);

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
      startKeepAlive();
      squawkPoll(true);
      squawk.timer = setInterval(() => squawkPoll(false), 15 * 1000);
    } else {
      stopKeepAlive();
      if (canSpeak()) window.speechSynthesis.cancel();
    }
    syncSquawkUi();
  }

  async function loadSquawkHistory() {
    await guarded('squawk', async () => {
      const box = document.querySelector('[data-sq-history]');
      const c = await client();
      if (!box || !c) return;
      const since = new Date(Date.now() - FEED_HOURS * 3600 * 1000).toISOString();
      const { data, error } = await c.from('news_items').select('id,source,feed,title,title_fr,url,published_at,top').eq('top', true).gte('published_at', since).order('published_at', { ascending: false }).limit(150);
      if (error) throw error;
      const sig = (data || []).map((r) => r.id + (r.title_fr ? 1 : 0)).join('|');
      if (!changed('squawk', sig)) return;
      box.innerHTML = renderRows(data || [], 'mixed');
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
          <p class="sq-text">Chaque nouvelle news importante de l'onglet Nouveau (FinancialJuice, Investing Live, Investing.com, Bloomberg, Reuters, New York Times) est lue à voix haute, en français, dès qu'elle est triée et traduite (en général dans la minute qui suit). Ce qui a été lu reste en historique ci-dessous. Le même bouton existe dans la barre du haut, à côté de New York.</p>
          <div class="sq-actions">
            <button type="button" class="sq-btn" data-sq-toggle>Activer la voix</button>
            <button type="button" class="sq-btn" data-sq-test>Tester la voix</button>
            <a class="sq-btn" href="${SQUAWK_URL}" target="_blank" rel="noopener noreferrer">Squawk FinancialJuice d'origine</a>
          </div>
          <p class="sq-status" data-sq-status></p>
        </div>
        <div class="nf-col sq-history"><header class="nf-col-head"><span class="nf-col-title">Historique</span><span class="nf-col-sub">News importantes lues · du plus récent au plus ancien</span></header>
          <div class="nf-list" data-sq-history><p class="nf-empty">Chargement…</p></div></div>`;
      sec.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-sq-toggle]')) setSquawk(!squawk.on, true);
        else if (ev.target.closest('[data-sq-test]')) { pickVoice(); speak('Test du squawk. Les annonces seront lues ainsi, en français.'); }
      });
    }
    syncSquawkUi();
  }

  function initVolume(nav) {
    const v = parseFloat(lsGet(LS_VOL));
    if (v >= 0 && v <= 1) squawk.vol = v;
    const pop = document.createElement('div');
    pop.className = 'sq-vol'; pop.hidden = true;
    pop.innerHTML = '<span class="sq-vol-ico">🔈</span><input type="range" min="0" max="100" step="1" aria-label="Volume du Squawk"><span class="sq-vol-val"></span>';
    document.body.appendChild(pop);
    const rng = pop.querySelector('input'); const val = pop.querySelector('.sq-vol-val');
    const show = () => { rng.value = Math.round(squawk.vol * 100); val.textContent = rng.value + '%'; };
    rng.addEventListener('input', () => { squawk.vol = rng.value / 100; val.textContent = rng.value + '%'; lsSet(LS_VOL, String(squawk.vol)); });
    rng.addEventListener('change', () => { if (canSpeak()) { window.speechSynthesis.cancel(); speak('Volume'); } });
    nav.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      show();
      pop.hidden = false;
      const r = nav.getBoundingClientRect();
      pop.style.top = (r.bottom + 6) + 'px';
      pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left + r.width / 2 - pop.offsetWidth / 2)) + 'px';
    });
    document.addEventListener('pointerdown', (ev) => { if (!pop.hidden && !pop.contains(ev.target)) pop.hidden = true; });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') pop.hidden = true; });
  }

  function initSquawkNav() {
    const nav = document.getElementById('squawkToggle');
    if (nav) { nav.addEventListener('click', () => setSquawk(!squawk.on, true)); initVolume(nav); }
    if (canSpeak()) window.speechSynthesis.addEventListener('voiceschanged', pickVoice);
    if (lsGet(LS_SQUAWK) === '1') setSquawk(true, false);
    else syncSquawkUi();
  }

  /* ---------------- Nouveau : ce qui est nouveau depuis ta dernière visite ---------------- */
  // Un bouton par source (n'apparaît que s'il y a du nouveau). Pour chaque source on retient, dans ce navigateur,
  // la date de la dernière annonce lue dès qu'on déroule le bouton. Quand on revient dans l'onglet Nouveau (ou après
  // plus de 2 minutes d'absence), ce qui a été lu a disparu : seules les annonces plus récentes sont affichées.
  // Arriver dans Nouveau puis partir sans rien dérouler ne marque rien comme lu.
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

  function wireHome(box) {
    box.addEventListener('click', (event) => {
        if (event.target.closest('[data-nx-all]')) { showAll = !showAll; signatures.home = null; loadHome(); return; }
        const sec = event.target.closest('[data-nx-sec]');
        if (sec) {
          const key = sec.dataset.nxSec;
          const body = box.querySelector(`[data-nx-body="${key}"]`);
          const open = !openSections.has(key);
          if (open) { openSections.add(key); if (box.id === 'newsExtras') markSeen(key); } else openSections.delete(key);
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

  function ensureHome() {
    let box = document.getElementById('newsExtras');
    if (!box) {
      const anchor = document.getElementById('newsCalendar');
      if (!anchor) return null;
      box = document.createElement('div');
      box.id = 'newsExtras';
      anchor.parentNode.insertBefore(box, anchor);
      wireHome(box);
    }
    return box;
  }

  // Fenêtre Overwatch : Trump à gauche, boutons des autres sources à droite
  const owHosts = [];
  function mountOverwatchNews(host) {
    if (!host || owHosts.includes(host)) return;
    owHosts.push(host);
    wireHome(host);
    host.innerHTML = '<p class="speeches-empty">Chargement…</p>';
    loadHome(owFilter());
  }
  function owFilter() {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    return { startMs: d.getTime(), endMs: d.getTime() + 86400000, currencies: null, label: 'Aujourd\'hui' };
  }
  function renderOverwatch(lists) {
    owHosts.forEach((host) => {
      if (!host.isConnected) return;
      const btns = SECTIONS.filter((s) => lists[s.key].length).map((s) => {
        const open = openSections.has(s.key);
        return `<button type="button" class="nx-sec-btn${open ? ' is-open' : ''}" data-nx-sec="${s.key}" aria-expanded="${open}">${esc(s.label)}<span class="nx-count">${lists[s.key].length}</span></button>`;
      }).join('');
      const bodies = SECTIONS.filter((s) => lists[s.key].length).map((s) =>
        `<div class="nx-list" data-nx-body="${s.key}"${openSections.has(s.key) ? '' : ' hidden'}>${lists[s.key].map(homeItem).join('')}</div>`).join('');
      host.innerHTML = `
        <div class="ow-news-col ow-news-left">
          <div class="speeches-toolbar"><span class="speeches-toolbar-title">Trump</span></div>
          <div class="nx-list">${lists.trump.length ? lists.trump.map(homeItem).join('') : '<p class="speeches-empty">Rien aujourd\'hui.</p>'}</div>
        </div>
        <div class="ow-news-col ow-news-right">
          <div class="speeches-toolbar"><span class="speeches-toolbar-title">News</span></div>
          ${btns ? `<div class="nx-sec-bar">${btns}</div>${bodies}` : '<p class="speeches-empty">Rien aujourd\'hui.</p>'}
        </div>`;
    });
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
      if (!c || !f) return;
      if (!box && !owHosts.length) return;
      const startIso = new Date(f.startMs).toISOString();
      const endIso = new Date(f.endMs).toISOString();
      const wantUsd = !f.currencies || !f.currencies.size || f.currencies.has('USD');
      const news = (source) => c.from('news_items').select('id,feed,title,title_fr,url,published_at').eq('source', source).eq('top', true).gte('published_at', startIso).lt('published_at', endIso).order('published_at', { ascending: false }).limit(150);
      const [fj, il, inv, bbg, reu, nyt, ing, trump] = await Promise.all([
        news('fj'), news('investinglive'), news('investing'), news('bloomberg'), news('reuters'), news('nyt'),
        c.from('bank_research').select('id,bank,title,title_fr,url,published_at,summary,analyzed_at').gte('published_at', startIso).lt('published_at', endIso).order('published_at', { ascending: false }).limit(10),
        wantUsd
          ? c.from('trump_posts').select('id,posted_at,text_en,text_fr,title_fr,stars,url').gte('posted_at', startIso).lt('posted_at', endIso).gte('stars', 2).order('posted_at', { ascending: false }).limit(60)
          : Promise.resolve({ data: [], error: null }),
      ]);
      const lists = { fj: [], il: [], investing: [], bloomberg: [], reuters: [], nyt: [], bank: [], trump: [] };
      (fj.data || []).forEach((r) => lists.fj.push({ kind: 'fj', tag: '', at: r.published_at, title: r.title_fr || r.title, url: r.url, linkLabel: 'Source' }));
      (il.data || []).forEach((r) => lists.il.push({ kind: 'il', tag: r.feed || '', at: r.published_at, title: r.title_fr || r.title, url: r.url, linkLabel: 'Article' }));
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

      const owSig = owHosts.length ? SECTIONS.map((s) => lists[s.key].length + (maxAtByKey[s.key] || '')).join('|') + lists.trump.map((i) => i.at).join(',') + [...openSections].join(',') : '';
      if (owHosts.length && changed('ow', owSig + startIso)) renderOverwatch(lists);
      const sig = SECTIONS.map((s) => shown[s.key].map((i) => i.at + i.title).join('|')).join('#') + '|' + lists.trump.map((i) => i.at + i.title).join('|') + '@' + startIso + endIso + showAll;
      if (!box || !changed('home', sig)) return;
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
    else if (tabId === 'tab-overwatch') { loadHome(owFilter()); }
    else if (tabId === HOME_WINDOW) {
      // on (re)vient dans Nouveau : ce qui a été lu (bouton déroulé) la fois d'avant a disparu, seul le nouveau reste
      baseline = readSeen();
      showAll = false;
      openSections.clear();
      signatures.home = null;
      loadHome();
    }
  }

  window.NewsWindows = { refresh, renderHome: loadHome, mountOverwatchNews };

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
      else if (isVisible('tab-overwatch')) loadHome(owFilter());
    }, POLL_MS);
  });
})();
