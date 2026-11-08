'use strict';

/**
 * Configuration Supabase.
 * Remplis ces deux valeurs depuis ton dashboard Supabase :
 * Project Settings -> API Keys -> "Project URL" et "Publishable key"
 * (commence par sb_publishable_..., remplace l'ancienne clé "anon" JWT).
 * Ce ne sont PAS des identifiants secrets à protéger absolument : cette
 * clé est faite pour être exposée côté client, l'accès réel est
 * contrôlé par Supabase (Auth + policies), pas par le secret de cette clé.
 */
window.APP_CONFIG = {
  SUPABASE_URL: 'https://fuxnyuxcqydzoctedmsp.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_XUHS4kZN3Gncq7M9S_SdKg_gwn-FoXF',
  // Clé Google Maps Platform (Map Tiles API) pour le globe 3D photoréaliste de Google Earth (fenêtre Globe).
  // Laisser vide : le globe utilise alors l'imagerie satellite gratuite d'Esri. Cette clé est faite pour être
  // publique : restreins-la aux référents HTTP de ton site dans la console Google Cloud.
  GOOGLE_MAPS_API_KEY: 'AIzaSyDcmO3Npn5hKFscgQWY6YAz1AYIBb2JPJw',
};
