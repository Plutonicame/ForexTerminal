'use strict';

/**
 * fundamental.js
 * Onglet « Analyse fondamentale » : une zone PARTAGÉE par tous les
 * utilisateurs de l'appli, organisée en arbre d'onglets imbriqués.
 *
 *   Groupe (ex. « Analyse fondamentale »)
 *     └─ Onglet (ex. « 2026 »)
 *          └─ Onglet (ex. « Octobre »)
 *               └─ Onglet (ex. « Semaine 3 »)  + texte libre
 *
 * - Un groupe n'a qu'un nom et des onglets.
 * - Un onglet a un nom, un texte libre ET des sous-onglets (à l'infini).
 * - Tout est stocké dans la table Supabase "fundamental_nodes"
 *   (voir supabase-fundamental.sql) : une ligne par groupe/onglet,
 *   reliée à son parent par "parent_id" (null = groupe).
 * - Le contenu est partagé et se met à jour en direct chez tout le monde
 *   (Supabase Realtime). Les COULEURS, elles, restent personnelles :
 *   elles viennent du thème de chaque compte (Paramètres > Thème).
 * - Seul l'état « ouvert / fermé » des flèches est mémorisé, en local,
 *   sur chaque appareil (ce n'est pas du contenu partagé).
 * - Les actions (renommer, ajouter, monter/descendre, supprimer) sont dans
 *   un menu clic droit (appui long sur mobile). Groupes et onglets se
 *   déplacent à la souris (glisser-déposer) ; l'ordre est partagé et stocké
 *   dans la colonne "sort_order" (voir supabase-fundamental-order.sql).
 */
(function () {
  const TABLE = 'fundamental_nodes';
  const OPEN_KEY = 'fx_fund_open';
  const SAVE_DELAY_MS = 800;

  const COLS = 'id,parent_id,name,content,created_at,sort_order';
  const COLS_LEGACY = 'id,parent_id,name,content,created_at';
  let hasOrder = true; // passe à false si la colonne sort_order n'existe pas encore

  let nodes = new Map(); // id -> { id, parent_id, name, content, created_at, sort_order }
  let openIds = loadOpen();
  let userId = null;
  let channel = null;
  let loaded = false;
  let loading = false;

  const dirty = new Set();   // ids dont le texte n'est pas encore envoyé
  const saving = new Set();  // ids dont le texte est en cours d'envoi (à protéger comme « dirty » le temps de la requête)
  const timers = new Map();  // id -> timeout de sauvegarde différée
  const els = {};
  let dialogState = null;    // { resolve, withInput }

  /* =========================================================
     Utilitaires
     ========================================================= */
  function getClient() {
    return window.Auth && window.Auth.getClient ? window.Auth.getClient() : null;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function loadOpen() {
    try {
      const raw = localStorage.getItem(OPEN_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch (e) {
      return new Set();
    }
  }

  function saveOpen() {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(Array.from(openIds)));
    } catch (e) { /* stockage indisponible : sans conséquence */ }
  }

  function setStatus(message) {
    if (!els.status) return;
    els.status.textContent = message || '';
    els.status.hidden = !message;
  }

  function spinnerOn() {
    if (typeof showSaveSpinner === 'function') showSaveSpinner();
  }

  function spinnerOff() {
    if (typeof hideSaveSpinner === 'function') window.setTimeout(hideSaveSpinner, 400);
  }

  function friendlyError(error, action) {
    const msg = (error && error.message) || '';
    const code = (error && error.code) || '';
    if (/sort_order/.test(msg) || code === '42703' || code === 'PGRST204') {
      return 'Colonne d\'ordre absente : exécute supabase-fundamental-order.sql dans le SQL Editor de Supabase.';
    }
    if (code === '42P01' || code === 'PGRST205' || /does not exist|schema cache/i.test(msg)) {
      return 'La table "fundamental_nodes" n\'existe pas encore dans Supabase : ' +
        'exécute supabase-fundamental.sql dans le SQL Editor.';
    }
    return action + (msg ? ' (' + msg + ')' : '') + '.';
  }

  function normalize(row) {
    return {
      id: row.id,
      parent_id: row.parent_id || null,
      name: row.name,
      content: row.content || '',
      created_at: row.created_at || '',
      sort_order: row.sort_order === undefined ? null : row.sort_order,
    };
  }

  /* =========================================================
     Couleurs propres à chaque groupe (fond, bordure, texte)
     Stockées dans le THÈME du compte (ThemeColors), donc personnelles :
     seul le contenu est partagé, jamais les couleurs.
     ========================================================= */
  const GC_KEYS = ['bg', 'border', 'text'];
  const GC_DEFAULT_VAR = { bg: '--fund-group-bg', border: '--fund-group-border', text: '--fund-group-text' };

  function gcVar(id, key) {
    return '--fgc-' + id + '-' + key;
  }

  function getGroupColors(id) {
    const T = window.ThemeColors;
    const out = {};
    GC_KEYS.forEach((k) => { out[k] = T && T.getVar ? T.getVar(gcVar(id, k)) : null; });
    return out;
  }

  function sameColors(a, b) {
    return GC_KEYS.every((k) => (a[k] || null) === (b[k] || null));
  }

  function saveGroupColors(id, colors) {
    const T = window.ThemeColors;
    if (!T || !T.setVars) return;
    if (sameColors(getGroupColors(id), colors)) return;
    const map = {};
    GC_KEYS.forEach((k) => { map[gcVar(id, k)] = colors[k] || null; });
    T.setVars(map);
  }

  function applyGroupColors(wrap, id) {
    const c = getGroupColors(id);
    if (c.bg) {
      wrap.style.setProperty('--fund-g-bg', c.bg);
      wrap.style.setProperty('--fund-g-hover-bg', c.bg);
    }
    if (c.border) wrap.style.setProperty('--fund-g-border', c.border);
    if (c.text) wrap.style.setProperty('--fund-g-text', c.text);
  }

  /* =========================================================
     Arbre en mémoire
     ========================================================= */
  function childrenOf(parentId) {
    const list = [];
    nodes.forEach((n) => {
      if (n.parent_id === parentId) list.push(n);
    });
    list.sort((a, b) => {
      const pa = a.sort_order == null ? Infinity : a.sort_order;
      const pb = b.sort_order == null ? Infinity : b.sort_order;
      if (pa !== pb) return pa < pb ? -1 : 1;
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
    return list;
  }

  function descendantIds(id) {
    const out = [];
    childrenOf(id).forEach((child) => {
      out.push(child.id);
      descendantIds(child.id).forEach((d) => out.push(d));
    });
    return out;
  }

  function removeLocal(id) {
    const all = descendantIds(id).concat(id);
    all.forEach((nodeId) => {
      nodes.delete(nodeId);
      openIds.delete(nodeId);
      dirty.delete(nodeId);
      if (timers.has(nodeId)) {
        window.clearTimeout(timers.get(nodeId));
        timers.delete(nodeId);
      }
    });
    saveOpen();
  }

  /* =========================================================
     Dictée vocale (même moteur que le micro du chat IA :
     reconnaissance vocale du navigateur, en français).
     Contrairement au chat, le texte s'écrit EN DIRECT dans la note,
     à la position du curseur, pendant que tu parles.
     Un clic sur le micro démarre, un second clic arrête.
     ========================================================= */
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const ICON_MIC =
    '<svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true"><path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 0 0-7 0v5A3.5 3.5 0 0 0 12 15z"/><path d="M18 11.5a1 1 0 0 0-2 0 4 4 0 0 1-8 0 1 1 0 0 0-2 0 6 6 0 0 0 5 5.92V19h-1.5a1 1 0 0 0 0 2h5a1 1 0 0 0 0-2H13v-1.58a6 6 0 0 0 5-5.92z"/></svg>';
  let dict = null; // { id, ta, btn, rec, before, after, applying }

  function micButtonFor(id) {
    return els.tree ? els.tree.querySelector('.fund-mic[data-id="' + id + '"]') : null;
  }

  function setMicState(btn, on) {
    if (!btn) return;
    btn.classList.toggle('is-listening', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.title = on ? 'Arrêter la dictée' : 'Dicter (écrit en parlant)';
  }

  // Écrit « avant + dictée + après » dans la note et déclenche la sauvegarde habituelle.
  function applyDictation(text) {
    if (!dict || !dict.ta) return;
    const ta = dict.ta;
    const needSpace = dict.before && !/\s$/.test(dict.before) && text;
    const mid = (needSpace ? ' ' : '') + text;
    const tail = dict.after && text && !/^\s/.test(dict.after) ? ' ' + dict.after : dict.after;
    dict.applying = true;
    ta.value = dict.before + mid + tail;
    const caret = (dict.before + mid).length;
    try { ta.setSelectionRange(caret, caret); } catch (e) { /* ignoré */ }
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    dict.applying = false;
  }

  function startDictation(ta, btn) {
    if (!SpeechRec) {
      setStatus('Reconnaissance vocale non supportée par ce navigateur');
      return;
    }
    stopDictation();
    const start = typeof ta.selectionStart === 'number' ? ta.selectionStart : ta.value.length;
    const end = typeof ta.selectionEnd === 'number' ? ta.selectionEnd : start;
    const rec = new SpeechRec();
    rec.lang = 'fr-FR';
    rec.continuous = true;
    rec.interimResults = true;
    dict = {
      id: ta.dataset.id, ta, btn, rec,
      before: ta.value.slice(0, start),
      after: ta.value.slice(end),
      applying: false,
    };
    const me = dict;

    rec.onresult = (e) => {
      // On reconstruit tout depuis le début de la session de reconnaissance :
      // évite les doublons que certains navigateurs mobiles produisent.
      let finalText = '';
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      if (dict === me) applyDictation((finalText + interim).replace(/\s+/g, ' ').trim());
    };
    rec.onerror = (e) => {
      console.warn('[FX-FUND] dictée :', e.error);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setStatus('Autorise le micro dans les réglages du site');
        if (dict === me) stopDictation();
      }
    };
    // Le navigateur coupe la reconnaissance après un silence : on fige ce qui
    // a été écrit et on relance tant que l'utilisateur n'a pas arrêté.
    rec.onend = () => {
      if (dict !== me) return;
      me.before = me.ta.value.slice(0, me.ta.selectionStart);
      me.after = me.ta.value.slice(me.ta.selectionStart);
      try { rec.start(); } catch (e) { stopDictation(); }
    };

    setMicState(btn, true);
    setStatus('');
    try { rec.start(); } catch (e) { stopDictation(); }
  }

  function stopDictation() {
    if (!dict) return;
    const d = dict;
    dict = null;
    setMicState(d.btn, false);
    d.rec.onend = null;
    try { d.rec.stop(); } catch (e) { /* ignoré */ }
    if (d.ta) flushSave(d.id);
  }

  // Après un re-rendu de l'arbre, rattache la dictée en cours à la nouvelle zone de texte.
  function rebindDictation() {
    if (!dict) return;
    const ta = textareaFor(dict.id);
    const btn = micButtonFor(dict.id);
    if (!ta || !btn) { stopDictation(); return; }
    dict.ta = ta;
    dict.btn = btn;
    setMicState(btn, true);
  }

  /* =========================================================
     Rendu
     ========================================================= */
  function autosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.max(ta.scrollHeight + 2, 110) + 'px';
  }

  function textareaFor(id) {
    return els.tree ? els.tree.querySelector('.fund-text[data-id="' + id + '"]') : null;
  }

  function isEditing(id) {
    const a = document.activeElement;
    return !!(a && a.classList && a.classList.contains('fund-text') && a.dataset.id === id);
  }

  function captureFocus() {
    const a = document.activeElement;
    if (a && a.classList && a.classList.contains('fund-text') && els.tree.contains(a)) {
      return { id: a.dataset.id, start: a.selectionStart, end: a.selectionEnd, scroll: a.scrollTop };
    }
    return null;
  }

  function restoreFocus(state) {
    if (!state) return;
    const ta = textareaFor(state.id);
    if (!ta) return;
    ta.focus({ preventScroll: true });
    try { ta.setSelectionRange(state.start, state.end); } catch (e) { /* ignoré */ }
    ta.scrollTop = state.scroll;
  }

  // Règle : un onglet contient SOIT du texte, SOIT des sous-onglets.
  //  - vide                          -> zone de texte ET bouton « + » disponibles
  //  - dès qu'il y a du texte        -> le bouton « + » de la ligne disparaît
  //  - dès qu'il y a un sous-onglet  -> la zone de texte disparaît
  // Un groupe, lui, ne contient que des onglets (« + » toujours visible).
  function canAddChild(node) {
    if (node.parent_id === null) return true;
    return childrenOf(node.id).length > 0 || node.content.trim() === '';
  }

  function buildBody(node, isGroup, depth) {
    const body = el('div', 'fund-body');
    const kids = childrenOf(node.id);
    const hasKids = kids.length > 0;

    if (!isGroup && !hasKids) {
      const ta = el('textarea', 'fund-text');
      ta.dataset.id = node.id;
      ta.value = node.content;
      ta.placeholder = 'Écrire du texte...';
      ta.setAttribute('aria-label', 'Texte de ' + node.name);
      ta.addEventListener('input', () => {
        if (dict && dict.ta === ta && !dict.applying) stopDictation(); // l'utilisateur tape : la dictée s'arrête
        autosize(ta);
        const n = nodes.get(node.id);
        if (!n) return;
        n.content = ta.value;
        scheduleSave(node.id);
      });
      ta.addEventListener('blur', (ev) => {
        const next = ev.relatedTarget;
        if (dict && dict.ta === ta && !(next && next.classList && next.classList.contains('fund-mic'))) stopDictation();
        flushSave(node.id);
      });

      const wrap = el('div', 'fund-text-wrap');
      wrap.appendChild(ta);
      if (SpeechRec) {
        const mic = el('button', 'fund-mic');
        mic.type = 'button';
        mic.dataset.id = node.id;
        mic.innerHTML = ICON_MIC;
        mic.setAttribute('aria-label', 'Dicter dans ' + node.name);
        setMicState(mic, !!(dict && dict.id === node.id));
        // Garde le focus (et le curseur) dans la note quand on touche le micro.
        mic.addEventListener('pointerdown', (ev) => ev.preventDefault());
        mic.addEventListener('mousedown', (ev) => ev.preventDefault());
        mic.addEventListener('click', () => {
          if (dict && dict.ta === ta) stopDictation();
          else { ta.focus({ preventScroll: true }); startDictation(ta, mic); }
        });
        wrap.appendChild(mic);
      }
      body.appendChild(wrap);
    }

    if (hasKids) {
      const list = el('div', 'fund-children');
      kids.forEach((kid) => list.appendChild(buildNode(kid, depth + 1)));
      body.appendChild(list);
    } else if (isGroup) {
      body.appendChild(el('p', 'fund-empty', 'Aucun onglet pour le moment.'));
    }

    return body;
  }

  function buildNode(node, depth) {
    const isGroup = depth === 0;
    const isOpen = openIds.has(node.id);

    const wrap = el('div', 'fund-node ' + (isGroup ? 'fund-node--group' : 'fund-node--tab') + (isOpen ? ' is-open' : ''));
    wrap.dataset.id = node.id;

    const row = el('div', 'fund-row');

    const toggle = el('button', 'fund-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    const chevron = el('span', 'fund-chevron', '›');
    chevron.setAttribute('aria-hidden', 'true');
    toggle.appendChild(chevron);
    toggle.appendChild(el('span', 'fund-name', node.name));
    toggle.addEventListener('click', () => toggleNode(node.id));
    row.appendChild(toggle);

    wrap.appendChild(row);
    if (isGroup) applyGroupColors(wrap, node.id);
    if (isOpen) wrap.appendChild(buildBody(node, isGroup, depth));
    return wrap;
  }

  function render() {
    if (!els.tree) return;
    if (drag && drag.active) { drag.pendingRender = true; return; }
    const focus = captureFocus();
    const frag = document.createDocumentFragment();
    const groups = childrenOf(null);

    if (!loaded) {
      frag.appendChild(el('p', 'fund-empty', userId ? 'Chargement...' : 'Connecte-toi pour voir cette page.'));
    } else if (!groups.length) {
      frag.appendChild(el('p', 'fund-empty', 'Aucun groupe pour le moment. Crée le premier avec « + Groupe ».'));
    } else {
      groups.forEach((g) => frag.appendChild(buildNode(g, 0)));
    }

    els.tree.replaceChildren(frag);
    els.tree.querySelectorAll('.fund-text').forEach(autosize);
    restoreFocus(focus);
    rebindDictation();
  }

  function toggleNode(id) {
    if (openIds.has(id)) {
      // En refermant un onglet, tout ce qui était ouvert à l'intérieur se referme
      // aussi : à la réouverture, il apparaît avec ses sous-onglets repliés.
      openIds.delete(id);
      descendantIds(id).forEach((d) => openIds.delete(d));
    } else {
      openIds.add(id);
    }
    saveOpen();
    render();
  }

  /* =========================================================
     Boîte de dialogue (nom / confirmation)
     ========================================================= */
  function openDialog(opts) {
    return new Promise((resolve) => {
      if (dialogState) finishDialog(null);
      dialogState = {
        resolve,
        withInput: !!opts.withInput,
        withColors: !!opts.withColors,
        colors: opts.withColors ? Object.assign({ bg: null, border: null, text: null }, opts.colors) : null,
      };

      els.dialogTitle.textContent = opts.title || '';
      els.dialogMessage.textContent = opts.message || '';
      els.dialogMessage.hidden = !opts.message;
      els.dialogInput.hidden = !opts.withInput;
      els.dialogInput.value = opts.initial || '';
      els.dialogError.hidden = true;
      els.dialogOk.textContent = opts.okLabel || 'Valider';
      els.dialogOk.classList.toggle('is-danger', !!opts.danger);
      els.customToggle.hidden = !opts.withColors;
      els.custom.hidden = true;
      els.customToggle.setAttribute('aria-expanded', 'false');
      if (opts.withColors) {
        refreshColorUI();
        // Déjà personnalisé : on montre directement les couleurs actuelles.
        if (GC_KEYS.some((k) => dialogState.colors[k])) setCustomOpen(true);
      }
      els.dialog.hidden = false;

      window.setTimeout(() => {
        if (opts.withInput) {
          els.dialogInput.focus();
          els.dialogInput.select();
        } else {
          els.dialogOk.focus();
        }
      }, 0);
    });
  }

  function finishDialog(result) {
    if (!dialogState) return;
    const { resolve } = dialogState;
    dialogState = null;
    els.dialog.hidden = true;
    resolve(result);
  }

  function submitDialog() {
    if (!dialogState) return;
    if (dialogState.withInput) {
      const value = els.dialogInput.value.trim();
      if (!value) {
        els.dialogError.textContent = 'Le nom ne peut pas être vide.';
        els.dialogError.hidden = false;
        els.dialogInput.focus();
        return;
      }
      finishDialog(dialogState.withColors ? { name: value, colors: Object.assign({}, dialogState.colors) } : value);
    } else {
      finishDialog(true);
    }
  }

  function setCustomOpen(open) {
    els.custom.hidden = !open;
    els.customToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) refreshColorUI();
  }

  function effectiveColor(key) {
    if (dialogState && dialogState.colors && dialogState.colors[key]) return dialogState.colors[key];
    const T = window.ThemeColors;
    return T && T.getColor ? T.getColor(GC_DEFAULT_VAR[key]) : '#444444';
  }

  // Met à jour les carrés de couleur et l'aperçu du groupe.
  function refreshColorUI() {
    if (!dialogState || !dialogState.withColors) return;
    els.swatches.forEach((btn) => { btn.style.background = effectiveColor(btn.dataset.key); });
    els.preview.style.background = effectiveColor('bg');
    els.preview.style.borderColor = effectiveColor('border');
    els.preview.style.color = effectiveColor('text');
    els.preview.textContent = els.dialogInput.value.trim() || 'Nom du groupe';
  }

  function pickGroupColor(key) {
    const T = window.ThemeColors;
    if (!dialogState || !T || !T.pickColor) return;
    const labels = { bg: 'Fond du groupe', border: 'Bordure du groupe', text: 'Texte du groupe' };
    T.pickColor(labels[key], effectiveColor(key), (hex) => {
      if (!dialogState || !dialogState.colors) return;
      dialogState.colors[key] = hex;
      refreshColorUI();
    });
  }

  function askName(opts) {
    return openDialog({ title: opts.title, initial: opts.initial, okLabel: opts.okLabel, withInput: true });
  }

  // Fenêtre « groupe » : nom + couleurs (Personnaliser). Renvoie { name, colors } ou null.
  function askGroup(opts) {
    return openDialog({
      title: opts.title, initial: opts.initial, okLabel: opts.okLabel,
      withInput: true, withColors: true, colors: opts.colors,
    });
  }

  function askConfirm(opts) {
    return openDialog({ title: opts.title, message: opts.message, okLabel: opts.okLabel, danger: true, withInput: false });
  }

  /* =========================================================
     Actions (écriture dans Supabase)
     ========================================================= */
  async function addNode(parentId) {
    const isGroup = parentId === null;
    let name;
    let colors = null;
    if (isGroup) {
      const res = await askGroup({ title: 'Nouveau groupe', okLabel: 'Créer' });
      if (!res) return;
      name = res.name;
      colors = res.colors;
    } else {
      name = await askName({ title: 'Nouvel onglet', okLabel: 'Créer' });
      if (!name) return;
    }

    const client = getClient();
    if (!client) return;

    spinnerOn();
    const payload = { parent_id: parentId, name };
    if (hasOrder) {
      payload.sort_order = childrenOf(parentId).reduce((m, n) => Math.max(m, n.sort_order || 0), 0) + 1;
    }
    const { data, error } = await client
      .from(TABLE)
      .insert(payload)
      .select(hasOrder ? COLS : COLS_LEGACY)
      .single();
    spinnerOff();

    if (error) {
      console.error('[FX-FUND] Erreur création :', error);
      setStatus(friendlyError(error, 'Impossible de créer l\'élément'));
      return;
    }

    nodes.set(data.id, normalize(data));
    if (isGroup && colors) saveGroupColors(data.id, colors);
    if (parentId) openIds.add(parentId);
    openIds.add(data.id);
    saveOpen();
    setStatus('');
    render();
  }

  async function renameNode(id) {
    const node = nodes.get(id);
    if (!node) return;
    const isGroup = node.parent_id === null;

    let name;
    let colors = null;
    if (isGroup) {
      const res = await askGroup({
        title: 'Modifier le groupe',
        initial: node.name,
        okLabel: 'Enregistrer',
        colors: getGroupColors(id),
      });
      if (!res) return;
      name = res.name;
      colors = res.colors;
    } else {
      name = await askName({ title: 'Renommer', initial: node.name, okLabel: 'Enregistrer' });
      if (!name) return;
    }

    if (colors) saveGroupColors(id, colors); // personnel : thème du compte, pas la table partagée

    if (name !== node.name) {
      const client = getClient();
      if (!client) return;

      spinnerOn();
      const { error } = await client.from(TABLE).update({ name }).eq('id', id);
      spinnerOff();

      if (error) {
        console.error('[FX-FUND] Erreur renommage :', error);
        setStatus(friendlyError(error, 'Impossible de renommer'));
        render();
        return;
      }
      node.name = name;
    }
    setStatus('');
    render();
  }

  async function deleteNode(id) {
    const node = nodes.get(id);
    if (!node) return;
    const count = descendantIds(id).length;
    const extra = count
      ? ' et les ' + count + ' onglet' + (count > 1 ? 's' : '') + ' qu\'il contient'
      : '';
    const ok = await askConfirm({
      title: 'Supprimer',
      message: '« ' + node.name + ' »' + extra + ' ser' + (count ? 'ont' : 'a') +
        ' supprimé' + (count ? 's' : '') + ' pour tous les utilisateurs. Cette action est définitive.',
      okLabel: 'Supprimer',
    });
    if (!ok) return;

    const client = getClient();
    if (!client) return;

    spinnerOn();
    const { error } = await client.from(TABLE).delete().eq('id', id);
    spinnerOff();

    if (error) {
      console.error('[FX-FUND] Erreur suppression :', error);
      setStatus(friendlyError(error, 'Impossible de supprimer'));
      return;
    }
    removeLocal(id);
    if (node.parent_id === null) saveGroupColors(id, { bg: null, border: null, text: null });
    setStatus('');
    render();
  }

  /* ---------- Sauvegarde du texte (différée) ---------- */
  function scheduleSave(id) {
    dirty.add(id);
    if (timers.has(id)) window.clearTimeout(timers.get(id));
    timers.set(id, window.setTimeout(() => flushSave(id), SAVE_DELAY_MS));
  }

  async function flushSave(id) {
    if (timers.has(id)) {
      window.clearTimeout(timers.get(id));
      timers.delete(id);
    }
    if (!dirty.has(id)) return;

    const node = nodes.get(id);
    const client = getClient();
    dirty.delete(id);
    if (!node || !client) return;

    spinnerOn();
    saving.add(id);
    let error = null;
    try {
      const res = await client.from(TABLE).update({ content: node.content }).eq('id', id).select('id');
      error = res.error;
      // Une mise à jour refusée par les règles d'accès ne renvoie aucune ligne ni erreur : ce n'est PAS enregistré
      if (!error && (!res.data || !res.data.length)) error = { message: 'Aucune ligne modifiée (accès refusé ou note supprimée)' };
    } catch (e) { error = e; } finally { saving.delete(id); }
    spinnerOff();

    if (error) {
      console.error('[FX-FUND] Erreur sauvegarde du texte :', error);
      dirty.add(id); // sera retenté à la prochaine frappe ou au prochain retrait du focus
      setStatus(friendlyError(error, 'Impossible d\'enregistrer le texte'));
    } else {
      setStatus('');
    }
  }

  function flushAll() {
    Array.from(dirty).forEach((id) => flushSave(id));
  }

  /* =========================================================
     Déplacement (ordre + changement de parent)
     ========================================================= */
  // Où un nœud peut-il aller ?
  //  - un groupe reste à la racine (on change seulement son ordre) ;
  //  - un onglet va dans un groupe ou dans un autre onglet qui n'a pas de texte,
  //    jamais dans lui-même ni dans un de ses sous-onglets.
  function canDropAs(node, newParentId) {
    if (node.parent_id === null) return newParentId === null;
    if (newParentId === null || newParentId === node.id) return false;
    const target = nodes.get(newParentId);
    if (!target) return false;
    if (descendantIds(node.id).includes(newParentId)) return false;
    return canAddChild(target);
  }

  async function moveNode(id, newParentId, index) {
    const node = nodes.get(id);
    if (!node || !canDropAs(node, newParentId)) return;
    if (!hasOrder) {
      setStatus('Pour déplacer, exécute d\'abord supabase-fundamental-order.sql dans le SQL Editor de Supabase.');
      return;
    }
    const client = getClient();
    if (!client) return;

    const sibs = childrenOf(newParentId).filter((n) => n.id !== id);
    sibs.splice(Math.max(0, Math.min(index, sibs.length)), 0, node);

    const updates = [];
    sibs.forEach((n, i) => {
      const pos = i + 1;
      const parentChanged = n.id === id && n.parent_id !== newParentId;
      if (n.sort_order !== pos || parentChanged) updates.push({ id: n.id, pos, parentChanged });
    });
    if (!updates.length) return;

    // Affichage immédiat, puis envoi à Supabase (partagé en direct).
    updates.forEach((u) => {
      const n = nodes.get(u.id);
      n.sort_order = u.pos;
      if (u.parentChanged) n.parent_id = newParentId;
    });
    if (newParentId) openIds.add(newParentId);
    saveOpen();
    setStatus('');
    render();

    spinnerOn();
    const results = await Promise.all(updates.map((u) => {
      const patch = { sort_order: u.pos };
      if (u.parentChanged) patch.parent_id = newParentId;
      return client.from(TABLE).update(patch).eq('id', u.id);
    }));
    spinnerOff();

    const failed = results.find((r) => r.error);
    if (failed) {
      console.error('[FX-FUND] Erreur déplacement :', failed.error);
      setStatus(friendlyError(failed.error, 'Impossible de déplacer'));
      load();
    }
  }

  // where : 'before' | 'after' (frère de la cible) | 'inside' (dans la cible, à la fin)
  function moveRelative(id, targetId, where) {
    const t = nodes.get(targetId);
    if (!t) return;
    if (where === 'inside') {
      return moveNode(id, targetId, childrenOf(targetId).filter((n) => n.id !== id).length);
    }
    const sibs = childrenOf(t.parent_id).filter((n) => n.id !== id);
    const i = sibs.findIndex((n) => n.id === targetId);
    if (i < 0) return;
    return moveNode(id, t.parent_id, where === 'before' ? i : i + 1);
  }

  function shiftNode(id, dir) {
    const n = nodes.get(id);
    if (!n) return;
    const sibs = childrenOf(n.parent_id);
    const j = sibs.findIndex((x) => x.id === id) + dir;
    if (j < 0 || j >= sibs.length) return;
    moveRelative(id, sibs[j].id, dir < 0 ? 'before' : 'after');
  }

  /* =========================================================
     Copier / coller
     Copier = le nœud + son contenu DIRECT uniquement :
       - son texte, ou ses sous-onglets du premier niveau (avec leur texte) ;
       - les sous-onglets des sous-onglets ne sont PAS copiés.
     (Copier l'onglet 1 prend l'onglet 1 + l'onglet 2 ; l'onglet 3, qui est
     dans l'onglet 2, reste de côté. Copier l'onglet 2 prend l'onglet 2 + 3.)
     Au collage, seul l'élément principal peut être renommé.
     ========================================================= */
  let clip = null; // { kind: 'group' | 'tab', name, content, colors, kids: [{ name, content }] }

  function copyNode(id) {
    const n = nodes.get(id);
    if (!n) return;
    const kids = childrenOf(id);
    clip = {
      kind: n.parent_id === null ? 'group' : 'tab',
      name: n.name,
      content: kids.length ? '' : n.content,
      colors: n.parent_id === null ? getGroupColors(id) : null,
      kids: kids.map((k) => ({ name: k.name, content: childrenOf(k.id).length ? '' : k.content })),
    };
    setStatus('');
  }

  // where : 'inside' (dans la cible, à la fin) | 'after' (juste après la cible, même niveau)
  function canPaste(targetId, where) {
    const t = nodes.get(targetId);
    if (!clip || !t) return false;
    if (clip.kind === 'group') return where === 'after' && t.parent_id === null;
    if (where === 'inside') return canAddChild(t);
    return t.parent_id !== null;
  }

  async function pasteClip(targetId, where) {
    const c = clip;
    if (!c || !canPaste(targetId, where)) return;

    let name;
    let colors = null;
    if (c.kind === 'group') {
      const res = await askGroup({ title: 'Coller le groupe', initial: c.name, okLabel: 'Coller', colors: c.colors });
      if (!res) return;
      name = res.name;
      colors = res.colors;
    } else {
      name = await askName({ title: 'Coller l\'onglet', initial: c.name, okLabel: 'Coller' });
      if (!name) return;
    }

    // L'arbre a pu changer pendant que la fenêtre était ouverte (temps réel).
    const target = nodes.get(targetId);
    if (!target || !canPaste(targetId, where)) {
      setStatus('Impossible de coller ici : l\'élément a changé entre-temps.');
      return;
    }
    const client = getClient();
    if (!client) return;

    const parentId = where === 'inside' ? targetId : target.parent_id;
    const columns = hasOrder ? COLS : COLS_LEGACY;
    const rootRow = { parent_id: parentId, name, content: c.content };
    if (hasOrder) rootRow.sort_order = childrenOf(parentId).reduce((m, n) => Math.max(m, n.sort_order || 0), 0) + 1;

    spinnerOn();
    const first = await client.from(TABLE).insert(rootRow).select(columns).single();
    if (first.error) {
      spinnerOff();
      console.error('[FX-FUND] Erreur collage :', first.error);
      setStatus(friendlyError(first.error, 'Impossible de coller'));
      return;
    }
    const root = first.data;
    nodes.set(root.id, normalize(root));

    let failure = null;
    const rows = c.kids.map((k, i) => {
      const r = { parent_id: root.id, name: k.name, content: k.content };
      if (hasOrder) r.sort_order = i + 1;
      return r;
    });
    if (rows.length && hasOrder) {
      const res = await client.from(TABLE).insert(rows).select(columns);
      if (res.error) failure = res.error;
      else res.data.forEach((d) => nodes.set(d.id, normalize(d)));
    } else {
      // Sans colonne d'ordre, l'ordre vient de la date de création : on insère un par un.
      for (const r of rows) {
        const res = await client.from(TABLE).insert(r).select(columns).single();
        if (res.error) { failure = res.error; break; }
        nodes.set(res.data.id, normalize(res.data));
      }
    }
    spinnerOff();

    if (colors) saveGroupColors(root.id, colors);
    if (parentId) openIds.add(parentId);
    openIds.add(root.id);
    saveOpen();
    if (failure) {
      console.error('[FX-FUND] Erreur collage (contenu) :', failure);
      setStatus(friendlyError(failure, 'La copie est incomplète'));
    } else {
      setStatus('');
    }
    render();

    if (where === 'after' && hasOrder) await moveRelative(root.id, targetId, 'after');
  }

  /* ---------- Glisser-déposer à la souris ---------- */
  let drag = null; // { id, startX, startY, active, ghost, target, scrollEl, timer, lastX, lastY, pendingRender }
  let suppressClick = false;

  function scrollParentOf(node) {
    let e = node.parentElement;
    while (e && e !== document.body && e !== document.documentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight) return e;
      e = e.parentElement;
    }
    return null;
  }

  function onTreePointerDown(e) {
    if (e.button !== 0 || e.pointerType !== 'mouse' || !els.tree) return;
    const row = e.target.closest ? e.target.closest('.fund-row') : null;
    if (!row || !els.tree.contains(row)) return;
    const id = row.parentElement.dataset.id;
    if (!nodes.has(id)) return;
    drag = {
      id, row, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY,
      active: false, ghost: null, target: null, scrollEl: null, timer: null, pendingRender: false,
    };
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragEnd);
    document.addEventListener('pointercancel', onDragCancel);
    document.addEventListener('keydown', onDragKey, true);
  }

  function startDrag() {
    const d = drag;
    const wrap = d.row.parentElement;
    d.active = true;
    d.scrollEl = scrollParentOf(els.tree);
    document.body.classList.add('fund-dragging');
    wrap.classList.add('is-dragging');
    const ghost = el('div', 'fund-node fund-drag-ghost ' + (wrap.classList.contains('fund-node--group') ? 'fund-node--group' : 'fund-node--tab'));
    ghost.style.cssText = wrap.style.cssText; // couleurs propres au groupe
    ghost.style.width = d.row.offsetWidth + 'px';
    ghost.appendChild(d.row.cloneNode(true));
    document.body.appendChild(ghost);
    d.ghost = ghost;
    d.offsetX = d.startX - d.row.getBoundingClientRect().left;
    d.offsetY = d.startY - d.row.getBoundingClientRect().top;
    try { window.getSelection().removeAllRanges(); } catch (err) { /* ignoré */ }
    // Défilement automatique près des bords de l'écran.
    d.timer = window.setInterval(() => {
      if (!drag || !drag.active) return;
      const top = d.scrollEl ? d.scrollEl.getBoundingClientRect().top : 0;
      const bottom = d.scrollEl ? d.scrollEl.getBoundingClientRect().bottom : window.innerHeight;
      let dy = 0;
      if (d.lastY < top + 60) dy = -Math.ceil((top + 60 - d.lastY) / 4);
      else if (d.lastY > bottom - 60) dy = Math.ceil((d.lastY - (bottom - 60)) / 4);
      if (!dy) return;
      if (d.scrollEl) d.scrollEl.scrollTop += dy; else window.scrollBy(0, dy);
      updateDropTarget();
    }, 30);
  }

  function computeDropTarget(x, y) {
    const d = drag;
    const hit = document.elementFromPoint(x, y);
    const row = hit && hit.closest ? hit.closest('.fund-row') : null;
    if (!row || !els.tree.contains(row)) return null;
    const tid = row.parentElement.dataset.id;
    const dragged = nodes.get(d.id);
    const t = nodes.get(tid);
    if (!dragged || !t || tid === d.id || descendantIds(d.id).includes(tid)) return null;

    const rect = row.getBoundingClientRect();
    const ratio = (y - rect.top) / Math.max(1, rect.height);
    const tIsGroup = t.parent_id === null;

    if (dragged.parent_id === null) { // un groupe ne se place qu'entre groupes
      if (!tIsGroup) return null;
      return { id: tid, where: ratio < 0.5 ? 'before' : 'after', row };
    }
    let where;
    if (tIsGroup) {
      where = 'inside';
    } else if (ratio < 0.25) {
      where = 'before';
    } else if (ratio > 0.75) {
      where = 'after';
    } else {
      where = canDropAs(dragged, tid) ? 'inside' : (ratio < 0.5 ? 'before' : 'after');
    }
    const newParent = where === 'inside' ? tid : t.parent_id;
    if (!canDropAs(dragged, newParent)) return null;
    return { id: tid, where, row };
  }

  function clearDropMarks() {
    if (!els.tree) return;
    els.tree.querySelectorAll('.fund-drop-before, .fund-drop-after, .fund-drop-inside').forEach((n) => {
      n.classList.remove('fund-drop-before', 'fund-drop-after', 'fund-drop-inside');
    });
  }

  function updateDropTarget() {
    const d = drag;
    if (!d || !d.active) return;
    const target = computeDropTarget(d.lastX, d.lastY);
    clearDropMarks();
    d.target = target;
    if (!target) return;
    if (target.where === 'inside') target.row.classList.add('fund-drop-inside');
    else target.row.parentElement.classList.add(target.where === 'before' ? 'fund-drop-before' : 'fund-drop-after');
  }

  function onDragMove(e) {
    const d = drag;
    if (!d) return;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return;
      startDrag();
    }
    d.ghost.style.left = (e.clientX - d.offsetX) + 'px';
    d.ghost.style.top = (e.clientY - d.offsetY) + 'px';
    updateDropTarget();
  }

  function endDragCleanup() {
    const d = drag;
    drag = null;
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragEnd);
    document.removeEventListener('pointercancel', onDragCancel);
    document.removeEventListener('keydown', onDragKey, true);
    if (!d) return null;
    if (d.timer) window.clearInterval(d.timer);
    if (d.ghost) d.ghost.remove();
    document.body.classList.remove('fund-dragging');
    clearDropMarks();
    if (els.tree) els.tree.querySelectorAll('.is-dragging').forEach((n) => n.classList.remove('is-dragging'));
    return d;
  }

  function onDragEnd() {
    const d = endDragCleanup();
    if (!d || !d.active) return;
    // Évite qu'un clic fantôme ouvre/ferme l'onglet qu'on vient de lâcher.
    suppressClick = true;
    window.setTimeout(() => { suppressClick = false; }, 0);
    // un rendu différé pendant le glisser (changement reçu d'un autre appareil) ne doit jamais être perdu
    if (d.target) Promise.resolve(moveRelative(d.id, d.target.id, d.target.where)).finally(() => { if (d.pendingRender) render(); });
    else if (d.pendingRender) render();
  }

  function onDragCancel() {
    const d = endDragCleanup();
    if (d && d.pendingRender) render();
  }

  function onDragKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onDragCancel();
    }
  }

  /* =========================================================
     Menu clic droit (comme un menu contextuel du bureau)
     ========================================================= */
  let ctx = null; // élément du menu ouvert

  function closeMenu() {
    if (!ctx) return;
    ctx.remove();
    ctx = null;
    document.removeEventListener('pointerdown', onMenuOutside, true);
    document.removeEventListener('keydown', onMenuKey, true);
    document.removeEventListener('scroll', closeMenu, true);
    window.removeEventListener('resize', closeMenu);
    window.removeEventListener('blur', closeMenu);
  }

  function onMenuOutside(e) {
    if (ctx && !ctx.contains(e.target)) closeMenu();
  }

  function onMenuKey(e) {
    if (!ctx) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(ctx.querySelectorAll('.fund-ctx-item:not(:disabled)'));
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
    items[next].focus();
  }

  function openMenu(x, y, items) {
    closeMenu();
    const menu = el('div', 'fund-ctx');
    menu.setAttribute('role', 'menu');
    menu.tabIndex = -1;
    items.forEach((it) => {
      if (it.sep) {
        menu.appendChild(el('div', 'fund-ctx-sep'));
        return;
      }
      const b = el('button', 'fund-ctx-item' + (it.danger ? ' is-danger' : ''), it.label);
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.disabled = !!it.disabled;
      b.addEventListener('click', () => {
        closeMenu();
        it.onClick();
      });
      menu.appendChild(b);
    });
    menu.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.appendChild(menu);

    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - h - 4)) + 'px';
    ctx = menu;
    menu.focus({ preventScroll: true });

    document.addEventListener('pointerdown', onMenuOutside, true);
    document.addEventListener('keydown', onMenuKey, true);
    document.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('blur', closeMenu);
  }

  function onTreeContextMenu(e) {
    const row = e.target.closest ? e.target.closest('.fund-row') : null;
    if (!row || !els.tree.contains(row)) return; // zone de texte : menu normal (copier/coller)
    const id = row.parentElement.dataset.id;
    const node = nodes.get(id);
    if (!node) return;
    e.preventDefault();
    if (drag && drag.active) return;

    const isGroup = node.parent_id === null;
    const sibs = childrenOf(node.parent_id);
    const idx = sibs.findIndex((n) => n.id === id);
    openMenu(e.clientX, e.clientY, [
      { label: isGroup ? 'Modifier / personnaliser…' : 'Renommer…', onClick: () => renameNode(id) },
      { label: 'Ajouter un onglet…', disabled: !canAddChild(node), onClick: () => addNode(id) },
      { sep: true },
      { label: 'Copier', onClick: () => copyNode(id) },
      { label: 'Coller à l\'intérieur…', disabled: !canPaste(id, 'inside'), onClick: () => pasteClip(id, 'inside') },
      { label: 'Coller après…', disabled: !canPaste(id, 'after'), onClick: () => pasteClip(id, 'after') },
      { sep: true },
      { label: 'Monter', disabled: idx <= 0, onClick: () => shiftNode(id, -1) },
      { label: 'Descendre', disabled: idx < 0 || idx >= sibs.length - 1, onClick: () => shiftNode(id, 1) },
      { sep: true },
      { label: 'Supprimer', danger: true, onClick: () => deleteNode(id) },
    ]);
  }

  /* =========================================================
     Chargement et temps réel
     ========================================================= */
  async function load() {
    const client = getClient();
    if (!client || !userId || loading) return;
    loading = true;

    let res = await client.from(TABLE).select(hasOrder ? COLS : COLS_LEGACY).order('created_at', { ascending: true });
    if (res.error && hasOrder && (/sort_order/.test(res.error.message || '') || res.error.code === '42703')) {
      hasOrder = false; // colonne pas encore créée : l'appli marche, mais sans déplacement
      res = await client.from(TABLE).select(COLS_LEGACY).order('created_at', { ascending: true });
    }
    const { data, error } = res;
    loading = false;

    if (error) {
      console.error('[FX-FUND] Erreur chargement :', error);
      setStatus(friendlyError(error, 'Chargement impossible'));
      loaded = true;
      render();
      return;
    }

    const next = new Map();
    data.forEach((row) => {
      const n = normalize(row);
      const local = nodes.get(n.id);
      if (local && (dirty.has(n.id) || saving.has(n.id))) n.content = local.content; // ne jamais écraser une frappe non envoyée
      next.set(n.id, n);
    });
    nodes = next;
    loaded = true;
    setStatus('');
    render();
  }

  function onRealtime(payload) {
    if (payload.eventType === 'DELETE') {
      const id = payload.old && payload.old.id;
      if (id && nodes.has(id)) {
        removeLocal(id);
        render();
      }
      return;
    }

    const row = payload.new;
    if (!row || !row.id) return;

    const existing = nodes.get(row.id);
    if (!existing) {
      nodes.set(row.id, normalize(row));
      render();
      return;
    }

    let needsRender = false;
    if (row.name !== undefined && existing.name !== row.name) {
      existing.name = row.name;
      needsRender = true;
    }
    if (row.parent_id !== undefined && existing.parent_id !== (row.parent_id || null)) {
      existing.parent_id = row.parent_id || null;
      needsRender = true;
    }

    if (row.sort_order !== undefined && existing.sort_order !== row.sort_order) {
      existing.sort_order = row.sort_order;
      needsRender = true;
    }

    // Le texte n'est mis à jour que si je ne suis pas en train de l'écrire.
    // (Supabase peut omettre "content" quand il n'a pas changé : on ignore alors.)
    const protect = dirty.has(row.id) || saving.has(row.id) || isEditing(row.id) || !!(dict && dict.id === row.id);
    if (!protect && row.content !== undefined && existing.content !== row.content) {
      existing.content = row.content;
      const ta = textareaFor(row.id);
      if (ta) {
        ta.value = row.content;
        autosize(ta);
      }
    }

    if (needsRender) render();
  }

  function subscribe() {
    const client = getClient();
    if (!client) return;
    unsubscribe();
    channel = client
      .channel('fundamental_nodes_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, onRealtime)
      .subscribe();
  }

  function unsubscribe() {
    const client = getClient();
    if (channel && client) client.removeChannel(channel);
    channel = null;
  }

  function start(uid) {
    if (uid === userId) return;
    userId = uid;
    loaded = false;
    render();
    load().then(subscribe);
  }

  function stop() {
    if (!userId) return;
    userId = null;
    clip = null;
    unsubscribe();
    nodes = new Map();
    dirty.clear();
    loaded = false;
    render();
  }

  function isTabActive() {
    const panel = document.getElementById('tab-5');
    return !!(panel && panel.classList.contains('is-active'));
  }

  /* =========================================================
     Init
     ========================================================= */
  function init() {
    els.tree = document.getElementById('fundTree');
    els.status = document.getElementById('fundStatus');
    els.addGroupBtn = document.getElementById('fundAddGroupBtn');
    els.dialog = document.getElementById('fundDialog');
    els.dialogTitle = document.getElementById('fundDialogTitle');
    els.dialogMessage = document.getElementById('fundDialogMessage');
    els.dialogInput = document.getElementById('fundDialogInput');
    els.dialogError = document.getElementById('fundDialogError');
    els.dialogOk = document.getElementById('fundDialogOk');
    els.dialogCancel = document.getElementById('fundDialogCancel');
    els.customToggle = document.getElementById('fundDialogCustomToggle');
    els.custom = document.getElementById('fundDialogCustom');
    els.preview = document.getElementById('fundDialogPreview');
    els.swatches = Array.from(document.querySelectorAll('.fund-dialog-swatch'));
    els.colorReset = document.getElementById('fundDialogColorReset');
    if (!els.tree || !els.dialog) return;

    els.addGroupBtn.addEventListener('click', () => addNode(null));

    els.tree.addEventListener('pointerdown', onTreePointerDown);
    els.tree.addEventListener('contextmenu', onTreeContextMenu);
    els.tree.addEventListener('click', (e) => {
      if (!suppressClick) return;
      e.stopPropagation();
      e.preventDefault();
    }, true);

    els.dialogOk.addEventListener('click', submitDialog);
    els.dialogCancel.addEventListener('click', () => finishDialog(null));
    els.dialog.addEventListener('click', (event) => {
      if (event.target === els.dialog) finishDialog(null);
    });
    els.dialogInput.addEventListener('input', () => {
      els.dialogError.hidden = true;
      refreshColorUI();
    });
    els.customToggle.addEventListener('click', () => setCustomOpen(els.custom.hidden));
    els.swatches.forEach((btn) => btn.addEventListener('click', () => pickGroupColor(btn.dataset.key)));
    els.colorReset.addEventListener('click', () => {
      if (!dialogState || !dialogState.colors) return;
      dialogState.colors = { bg: null, border: null, text: null };
      refreshColorUI();
    });
    // Le thème peut changer ailleurs (autre appareil du même compte, réinitialisation).
    window.addEventListener('fx-theme-changed', () => render());
    document.addEventListener('keydown', (event) => {
      if (!dialogState) return;
      // Le sélecteur de couleur gère lui-même sa fermeture.
      const cp = document.getElementById('cpOverlay');
      if (cp && cp.classList.contains('is-open')) return;
      if (event.key === 'Escape') {
        finishDialog(null);
      } else if (event.key === 'Enter' && event.target === els.dialogInput) {
        event.preventDefault();
        submitDialog();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flushAll();
      else if (userId && isTabActive()) load();
    });
    window.addEventListener('pagehide', flushAll);
    window.addEventListener('pagehide', closeMenu);
    window.addEventListener('resize', () => {
      els.tree.querySelectorAll('.fund-text').forEach(autosize);
    });

    render();

    if (window.Auth && window.Auth.onAuthStateChange) {
      window.Auth.onAuthStateChange((session) => {
        const uid = session && session.user ? session.user.id : null;
        // setTimeout : on évite d'appeler Supabase directement depuis son propre callback.
        window.setTimeout(() => (uid ? start(uid) : stop()), 0);
      });
    }
    if (window.Auth && window.Auth.getSession) {
      window.Auth.getSession().then((session) => {
        if (session && session.user) start(session.user.id);
      });
    }
  }

  window.Fundamental = {
    // Appelé par app.js à chaque ouverture de l'onglet : données fraîches.
    refresh() {
      if (userId) load();
    },
  };

  document.addEventListener('DOMContentLoaded', init);
})();
