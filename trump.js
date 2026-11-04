'use strict';

/**
 * trump.js
 * Fenêtre « Discours » (panneau USD et All) : posts de Donald Trump (Truth Social).
 * Même présentation que les discours des banques centrales : on réutilise
 * les classes CSS et la pop-up de speeches.js (speechStore, openSpeechPopup…).
 * Données : table trump_posts, alimentée par l'edge function trump-bot.
 */
(function () {
  const WINDOW_ID = 'tab-speeches';
  const LIMIT = 200;
  const COLUMNS = 'id, posted_at, text_en, text_fr, title_fr, stars, summary, url';
  let loading = false;
  let signature = null;
  let lastEntries = [];
  const MIN_STARS = 2; // seuls les posts à 2 étoiles ou plus sont affichés

  function rowToEntry(row) {
    const body = row.text_fr || row.text_en || '';
    return {
      id: 'trump-' + row.id,
      first: 'Donald',
      last: 'Trump',
      role: 'Président des États-Unis',
      stars: row.stars,
      date: row.posted_at,
      title: row.title_fr || '',
      speech: body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
      summary: Array.isArray(row.summary) ? row.summary : [],
      source: row.url,
      kindLabel: 'Post traduit en français',
      sourceLabel: 'Voir le post original sur Truth Social',
      pending: row.stars == null, // pas encore analysé par l'IA
    };
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function stars(n) {
    const v = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
    let h = '';
    for (let i = 1; i <= 5; i += 1) h += `<span class="speech-star${i <= v ? ' is-on' : ''}">★</span>`;
    return `<span class="speech-stars" role="img" aria-label="Importance ${v} sur 5">${h}</span>`;
  }

  // La case est la même que pour les discours ; le bouton « Tweet » déplie le texte
  // traduit juste en dessous (pas de fenêtre séparée).
  function buildCard(entry) {
    const link = /^https:\/\//i.test(entry.source || '')
      ? `<a class="trump-tweet-link" href="${esc(entry.source)}" target="_blank" rel="noopener noreferrer">Voir le post original sur Truth Social</a>` : '';
    return `
    <div class="speech-item">
      <div class="speech-badge">
        <span class="speech-badge-status">Truth Social</span>
        ${stars(entry.stars)}
      </div>
      <article class="speech-card">
        <div class="speech-card-name">
          <span class="speech-card-first">${esc(entry.first)}</span>
          <span class="speech-card-last">${esc(entry.last)}</span>
          <span class="speech-card-role">${esc(entry.role)}</span>
        </div>
        <span class="speech-card-date">${esc(fmtDate(entry.date))}</span>
        <div class="speech-card-photo" aria-hidden="true"></div>
      </article>
      <div class="speech-card-actions">
        <button type="button" class="speech-btn" data-trump-tweet aria-expanded="false">Tweet</button>
      </div>
      <div class="trump-tweet" hidden>
        ${entry.title ? `<p class="trump-tweet-title">${esc(entry.title)}</p>` : ''}
        ${entry.speech.map((p) => `<p>${esc(p)}</p>`).join('')}
        ${link}
      </div>
    </div>`;
  }

  function ensureSection() {
    // Posts de Trump : panneau USD de la fenêtre « Discours » (visibles dans USD et All)
    const panel = document.querySelector('.currency-panel[data-win="speeches"][data-currency="USD"]');
    if (!panel) return null;
    let section = panel.querySelector('.trump-speeches');
    if (!section) {
      section = document.createElement('div');
      section.className = 'trump-speeches';
      panel.appendChild(section);
      section.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-trump-tweet]');
        if (!btn) return;
        const box = btn.closest('.speech-item').querySelector('.trump-tweet');
        const open = box.hidden;
        box.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
        btn.textContent = open ? 'Masquer' : 'Tweet';
      });
    }
    return section;
  }

  function render(section, all, failed) {
    const entries = all.filter((e) => !e.pending && (e.stars || 0) >= MIN_STARS);
    section.innerHTML = `
    <div class="speeches-toolbar">
      <span class="speeches-toolbar-title">Donald Trump</span>
      <span class="speeches-toolbar-info">Truth Social · ${entries.length} posts importants (2 étoiles et plus)</span>
    </div>
    ${entries.length
      ? `<div class="speeches-grid">${entries.map(buildCard).join('')}</div>`
      : `<p class="speeches-empty">${failed ? 'Impossible de charger les posts pour le moment.' : 'Aucun post à 2 étoiles ou plus pour le moment.'}</p>`}`;
  }

  async function load() {
    if (loading || !window.Auth || !window.Auth.isConfigured()) return;
    const client = window.Auth.getClient();
    const section = ensureSection();
    if (!client || !section) return;
    loading = true;
    try {
      if (!(await window.Auth.getSession())) return;
      const { data, error } = await client
        .from('trump_posts')
        .select(COLUMNS)
        .order('posted_at', { ascending: false })
        .limit(LIMIT);
      if (error) throw error;
      const entries = (data || []).map(rowToEntry);
      lastEntries = entries;
      const sig = entries.map((e) => `${e.id}:${e.stars}:${e.speech.length}`).join('|');
      if (sig === signature) return;
      signature = sig;
      render(section, entries, false);
    } catch (e) {
      console.warn('trump.js', e);
      if (signature === null) render(section, [], true);
    } finally {
      loading = false;
    }
  }

  window.Trump = { refresh: load };

  document.addEventListener('DOMContentLoaded', () => {
    ensureSection();
    if (window.Auth) window.Auth.onAuthStateChange((s) => { if (s) load(); });
    setInterval(() => {
      const p = document.getElementById(WINDOW_ID);
      if (!document.hidden && p && !p.hidden) load();
    }, 60 * 1000);
  });
})();
