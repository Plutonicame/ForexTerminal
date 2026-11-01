'use strict';

/**
 * trump.js
 * Onglet « Événements secondaires » : posts de Donald Trump (Truth Social).
 * Même présentation que les discours des banques centrales : on réutilise
 * les classes CSS et la pop-up de speeches.js (speechStore, openSpeechPopup…).
 * Données : table trump_posts, alimentée par l'edge function trump-bot.
 */
(function () {
  const PANEL_ID = 'tab-2';
  const LIMIT = 200;
  const COLUMNS = 'id, posted_at, text_en, text_fr, title_fr, stars, summary, url';
  let loading = false;
  let signature = null;

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
      sourceLabel: 'Voir le post original sur Truth Social',
      pending: row.stars == null, // pas encore analysé par l'IA
    };
  }

  function buildCard(entry) {
    const key = 'TRUMP:' + entry.id;
    speechStore.set(key, entry);
    const k = speechEscape(key);
    return `
    <div class="speech-item">
      <div class="speech-badge">
        <span class="speech-badge-status">Truth Social</span>
        ${entry.pending ? '<span class="speech-badge-status">Analyse en cours…</span>' : speechStarsHtml(entry.stars)}
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
        <button type="button" class="speech-btn" data-open="speech" data-key="${k}">Discours</button>
        <button type="button" class="speech-btn" data-open="summary" data-key="${k}">Résumé</button>
      </div>
    </div>`;
  }

  function ensureSection() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return null;
    let section = panel.querySelector('.speeches');
    if (!section) {
      panel.textContent = '';
      section = document.createElement('div');
      section.className = 'speeches';
      panel.appendChild(section);
      section.addEventListener('click', (event) => {
        const btn = event.target.closest('.speech-btn[data-open]');
        if (!btn) return;
        openSpeechPopup(btn.dataset.key, btn.dataset.open, btn);
      });
    }
    return section;
  }

  function render(section, entries, failed) {
    section.innerHTML = `
    <div class="speeches-toolbar">
      <span class="speeches-toolbar-title">Donald Trump</span>
      <span class="speeches-toolbar-info">Truth Social · ${entries.length} posts</span>
    </div>
    ${entries.length
      ? `<div class="speeches-grid">${entries.map(buildCard).join('')}</div>`
      : `<p class="speeches-empty">${failed ? 'Impossible de charger les posts pour le moment.' : 'Aucun post pour le moment.'}</p>`}`;
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
      const p = document.getElementById(PANEL_ID);
      if (!document.hidden && p && !p.hidden) load();
    }, 60 * 1000);
  });
})();
