'use strict';

/**
 * recap.js
 * Fenêtre « Session Recap » : brief du matin en français sur tout ce qui s'est passé dans FXT depuis 21 h (Paris) la veille
 * (ou depuis 21 h aujourd'hui si on est passé 21 h) : sentiment du risque, force des devises, écarts avec tes biais de
 * Note fondamentale, news, données éco, discours, banques centrales, taux. Analyse faite par l'edge function fx-insight (mode recap).
 * Exclus : calculateur de risque, paramètres, notes.
 * Couleurs : style.css (variables --rcp-*) ou Paramètres > Thème > Session Recap.
 */
(function () {
  const PANEL_ID = 'tab-recap';
  const LS_LAST = 'fxt-recap-last';
  let built = false;
  let busy = false;
  let body = null;
  let meta = null;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function parisHour(d) {
    return Number(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' }).format(d));
  }
  function parisOffsetMs(d) {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' })
      .formatToParts(d).forEach((x) => { if (x.type !== 'literal') p[x.type] = Number(x.value); });
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000;
  }
  // Dernier 21:00 heure de Paris déjà passé
  function sinceMs() {
    const now = new Date();
    const off = parisOffsetMs(now);
    const local = new Date(now.getTime() + off); // « heure murale » Paris exprimée en UTC
    let day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 21, 0, 0);
    if (local.getTime() < day) day -= 86400000;
    return day - off;
  }
  const fmt = (ms) => new Date(ms).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

  function render(r, since, at) {
    const secs = (r.sections || []).map((s) => `<section class="rcp-sec"><h3 class="rcp-h">${esc(s.title)}</h3><ul class="rcp-ul">${(s.points || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul></section>`).join('');
    const gaps = (r.bias_gaps || []).length
      ? `<section class="rcp-sec rcp-gaps"><h3 class="rcp-h">Écarts avec tes biais</h3>${r.bias_gaps.map((g) => `<div class="rcp-gap"><span class="rcp-chip">${esc(g.ccy)}</span>${esc(g.note)}</div>`).join('')}</section>`
      : '';
    body.innerHTML = `<p class="rcp-headline">${esc(r.headline)}</p>${secs}${gaps}`;
    meta.textContent = 'Du ' + fmt(since) + ' à ' + new Date(at).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
  }

  async function generate(force) {
    if (busy) return;
    const c = window.Auth && window.Auth.getClient && window.Auth.getClient();
    if (!c) return;
    busy = true;
    const since = sinceMs();
    meta.textContent = 'Du ' + fmt(since) + ' · analyse en cours…';
    if (!body.querySelector('.rcp-headline')) body.innerHTML = '<p class="rcp-dim">Analyse de tout FXT en cours (risque, devises, news, éco, discours, taux)…</p>';
    try {
      const biases = window.Understand && window.Understand.getBiases ? await window.Understand.getBiases() : {};
      const { data, error } = await c.functions.invoke('fx-insight', { body: { mode: 'recap', since, biases, force: !!force } });
      if (error || !data || !data.ok) throw new Error((data && data.error) || (error && error.message) || 'analyse indisponible');
      render(data.result, since, Date.now());
      try { localStorage.setItem(LS_LAST, JSON.stringify({ since, at: Date.now(), result: data.result })); } catch (e) { /* ignore */ }
    } catch (e) {
      if (!body.querySelector('.rcp-headline')) body.innerHTML = '';
      body.insertAdjacentHTML('afterbegin', `<p class="rcp-err">${esc(e.message || e)}</p>`);
      meta.textContent = 'Du ' + fmt(since);
    } finally { busy = false; }
  }

  function build() {
    if (built) return;
    const sec = document.getElementById(PANEL_ID);
    if (!sec) return;
    built = true;
    sec.innerHTML = `<div class="calendar-toolbar"><span class="calendar-toolbar-title">Session Recap</span></div><div class="rcp-wrap"><div class="rcp-top"><span class="rcp-meta"></span><button type="button" class="rcp-btn">Actualiser</button></div><div class="rcp-body"></div></div>`;
    body = sec.querySelector('.rcp-body');
    meta = sec.querySelector('.rcp-meta');
    sec.querySelector('.rcp-btn').addEventListener('click', () => generate(true));
    try {
      const last = JSON.parse(localStorage.getItem(LS_LAST) || 'null');
      if (last && last.result && last.since === sinceMs()) render(last.result, last.since, last.at);
    } catch (e) { /* ignore */ }
  }

  window.Recap = { refresh() { build(); generate(false); } };
})();
