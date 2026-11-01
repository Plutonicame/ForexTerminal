'use strict';

/**
 * trump.js
 * Onglet « Événements secondaires » : fil des posts de Donald Trump (Truth Social).
 * Données : table trump_posts, alimentée par l'edge function trump-bot (cron).
 */
(function () {
  const PANEL_ID = 'tab-2';
  const LIMIT = 200;
  let loading = false;
  let signature = '';
  let showFr = true;
  const frCache = new Map(); // id -> traduction faite dans le navigateur (si le bot n'a pas pu)
  let translating = false;

  async function translateToFr(text) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=fr&dt=t&q=' + encodeURIComponent(text.slice(0, 4500));
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return data[0].map((c) => c[0]).join('');
  }

  // Traduit en arrière-plan les posts affichés qui n'ont pas de version française.
  async function fillMissingTranslations(rows, feed) {
    if (translating || !showFr) return;
    translating = true;
    try {
      const todo = rows.filter((r) => r.text_en && !r.text_fr && !frCache.has(r.id)).slice(0, 40);
      for (const r of todo) {
        if (!showFr) break;
        try {
          const fr = await translateToFr(r.text_en);
          frCache.set(r.id, fr);
          const node = feed.querySelector('[data-id="' + r.id + '"] .trump-text');
          if (node && showFr) node.textContent = fr;
        } catch (e) { break; } // limite atteinte : on réessaiera à la prochaine ouverture
      }
    } finally { translating = false; }
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function safeUrl(u) {
    return typeof u === 'string' && /^https:\/\//i.test(u) ? u : '';
  }

  function ensureShell() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return null;
    if (!panel.querySelector('.trump-feed')) {
      panel.textContent = '';
      const bar = el('div', 'trump-toolbar');
      bar.appendChild(el('span', 'trump-title', 'Donald Trump · Truth Social'));
      const sw = el('button', 'trump-lang', 'FR');
      sw.type = 'button';
      sw.title = 'Basculer français / anglais';
      sw.addEventListener('click', () => {
        showFr = !showFr;
        sw.textContent = showFr ? 'FR' : 'EN';
        signature = '';
        load();
      });
      bar.appendChild(sw);
      panel.appendChild(bar);
      panel.appendChild(el('div', 'trump-feed'));
    }
    return panel.querySelector('.trump-feed');
  }

  function card(row) {
    const c = el('article', 'trump-card');
    c.dataset.id = row.id;
    const head = el('div', 'trump-head');
    head.appendChild(el('span', 'trump-author', 'Donald J. Trump'));
    if (row.post_type && row.post_type !== 'original') head.appendChild(el('span', 'trump-badge', row.post_type === 'reblog' ? 'Re-Truth' : row.post_type));
    head.appendChild(el('span', 'trump-date', fmtDate(row.posted_at)));
    c.appendChild(head);
    const text = showFr ? (row.text_fr || frCache.get(row.id) || row.text_en) : row.text_en;
    if (text) c.appendChild(el('p', 'trump-text', text));
    (Array.isArray(row.media) ? row.media : []).slice(0, 4).forEach((m) => {
      const u = safeUrl(m && m.url);
      if (!u) return;
      if (m.type === 'image') {
        const img = el('img', 'trump-media');
        img.src = u; img.loading = 'lazy'; img.alt = '';
        c.appendChild(img);
      } else {
        const a = el('a', 'trump-link', 'Voir le média');
        a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer';
        c.appendChild(a);
      }
    });
    const orig = safeUrl(row.url);
    if (orig) {
      const a = el('a', 'trump-link', 'Ouvrir sur Truth Social');
      a.href = orig; a.target = '_blank'; a.rel = 'noopener noreferrer';
      c.appendChild(a);
    }
    return c;
  }

  async function load() {
    if (loading || !window.Auth || !window.Auth.isConfigured()) return;
    const client = window.Auth.getClient();
    const feed = ensureShell();
    if (!client || !feed) return;
    loading = true;
    try {
      if (!(await window.Auth.getSession())) return;
      const { data, error } = await client
        .from('trump_posts')
        .select('id,posted_at,post_type,text_en,text_fr,url,media')
        .order('posted_at', { ascending: false })
        .limit(LIMIT);
      if (error) throw error;
      const rows = data || [];
      const sig = rows.map((r) => r.id + (r.text_fr ? 'f' : '')).join('|') + showFr;
      if (sig === signature) return;
      signature = sig;
      feed.textContent = '';
      if (!rows.length) feed.appendChild(el('p', 'trump-empty', 'Aucun post pour le moment.'));
      rows.forEach((r) => feed.appendChild(card(r)));
      fillMissingTranslations(rows, feed);
    } catch (e) {
      console.warn('trump.js', e);
    } finally {
      loading = false;
    }
  }

  window.Trump = { refresh: load };

  document.addEventListener('DOMContentLoaded', () => {
    ensureShell();
    if (window.Auth) window.Auth.onAuthStateChange((s) => { if (s) load(); });
    setInterval(() => {
      const p = document.getElementById(PANEL_ID);
      if (!document.hidden && p && !p.hidden) load();
    }, 60 * 1000);
  });
})();
