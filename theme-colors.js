'use strict';

/**
 * theme-colors.js
 * Système de personnalisation des couleurs, porté depuis l'ancien projet
 * (TJP) : roue de saturation/luminosité, curseur de teinte, champ hex,
 * couleurs récemment utilisées. Réutilisé pour n'importe quel champ de
 * couleur de l'appli (pour l'instant : la section "Connexion").
 *
 * Persistance : les couleurs choisies sont stockées dans localStorage.
 * La sauvegarde dans le cloud (Supabase) n'est pas encore branchée —
 * ce sera la prochaine étape une fois qu'une table de paramètres
 * utilisateur existera côté Supabase.
 */

const THEME_STORAGE_KEY = 'fx_theme_vars';

/* =========================================================
   1. Registre des champs de couleur personnalisables, par section
   ========================================================= */
const THEME_FIELDS = {
  nouveau: [
    { v: '--filterbar-bg', l: 'Fond', category: 'Barre de filtres', section: 'Fond & bordure' },
    { v: '--filterbar-border', l: 'Bordure (en dessous)', category: 'Barre de filtres', section: 'Fond & bordure' },

    { v: '--filter-dd-btn-bg', l: 'Fond', category: 'Menu Devise', section: 'Bouton' },
    { v: '--filter-dd-btn-border', l: 'Bordure', category: 'Menu Devise', section: 'Bouton' },
    { v: '--filter-dd-btn-text', l: 'Texte et flèche', category: 'Menu Devise', section: 'Bouton' },
    { v: '--filter-dd-menu-bg', l: 'Fond', category: 'Menu Devise', section: 'Liste déroulante' },
    { v: '--filter-dd-menu-border', l: 'Bordure', category: 'Menu Devise', section: 'Liste déroulante' },
    { v: '--filter-dd-item-text', l: 'Texte des devises', category: 'Menu Devise', section: 'Liste déroulante' },
    { v: '--filter-dd-item-hover-bg', l: 'Fond au survol', category: 'Menu Devise', section: 'Liste déroulante' },
    { v: '--filter-check-color', l: 'Couleur des cases cochées', category: 'Menu Devise', section: 'Cases à cocher' },
    { v: '--filter-all-bg', l: 'Fond', category: 'Menu Devise', section: 'Bouton All' },
    { v: '--filter-all-border', l: 'Bordure', category: 'Menu Devise', section: 'Bouton All' },
    { v: '--filter-all-text', l: 'Texte', category: 'Menu Devise', section: 'Bouton All' },
    { v: '--filter-all-hover-bg', l: 'Fond au survol', category: 'Menu Devise', section: 'Bouton All' },

    { v: '--news-date-btn-bg', l: 'Fond', category: 'Période', section: 'Bouton calendrier' },
    { v: '--news-date-btn-border', l: 'Bordure', category: 'Période', section: 'Bouton calendrier' },
    { v: '--news-date-btn-icon', l: 'Icône', category: 'Période', section: 'Bouton calendrier' },
    { v: '--news-date-btn-hover-border', l: 'Bordure survolé', category: 'Période', section: 'Bouton calendrier' },
    { v: '--news-date-btn-hover-icon', l: 'Icône survolé', category: 'Période', section: 'Bouton calendrier' },
    { v: '--news-date-btn-open-bg', l: 'Fond ouvert', category: 'Période', section: 'Bouton calendrier' },
    { v: '--news-date-btn-open-border', l: 'Bordure ouvert', category: 'Période', section: 'Bouton calendrier' },
    { v: '--news-date-btn-open-icon', l: 'Icône ouvert', category: 'Période', section: 'Bouton calendrier' },
    { v: '--news-period-text', l: 'Texte de la période (à côté du bouton)', category: 'Période', section: 'Bouton calendrier' },
    { v: '--news-cal-bg', l: 'Fond', category: 'Période', section: 'Fenêtre de sélection' },
    { v: '--news-cal-border', l: 'Bordure', category: 'Période', section: 'Fenêtre de sélection' },
    { v: '--news-cal-text', l: 'Texte (mois et jours)', category: 'Période', section: 'Fenêtre de sélection' },
    { v: '--news-cal-weekday', l: 'Lettres des jours (L M M...)', category: 'Période', section: 'Fenêtre de sélection' },
    { v: '--news-cal-today-border', l: "Contour d'aujourd'hui", category: 'Période', section: 'Fenêtre de sélection' },
    { v: '--news-cal-range-bg', l: 'Fond des jours de la période', category: 'Période', section: 'Fenêtre de sélection' },
    { v: '--news-cal-edge-bg', l: 'Fond du premier et du dernier jour', category: 'Période', section: 'Fenêtre de sélection' },
    { v: '--news-cal-edge-text', l: 'Texte du premier et du dernier jour', category: 'Période', section: 'Fenêtre de sélection' },

    { v: '--news-toolbar-bg', l: 'Fond', category: 'Page Nouveau', section: 'Bandeau « Nouveau »' },
    { v: '--news-toolbar-border', l: 'Bordure', category: 'Page Nouveau', section: 'Bandeau « Nouveau »' },
    { v: '--news-toolbar-title', l: 'Titre', category: 'Page Nouveau', section: 'Bandeau « Nouveau »' },
    { v: '--news-info-text', l: 'Ligne de résumé (date, nombre d\'événements)', category: 'Page Nouveau', section: 'Textes' },
    { v: '--news-cur-border', l: 'Bordure', category: 'Page Nouveau', section: 'Pastille de devise (USD, EUR...)' },
    { v: '--news-cur-text', l: 'Texte', category: 'Page Nouveau', section: 'Pastille de devise (USD, EUR...)' },
    { v: '--news-speech-tag-text', l: 'Étiquette au-dessus des discours', category: 'Page Nouveau', section: 'Textes' },
  ],
  connexion: [
    { v: '--auth-bg', l: 'Fond de la connexion', section: 'Écran de connexion' },
    { v: '--auth-border', l: 'Bordure de la carte', section: 'Écran de connexion' },
    { v: '--auth-text-color', l: 'Texte au-dessus', section: 'Écran de connexion' },
    { v: '--auth-error-text', l: "Texte d'erreur", section: 'Écran de connexion' },
    { v: '--auth-google-btn-bg', l: 'Fond', section: 'Bouton Google' },
    { v: '--auth-google-btn-border', l: 'Bordure', section: 'Bouton Google' },
    { v: '--auth-google-btn-hover-bg', l: 'Fond au survol', section: 'Bouton Google' },
    { v: '--auth-google-text-color', l: 'Texte', section: 'Bouton Google' },
  ],
  analyse: [
    { v: '--currency-bar-bg', l: 'Fond de la barre (derrière les boutons, quand elle reste collée en haut)', section: 'Barre des devises' },
    { v: '--currency-card-bg', l: 'Fond', section: 'Boutons des devises' },
    { v: '--currency-card-border', l: 'Bordure', section: 'Boutons des devises' },
    { v: '--currency-card-text', l: 'Texte (USD, EUR...)', section: 'Boutons des devises' },
    { v: '--currency-card-active-bg', l: 'Fond', section: 'Devise sélectionnée' },
    { v: '--currency-card-active-border', l: 'Bordure', section: 'Devise sélectionnée' },
    { v: '--currency-card-active-text', l: 'Texte', section: 'Devise sélectionnée' },

    { v: '--calendar-date-btn-bg', l: 'Fond', section: 'Calendrier — bouton date' },
    { v: '--calendar-date-btn-border', l: 'Bordure', section: 'Calendrier — bouton date' },
    { v: '--calendar-date-btn-icon', l: 'Icône', section: 'Calendrier — bouton date' },
    { v: '--calendar-date-btn-hover-border', l: 'Bordure survolé', section: 'Calendrier — bouton date' },
    { v: '--calendar-date-btn-hover-icon', l: 'Icône survolé', section: 'Calendrier — bouton date' },
    { v: '--calendar-date-btn-open-bg', l: 'Fond ouvert', section: 'Calendrier — bouton date' },
    { v: '--calendar-date-btn-open-border', l: 'Bordure ouvert', section: 'Calendrier — bouton date' },
    { v: '--calendar-date-btn-open-icon', l: 'Icône ouvert', section: 'Calendrier — bouton date' },
    { v: '--calendar-date-popup-bg', l: 'Fond', section: 'Calendrier — bulle de date' },
    { v: '--calendar-date-popup-border', l: 'Bordure', section: 'Calendrier — bulle de date' },
    { v: '--calendar-date-popup-text', l: 'Texte', section: 'Calendrier — bulle de date' },

    { v: '--calendar-toolbar-bg', l: 'Fond', section: 'Calendrier — barre "Calendrier"' },
    { v: '--calendar-toolbar-border', l: 'Bordure', section: 'Calendrier — barre "Calendrier"' },
    { v: '--calendar-toolbar-title', l: 'Titre "Calendrier"', section: 'Calendrier — barre "Calendrier"' },
    { v: '--calendar-impact-toggle-track-bg', l: 'Fond du curseur', section: 'Calendrier — filtre impact' },
    { v: '--calendar-impact-toggle-track-border', l: 'Bordure du curseur', section: 'Calendrier — filtre impact' },
    { v: '--calendar-impact-toggle-knob-bg', l: 'Rond du curseur', section: 'Calendrier — filtre impact' },
    { v: '--calendar-translate-btn-bg', l: 'Fond', section: 'Calendrier — bouton traduction' },
    { v: '--calendar-translate-btn-border', l: 'Bordure', section: 'Calendrier — bouton traduction' },
    { v: '--calendar-translate-btn-icon', l: 'Icône', section: 'Calendrier — bouton traduction' },
    { v: '--calendar-translate-btn-active-bg', l: 'Fond actif', section: 'Calendrier — bouton traduction' },
    { v: '--calendar-translate-btn-active-border', l: 'Bordure actif', section: 'Calendrier — bouton traduction' },
    { v: '--calendar-translate-btn-active-icon', l: 'Icône actif', section: 'Calendrier — bouton traduction' },

    { v: '--calendar-bg', l: 'Fond', section: 'Calendrier — tableau' },
    { v: '--calendar-border', l: 'Bordure et lignes', section: 'Calendrier — tableau' },
    { v: '--calendar-row-hover-bg', l: 'Fond de la ligne survolée', section: 'Calendrier — tableau' },
    { v: '--calendar-head-bg', l: 'Fond', section: 'Calendrier — en-tête' },
    { v: '--calendar-head-text', l: 'Texte', section: 'Calendrier — en-tête' },
    { v: '--calendar-name-text', l: "Nom de l'événement", section: 'Calendrier — textes' },
    { v: '--calendar-country-text', l: 'Pays des CPI : texte', section: 'Calendrier — pays des CPI nationaux' },
    { v: '--calendar-country-bg', l: 'Pays des CPI : fond', section: 'Calendrier — pays des CPI nationaux' },
    { v: '--calendar-country-border', l: 'Pays des CPI : bordure', section: 'Calendrier — pays des CPI nationaux' },
    { v: '--calendar-value-text', l: 'Valeurs (avant, prévisions)', section: 'Calendrier — textes' },
    { v: '--calendar-actual-up', l: 'En hausse (au-dessus de la prévision)', section: 'Calendrier — valeur sortie' },
    { v: '--calendar-actual-down', l: 'En baisse (sous la prévision)', section: 'Calendrier — valeur sortie' },
    { v: '--calendar-actual-text', l: 'Égale ou non comparable', section: 'Calendrier — valeur sortie' },
    { v: '--calendar-impact-high', l: 'Rouge (impact fort)', section: 'Calendrier — impact' },
    { v: '--calendar-impact-medium', l: 'Orange (impact moyen)', section: 'Calendrier — impact' },

    { v: '--speech-toolbar-bg', l: 'Fond', section: 'Discours — bandeau' },
    { v: '--speech-toolbar-border', l: 'Bordure', section: 'Discours — bandeau' },
    { v: '--speech-toolbar-title', l: 'Titre "Discours"', section: 'Discours — bandeau' },
    { v: '--speech-toolbar-info', l: 'Texte à droite', section: 'Discours — bandeau' },
    { v: '--speech-card-bg', l: 'Fond', section: 'Discours — cases (toutes)' },
    { v: '--speech-card-border', l: 'Bordure', section: 'Discours — cases (toutes)' },
    { v: '--speech-card-first-text', l: 'Prénom', section: 'Discours — cases (toutes)' },
    { v: '--speech-card-last-text', l: 'Nom', section: 'Discours — cases (toutes)' },
    { v: '--speech-card-role-text', l: 'Fonction', section: 'Discours — cases (toutes)' },
    { v: '--speech-silhouette', l: 'Silhouette provisoire', section: 'Discours — cases (toutes)' },
    { v: '--speech-badge-bg', l: 'Fond', section: 'Discours — bandeau des cases (tous)' },
    { v: '--speech-badge-border', l: 'Bordure', section: 'Discours — bandeau des cases (tous)' },
    { v: '--speech-badge-text', l: 'Texte', section: 'Discours — bandeau des cases (tous)' },
    { v: '--speech-star-on', l: 'Étoile allumée', section: 'Discours — bandeau des cases (tous)' },
    { v: '--speech-star-off', l: 'Étoile éteinte', section: 'Discours — bandeau des cases (tous)' },
    { v: '--speech-popup-overlay', l: 'Voile derrière', section: 'Discours — pop-up' },
    { v: '--speech-popup-bg', l: 'Fond', section: 'Discours — pop-up' },
    { v: '--speech-popup-border', l: 'Bordure', section: 'Discours — pop-up' },
    { v: '--speech-popup-title', l: 'Titre (nom)', section: 'Discours — pop-up' },
    { v: '--speech-popup-meta', l: 'Poste et date', section: 'Discours — pop-up' },
    { v: '--speech-popup-text', l: 'Texte', section: 'Discours — pop-up' },
    { v: '--speech-popup-heading', l: 'Sous-titres', section: 'Discours — pop-up' },
    { v: '--speech-popup-close', l: 'Bouton fermer', section: 'Discours — pop-up' },
    { v: '--speech-btn-bg', l: 'Fond', section: 'Discours — boutons (tous)' },
    { v: '--speech-btn-border', l: 'Bordure', section: 'Discours — boutons (tous)' },
    { v: '--speech-btn-text', l: 'Texte', section: 'Discours — boutons (tous)' },
    { v: '--speech-btn-hover-bg', l: 'Fond au survol', section: 'Discours — boutons (tous)' },
    { v: '--speech-btn-hover-border', l: 'Bordure au survol', section: 'Discours — boutons (tous)' },
    { v: '--speech-btn-hover-text', l: 'Texte au survol', section: 'Discours — boutons (tous)' },

    { v: '--rates-none', l: 'Aucun changement', section: 'Attentes de taux — couleurs principales (cases, courbes, légende)' },
    { v: '--rates-up', l: 'Hausse de 25 pb', section: 'Attentes de taux — couleurs principales (cases, courbes, légende)' },
    { v: '--rates-down', l: 'Baisse de 25 pb', section: 'Attentes de taux — couleurs principales (cases, courbes, légende)' },
    { v: '--rates-other', l: 'Autre (50 pb ou plus)', section: 'Attentes de taux — couleurs principales (cases, courbes, légende)' },
    { v: '--rates-toolbar-bg', l: 'Fond', section: 'Attentes de taux — bandeau' },
    { v: '--rates-toolbar-border', l: 'Bordure', section: 'Attentes de taux — bandeau' },
    { v: '--rates-toolbar-title', l: 'Titre', section: 'Attentes de taux — bandeau' },
    { v: '--rates-toolbar-info', l: 'Texte à droite', section: 'Attentes de taux — bandeau' },
    { v: '--rates-empty-text', l: 'Messages (chargement, pas de marché)', section: 'Attentes de taux — bandeau' },
    { v: '--rates-kpi-bg', l: 'Fond', section: 'Attentes de taux — cases KPI' },
    { v: '--rates-kpi-border', l: 'Bordure', section: 'Attentes de taux — cases KPI' },
    { v: '--rates-kpi-label', l: 'Intitulé', section: 'Attentes de taux — cases KPI' },
    { v: '--rates-kpi-value', l: 'Pourcentage', section: 'Attentes de taux — cases KPI' },
    { v: '--rates-kpi-sub', l: 'Petit texte (variation sur 24 h)', section: 'Attentes de taux — cases KPI' },
    { v: '--rates-kpi-bar-none', l: 'Aucun changement', section: 'Attentes de taux — barre colorée des cases KPI' },
    { v: '--rates-kpi-bar-up', l: 'Hausse de 25 pb', section: 'Attentes de taux — barre colorée des cases KPI' },
    { v: '--rates-kpi-bar-down', l: 'Baisse de 25 pb', section: 'Attentes de taux — barre colorée des cases KPI' },
    { v: '--rates-kpi-bar-other', l: 'Autre (50 pb ou plus)', section: 'Attentes de taux — barre colorée des cases KPI' },
    { v: '--rates-line-none', l: 'Aucun changement', section: 'Attentes de taux — courbes' },
    { v: '--rates-line-up', l: 'Hausse de 25 pb', section: 'Attentes de taux — courbes' },
    { v: '--rates-line-down', l: 'Baisse de 25 pb', section: 'Attentes de taux — courbes' },
    { v: '--rates-line-other', l: 'Autre (50 pb ou plus)', section: 'Attentes de taux — courbes' },
    { v: '--rates-card-bg', l: 'Fond', section: 'Attentes de taux — graphique' },
    { v: '--rates-card-border', l: 'Bordure', section: 'Attentes de taux — graphique' },
    { v: '--rates-chart-title', l: 'Titre du marché', section: 'Attentes de taux — graphique' },
    { v: '--rates-chart-sub', l: 'Sous-titre (échéance, volume)', section: 'Attentes de taux — graphique' },
    { v: '--rates-link', l: 'Lien « Voir sur Polymarket »', section: 'Attentes de taux — graphique' },
    { v: '--rates-grid', l: 'Quadrillage', section: 'Attentes de taux — graphique' },
    { v: '--rates-axis', l: 'Textes des axes', section: 'Attentes de taux — graphique' },
    { v: '--rates-cursor', l: 'Trait pointillé au survol', section: 'Attentes de taux — graphique' },
    { v: '--rates-legend-text', l: 'Légende', section: 'Attentes de taux — graphique' },
    { v: '--rates-tooltip-bg', l: 'Fond', section: 'Attentes de taux — infobulle' },
    { v: '--rates-tooltip-border', l: 'Bordure', section: 'Attentes de taux — infobulle' },
    { v: '--rates-tooltip-text', l: 'Texte', section: 'Attentes de taux — infobulle' },
    { v: '--rates-tooltip-date', l: 'Date et heure', section: 'Attentes de taux — infobulle' },

    { v: '--cot-inst-long', l: 'Institutionnels : Long', section: 'COT — camembert' },
    { v: '--cot-inst-short', l: 'Institutionnels : Short', section: 'COT — camembert' },
    { v: '--cot-slice-border', l: 'Séparation entre les parts', section: 'COT — camembert' },
    { v: '--cot-slice-label', l: 'Pourcentage dans les parts', section: 'COT — camembert' },
    { v: '--cot-toolbar-bg', l: 'Fond', section: 'COT — bandeau' },
    { v: '--cot-toolbar-border', l: 'Bordure', section: 'COT — bandeau' },
    { v: '--cot-toolbar-title', l: 'Titre', section: 'COT — bandeau' },
    { v: '--cot-toolbar-info', l: 'Texte à droite (dates)', section: 'COT — bandeau' },
    { v: '--cot-empty-text', l: 'Messages (chargement, pas de données)', section: 'COT — bandeau' },
    { v: '--cot-card-bg', l: 'Fond', section: 'COT — cartes et précisions' },
    { v: '--cot-card-border', l: 'Bordure', section: 'COT — cartes et précisions' },
    { v: '--cot-title', l: 'Titre', section: 'COT — cartes et précisions' },
    { v: '--cot-subtitle', l: 'Sous-titre', section: 'COT — cartes et précisions' },
    { v: '--cot-text', l: 'Intitulés (Long, Short, Position nette…)', section: 'COT — cartes et précisions' },
    { v: '--cot-value', l: 'Valeurs en gras et biais', section: 'COT — cartes et précisions' },
    { v: '--cot-dim', l: 'Texte secondaire (chiffres)', section: 'COT — cartes et précisions' },
    { v: '--cot-sep', l: 'Traits de séparation', section: 'COT — cartes et précisions' },
    { v: '--cot-delta-up', l: 'Variation haussière pour la devise (plus de Long / Net, moins de Short)', section: 'COT — variations sur la semaine' },
    { v: '--cot-delta-down', l: 'Variation baissière pour la devise (moins de Long / Net, plus de Short)', section: 'COT — variations sur la semaine' },

    { v: '--intra-retail-long', l: 'Retail : Long (acheteurs)', section: 'Retail intraday — camemberts' },
    { v: '--intra-retail-short', l: 'Retail : Short (vendeurs)', section: 'Retail intraday — camemberts' },
    { v: '--intra-contra-long', l: 'Contrarien : lecture haussière', section: 'Retail intraday — camemberts' },
    { v: '--intra-contra-short', l: 'Contrarien : lecture baissière', section: 'Retail intraday — camemberts' },
    { v: '--intra-slice-border', l: 'Séparation entre les parts', section: 'Retail intraday — camemberts' },
    { v: '--intra-slice-label', l: 'Pourcentage dans les parts', section: 'Retail intraday — camemberts' },
    { v: '--intra-toolbar-bg', l: 'Fond', section: 'Retail intraday — bandeau' },
    { v: '--intra-toolbar-border', l: 'Bordure', section: 'Retail intraday — bandeau' },
    { v: '--intra-toolbar-title', l: 'Titre', section: 'Retail intraday — bandeau' },
    { v: '--intra-toolbar-info', l: 'Texte à droite (sources, heure)', section: 'Retail intraday — bandeau' },
    { v: '--intra-empty-text', l: 'Messages (chargement, pas de source)', section: 'Retail intraday — bandeau' },
    { v: '--intra-card-bg', l: 'Fond', section: 'Retail intraday — cartes et précisions' },
    { v: '--intra-card-border', l: 'Bordure', section: 'Retail intraday — cartes et précisions' },
    { v: '--intra-title', l: 'Titre', section: 'Retail intraday — cartes et précisions' },
    { v: '--intra-subtitle', l: 'Sous-titre', section: 'Retail intraday — cartes et précisions' },
    { v: '--intra-text', l: 'Intitulés', section: 'Retail intraday — cartes et précisions' },
    { v: '--intra-value', l: 'Valeurs en gras et biais', section: 'Retail intraday — cartes et précisions' },
    { v: '--intra-dim', l: 'Texte secondaire', section: 'Retail intraday — cartes et précisions' },
    { v: '--intra-sep', l: 'Traits de séparation', section: 'Retail intraday — cartes et précisions' },
    { v: '--intra-link', l: 'Lien « Voir les paires »', section: 'Retail intraday — cartes et précisions' },
  ],
  evenements: [],
  fondamentale: [
    { v: '--fund-toolbar-bg', l: 'Fond', category: 'Page', section: 'Bandeau « Analyse fondamentale »' },
    { v: '--fund-toolbar-border', l: 'Bordure', category: 'Page', section: 'Bandeau « Analyse fondamentale »' },
    { v: '--fund-toolbar-title', l: 'Titre', category: 'Page', section: 'Bandeau « Analyse fondamentale »' },

    { v: '--fund-primary-bg', l: 'Fond', category: 'Page', section: 'Bouton « + Groupe »' },
    { v: '--fund-primary-border', l: 'Bordure', category: 'Page', section: 'Bouton « + Groupe »' },
    { v: '--fund-primary-text', l: 'Texte', category: 'Page', section: 'Bouton « + Groupe »' },
    { v: '--fund-primary-hover-bg', l: 'Fond au survol', category: 'Page', section: 'Bouton « + Groupe »' },

    { v: '--fund-empty-text', l: 'Messages « Aucun onglet... »', category: 'Page', section: 'Textes' },
    { v: '--fund-error-text', l: "Messages d'erreur", category: 'Page', section: 'Textes' },

    { v: '--fund-group-bg', l: 'Fond', category: 'Groupes', section: 'Ligne du groupe' },
    { v: '--fund-group-border', l: 'Bordure', category: 'Groupes', section: 'Ligne du groupe' },
    { v: '--fund-group-text', l: 'Nom', category: 'Groupes', section: 'Ligne du groupe' },
    { v: '--fund-group-hover-bg', l: 'Fond au survol', category: 'Groupes', section: 'Ligne du groupe' },

    { v: '--fund-tab-bg', l: 'Fond', category: 'Onglets', section: "Ligne de l'onglet" },
    { v: '--fund-tab-border', l: 'Bordure', category: 'Onglets', section: "Ligne de l'onglet" },
    { v: '--fund-tab-text', l: 'Nom', category: 'Onglets', section: "Ligne de l'onglet" },
    { v: '--fund-tab-hover-bg', l: 'Fond au survol', category: 'Onglets', section: "Ligne de l'onglet" },

    { v: '--fund-chevron', l: 'Flèche à gauche', category: 'Onglets', section: 'Flèche' },

    { v: '--fund-text-bg', l: 'Fond', category: 'Onglets', section: 'Zone de texte' },
    { v: '--fund-text-border', l: 'Bordure', category: 'Onglets', section: 'Zone de texte' },
    { v: '--fund-text-color', l: 'Texte', category: 'Onglets', section: 'Zone de texte' },
    { v: '--fund-text-placeholder', l: "Texte d'invite (« Écrire du texte... »)", category: 'Onglets', section: 'Zone de texte' },
    { v: '--fund-text-focus-border', l: 'Bordure pendant la saisie', category: 'Onglets', section: 'Zone de texte' },

    { v: '--fund-ctx-bg', l: 'Fond', category: 'Menu clic droit', section: 'Menu (clic droit sur un groupe ou un onglet)' },
    { v: '--fund-ctx-border', l: 'Bordure', category: 'Menu clic droit', section: 'Menu (clic droit sur un groupe ou un onglet)' },
    { v: '--fund-ctx-text', l: 'Texte', category: 'Menu clic droit', section: 'Menu (clic droit sur un groupe ou un onglet)' },
    { v: '--fund-ctx-hover-bg', l: 'Fond au survol', category: 'Menu clic droit', section: 'Menu (clic droit sur un groupe ou un onglet)' },
    { v: '--fund-ctx-hover-text', l: 'Texte au survol', category: 'Menu clic droit', section: 'Menu (clic droit sur un groupe ou un onglet)' },
    { v: '--fund-ctx-danger-text', l: 'Texte « Supprimer »', category: 'Menu clic droit', section: 'Menu (clic droit sur un groupe ou un onglet)' },
    { v: '--fund-ctx-sep', l: 'Traits de séparation', category: 'Menu clic droit', section: 'Menu (clic droit sur un groupe ou un onglet)' },
    { v: '--fund-mic-text', l: 'Icône', category: 'Dictée vocale', section: 'Micro (dans les zones de texte)' },
    { v: '--fund-mic-hover-text', l: 'Icône au survol', category: 'Dictée vocale', section: 'Micro (dans les zones de texte)' },
    { v: '--fund-mic-active', l: 'Icône pendant la dictée', category: 'Dictée vocale', section: 'Micro (dans les zones de texte)' },
    { v: '--fund-drop-line', l: 'Repère de dépôt (trait et contour)', category: 'Glisser-déposer', section: 'Déplacement à la souris' },


    { v: '--fund-dialog-overlay', l: 'Voile derrière', category: 'Fenêtre de saisie', section: 'Fenêtre' },
    { v: '--fund-dialog-bg', l: 'Fond', category: 'Fenêtre de saisie', section: 'Fenêtre' },
    { v: '--fund-dialog-border', l: 'Bordure', category: 'Fenêtre de saisie', section: 'Fenêtre' },
    { v: '--fund-dialog-title', l: 'Titre', category: 'Fenêtre de saisie', section: 'Fenêtre' },
    { v: '--fund-dialog-text', l: 'Texte', category: 'Fenêtre de saisie', section: 'Fenêtre' },

    { v: '--fund-input-bg', l: 'Fond', category: 'Fenêtre de saisie', section: 'Champ du nom' },
    { v: '--fund-input-border', l: 'Bordure', category: 'Fenêtre de saisie', section: 'Champ du nom' },
    { v: '--fund-input-text', l: 'Texte', category: 'Fenêtre de saisie', section: 'Champ du nom' },

    { v: '--fund-ok-bg', l: 'Valider : fond', category: 'Fenêtre de saisie', section: 'Boutons' },
    { v: '--fund-ok-border', l: 'Valider : bordure', category: 'Fenêtre de saisie', section: 'Boutons' },
    { v: '--fund-ok-text', l: 'Valider : texte', category: 'Fenêtre de saisie', section: 'Boutons' },
    { v: '--fund-cancel-border', l: 'Annuler : bordure', category: 'Fenêtre de saisie', section: 'Boutons' },
    { v: '--fund-cancel-text', l: 'Annuler : texte', category: 'Fenêtre de saisie', section: 'Boutons' },
    { v: '--fund-danger-bg', l: 'Supprimer : fond', category: 'Fenêtre de saisie', section: 'Boutons' },
    { v: '--fund-danger-border', l: 'Supprimer : bordure', category: 'Fenêtre de saisie', section: 'Boutons' },
    { v: '--fund-danger-text', l: 'Supprimer : texte', category: 'Fenêtre de saisie', section: 'Boutons' },
  ],
  parametres: [
    { v: '--settings-row-bg', l: 'Fond', category: 'Thème', section: 'Bandeau' },
    { v: '--settings-row-border', l: 'Bordure', category: 'Thème', section: 'Bandeau' },
    { v: '--settings-row-text', l: 'Texte', category: 'Thème', section: 'Bandeau' },

    { v: '--settings-btn-bg', l: 'Fond', category: 'Thème', section: 'Bouton' },
    { v: '--settings-btn-border', l: 'Bordure', category: 'Thème', section: 'Bouton' },
    { v: '--settings-btn-text', l: 'Texte', category: 'Thème', section: 'Bouton' },

    { v: '--theme-panel-bg', l: 'Fond', category: 'Thème', section: 'Carte englobante' },
    { v: '--theme-panel-border', l: 'Bordure', category: 'Thème', section: 'Carte englobante' },

    { v: '--accordion-content-bg', l: 'Fond', category: 'Menu déplié', section: 'Contenu (ex. Connexion)' },
    { v: '--accordion-content-title-color', l: 'Titre', category: 'Menu déplié', section: 'Contenu (ex. Connexion)' },
    { v: '--accordion-content-text', l: 'Texte', category: 'Menu déplié', section: 'Contenu (ex. Connexion)' },
    { v: '--accordion-content-border', l: 'Bordure du panneau', category: 'Menu déplié', section: 'Contenu (ex. Connexion)' },
    { v: '--accordion-swatch-border', l: 'Bordure des carrés de couleur', category: 'Menu déplié', section: 'Contenu (ex. Connexion)' },
    { v: '--theme-accordion-bg', l: 'Fond de la section', category: 'Menu déplié', section: 'Boîte (Connexion, Analyse...)' },
    { v: '--theme-accordion-border', l: 'Bordure de la section', category: 'Menu déplié', section: 'Boîte (Connexion, Analyse...)' },
    { v: '--theme-accordion-row-hover-bg', l: 'Fond au survol du titre', category: 'Menu déplié', section: 'Boîte (Connexion, Analyse...)' },
    { v: '--theme-field-row-hover-bg', l: 'Fond au survol d\'une ligne', category: 'Menu déplié', section: 'Boîte (Connexion, Analyse...)' },

    { v: '--cp-modal-bg', l: 'Fond', category: 'Sélecteur de couleur', section: 'Fenêtre' },
    { v: '--cp-modal-border', l: 'Bordure', category: 'Sélecteur de couleur', section: 'Fenêtre' },
    { v: '--cp-modal-text', l: 'Titre', category: 'Sélecteur de couleur', section: 'Fenêtre' },
    { v: '--cp-overlay-color', l: 'Couleur du fond assombri', category: 'Sélecteur de couleur', section: 'Fenêtre' },
    { v: '--cp-overlay-alpha', l: 'Opacité', type: 'alpha', category: 'Sélecteur de couleur', section: 'Fenêtre' },
    { v: '--cp-overlay-blur', l: 'Niveau de flou', type: 'range', maxPx: 24, category: 'Sélecteur de couleur', section: 'Fenêtre' },
    { v: '--cp-cursor-border', l: 'Curseur sur la roue', category: 'Sélecteur de couleur', section: 'Fenêtre' },
    { v: '--cp-hue-thumb-bg', l: 'Curseur du curseur de teinte', category: 'Sélecteur de couleur', section: 'Fenêtre' },
    { v: '--cp-hue-label-color', l: 'Libellé "Teinte"', category: 'Sélecteur de couleur', section: 'Champ hexadécimal' },
    { v: '--cp-hex-bg', l: 'Fond', category: 'Sélecteur de couleur', section: 'Champ hexadécimal' },
    { v: '--cp-hex-border', l: 'Bordure', category: 'Sélecteur de couleur', section: 'Champ hexadécimal' },
    { v: '--cp-hex-text', l: 'Texte', category: 'Sélecteur de couleur', section: 'Champ hexadécimal' },
    { v: '--cp-mem-label-color', l: 'Libellé "Récentes"', category: 'Sélecteur de couleur', section: 'Couleurs récentes' },
    { v: '--cp-swatch-border', l: 'Bordure des carrés', category: 'Sélecteur de couleur', section: 'Couleurs récentes' },
    { v: '--cp-btn-ghost-bg', l: 'Fond', category: 'Sélecteur de couleur', section: 'Bouton "Annuler"' },
    { v: '--cp-btn-ghost-border', l: 'Bordure', category: 'Sélecteur de couleur', section: 'Bouton "Annuler"' },
    { v: '--cp-btn-ghost-text', l: 'Texte', category: 'Sélecteur de couleur', section: 'Bouton "Annuler"' },
    { v: '--cp-btn-primary-bg', l: 'Fond', category: 'Sélecteur de couleur', section: 'Bouton "Appliquer" (picker)' },
    { v: '--cp-btn-primary-border', l: 'Bordure', category: 'Sélecteur de couleur', section: 'Bouton "Appliquer" (picker)' },
    { v: '--cp-btn-primary-text', l: 'Texte', category: 'Sélecteur de couleur', section: 'Bouton "Appliquer" (picker)' },

    { v: '--btn-collapse-bg', l: 'Fond', category: 'Boutons du bas', section: 'Replier les couleurs' },
    { v: '--btn-collapse-border', l: 'Bordure', category: 'Boutons du bas', section: 'Replier les couleurs' },
    { v: '--btn-collapse-text', l: 'Texte', category: 'Boutons du bas', section: 'Replier les couleurs' },

    { v: '--btn-reset-bg', l: 'Fond', category: 'Boutons du bas', section: 'Réinitialiser' },
    { v: '--btn-reset-border', l: 'Bordure', category: 'Boutons du bas', section: 'Réinitialiser' },
    { v: '--btn-reset-text', l: 'Texte', category: 'Boutons du bas', section: 'Réinitialiser' },

    { v: '--btn-apply-bg', l: 'Fond', category: 'Boutons du bas', section: 'Appliquer' },
    { v: '--btn-apply-border', l: 'Bordure', category: 'Boutons du bas', section: 'Appliquer' },
    { v: '--btn-apply-text', l: 'Texte', category: 'Boutons du bas', section: 'Appliquer' },

    { v: '--save-spinner-track', l: 'Anneau', category: 'Chargement', section: 'Rond de sauvegarde' },
    { v: '--save-spinner-active', l: 'Partie active', category: 'Chargement', section: 'Rond de sauvegarde' },
  ],
  general: [
    { v: '--nav-bg', l: 'Fond', category: 'Barre de navigation', section: 'Fond & bordure' },
    { v: '--nav-border', l: 'Bordure (en dessous)', category: 'Barre de navigation', section: 'Fond & bordure' },
    { v: '--clock-time-color', l: "Texte de l'heure", category: 'Barre de navigation', section: 'Horloges' },
    { v: '--clock-city-color', l: 'Texte au-dessus (villes)', category: 'Barre de navigation', section: 'Horloges' },
    { v: '--session-bg', l: 'Fond', category: 'Barre de navigation', section: 'Case des sessions' },
    { v: '--session-text-color', l: 'Texte', category: 'Barre de navigation', section: 'Case des sessions' },
    { v: '--session-border', l: 'Bordure', category: 'Barre de navigation', section: 'Case des sessions' },
    { v: '--burger-bg', l: 'Fond', category: 'Barre de navigation', section: 'Menu burger (bouton)' },
    { v: '--burger-border', l: 'Bordure', category: 'Barre de navigation', section: 'Menu burger (bouton)' },
    { v: '--burger-bars-color', l: 'Les 3 traits', category: 'Barre de navigation', section: 'Menu burger (bouton)' },

    { v: '--menu-overlay-color', l: 'Couleur du fond', category: 'Menu burger déplié', section: 'Fond' },
    { v: '--menu-overlay-alpha', l: 'Opacité', type: 'alpha', category: 'Menu burger déplié', section: 'Fond' },
    { v: '--menu-overlay-blur', l: 'Niveau de flou', type: 'range', maxPx: 24, category: 'Menu burger déplié', section: 'Fond' },
    { v: '--menu-close-bg', l: 'Fond', category: 'Menu burger déplié', section: 'Bouton "Fermer"' },
    { v: '--menu-close-border', l: 'Bordure', category: 'Menu burger déplié', section: 'Bouton "Fermer"' },
    { v: '--menu-close-text', l: 'Texte', category: 'Menu burger déplié', section: 'Bouton "Fermer"' },
    { v: '--menu-tab-nouveau-border', l: 'Bordure', category: 'Menu burger déplié', section: 'Onglet Nouveau' },
    { v: '--menu-tab-nouveau-text', l: 'Texte', category: 'Menu burger déplié', section: 'Onglet Nouveau' },
    { v: '--menu-tab-nouveau-hover-text', l: 'Texte au survol', category: 'Menu burger déplié', section: 'Onglet Nouveau' },
    { v: '--menu-tab-analyse-border', l: 'Bordure', category: 'Menu burger déplié', section: 'Onglet Analyse' },
    { v: '--menu-tab-analyse-text', l: 'Texte', category: 'Menu burger déplié', section: 'Onglet Analyse' },
    { v: '--menu-tab-analyse-hover-text', l: 'Texte au survol', category: 'Menu burger déplié', section: 'Onglet Analyse' },
    { v: '--menu-tab-evenements-border', l: 'Bordure', category: 'Menu burger déplié', section: 'Onglet Événements' },
    { v: '--menu-tab-evenements-text', l: 'Texte', category: 'Menu burger déplié', section: 'Onglet Événements' },
    { v: '--menu-tab-evenements-hover-text', l: 'Texte au survol', category: 'Menu burger déplié', section: 'Onglet Événements' },
    { v: '--menu-tab-fondamentale-border', l: 'Bordure', category: 'Menu burger déplié', section: 'Onglet Analyse fondamentale' },
    { v: '--menu-tab-fondamentale-text', l: 'Texte', category: 'Menu burger déplié', section: 'Onglet Analyse fondamentale' },
    { v: '--menu-tab-fondamentale-hover-text', l: 'Texte au survol', category: 'Menu burger déplié', section: 'Onglet Analyse fondamentale' },
    { v: '--menu-tab-parametres-border', l: 'Bordure', category: 'Menu burger déplié', section: 'Onglet Paramètres' },
    { v: '--menu-tab-parametres-text', l: 'Texte', category: 'Menu burger déplié', section: 'Onglet Paramètres' },
    { v: '--menu-tab-parametres-hover-text', l: 'Texte au survol', category: 'Menu burger déplié', section: 'Onglet Paramètres' },
    { v: '--menu-tab-deconnexion-border', l: 'Bordure', category: 'Menu burger déplié', section: 'Onglet Déconnexion' },
    { v: '--menu-tab-deconnexion-text', l: 'Texte', category: 'Menu burger déplié', section: 'Onglet Déconnexion' },
    { v: '--menu-tab-deconnexion-hover-text', l: 'Texte au survol', category: 'Menu burger déplié', section: 'Onglet Déconnexion' },
    { v: '--menu-tab-deconnexion-icon', l: 'Icône', category: 'Menu burger déplié', section: 'Onglet Déconnexion' },

    { v: '--bg', l: "Fond général de l'appli", category: 'Palette de base', section: '' },
    { v: '--bg-card', l: 'Fond des cartes', category: 'Palette de base', section: '' },
    { v: '--text', l: 'Texte principal', category: 'Palette de base', section: '' },
    { v: '--text-dim', l: 'Texte secondaire', category: 'Palette de base', section: '' },
    { v: '--border', l: 'Bordures claires', category: 'Palette de base', section: '' },
    { v: '--border-dim', l: 'Bordures discrètes', category: 'Palette de base', section: '' },
    { v: '--blue', l: 'Bleu', category: 'Palette de base', section: '' },
    { v: '--blue-light', l: 'Bleu clair', category: 'Palette de base', section: '' },
    { v: '--red', l: 'Rouge', category: 'Palette de base', section: '' },
    { v: '--red-light', l: 'Rouge clair', category: 'Palette de base', section: '' },
    { v: '--gray', l: 'Gris', category: 'Palette de base', section: '' },
  ],
};

/* =========================================================
   2. État des couleurs personnalisées (chargé depuis localStorage)
   ========================================================= */
let themeVars = {};

function loadThemeVars() {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    themeVars = raw ? JSON.parse(raw) : {};
  } catch (e) {
    themeVars = {};
  }
}

function saveThemeVars() {
  showSaveSpinner();
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(themeVars));
  } catch (e) {
    console.error('Impossible de sauvegarder les couleurs en local :', e);
  }
  // La sauvegarde locale est instantanée ; on garde le rond visible un
  // court instant pour qu'il soit perceptible (utile aussi le jour où
  // ce sera une vraie sauvegarde cloud, potentiellement plus longue).
  window.setTimeout(hideSaveSpinner, 500);
}

let saveSpinnerTimeout = null;

function showSaveSpinner() {
  const el = document.getElementById('saveSpinner');
  if (!el) return;
  if (saveSpinnerTimeout) {
    window.clearTimeout(saveSpinnerTimeout);
    saveSpinnerTimeout = null;
  }
  el.classList.add('is-visible');
}

function hideSaveSpinner() {
  const el = document.getElementById('saveSpinner');
  if (el) el.classList.remove('is-visible');
}

// Champs "fond + opacité" : la valeur réellement appliquée en CSS
// (target) est recalculée à partir d'une couleur (hex) et d'une
// opacité (0-100) stockées séparément.
const RGBA_COMBOS = [
  { target: '--menu-overlay-bg', color: '--menu-overlay-color', alpha: '--menu-overlay-alpha' },
  { target: '--cp-overlay-bg', color: '--cp-overlay-color', alpha: '--cp-overlay-alpha' },
];

function hexToRgbArr(value) {
  if (!value) return [0, 0, 0];
  const rgbaMatch = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbaMatch) {
    return [parseInt(rgbaMatch[1], 10), parseInt(rgbaMatch[2], 10), parseInt(rgbaMatch[3], 10)];
  }
  const hex = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }
  return [0, 0, 0];
}

function recomputeRgbaCombos() {
  for (const combo of RGBA_COMBOS) {
    const [r, g, b] = hexToRgbArr(currentValueFor(combo.color));
    const alphaPct = parseFloat(currentValueFor(combo.alpha)) || 0;
    const rgba = `rgba(${r}, ${g}, ${b}, ${alphaPct / 100})`;
    themeVars[combo.target] = rgba;
    document.documentElement.style.setProperty(combo.target, rgba);
  }
}

function previewThemeVars() {
  Object.entries(themeVars).forEach(([v, c]) => {
    document.documentElement.style.setProperty(v, c);
  });
  recomputeRgbaCombos();
}

/* =========================================================
   3. Conversions couleur (hex <-> hsl), identiques à TJP
   ========================================================= */
function hsl2hex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}

function hex2hsl(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  let h, s;
  const l = (mx + mn) / 2;
  if (mx === mn) {
    h = s = 0;
  } else {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    switch (mx) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h * 360, s, l];
}

/* =========================================================
   4. Moteur du sélecteur de couleur (canvas + curseur + teinte)
   ========================================================= */
let cpCB = null;
let cpH = 0, cpS = 1, cpL = 0.5, cpCX = 1, cpCY = 0, cpDrag = false;
const cpMem = (() => {
  try {
    return JSON.parse(localStorage.getItem('fx_cp_mem') || '[]');
  } catch (e) {
    return [];
  }
})();

function drawSpec() {
  const c = document.getElementById('cpCanvas');
  const w = document.getElementById('cpWrap');
  if (!c || !w) return;
  c.width = w.offsetWidth || 300;
  c.height = 144;
  const ctx = c.getContext('2d');
  const gW = ctx.createLinearGradient(0, 0, c.width, 0);
  gW.addColorStop(0, '#fff');
  gW.addColorStop(1, `hsl(${cpH},100%,50%)`);
  ctx.fillStyle = gW;
  ctx.fillRect(0, 0, c.width, c.height);
  const gB = ctx.createLinearGradient(0, 0, 0, c.height);
  gB.addColorStop(0, 'rgba(0,0,0,0)');
  gB.addColorStop(1, '#000');
  ctx.fillStyle = gB;
  ctx.fillRect(0, 0, c.width, c.height);
}

function upCur() {
  const c = document.getElementById('cpCursor');
  if (!c) return;
  c.style.left = cpCX * 100 + '%';
  c.style.top = cpCY * 100 + '%';
}

function upPrev() {
  const hex = hsl2hex(cpH, cpS, cpL);
  const sw = document.getElementById('cpSwatch');
  const hexInput = document.getElementById('cpHex');
  if (sw) sw.style.background = hex;
  if (hexInput) hexInput.value = hex;
}

function pickXY(x, y) {
  const wrap = document.getElementById('cpWrap');
  if (!wrap) return;
  const r = wrap.getBoundingClientRect();
  cpCX = Math.max(0, Math.min(1, (x - r.left) / r.width));
  cpCY = Math.max(0, Math.min(1, (y - r.top) / r.height));
  cpS = cpCX;
  cpL = Math.max(0.02, Math.min(0.98, 1 - cpCY * 0.97));
  upCur();
  upPrev();
}

function renderMemSwatches() {
  const mem = document.getElementById('cpMem');
  if (!mem) return;
  mem.innerHTML = [...cpMem]
    .reverse()
    .map((c) => `<div class="cp-ms" style="background:${c};border-color:${c}" data-hex="${c}" title="${c}"></div>`)
    .join('');
  mem.querySelectorAll('.cp-ms').forEach((el) => {
    el.addEventListener('click', () => cpSelectHex(el.dataset.hex));
  });
}

function cpSelectHex(hex) {
  try {
    const [h, s, l] = hex2hsl(hex);
    cpH = h; cpS = s; cpL = l; cpCX = s; cpCY = 1 - l;
    const hue = document.getElementById('cpHue');
    if (hue) hue.value = h;
  } catch (e) {}
  drawSpec();
  upCur();
  upPrev();
}

function openColorPicker(label, curHex, callback) {
  cpCB = callback;
  const title = document.getElementById('cpTitle');
  if (title) title.textContent = label || 'Couleur';
  try {
    if (curHex && curHex.trim().startsWith('#')) {
      const [h, s, l] = hex2hsl(curHex.trim());
      cpH = h; cpS = s; cpL = l; cpCX = s; cpCY = 1 - l;
      const hue = document.getElementById('cpHue');
      if (hue) hue.value = h;
    }
  } catch (e) {}
  const overlay = document.getElementById('cpOverlay');
  if (overlay) overlay.classList.add('is-open');
  requestAnimationFrame(() => {
    drawSpec();
    upCur();
    upPrev();
  });
  renderMemSwatches();
}

function closeColorPicker() {
  const overlay = document.getElementById('cpOverlay');
  if (overlay) overlay.classList.remove('is-open');
}

function confirmColorPicker() {
  const hexInput = document.getElementById('cpHex');
  const raw = hexInput ? hexInput.value : '';
  const hex = /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : hsl2hex(cpH, cpS, cpL);
  if (!cpMem.includes(hex)) {
    cpMem.push(hex);
    if (cpMem.length > 22) cpMem.shift();
    try { localStorage.setItem('fx_cp_mem', JSON.stringify(cpMem)); } catch (e) {}
  }
  if (cpCB) cpCB(hex);
  // Valider une couleur ici a le même effet que cliquer sur "Appliquer"
  // tout en bas : aperçu + sauvegarde immédiats, pas besoin d'un second clic.
  applyThemeVars();
  closeColorPicker();
}

function initColorPickerEngine() {
  const wrap = document.getElementById('cpWrap');
  const hue = document.getElementById('cpHue');
  const hexInput = document.getElementById('cpHex');
  const cancelBtn = document.getElementById('cpCancelBtn');
  const confirmBtn = document.getElementById('cpConfirmBtn');
  if (!wrap || !hue || !hexInput) return;

  wrap.addEventListener('mousedown', (e) => {
    cpDrag = true;
    pickXY(e.clientX, e.clientY);
    e.preventDefault();
  });
  wrap.addEventListener('touchstart', (e) => {
    cpDrag = true;
    pickXY(e.touches[0].clientX, e.touches[0].clientY);
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('mousemove', (e) => { if (cpDrag) pickXY(e.clientX, e.clientY); });
  document.addEventListener('touchmove', (e) => { if (cpDrag) pickXY(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
  document.addEventListener('mouseup', () => { cpDrag = false; });
  document.addEventListener('touchend', () => { cpDrag = false; });

  hue.addEventListener('input', function () {
    cpH = parseFloat(this.value);
    drawSpec();
    upPrev();
  });

  hexInput.addEventListener('input', function () {
    if (/^#[0-9a-f]{6}$/i.test(this.value)) {
      try {
        const [h, s, l] = hex2hsl(this.value);
        cpH = h; cpS = s; cpL = l; cpCX = s; cpCY = 1 - l;
        hue.value = h;
        drawSpec();
        upCur();
      } catch (e) {}
      const sw = document.getElementById('cpSwatch');
      if (sw) sw.style.background = this.value;
    }
  });

  if (cancelBtn) cancelBtn.addEventListener('click', closeColorPicker);
  if (confirmBtn) confirmBtn.addEventListener('click', confirmColorPicker);
}

/* =========================================================
   5. Construction des lignes de champs par section
   ========================================================= */
function pxToPercent(value, maxPx) {
  const px = parseFloat(value) || 0;
  const pct = Math.round((px / maxPx) * 100);
  return Math.max(0, Math.min(100, pct));
}

function percentToPx(percent, maxPx) {
  const pct = Math.max(0, Math.min(100, parseFloat(percent) || 0));
  return `${(pct / 100) * maxPx}px`;
}

function currentValueFor(varName) {
  if (themeVars[varName]) return themeVars[varName];
  const computed = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return computed || '#000000';
}

function renderThemeFields(sectionKey) {
  const container = document.getElementById(`themeFields-${sectionKey}`);
  const fields = THEME_FIELDS[sectionKey] || [];
  if (!container) return;

  if (!fields.length) {
    container.innerHTML = '<p class="theme-field-empty">Rien à personnaliser ici pour le moment.</p>';
    return;
  }

  // Regroupement à 2 niveaux : catégorie (ex. "Thème") puis sous-section
  // (ex. "Bandeau", "Bouton"). Les champs sans "category" tombent dans
  // une catégorie implicite unique (pas de titre de catégorie affiché).
  const categories = [];
  for (const f of fields) {
    const catKey = f.category || '';
    let cat = categories.find((c) => c.title === catKey);
    if (!cat) {
      cat = { title: catKey, groups: [] };
      categories.push(cat);
    }
    let group = cat.groups.find((g) => g.title === f.section);
    if (!group) {
      group = { title: f.section, items: [] };
      cat.groups.push(group);
    }
    group.items.push(f);
  }

  // IMPORTANT : les titres de catégorie et les groupes sont des éléments
  // directs de la grille (pas imbriqués dans un conteneur par catégorie),
  // pour que la grille à 2 colonnes — et la ligne de séparation verticale —
  // reste continue sur tout le menu déplié, sans se couper à chaque
  // catégorie. Chaque titre de catégorie force un retour à la ligne
  // (grid-column: 1 / -1), donc les groupes qui suivent redémarrent
  // proprement en colonne 1.
  let html = '';
  for (const cat of categories) {
    if (cat.title) {
      html += `<p class="theme-field-category-title">${cat.title}</p>`;
    }
    cat.groups.forEach((group, i) => {
      const rows = group.items
        .map((f) => {
          if (f.type === 'range') {
            const percent = pxToPercent(currentValueFor(f.v), f.maxPx);
            return `<div class="theme-field-row">
              <span class="theme-field-label">${f.l}</span>
              <span style="display:flex;align-items:center;gap:8px;">
                <input type="range" class="theme-field-range" min="0" max="100" value="${percent}" data-var="${f.v}" data-field-type="range" data-max-px="${f.maxPx}">
                <span class="theme-field-range-value">${percent}%</span>
              </span>
            </div>`;
          }
          if (f.type === 'alpha') {
            const percent = Math.max(0, Math.min(100, Math.round(parseFloat(currentValueFor(f.v)) || 0)));
            return `<div class="theme-field-row">
              <span class="theme-field-label">${f.l}</span>
              <span style="display:flex;align-items:center;gap:8px;">
                <input type="range" class="theme-field-range" min="0" max="100" value="${percent}" data-var="${f.v}" data-field-type="alpha">
                <span class="theme-field-range-value">${percent}%</span>
              </span>
            </div>`;
          }
          const hex = currentValueFor(f.v);
          return `<div class="theme-field-row">
            <span class="theme-field-label">${f.l}</span>
            <button type="button" class="theme-field-swatch" style="background:${hex}" data-var="${f.v}" data-label="${f.l}"></button>
          </div>`;
        })
        .join('');
      const groupHeading = group.title ? `<p class="theme-field-group-title">${group.title}</p>` : '';
      html += `<div class="theme-field-group">${groupHeading}${rows}</div>`;
    });
  }
  container.innerHTML = html;

  container.querySelectorAll('.theme-field-swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      const varName = btn.dataset.var;
      const label = btn.dataset.label;
      openColorPicker(label, currentValueFor(varName), (newHex) => {
        themeVars[varName] = newHex;
        previewThemeVars();
        btn.style.background = newHex;
      });
    });
  });

  container.querySelectorAll('.theme-field-range').forEach((input) => {
    const valueLabel = input.parentElement.querySelector('.theme-field-range-value');
    input.addEventListener('input', () => {
      const varName = input.dataset.var;
      if (input.dataset.fieldType === 'alpha') {
        themeVars[varName] = input.value;
      } else {
        const maxPx = parseFloat(input.dataset.maxPx);
        themeVars[varName] = percentToPx(input.value, maxPx);
      }
      previewThemeVars();
      if (valueLabel) valueLabel.textContent = `${input.value}%`;
    });
    input.addEventListener('change', () => {
      applyThemeVars();
    });
  });
}

function renderAllThemeFields() {
  Object.keys(THEME_FIELDS).forEach(renderThemeFields);
}

/* =========================================================
   6. Synchronisation cloud (Supabase) — un enregistrement par compte,
   partagé en temps réel entre tous les appareils connectés avec le
   même compte Google. Nécessite la table "user_settings" (voir
   supabase-user-settings.sql) et fonctionne uniquement si connecté.
   ========================================================= */
const CLOUD_TABLE = 'user_settings';
let cloudUserId = null;
let cloudChannel = null;

async function pullCloudTheme() {
  if (!window.Auth || !cloudUserId) return;
  const client = window.Auth.getClient();
  if (!client) return;
  const { data, error } = await client
    .from(CLOUD_TABLE)
    .select('theme_vars')
    .eq('user_id', cloudUserId)
    .maybeSingle();
  if (error) {
    console.error('🔵 [FX-THEME]', 'Erreur lecture cloud :', error);
    return;
  }
  if (data && data.theme_vars) {
    themeVars = data.theme_vars;
    previewThemeVars();
    try { localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(themeVars)); } catch (e) {}
    renderAllThemeFields();
    window.dispatchEvent(new Event('fx-theme-changed'));
    console.log('🔵 [FX-THEME]', 'Paramètres récupérés depuis le cloud pour ce compte.');
  }
}

async function pushCloudTheme() {
  if (!window.Auth || !cloudUserId) return;
  const client = window.Auth.getClient();
  if (!client) return;
  const { error } = await client
    .from(CLOUD_TABLE)
    .upsert(
      { user_id: cloudUserId, theme_vars: themeVars, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
  if (error) {
    console.error('🔵 [FX-THEME]', 'Erreur sauvegarde cloud :', error);
  }
}

function subscribeCloudTheme() {
  if (!window.Auth || !cloudUserId) return;
  const client = window.Auth.getClient();
  if (!client) return;

  unsubscribeCloudTheme();

  cloudChannel = client
    .channel('user_settings_' + cloudUserId)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: CLOUD_TABLE, filter: `user_id=eq.${cloudUserId}` },
      (payload) => {
        const newVars = payload.new && payload.new.theme_vars;
        if (newVars) {
          themeVars = newVars;
          previewThemeVars();
          try { localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(themeVars)); } catch (e) {}
          renderAllThemeFields();
          window.dispatchEvent(new Event('fx-theme-changed'));
          console.log('🔵 [FX-THEME]', 'Thème mis à jour en direct depuis un autre appareil.');
        }
      }
    )
    .subscribe();
}

function unsubscribeCloudTheme() {
  if (cloudChannel && window.Auth) {
    const client = window.Auth.getClient();
    if (client) client.removeChannel(cloudChannel);
  }
  cloudChannel = null;
}

function initCloudSync() {
  if (!window.Auth) return;

  window.Auth.onAuthStateChange((session) => {
    const userId = session && session.user ? session.user.id : null;
    if (userId && userId !== cloudUserId) {
      cloudUserId = userId;
      pullCloudTheme().then(subscribeCloudTheme);
    } else if (!userId && cloudUserId) {
      cloudUserId = null;
      unsubscribeCloudTheme();
    }
  });
}

/* =========================================================
   7. Appliquer / Réinitialiser (appelés depuis app.js)
   ========================================================= */
function applyThemeVars() {
  previewThemeVars();
  saveThemeVars();
  pushCloudTheme();
}

function resetThemeVars() {
  // Les couleurs choisies pour chaque groupe d'« Analyse fondamentale »
  // (clés "--fgc-...") ne sont pas réglables dans ce panneau : on les garde.
  const kept = {};
  Object.keys(themeVars).forEach((k) => {
    if (k.startsWith('--fgc-')) kept[k] = themeVars[k];
  });
  themeVars = kept;
  saveThemeVars();
  document.documentElement.removeAttribute('style');
  Object.entries(kept).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
  renderAllThemeFields();
  pushCloudTheme();
  window.dispatchEvent(new Event('fx-theme-changed'));
}

/* Petite API pour les autres fichiers (ex. fundamental.js : couleur propre à
   chaque groupe). Les valeurs sont enregistrées dans le thème du compte,
   donc personnelles et synchronisées entre SES appareils, jamais partagées. */
function getThemeVar(name) {
  return themeVars[name] || null;
}

function setThemeVars(map) {
  let changed = false;
  Object.entries(map).forEach(([name, value]) => {
    if (value === null || value === undefined) {
      if (name in themeVars) {
        delete themeVars[name];
        document.documentElement.style.removeProperty(name);
        changed = true;
      }
    } else if (themeVars[name] !== value) {
      themeVars[name] = value;
      document.documentElement.style.setProperty(name, value);
      changed = true;
    }
  });
  if (changed) applyThemeVars();
}

/* =========================================================
   Init
   ========================================================= */
function initThemeColors() {
  loadThemeVars();
  previewThemeVars();
  initColorPickerEngine();
  renderAllThemeFields();
  initCloudSync();
}

window.ThemeColors = {
  init: initThemeColors,
  apply: applyThemeVars,
  reset: resetThemeVars,
  getVar: getThemeVar,
  setVars: setThemeVars,
  getColor: currentValueFor,
  pickColor: openColorPicker,
};

document.addEventListener('DOMContentLoaded', () => {
  initThemeColors();
});
