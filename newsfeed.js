'use strict';

/**
 * newsfeed.js
 * Fenêtres d'actualité en direct :
 *   - News Feed     : deux colonnes — investingLive (Live Feed) | FinancialJuice (annonces rouges)
 *   - Bank Research : FX Daily d'ING (traduit en français + lien vers l'original)
 *   - Squawk        : accès à la radio économique de FinancialJuice
 *   - Nouveau       : tout ce qui est nouveau (posts de Trump, FX Daily ING, annonces rouges)
 * Données : tables news_items (news-bot), bank_research (ing-bot) et trump_posts (trump-bot).
 * Seuls des titres + liens sont repris pour investingLive et FinancialJuice ; ING est traduit avec un lien vers l'original.
 */
(function () {
  const FEED_WINDOW = 'tab-newsfeed';
  const BANK_WINDOW = 'tab-bankresearch';
  const SQUAWK_WINDOW = 'tab-squawk';
  const HOME_WINDOW = 'tab-4';
  const SQUAWK_URL = 'https://www.financialjuice.com/home';
  const POLL_MS = 60 * 1000;

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

  /* ---------------- News Feed ---------------- */
  function ensureFeedLayout() {
    const sec = document.getElementById(FEED_WINDOW);
    if (!sec) return null;
    if (!sec.querySelector('.nf-grid')) {
      sec.innerHTML = `
        <div class="calendar-toolbar"><span class="calendar-toolbar-title">News Feed</span></div>
        <div class="nf-grid">
          <section class="nf-col" aria-label="investingLive Live Feed">
            <header class="nf-col-head"><span class="nf-col-title">investingLive</span><span class="nf-col-sub">Live Feed · titres en anglais</span></header>
            <div class="nf-list" data-nf="investinglive"><p class="nf-empty">Chargement…</p></div>
          </section>
          <section class="nf-col" aria-label="FinancialJuice annonces rouges">
            <header class="nf-col-head"><span class="nf-col-title">FinancialJuice</span><span class="nf-col-sub">Annonces rouges uniquement · traduites</span></header>
            <div class="nf-list" data-nf="fj"><p class="nf-empty">Chargement…</p></div>
          </section>
        </div>`;
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
      const title = kind === 'fj' ? (r.title_fr || r.title) : r.title;
      const tag = kind === 'investinglive' && r.feed ? `<span class="nf-tag">${esc(r.feed)}</span>` : '<span class="nf-tag nf-tag--red">Rouge</span>';
      const orig = kind === 'fj' && r.title_fr && r.title_fr !== r.title ? `<span class="nf-orig">${esc(r.title)}</span>` : '';
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
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const [inv, fj] = await Promise.all([
        c.from('news_items').select('id,feed,title,url,published_at').eq('source', 'investinglive').gte('published_at', since).order('published_at', { ascending: false }).limit(120),
        c.from('news_items').select('id,title,title_fr,url,published_at').eq('source', 'fj').eq('red', true).gte('published_at', since).order('published_at', { ascending: false }).limit(120),
      ]);
      if (inv.error || fj.error) throw (inv.error || fj.error);
      const sig = (inv.data || []).map((r) => r.id).join('|') + '#' + (fj.data || []).map((r) => r.id + (r.title_fr ? 1 : 0)).join('|');
      if (!changed('feed', sig)) return;
      sec.querySelector('[data-nf="investinglive"]').innerHTML = renderRows(inv.data || [], 'investinglive');
      sec.querySelector('[data-nf="fj"]').innerHTML = renderRows(fj.data || [], 'fj');
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

  /* ---------------- Squawk ---------------- */
  function buildSquawk() {
    const sec = document.getElementById(SQUAWK_WINDOW);
    if (!sec || sec.querySelector('.sq-card')) return;
    sec.innerHTML = `
      <div class="calendar-toolbar"><span class="calendar-toolbar-title">Squawk</span></div>
      <div class="sq-card">
        <p class="sq-title">Radio économique de FinancialJuice</p>
        <p class="sq-text">La radio (squawk) de FinancialJuice lit les annonces à voix haute, en direct, en anglais. Elle est diffusée dans le lecteur de FinancialJuice et ne peut pas être intégrée directement dans une autre page : le bouton ouvre le lecteur dans un nouvel onglet, que tu peux laisser tourner en arrière-plan.</p>
        <a class="sq-btn" href="${SQUAWK_URL}" target="_blank" rel="noopener noreferrer">Ouvrir le squawk FinancialJuice</a>
      </div>`;
  }

  /* ---------------- Nouveau : tout ce qui est nouveau ---------------- */
  function ensureHome() {
    let box = document.getElementById('newsExtras');
    if (!box) {
      const anchor = document.getElementById('newsCalendar');
      if (!anchor) return null;
      box = document.createElement('div');
      box.id = 'newsExtras';
      anchor.parentNode.insertBefore(box, anchor);
      box.addEventListener('click', (event) => {
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
        <span class="nf-tag${it.kind === 'fj' ? ' nf-tag--red' : ''}">${esc(it.tag)}</span>
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
      const [fj, ing, trump] = await Promise.all([
        c.from('news_items').select('id,title,title_fr,url,published_at').eq('source', 'fj').eq('red', true).gte('published_at', startIso).lt('published_at', endIso).order('published_at', { ascending: false }).limit(100),
        c.from('bank_research').select('id,bank,title,title_fr,url,published_at,text_fr,summary,analyzed_at').gte('published_at', startIso).lt('published_at', endIso).order('published_at', { ascending: false }).limit(10),
        wantUsd
          ? c.from('trump_posts').select('id,posted_at,text_en,text_fr,title_fr,stars,url').gte('posted_at', startIso).lt('posted_at', endIso).gte('stars', 2).order('posted_at', { ascending: false }).limit(60)
          : Promise.resolve({ data: [], error: null }),
      ]);
      const items = [];
      (fj.data || []).forEach((r) => items.push({ kind: 'fj', tag: 'FinancialJuice', at: r.published_at, title: r.title_fr || r.title, url: r.url, linkLabel: 'Source' }));
      (ing.data || []).forEach((r) => items.push({
        kind: 'ing', tag: 'ING · FX Daily', at: r.published_at, title: (r.analyzed_at && r.title_fr) || r.title, url: r.url, linkLabel: 'Article original',
        more: r.analyzed_at && Array.isArray(r.summary) && r.summary.length ? `<ul class="br-bullets">${r.summary.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : '',
      }));
      (trump.data || []).forEach((r) => items.push({
        kind: 'trump', tag: 'Trump', at: r.posted_at, title: r.title_fr || (r.text_fr || r.text_en || '').slice(0, 140), url: r.url, linkLabel: 'Post original',
        more: paragraphs(r.text_fr || r.text_en),
      }));
      items.sort((a, b) => new Date(b.at) - new Date(a.at));

      const sig = items.map((i) => i.kind + i.at + i.title).join('|') + '@' + startIso + endIso;
      if (!changed('home', sig)) return;
      box.innerHTML = `
        <div class="speeches-toolbar">
          <span class="speeches-toolbar-title">Nouveautés</span>
          <span class="speeches-toolbar-info">${esc(f.label || '')} · posts de Trump, FX Daily d'ING, annonces rouges FinancialJuice</span>
        </div>
        ${items.length ? `<div class="nx-list">${items.map(homeItem).join('')}</div>` : '<p class="speeches-empty">Rien de nouveau sur cette période.</p>'}`;
    });
  }

  /* ---------------- Navigation + rafraîchissement ---------------- */
  function refresh(tabId) {
    if (tabId === FEED_WINDOW) { ensureFeedLayout(); loadFeed(); }
    else if (tabId === BANK_WINDOW) loadBank();
    else if (tabId === SQUAWK_WINDOW) buildSquawk();
    else if (tabId === HOME_WINDOW) loadHome();
  }

  window.NewsWindows = { refresh, renderHome: loadHome };

  document.addEventListener('DOMContentLoaded', () => {
    ensureFeedLayout();
    buildSquawk();
    ensureHome();
    if (window.Auth) window.Auth.onAuthStateChange((s) => { if (s) { loadFeed(); loadBank(); loadHome(); } });
    setInterval(() => {
      if (isVisible(FEED_WINDOW)) loadFeed();
      if (isVisible(BANK_WINDOW)) loadBank();
      if (isVisible(HOME_WINDOW)) loadHome();
    }, POLL_MS);
  });
})();
