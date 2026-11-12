'use strict';

/**
 * riskcalc.js
 * Fenêtre « Calculateur de risque » : même calcul que le Position Size Calculator de Myfxbook.
 *   Entrées : devise du compte, taille du compte, risque (en % ou en montant), stop loss (pips), paire.
 *   Sorties : montant risqué, valeur du pip (par lot standard), taille de position en unités et en lots standard / mini / micro.
 * Les cours de conversion viennent de la table fx_live (lignes « EURUSD »… rafraîchies par l'edge function fx-live-bot).
 * Si les cours ne sont pas disponibles, on peut saisir le cours de conversion à la main.
 * Couleurs : style.css (variables --rc-*) ou Paramètres > Thème > Calculateur de risque.
 */
(function () {
  const PANEL_ID = 'tab-riskcalc';
  const LS = 'fxt-riskcalc';
  const CUR = ['USD', 'EUR', 'JPY', 'GBP', 'CHF', 'CAD', 'AUD', 'NZD'];
  const PAIRS = ['EURUSD', 'EURGBP', 'EURJPY', 'EURCAD', 'EURCHF', 'EURAUD', 'EURNZD', 'GBPUSD', 'GBPJPY', 'GBPCAD', 'GBPCHF', 'GBPAUD', 'GBPNZD', 'USDJPY', 'USDCAD', 'USDCHF', 'AUDUSD', 'NZDUSD', 'CADJPY', 'CADCHF', 'AUDCAD', 'CHFJPY', 'AUDCHF', 'NZDCHF', 'AUDJPY', 'AUDNZD', 'NZDJPY', 'NZDCAD'];
  const SYM = { USD: '$', EUR: '€', JPY: '¥', GBP: '£', CHF: 'CHF ', CAD: 'C$', AUD: 'A$', NZD: 'NZ$' };

  const st = { dep: 'EUR', bal: 10000, mode: 'pct', risk: 1, sl: 20, pair: 'EURUSD', manual: '' };
  let built = false;
  let rates = {}; // 'EURUSD' -> { price, at }
  let loadedAt = 0;
  let root = null;

  try { const s = JSON.parse(localStorage.getItem(LS) || 'null'); if (s && typeof s === 'object') Object.assign(st, s); } catch (e) { /* stockage indisponible */ }
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) { /* ignore */ } };

  const fmtNum = (v, d = 2) => (isFinite(v) ? v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
  const money = (v, c) => fmtNum(v, 2) + ' ' + (SYM[c] ? SYM[c].trim() : c);

  // cours de 1 unité de `a` exprimé en `b` (null si inconnu)
  function rate(a, b) {
    if (a === b) return 1;
    if (rates[a + b]) return rates[a + b].price;
    if (rates[b + a]) return 1 / rates[b + a].price;
    return null;
  }

  async function loadRates() {
    if (!window.Auth || !window.Auth.isConfigured || !window.Auth.isConfigured()) return;
    try {
      const c = window.Auth.getClient && window.Auth.getClient();
      if (!c || !(await window.Auth.getSession())) return;
      const { data, error } = await c.from('fx_live').select('currency,price,updated_at').in('currency', PAIRS);
      if (error || !data) return;
      data.forEach((r) => { rates[r.currency] = { price: r.price, at: new Date(r.updated_at).getTime() }; });
      loadedAt = Date.now();
      calc();
    } catch (e) { /* on réessaiera */ }
  }

  function field(id, label, inner, hint) {
    return `<label class="rc-field" for="${id}"><span class="rc-label">${label}</span>${inner}${hint ? `<span class="rc-hint">${hint}</span>` : ''}</label>`;
  }

  function build() {
    if (built) return;
    const sec = document.getElementById(PANEL_ID);
    if (!sec) return;
    built = true;
    sec.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'calendar-toolbar';
    bar.innerHTML = '<span class="calendar-toolbar-title">Calculateur de risque</span><span class="speeches-toolbar-info">Taille de position selon ton risque et ton stop loss</span>';
    sec.appendChild(bar);
    root = document.createElement('div');
    root.className = 'rc-wrap';
    root.innerHTML = `
      <section class="rc-card">
        <h3 class="rc-h">Paramètres</h3>
        ${field('rcDep', 'Devise du compte', `<select id="rcDep" class="rc-in">${CUR.map((c) => `<option value="${c}">${c}</option>`).join('')}</select>`)}
        ${field('rcBal', 'Taille du compte', '<input id="rcBal" class="rc-in" type="number" min="0" step="any" inputmode="decimal">')}
        <div class="rc-field">
          <span class="rc-label">Risque</span>
          <div class="rc-row">
            <input id="rcRisk" class="rc-in" type="number" min="0" step="any" inputmode="decimal" aria-label="Risque">
            <div class="rc-seg" role="group" aria-label="Unité du risque"><button type="button" class="rc-seg-btn" data-mode="pct">%</button><button type="button" class="rc-seg-btn" data-mode="amt" id="rcAmtBtn">Montant</button></div>
          </div>
        </div>
        ${field('rcSl', 'Stop loss (pips)', '<input id="rcSl" class="rc-in" type="number" min="0" step="any" inputmode="decimal">')}
        ${field('rcPair', 'Paire de devises', `<select id="rcPair" class="rc-in">${PAIRS.map((p) => `<option value="${p}">${p.slice(0, 3)}/${p.slice(3)}</option>`).join('')}</select>`)}
        <div class="rc-field" id="rcManualBox" hidden>
          <label class="rc-label" for="rcManual" id="rcManualLabel">Cours de conversion</label>
          <input id="rcManual" class="rc-in" type="number" min="0" step="any" inputmode="decimal">
          <span class="rc-hint">Cours indisponible : saisis-le à la main.</span>
        </div>
      </section>
      <section class="rc-card">
        <h3 class="rc-h">Résultat</h3>
        <div class="rc-big"><span class="rc-big-l">Taille de position</span><span class="rc-big-v" id="rcLots">–</span><span class="rc-big-s" id="rcUnits">–</span></div>
        <dl class="rc-dl">
          <div><dt>Montant risqué</dt><dd id="rcAmount">–</dd></div>
          <div><dt>Valeur du pip (1 lot standard)</dt><dd id="rcPip">–</dd></div>
          <div><dt>Valeur du pip (position)</dt><dd id="rcPipPos">–</dd></div>
          <div><dt>Lots standard (100 000)</dt><dd id="rcStd">–</dd></div>
          <div><dt>Mini lots (10 000)</dt><dd id="rcMini">–</dd></div>
          <div><dt>Micro lots (1 000)</dt><dd id="rcMicro">–</dd></div>
          <div><dt>Taille du pip</dt><dd id="rcPipSize">–</dd></div>
          <div><dt>Cours de conversion</dt><dd id="rcConv">–</dd></div>
        </dl>
        <p class="rc-note" id="rcNote"></p>
      </section>`;
    sec.appendChild(root);

    const $ = (id) => root.querySelector('#' + id);
    $('rcDep').value = st.dep; $('rcBal').value = st.bal; $('rcRisk').value = st.risk; $('rcSl').value = st.sl; $('rcPair').value = st.pair; $('rcManual').value = st.manual;
    root.addEventListener('input', (ev) => {
      const t = ev.target;
      if (t.id === 'rcDep') st.dep = t.value;
      else if (t.id === 'rcBal') st.bal = parseFloat(t.value);
      else if (t.id === 'rcRisk') st.risk = parseFloat(t.value);
      else if (t.id === 'rcSl') st.sl = parseFloat(t.value);
      else if (t.id === 'rcPair') st.pair = t.value;
      else if (t.id === 'rcManual') st.manual = t.value;
      save(); calc();
    });
    root.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-mode]');
      if (!b) return;
      st.mode = b.dataset.mode; save(); calc();
    });
    calc();
  }

  function calc() {
    if (!root) return;
    const $ = (id) => root.querySelector('#' + id);
    const base = st.pair.slice(0, 3); const quote = st.pair.slice(3);
    const pipSize = quote === 'JPY' ? 0.01 : 0.0001;
    root.querySelectorAll('.rc-seg-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.mode === st.mode));
    $('rcAmtBtn').textContent = 'Montant (' + st.dep + ')';

    // conversion de la devise de cotation vers la devise du compte
    let q2d = rate(quote, st.dep);
    const missing = q2d == null;
    const manualBox = $('rcManualBox');
    manualBox.hidden = !missing;
    if (missing) {
      $('rcManualLabel').textContent = 'Cours ' + quote + ' → ' + st.dep;
      const m = parseFloat(st.manual);
      q2d = m > 0 ? m : null;
    }
    const riskAmt = st.mode === 'pct' ? (st.bal * st.risk) / 100 : st.risk;
    const ok = q2d != null && st.sl > 0 && riskAmt >= 0 && isFinite(riskAmt) && isFinite(st.sl);
    const pipPerUnit = q2d != null ? pipSize * q2d : NaN; // valeur d'un pip pour 1 unité, en devise du compte
    const units = ok ? riskAmt / (st.sl * pipPerUnit) : NaN;
    const dash = '–';
    $('rcAmount').textContent = isFinite(riskAmt) ? money(riskAmt, st.dep) + (st.mode === 'amt' && st.bal > 0 ? ' (' + fmtNum((riskAmt / st.bal) * 100, 2) + ' %)' : '') : dash;
    $('rcPip').textContent = q2d != null ? money(pipPerUnit * 100000, st.dep) : dash;
    $('rcPipPos').textContent = ok ? money(pipPerUnit * units, st.dep) : dash;
    $('rcLots').textContent = ok ? fmtNum(units / 100000, 2) + ' lot' + (units / 100000 >= 2 ? 's' : '') : dash;
    $('rcUnits').textContent = ok ? fmtNum(Math.round(units), 0) + ' unités ' + base : dash;
    $('rcStd').textContent = ok ? fmtNum(units / 100000, 2) : dash;
    $('rcMini').textContent = ok ? fmtNum(units / 10000, 2) : dash;
    $('rcMicro').textContent = ok ? fmtNum(units / 1000, 2) : dash;
    $('rcPipSize').textContent = pipSize === 0.01 ? '0,01' : '0,0001';
    $('rcConv').textContent = q2d != null ? quote + '/' + st.dep + ' = ' + fmtNum(q2d, 5) : dash;
    const at = rates[st.pair] ? rates[st.pair].at : 0;
    $('rcNote').textContent = missing ? '' : (at ? 'Cours du ' + new Date(at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' (Paris). ' : '')
      + 'Calcul : montant risqué ÷ (stop loss × valeur du pip). Les cours viennent de Yahoo Finance, avec quelques secondes de retard ; vérifie le cours de ton courtier avant d\'entrer.';
  }

  window.RiskCalc = {
    refresh() {
      build();
      if (Date.now() - loadedAt > 30000) loadRates();
    },
  };
})();
