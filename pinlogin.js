/* Connexion email + PIN (comme le TJP) : Google sert à créer le compte, ensuite email + PIN à 4 chiffres. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const LAST = 'fxt_last_email';
  let pad = null;

  function step(name) {
    ['Google', 'Email', 'Pin'].forEach((s) => { const el = $('loginStep' + s); if (el) el.hidden = s !== name; });
    const note = $('loginNote'); if (note) note.hidden = true;
  }
  function err(msg) { const n = $('loginNote'); if (n) { n.hidden = !msg; n.textContent = msg || ''; } }

  // Pavé à 4 chiffres. onDone(code, reset)
  function buildPad(onDone) {
    const padEl = $('loginPad'); const dots = $('loginDots').querySelectorAll('i');
    let entry = ''; let busy = false;
    padEl.innerHTML = '';
    const paint = () => dots.forEach((d, i) => d.classList.toggle('is-on', i < entry.length));
    const reset = () => { entry = ''; busy = false; paint(); };
    const add = (k) => {
      if (busy || entry.length >= 4) return;
      entry += k; paint();
      if (entry.length === 4) { busy = true; setTimeout(() => onDone(entry, reset), 120); }
    };
    const del = () => { if (!busy) { entry = entry.slice(0, -1); paint(); } };
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].forEach((k) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'login-key'; b.textContent = k;
      if (!k) b.disabled = true; else b.addEventListener('click', () => (k === '⌫' ? del() : add(k)));
      padEl.appendChild(b);
    });
    pad = { add, del };
  }
  document.addEventListener('keydown', (e) => {
    if (!pad || $('loginStepPin').hidden || $('loginScreen').hidden) return;
    if (/^\d$/.test(e.key)) pad.add(e.key); else if (e.key === 'Backspace') pad.del();
  });

  // Création du PIN (après une connexion Google, ou si le compte n'en a pas encore)
  function createPin(session, done) {
    step('Pin');
    $('loginPinBack').hidden = true;
    let first = '';
    const ask = () => {
      $('loginPinText').textContent = first ? 'Confirme ton PIN' : 'Crée ton PIN (4 chiffres)';
      buildPad(async (code, reset) => {
        if (!first) { first = code; reset(); ask(); return; }
        if (code !== first) { first = ''; err('Les deux PIN sont différents. Recommence.'); reset(); ask(); return; }
        try { await window.Auth.setPin(session, code); err(''); done(); }
        catch (e) { err(e.message); first = ''; reset(); ask(); }
      });
    };
    ask();
  }

  function init(showApp, showLogin) {
    const emailInp = $('loginEmail'); let email = '';
    const toPin = () => {
      step('Pin'); $('loginPinBack').hidden = false;
      $('loginPinText').textContent = email;
      buildPad(async (code, reset) => {
        try {
          await window.Auth.signInWithPin(email, code);
          try { localStorage.setItem(LAST, email); } catch (e) { /* ignoré */ }
          err('');
        } catch (e) { err(e.message); reset(); }
      });
    };
    const next = () => {
      const v = emailInp.value.trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(v)) { err('Email invalide.'); return; }
      email = v; toPin();
    };
    $('loginEmailNext').addEventListener('click', next);
    emailInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') next(); });
    $('loginToEmail').addEventListener('click', () => step('Email'));
    $('loginToGoogle').addEventListener('click', () => step('Google'));
    $('loginPinBack').addEventListener('click', () => step('Email'));
    let last = ''; try { last = localStorage.getItem(LAST) || ''; } catch (e) { /* ignoré */ }
    if (last) emailInp.value = last;
    return {
      // écran quand il n'y a pas de session : email+PIN si déjà venu, sinon Google
      showEntry() { showLogin(); step(last ? 'Email' : 'Google'); },
      // session valide : exige que le compte ait un PIN, sinon le fait créer
      async gate(session) {
        let has = true;
        try { has = await window.Auth.pinStatus(session); } catch (e) { has = true; }
        if (has) { try { localStorage.setItem(LAST, session.user.email.toLowerCase()); } catch (e) { /* ignoré */ } showApp(); return; }
        showLogin(); createPin(session, () => { try { localStorage.setItem(LAST, session.user.email.toLowerCase()); } catch (e) { /* ignoré */ } showApp(); });
      },
    };
  }
  window.PinLogin = { init };
})();
