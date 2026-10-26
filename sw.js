'use strict';

/**
 * Service worker minimal.
 * Rôle actuel : mettre en cache l'app shell (HTML/CSS/JS/manifest/icônes)
 * pour rendre l'appli installable et utilisable hors-ligne pour sa coquille.
 * Aucune logique de données métier ici (calendrier, discours, etc.) —
 * ce sera ajouté plus tard si besoin (ex. cache des réponses API).
 */

const CACHE_VERSION = 'fx-terminal-shell-v91';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './style.css',
  './app.js',
  './auth.js',
  './supabase-config.js',
  './theme-colors.js',
  './speeches.js',
  './rates.js',
  './cot.js',
  './retail.js',
  './fundamental.js',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Stratégie : RÉSEAU D'ABORD pour notre app shell (HTML/CSS/JS/icônes),
// avec repli sur le cache uniquement si hors-ligne. Ça garantit qu'un
// simple F5 récupère toujours la dernière version déployée, tout en
// gardant l'appli utilisable sans connexion. La session de connexion
// (Supabase) est stockée à part (localStorage), donc elle n'est jamais
// affectée par cette stratégie de cache.
// IMPORTANT : on ne touche JAMAIS aux requêtes vers d'autres origines
// (API Supabase, polices Google, CDN supabase-js, etc.).
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
