/* Connexion Google + email/PIN — même fonctionnement et même écrans que le TJP. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const LAST = 'fxt_last_email';
  let keyHandler = null;

  function showOverlay(id) {
    document.querySelectorAll('.auth-overlay').forEach((el) => el.classList.remove('active'));
    if (id) $(id).classList.add('active');
  }
  function showErr(id, msg) { const e = $(id); if (!e) return; e.textContent = msg; e.style.display = 'block'; }

  // Pavé PIN identique au TJP (touches, points, clavier physique)
  function buildPad(padId, dotsId, onComplete, errId) {
    const pad = $(padId); pad.innerHTML = '';
    let entry = '';
    const dots = $(dotsId).querySelectorAll('.pin-dot');
    function update() {
      dots.forEach((d, i) => d.classList.toggle('filled', i < entry.length));
      if (entry.length === 4) setTimeout(() => onComplete(entry, reset), 150);
    }
    function reset(shake) {
      entry = '';
      dots.forEach((d) => { d.classList.remove('filled'); });
      const err = $(errId);
      if (!shake && err) err.style.display = 'none';
    }
    function typeDigit(k) { if (entry.length < 4) { entry += k; update(); } }
    function backspace() { if (entry.length > 0) { entry = entry.slice(0, -1); update(); } }
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'empty', '0', 'del'].forEach((k) => {
      const btn = document.createElement('button');
      btn.className = 'pin-btn' + (k === 'del' ? ' del' : k === 'empty' ? ' empty' : '');
      btn.textContent = k === 'del' ? '⌫' : k === 'empty' ? '' : k;
      if (k !== 'empty') btn.onclick = () => (k === 'del' ? backspace() : typeDigit(k));
      pad.appendChild(btn);
    });
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = (e) => {
      if (pad.offsetParent === null) return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key >= '0' && e.key <= '9') { e.preventDefault(); typeDigit(e.key); }
      else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); backspace(); }
    };
    document.addEventListener('keydown', keyHandler);
  }

  function init(showApp, showLogin, onUnlock) {
    let returnEmail = '';
    let pinAttempts = 0;

    function setupEnterPinRemote() {
      pinAttempts = 0;
      buildPad('enterPad', 'enterDots', async (val, reset) => {
        try {
          await window.Auth.signInWithPin(returnEmail, val);
          try { localStorage.setItem(LAST, returnEmail); } catch (e) { /* ignoré */ }
          pinAttempts = 0;
          onUnlock(); showOverlay(null); showApp();
        } catch (e) {
          pinAttempts++;
          if (pinAttempts >= 5) {
            showErr('enterErr', 'Trop de tentatives. Réessaie plus tard.');
            setTimeout(() => showOverlay('overlayGoogle'), 2000);
          } else { showErr('enterErr', e.message || 'Code PIN incorrect.'); reset(true); }
        }
      }, 'enterErr');
    }

    let busy = false;
    async function submitReturnEmail() {
      if (busy) return;
      const email = $('returnEmail').value.trim().toLowerCase();
      const err = $('returnEmailErr'); err.style.display = 'none';
      if (!email || !email.includes('@')) { showErr('returnEmailErr', 'Email invalide.'); return; }
      returnEmail = email;
      busy = true;
      let known = false;
      try { known = await window.Auth.pinExists(email); }
      catch (e) { busy = false; showErr('returnEmailErr', 'Connexion impossible. Réessaie.'); return; }
      busy = false;
      // Email sans compte : direction « Continuer avec Google » (comme le TJP)
      if (!known) { showOverlay('overlayGoogle'); return; }
      $('enterPinSub').textContent = email;
      $('enterErr').style.display = 'none';
      showOverlay('overlayEnterPin');
      setupEnterPinRemote();
    }

    let first = '';
    function setupCreatePin(session, done) {
      first = '';
      buildPad('createPad', 'createDots', (val) => {
        first = val; showOverlay('overlayConfirmPin'); setupConfirmPin(session, done);
      }, 'createErr');
    }
    function setupConfirmPin(session, done) {
      buildPad('confirmPad', 'confirmDots', async (val, reset) => {
        if (val === first) {
          try { await window.Auth.setPin(session, val); done(); }
          catch (e) { showErr('confirmErr', e.message || 'Enregistrement impossible.'); reset(true); first = ''; setTimeout(() => { showOverlay('overlayCreatePin'); setupCreatePin(session, done); }, 1200); }
        } else {
          showErr('confirmErr', 'PIN non identique. Recommence.');
          reset(true); first = '';
          setTimeout(() => { showOverlay('overlayCreatePin'); setupCreatePin(session, done); }, 800);
        }
      }, 'confirmErr');
    }

    $('returnEmailBtn').addEventListener('click', submitReturnEmail);
    $('returnEmail').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitReturnEmail(); });
    $('emailToGoogle').addEventListener('click', () => showOverlay('overlayGoogle'));
    $('enterPinChangeEmailBtn').addEventListener('click', () => showOverlay('overlayEmailPin'));
    try { const l = localStorage.getItem(LAST); if (l) $('returnEmail').value = l; } catch (e) { /* ignoré */ }

    return {
      showEntry() { showLogin(); showOverlay('overlayEmailPin'); },
      async gate(session) {
        let has = true;
        try { has = await window.Auth.pinStatus(session); } catch (e) { has = true; }
        const ok = () => { try { localStorage.setItem(LAST, session.user.email.toLowerCase()); } catch (e) { /* ignoré */ } showOverlay(null); showApp(); };
        if (has) { ok(); return; }
        showLogin(); showOverlay('overlayCreatePin'); setupCreatePin(session, ok);
      },
    };
  }
  window.PinLogin = { init };
})();
