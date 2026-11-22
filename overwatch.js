'use strict';

/**
 * overwatch.js — fenêtre « Overwatch » : vue d'ensemble rapide, en petites briques qui s'imbriquent.
 * Chaque brique réutilise le module de la fenêtre d'origine (Indicator, Saisonnalité, Risque, Taux, Globe, News,
 * calendrier) en version réduite : l'assemblage est fait ici, les réglages visuels sont dans Paramètres > Thème > Overwatch.
 */
(function () {
  const PANEL_ID = 'tab-overwatch';
  let mounted = false;

  function mount() {
    if (mounted) return;
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    mounted = true;
    const $ = (id) => document.getElementById(id);
    if (window.Indicator) window.Indicator.mountFx($('owFx'));
    if (window.Seasonality) window.Seasonality.mountMonth($('owSeas'));
    if (window.Risk) window.Risk.mountGauge($('owRisk'));
    if (window.Rates) window.Rates.mountGrid($('owRates'));
    if (window.Globe) window.Globe.mountMini($('owGlobe'));
    if (window.NewsWindows) window.NewsWindows.mountOverwatchNews($('owNews'));
    wireClicks();
  }

  function setActive(on) {
    if (on) mount();
    if (window.Globe) window.Globe.setMiniActive(on);
    if (!on) { if (window.NewsWindows && window.NewsWindows.leaveOverwatch) window.NewsWindows.leaveOverwatch(); return; }
    if (window.Indicator) window.Indicator.reloadFx();
    if (window.Rates) window.Rates.reload();
    if (window.Risk) window.Risk.refresh();
    if (window.Seasonality) window.Seasonality.refresh();
    if (window.OverwatchCalendar) window.OverwatchCalendar.refresh();
  }

  /* ---------- Clics : chaque brique ouvre sa fenêtre ; la flèche à côté du burger ramène à Overwatch ---------- */
  const backBtn = () => document.getElementById('backBtn');
  let armed = false;
  function hideBack() { armed = false; const b = backBtn(); if (b) b.hidden = true; }
  function arm() {
    const b = backBtn(); if (!b) return;
    b.hidden = false; armed = false;
    setTimeout(() => { armed = true; }, 0); // le clic qui vient d'ouvrir la fenêtre ne compte pas
  }
  // tout autre clic / touche (changer de devise, ouvrir le menu, etc.) annule la flèche
  ['pointerdown', 'keydown'].forEach((t) => document.addEventListener(t, (e) => {
    if (!armed) return;
    if (e.target && e.target.closest && e.target.closest('#backBtn')) return;
    hideBack();
  }, true));
  function go(tabId, after) {
    const t = document.querySelector('.menu-tab[data-tab="' + tabId + '"]');
    if (!t) return;
    t.click();
    if (after) after();
    arm();
  }
  function goBack() {
    hideBack();
    const t = document.querySelector('.menu-tab[data-tab="tab-overwatch"]');
    if (t) t.click();
  }
  const INTERACTIVE = 'a, button, input, select, textarea, .nx-more, [data-nx-body] .speech-btn';
  // clic simple (sans glisser) sur une zone dont le glisser a un autre rôle (graphique, globe)
  function plainClick(host, fn, delay) {
    let down = null; let timer = null;
    host.addEventListener('pointerdown', (e) => { down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null; }, true);
    host.addEventListener('dblclick', () => { clearTimeout(timer); }, true);
    host.addEventListener('pointerup', (e) => {
      const d = down; down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
      if (e.target.closest && e.target.closest('button, a')) return;
      clearTimeout(timer);
      timer = setTimeout(fn, delay || 0);
    }, true);
  }
  function wireClicks() {
    const $ = (id) => document.getElementById(id);
    const sel = (win, code) => () => { if (window.FXWindows) window.FXWindows.select(win, code); };
    const back = backBtn(); if (back) back.addEventListener('click', goBack);

    // Risk-on / risk-off
    $('owRisk').addEventListener('click', () => go('tab-risk'));
    // Globe : un clic sans glisser (glisser = tourner le globe)
    plainClick($('owGlobe'), () => go('tab-globe'));
    // Force des devises : un clic simple (glisser = zoom sur une zone, double-clic = replacer)
    plainClick($('owFx'), () => go('tab-indicator'), 300);
    // Saisonnalité : colonne / devise -> cette devise ; ailleurs -> toutes les devises
    $('owSeas').addEventListener('click', (e) => {
      const hit = e.target.closest('.seas-hit');
      const code = hit ? hit.dataset.cur : 'ALL';
      go('tab-seasonality', sel('seasonality', code));
    });
    // Trump -> fenêtre Discours (où se trouvent ses posts) ; News -> News Feed
    $('owNews').addEventListener('click', (e) => {
      if (e.target.closest(INTERACTIVE)) return;
      if (e.target.closest('.ow-news-left')) go('tab-speeches');
      else if (e.target.closest('.ow-news-right')) go('tab-newsfeed');
    });
    // Discours du jour : zone de titre / fond -> fenêtre Discours
    $('owSpeeches').addEventListener('click', (e) => {
      if (e.target.closest('button, a, .speech-popup, .news-speech')) return;
      go('tab-speeches');
    });
  }

  window.Overwatch = { setActive, arm, go };

  // Overwatch est la page d'accueil : on la charge dès que l'appli s'affiche (après connexion)
  document.addEventListener('fxt-app-shown', () => {
    const p = document.getElementById(PANEL_ID);
    if (p && !p.hidden) { setActive(true); if (window.OverwatchCalendar) window.OverwatchCalendar.refresh(); }
  });

  // rafraîchissement périodique tant que la fenêtre est affichée
  document.addEventListener('DOMContentLoaded', () => {
    setInterval(() => {
      const p = document.getElementById(PANEL_ID);
      if (!p || p.hidden || document.hidden) return;
      if (window.Indicator) window.Indicator.reloadFx();
      if (window.Rates) window.Rates.reload();
      if (window.OverwatchCalendar) window.OverwatchCalendar.refresh();
    }, 60 * 1000);
  });
})();
