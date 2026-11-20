'use strict';

/**
 * auth.js
 * Petite couche au-dessus de Supabase Auth : connexion/déconnexion Google,
 * récupération de la session, écoute des changements d'état.
 * Dépend de supabase-config.js (chargé avant) et de la librairie
 * supabase-js (chargée via CDN dans index.html).
 */

let supabaseClient = null;
let configWarningShown = false;

function isConfigured() {
  const cfg = window.APP_CONFIG || {};
  return (
    cfg.SUPABASE_URL &&
    cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes('TON_PROJECT_REF') &&
    !cfg.SUPABASE_ANON_KEY.includes('TON_ANON_PUBLIC_KEY')
  );
}

function getClient() {
  if (supabaseClient) return supabaseClient;

  if (!isConfigured()) {
    if (!configWarningShown) {
      console.warn(
        'Supabase non configuré : renseigne supabase-config.js ' +
        '(SUPABASE_URL et SUPABASE_ANON_KEY) depuis ton dashboard Supabase.'
      );
      configWarningShown = true;
    }
    return null;
  }

  if (typeof window.supabase === 'undefined') {
    console.error('La librairie supabase-js ne s\'est pas chargée (vérifie la balise <script> du CDN dans index.html).');
    return null;
  }

  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG;
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return supabaseClient;
}

async function getSession() {
  const client = getClient();
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) {
    console.error('Erreur lors de la récupération de la session :', error);
    return null;
  }
  return data.session;
}

async function signInWithGoogle() {
  const client = getClient();
  if (!client) return;
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      // Force Google à afficher le sélecteur de comptes (avec « Utiliser un
      // autre compte »), même s'il n'y a qu'un seul compte connecté dans
      // le navigateur. Sans ça, Google reconnecte le compte automatiquement.
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) {
    console.error('Erreur lors de la connexion Google :', error);
  }
}

async function signOut() {
  const client = getClient();
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) {
    console.error('Erreur lors de la déconnexion :', error);
    return;
  }
  window.location.reload();
}

function onAuthStateChange(callback) {
  const client = getClient();
  if (!client) return;
  client.auth.onAuthStateChange((event, session) => {
    callback(session);
  });
}

const PIN_ENDPOINT_PATH = '/functions/v1/pin-auth';
async function callPinAuth(payload, accessToken) {
  const cfg = window.APP_CONFIG || {};
  const res = await fetch(cfg.SUPABASE_URL + PIN_ENDPOINT_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + (accessToken || cfg.SUPABASE_ANON_KEY) },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || 'Erreur serveur (' + res.status + ')');
  return data;
}

// Connexion par email + PIN : le serveur vérifie le PIN et renvoie un jeton qui s'échange contre une vraie session.
async function signInWithPin(email, pin) {
  const client = getClient();
  if (!client) throw new Error('Supabase non configuré.');
  const r = await callPinAuth({ action: 'verify', email, pin });
  const { data, error } = await client.auth.verifyOtp({ token_hash: r.token_hash, type: 'magiclink' });
  if (error || !data || !data.session) throw new Error('Connexion impossible. Réessaie.');
  return data.session;
}
async function pinStatus(session) { return (await callPinAuth({ action: 'status' }, session.access_token)).has_pin; }
async function setPin(session, pin) { await callPinAuth({ action: 'set', pin }, session.access_token); }

window.Auth = {
  signInWithPin,
  pinStatus,
  setPin,
  isConfigured,
  getClient,
  getSession,
  signInWithGoogle,
  signOut,
  onAuthStateChange,
};
