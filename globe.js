'use strict';

/**
 * globe.js
 * Fenêtre « Globe » : globe 3D plein écran (CesiumJS), vue depuis l'espace, avec les navires de transport en direct.
 *
 *  - Rendu « Google Earth » : Photorealistic 3D Tiles de Google (même donnée que Google Earth) si une clé
 *    Google Maps Platform est renseignée (GOOGLE_MAPS_API_KEY dans supabase-config.js). Sans clé, ou si Google
 *    refuse la clé, le globe passe sur l'imagerie satellite gratuite d'Esri.
 *  - Navires : pétroliers et cargos / porte-conteneurs (AIS, via l'edge function ais-bot qui alimente la table
 *    ships). Lecture en un seul appel (fonction SQL get_ships), rafraîchie toutes les 2 minutes tant que la
 *    fenêtre est ouverte. Les points de passage stratégiques (Ormuz, Suez, Malacca...) affichent le nombre de
 *    navires présents et un bouton pour y voler.
 *  - Le globe n'est créé qu'à la première ouverture de la fenêtre ; il est mis en pause quand on la quitte.
 * Couleurs : style.css (variables --globe-*) ou Paramètres > Thème > Globe.
 */
(function () {
  const PANEL_ID = 'tab-globe';
  const CESIUM_VERSION = '1.119.0';
  const CESIUM_BASE = `https://cdn.jsdelivr.net/npm/cesium@${CESIUM_VERSION}/Build/Cesium/`;
  const ESRI_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const SHIPS_POLL_MS = 2 * 60 * 1000;
  const SPACE_VIEW = { lon: 35, lat: 22, h: 24000000 };
  const LS_FILTERS = 'fxt-globe-filters';

  // Points de passage qui comptent pour les marchés : [nom, ouest, sud, est, nord, pourquoi]
  const CHOKES = [
    ['Ormuz', 54.0, 24.3, 58.8, 27.3, 'Pétrole du Golfe : environ un cinquième de la consommation mondiale'],
    ['Bab-el-Mandeb', 41.5, 11.5, 45.5, 14.5, 'Entrée de la mer Rouge : route Asie-Europe via Suez'],
    ['Suez', 31.8, 29.3, 33.3, 31.6, 'Canal Asie-Europe : pétrole, GNL, conteneurs'],
    ['Malacca', 98.0, 1.0, 104.5, 6.0, 'Route Asie : pétrole vers la Chine, le Japon, la Corée'],
    ['Taïwan', 118.0, 22.0, 121.8, 26.5, 'Conteneurs et pétrole d\'Asie de l\'Est'],
    ['Panama', -80.4, 8.6, -79.2, 9.6, 'Canal Atlantique-Pacifique : GNL, céréales, conteneurs'],
    ['Gibraltar', -6.3, 35.7, -4.8, 36.4, 'Entrée de la Méditerranée'],
    ['Bosphore', 28.8, 40.9, 29.3, 41.3, 'Pétrole de la mer Noire et de la Caspienne'],
    ['Manche', -2.5, 49.8, 2.0, 51.6, 'Nord de l\'Europe : conteneurs de Rotterdam, Anvers, Le Havre'],
    ['Golfe du Mexique', -98.0, 26.0, -88.0, 30.5, 'Exportations de pétrole et de GNL des États-Unis'],
    ['Cap de Bonne-Espérance', 16.0, -37.0, 21.0, -33.0, 'Déroutement des navires évitant la mer Rouge'],
  ];

  const CATS = {
    tanker: { label: 'Pétroliers', cssVar: '--globe-tanker', fallback: '#ff8a1f', one: 'Pétrolier' },
    cargo: { label: 'Cargos / porte-conteneurs', cssVar: '--globe-cargo', fallback: '#4d94ff', one: 'Cargo / porte-conteneurs' },
  };

  let built = false;
  let active = false;
  let viewer = null;
  let initPromise = null;
  let googleOn = false;
  let timer = null;
  let loadingShips = false;
  let shipsAt = 0;
  let shipRows = [];
  let selected = null;
  const collections = {};
  const filters = { tanker: true, cargo: true };
  const els = {};

  try {
    const f = JSON.parse(localStorage.getItem(LS_FILTERS) || 'null');
    if (f && typeof f === 'object') { filters.tanker = f.tanker !== false; filters.cargo = f.cargo !== false; }
  } catch (e) { /* stockage indisponible */ }

  const cssVar = (n, d) => { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d; } catch (e) { return d; } };
  const nf = new Intl.NumberFormat('fr-FR');

  /* ---------------- Chargement de CesiumJS (à la demande) ---------------- */
  function loadCesium() {
    if (window.Cesium) return Promise.resolve();
    if (loadCesium.p) return loadCesium.p;
    window.CESIUM_BASE_URL = CESIUM_BASE;
    loadCesium.p = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = CESIUM_BASE + 'Widgets/widgets.css';
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = CESIUM_BASE + 'Cesium.js';
      s.async = true;
      s.onload = () => (window.Cesium ? resolve() : reject(new Error('Cesium absent')));
      s.onerror = () => { loadCesium.p = null; reject(new Error('Impossible de charger CesiumJS')); };
      document.head.appendChild(s);
    });
    return loadCesium.p;
  }

  /* ---------------- Page ---------------- */
  function setStatus(text) {
    if (!els.status) return;
    els.status.textContent = text || '';
    els.status.hidden = !text;
  }

  function build() {
    if (built) return;
    const sec = document.getElementById(PANEL_ID);
    if (!sec) return;
    built = true;
    sec.innerHTML = `
      <div class="calendar-toolbar"><span class="calendar-toolbar-title">Globe</span>
        <div class="calendar-toolbar-tools globe-bar" data-globe-bar></div>
      </div>
      <div class="globe-choke" data-globe-choke aria-label="Points de passage stratégiques"></div>
      <div class="globe-wrap">
        <div class="globe-view" data-globe-view></div>
        <div class="globe-status" data-globe-status>Chargement du globe…</div>
        <div class="globe-info" data-globe-info hidden></div>
      </div>`;
    els.sec = sec;
    els.bar = sec.querySelector('[data-globe-bar]');
    els.choke = sec.querySelector('[data-globe-choke]');
    els.view = sec.querySelector('[data-globe-view]');
    els.status = sec.querySelector('[data-globe-status]');
    els.info = sec.querySelector('[data-globe-info]');

    els.bar.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-cat]');
      if (b) {
        filters[b.dataset.cat] = !filters[b.dataset.cat];
        try { localStorage.setItem(LS_FILTERS, JSON.stringify(filters)); } catch (e) { /* ignoré */ }
        applyFilters();
        renderBar();
        return;
      }
      if (ev.target.closest('[data-globe-home]') && viewer) flyHome();
    });
    els.choke.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-choke]');
      if (b && viewer) flyToChoke(Number(b.dataset.choke));
    });
    renderBar();
    renderChokes();
  }

  function counts() {
    const c = { tanker: 0, cargo: 0 };
    shipRows.forEach((r) => { if (c[r[5]] !== undefined) c[r[5]] += 1; });
    return c;
  }

  function renderBar() {
    if (!els.bar) return;
    const c = counts();
    els.bar.innerHTML = Object.keys(CATS).map((k) => `<button type="button" class="globe-chip${filters[k] ? '' : ' is-off'}" data-cat="${k}" aria-pressed="${filters[k]}" style="--c:${cssVar(CATS[k].cssVar, CATS[k].fallback)}"><span class="globe-dot"></span>${CATS[k].label}<b>${shipRows.length ? nf.format(c[k]) : ''}</b></button>`).join('')
      + '<button type="button" class="globe-chip" data-globe-home>Vue globe</button>';
  }

  function chokeCounts() {
    return CHOKES.map((q) => {
      let n = 0;
      for (const r of shipRows) { if (r[2] >= q[1] && r[2] <= q[3] && r[1] >= q[2] && r[1] <= q[4]) n += 1; }
      return n;
    });
  }

  function renderChokes() {
    if (!els.choke) return;
    const n = chokeCounts();
    els.choke.innerHTML = CHOKES.map((q, i) => `<button type="button" class="globe-chip" data-choke="${i}" title="${String(q[5]).replace(/"/g, '&quot;')}">${q[0]}${shipRows.length ? `<b>${nf.format(n[i])}</b>` : ''}</button>`).join('');
  }

  /* ---------------- Globe ---------------- */
  function flyHome() {
    const C = window.Cesium;
    viewer.camera.flyTo({ destination: C.Cartesian3.fromDegrees(SPACE_VIEW.lon, SPACE_VIEW.lat, SPACE_VIEW.h), duration: 2.5 });
  }

  function flyToChoke(i) {
    const q = CHOKES[i];
    if (!q) return;
    const C = window.Cesium;
    const pad = 0.6;
    viewer.camera.flyTo({ destination: C.Rectangle.fromDegrees(q[1] - pad, q[2] - pad, q[3] + pad, q[4] + pad), duration: 2.5 });
  }

  async function initViewer() {
    if (viewer) return;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      await loadCesium();
      const C = window.Cesium;
      const v = new C.Viewer(els.view, {
        baseLayer: false,
        baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false,
        animation: false, timeline: false, fullscreenButton: false, infoBox: false, selectionIndicator: false, vrButton: false,
        skyAtmosphere: new C.SkyAtmosphere(),
      });
      v.scene.globe.enableLighting = false;
      v.scene.screenSpaceCameraController.minimumZoomDistance = 30;
      v.scene.globe.showGroundAtmosphere = true;
      // fond : satellite gratuit (aussi utilisé tant que Google 3D charge, ou en secours)
      v.imageryLayers.addImageryProvider(new C.UrlTemplateImageryProvider({ url: ESRI_URL, maximumLevel: 18, credit: 'Imagerie : Esri, Maxar, Earthstar Geographics' }));
      v.camera.setView({ destination: C.Cartesian3.fromDegrees(SPACE_VIEW.lon, SPACE_VIEW.lat, SPACE_VIEW.h) });
      viewer = v;

      Object.keys(CATS).forEach((k) => {
        collections[k] = v.scene.primitives.add(new C.PointPrimitiveCollection());
      });

      // points de passage : étiquettes
      CHOKES.forEach((q) => {
        v.entities.add({
          position: C.Cartesian3.fromDegrees((q[1] + q[3]) / 2, (q[2] + q[4]) / 2, 0),
          label: {
            text: q[0], font: '12px "Space Mono", monospace', fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 3,
            style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(0, -16),
            distanceDisplayCondition: new C.DistanceDisplayCondition(4e4, 9e6),
          },
        });
      });

      // clic sur un navire
      const handler = new C.ScreenSpaceEventHandler(v.scene.canvas);
      handler.setInputAction((m) => {
        const p = v.scene.pick(m.position);
        const ship = p && p.id && p.id.fxShip;
        if (ship) selectShip(p.primitive, ship); else selectShip(null, null);
      }, C.ScreenSpaceEventType.LEFT_CLICK);

      await addGoogleTiles(v);
      applyFilters();
    })().catch((e) => {
      console.warn('globe.js', e);
      initPromise = null;
      setStatus('Impossible de charger le globe : ' + (e && e.message ? e.message : 'erreur inconnue'));
      throw e;
    });
    return initPromise;
  }

  // Google Earth 3D (Photorealistic 3D Tiles) si une clé est renseignée ; sinon, ou en cas de refus, imagerie Esri.
  async function addGoogleTiles(v) {
    const C = window.Cesium;
    const key = (window.APP_CONFIG && window.APP_CONFIG.GOOGLE_MAPS_API_KEY) || '';
    if (!key) { setStatus('Imagerie satellite Esri · pour la vue Google Earth 3D, renseigne GOOGLE_MAPS_API_KEY'); return; }
    try {
      C.GoogleMaps.defaultApiKey = key;
      const ts = await C.createGooglePhotorealistic3DTileset();
      let failed = 0;
      ts.tileFailed.addEventListener(() => {
        failed += 1;
        if (failed === 3 && googleOn) {
          googleOn = false;
          v.scene.primitives.remove(ts);
          v.scene.globe.show = true;
          setStatus('Google Earth 3D indisponible (clé refusée ou API non activée) · imagerie Esri');
        }
      });
      v.scene.primitives.add(ts);
      v.scene.globe.show = false;
      googleOn = true;
      setStatus('');
    } catch (e) {
      console.warn('globe.js google', e);
      googleOn = false;
      v.scene.globe.show = true;
      setStatus('Google Earth 3D indisponible (clé refusée ou API non activée) · imagerie Esri');
    }
  }

  function applyFilters() {
    Object.keys(CATS).forEach((k) => { if (collections[k]) collections[k].show = !!filters[k]; });
  }

  /* ---------------- Navires ---------------- */
  function selectShip(point, r) {
    if (selected && selected.point) {
      try { selected.point.pixelSize = selected.size; selected.point.outlineWidth = 1; } catch (e) { /* point retiré */ }
    }
    selected = null;
    if (!r || !point) { els.info.hidden = true; return; }
    selected = { point, size: point.pixelSize };
    point.pixelSize = point.pixelSize * 2.2;
    point.outlineWidth = 2;

    const cat = CATS[r[5]] || { one: 'Navire' };
    const lines = [
      ['Type', cat.one],
      ['MMSI', String(r[0])],
      ['Vitesse', r[3] == null ? '—' : String(Math.round(r[3] * 10) / 10) + ' nœuds'],
      ['Cap', r[4] == null ? '—' : Math.round(r[4]) + '°'],
      ['Destination', r[7] || '—'],
      ['Longueur', r[8] ? r[8] + ' m' : '—'],
    ];
    els.info.textContent = '';
    const title = document.createElement('b');
    title.textContent = r[6] || 'Navire sans nom';
    els.info.appendChild(title);
    lines.forEach(([k, val]) => { const s = document.createElement('span'); s.textContent = `${k} : ${val}`; els.info.appendChild(s); });
    const a = document.createElement('a');
    a.href = 'https://www.marinetraffic.com/en/ais/details/ships/mmsi:' + encodeURIComponent(String(r[0]));
    a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'Fiche du navire (MarineTraffic)';
    a.className = 'trump-tweet-link';
    els.info.appendChild(a);
    els.info.hidden = false;
  }

  function drawShips() {
    if (!viewer) return;
    const C = window.Cesium;
    selectShip(null, null);
    const h = googleOn ? 150 : 5; // un peu au-dessus de la surface : les tuiles 3D de Google ne sont pas sur l'ellipsoïde
    const colors = {};
    Object.keys(CATS).forEach((k) => { colors[k] = C.Color.fromCssColorString(cssVar(CATS[k].cssVar, CATS[k].fallback)); collections[k].removeAll(); });
    const outline = C.Color.BLACK.withAlpha(0.6);
    const scale = new C.NearFarScalar(2e5, 1.7, 2.5e7, 0.7);
    shipRows.forEach((r) => {
      const col = collections[r[5]];
      if (!col) return;
      col.add({ position: C.Cartesian3.fromDegrees(r[2], r[1], h), pixelSize: 4, color: colors[r[5]], outlineColor: outline, outlineWidth: 1, scaleByDistance: scale, id: { fxShip: r } });
    });
  }

  function updateShipStatus() {
    if (!els.status) return;
    if (!shipRows.length) {
      setStatus('Aucun navire pour le moment : le robot AIS n\'a pas encore de données (clé AISStream à renseigner, puis environ 1 h pour remplir la carte)');
      return;
    }
    const t = shipsAt ? new Date(shipsAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
    const base = googleOn ? '' : (window.APP_CONFIG && window.APP_CONFIG.GOOGLE_MAPS_API_KEY ? 'Google Earth 3D indisponible · imagerie Esri · ' : 'Imagerie satellite Esri · ');
    setStatus(`${base}${nf.format(shipRows.length)} navires · mis à jour à ${t}`);
  }

  async function loadShips() {
    if (loadingShips || !viewer) return;
    const client = window.Auth && window.Auth.getClient ? window.Auth.getClient() : null;
    if (!client) return;
    loadingShips = true;
    try {
      if (!(await window.Auth.getSession())) return;
      const { data, error } = await client.rpc('get_ships');
      if (error) throw error;
      shipRows = Array.isArray(data) ? data.filter((r) => Array.isArray(r) && Number.isFinite(r[1]) && Number.isFinite(r[2]) && CATS[r[5]]) : [];
      shipsAt = Date.now();
      drawShips();
      renderBar();
      renderChokes();
      updateShipStatus();
    } catch (e) {
      console.warn('globe.js ships', e);
      if (!shipRows.length) setStatus('Impossible de charger les navires pour le moment');
    } finally {
      loadingShips = false;
    }
  }

  /* ---------------- Ouverture / fermeture de la fenêtre ---------------- */
  function setActive(on) {
    active = !!on;
    if (!active) {
      if (viewer) viewer.useDefaultRenderLoop = false;
      if (timer) { clearInterval(timer); timer = null; }
      return;
    }
    build();
    if (!els.view) return;
    initViewer().then(() => {
      if (!active || !viewer) return;
      viewer.useDefaultRenderLoop = true;
      viewer.resize();
      loadShips();
      if (!timer) timer = setInterval(() => { if (active && !document.hidden) loadShips(); }, SHIPS_POLL_MS);
    }).catch(() => { /* message déjà affiché */ });
  }

  window.Globe = { setActive, reload: loadShips };

  document.addEventListener('DOMContentLoaded', () => {
    window.addEventListener('fx-theme-changed', () => { if (viewer && shipRows.length) drawShips(); renderBar(); });
  });
})();
