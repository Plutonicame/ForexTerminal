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
  }

  function setActive(on) {
    if (on) mount();
    if (window.Globe) window.Globe.setMiniActive(on);
    if (!on) return;
    if (window.Indicator) window.Indicator.reloadFx();
    if (window.Rates) window.Rates.reload();
    if (window.Risk) window.Risk.refresh();
    if (window.Seasonality) window.Seasonality.refresh();
    if (window.OverwatchCalendar) window.OverwatchCalendar.refresh();
  }

  window.Overwatch = { setActive };

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
