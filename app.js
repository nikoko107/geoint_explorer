import { initStorage }        from './modules/storage.js';
import { initProjects, getActiveProject, saveActiveProject, getActiveId, createAndSwitchProject } from './modules/projects.js';
import { initLayers, initLayersPanel, reloadLayers, getLayerConfig, resizeCompareMap } from './modules/layers.js';
import { initTracker, reloadNavLog, resetNavLog } from './modules/tracker.js';
import { initAnnotations, initAnnotationsPanel, initAnnotationsTracking, reloadAnnotations } from './modules/annotations.js';
import { initTrackingZones, reloadZones }                from './modules/tracking-zones.js';
import { initExport, exportProject, parseProjectImport } from './modules/export.js';
import { initMeasure } from './modules/measure.js';
import { initOverpass, initOverpassStandalone, openOverpassPanel, openOverpassStandalone } from './modules/overpass.js';

// ── Cartes ────────────────────────────────────────────────────────

const mapAnalysis = new maplibregl.Map({
  container: 'map-analysis',
  style: {
    version: 8,
    sources: {
      'osm-base': {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [{
      id: 'osm-base',
      type: 'raster',
      source: 'osm-base',
      paint: { 'raster-opacity': 0.15 },
    }],
  },
  center: [2.3488, 48.8534],
  zoom: 12,
  attributionControl: false,
});

mapAnalysis.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
mapAnalysis.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
mapAnalysis.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

const mapTracking = new maplibregl.Map({
  container: 'map-tracking',
  style: {
    version: 8,
    sources: {
      'carto-dark': {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
          'https://b.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        attribution: '© CARTO © OpenStreetMap contributors',
      },
    },
    layers: [{
      id: 'carto-dark',
      type: 'raster',
      source: 'carto-dark',
    }],
  },
  center: [2.3488, 48.8534],
  zoom: 10,
  attributionControl: false,
});

mapTracking.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
mapTracking.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

// ── Séparateur redimensionnable ───────────────────────────────────

function initPaneDivider() {
  const divider   = document.getElementById('pane-divider');
  const container = document.getElementById('maps-container');
  const topPane   = document.getElementById('analysis-pane');
  const botPane   = document.getElementById('tracking-pane');
  if (!divider || !container || !topPane || !botPane) return;

  let dragging = false;

  function isVertical() {
    return window.innerWidth <= 900;
  }

  divider.addEventListener('mousedown', e => {
    e.preventDefault();
    dragging = true;
    divider.classList.add('dragging');
    document.body.style.cursor = isVertical() ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const rect = container.getBoundingClientRect();

    if (isVertical()) {
      const divH  = divider.offsetHeight;
      const offset = e.clientY - rect.top;
      const total  = rect.height - divH;
      const topPct = Math.min(80, Math.max(20, (offset / total) * 100));
      topPane.style.flexBasis  = `${topPct}%`;
      topPane.style.flexGrow   = '0';
      botPane.style.flexBasis  = `${100 - topPct}%`;
      botPane.style.flexGrow   = '0';
    } else {
      const divW  = divider.offsetWidth;
      const offset = e.clientX - rect.left;
      const total  = rect.width - divW;
      const leftPct = Math.min(80, Math.max(20, (offset / total) * 100));
      topPane.style.flexBasis  = `${leftPct}%`;
      topPane.style.flexGrow   = '0';
      botPane.style.flexBasis  = `${100 - leftPct}%`;
      botPane.style.flexGrow   = '0';
    }
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    mapAnalysis.resize();
    mapTracking.resize();
    resizeCompareMap();
  });

  // Double-clic → reset 50/50
  divider.addEventListener('dblclick', () => {
    topPane.style.flexBasis = '';
    topPane.style.flexGrow  = '';
    botPane.style.flexBasis = '';
    botPane.style.flexGrow  = '';
    mapAnalysis.resize();
    mapTracking.resize();
  });
}

// ── Sync centre carte de suivi → carte d'analyse ──────────────────

function initTrackingSync() {
  mapAnalysis.on('move', () => {
    const c = mapAnalysis.getCenter();
    mapTracking.setCenter([c.lng, c.lat]);
  });
}

// ── Coordonnées curseur ───────────────────────────────────────────

mapAnalysis.on('mousemove', e => {
  const el = document.getElementById('cursor-coords');
  if (el) {
    const lat = e.lngLat.lat.toFixed(5);
    const lng = e.lngLat.lng.toFixed(5);
    el.textContent = `${lat}, ${lng}`;
  }
});
mapAnalysis.on('mouseleave', () => {
  const el = document.getElementById('cursor-coords');
  if (el) el.textContent = '—';
});

// ── Initialisation ────────────────────────────────────────────────

function onProjectSwitch(project) {
  if (!project) return;

  // Restaurer la vue de la carte d'analyse
  if (project.lastView) {
    mapAnalysis.jumpTo({ center: project.lastView.center, zoom: project.lastView.zoom });
  }

  // Recharger couches
  reloadLayers(project.layerConfig || []);

  // Recharger navLog
  reloadNavLog(project.navLog || []);

  // Recharger annotations
  reloadAnnotations(project.annotations || []);

  // Recharger zones
  reloadZones(project.trackingZones || []);

  // Recharger visites terrain
  reloadSvVisits(project.streetviewVisits || []);
}

// Mémoriser la vue courante avant switch
mapAnalysis.on('moveend', () => {
  const c = mapAnalysis.getCenter();
  saveActiveProject({ lastView: { center: [c.lng, c.lat], zoom: mapAnalysis.getZoom() } });
});

// Attendre que les deux cartes soient prêtes
let analysisReady = false;
let trackingReady = false;

function tryInit() {
  if (!analysisReady || !trackingReady) return;

  // Storage
  initStorage({
    onQuotaWarning: () => {
      const banner = document.getElementById('quota-banner');
      const msg = document.getElementById('quota-message');
      if (banner) {
        msg.textContent = 'Espace de stockage presque plein — anciennes entrées de navigation supprimées automatiquement';
        banner.classList.remove('hidden');
      }
    },
    onQuotaCritical: () => {
      const banner = document.getElementById('quota-banner');
      const msg = document.getElementById('quota-message');
      if (banner) {
        msg.textContent = 'Stockage plein — exportez vos données et supprimez un projet pour continuer.';
        banner.classList.remove('hidden');
      }
    },
  });

  // Bandeau quota
  document.getElementById('quota-close')?.addEventListener('click', () => {
    document.getElementById('quota-banner')?.classList.add('hidden');
  });

  // Projets
  initProjects({ onProjectSwitch });

  // Charger le projet actif
  const project = getActiveProject();
  if (project) {
    if (project.lastView) {
      mapAnalysis.jumpTo({ center: project.lastView.center, zoom: project.lastView.zoom });
    }
    initLayers(mapAnalysis, project.layerConfig || []);
    initTracker(mapAnalysis, mapTracking, project.navLog || []);
    initAnnotations(mapAnalysis, project.annotations || []);
    initAnnotationsTracking(mapTracking);
    initTrackingZones(mapTracking, mapAnalysis, project.trackingZones || [], {
      onOverpassRequest: openOverpassPanel,
    });
  } else {
    initLayers(mapAnalysis, []);
    initTracker(mapAnalysis, mapTracking, []);
    initAnnotations(mapAnalysis, []);
    initAnnotationsTracking(mapTracking);
    initTrackingZones(mapTracking, mapAnalysis, [], {
      onOverpassRequest: openOverpassPanel,
    });
  }

  // Panneau couches
  initLayersPanel();

  // Panneau annotations
  initAnnotationsPanel();

  // Overpass
  initOverpass({
    onImportDone: count => {
      const banner = document.getElementById('quota-banner');
      const msg    = document.getElementById('quota-message');
      if (banner && msg) {
        msg.textContent = `${count} annotation${count > 1 ? 's' : ''} importée${count > 1 ? 's' : ''} dans le projet.`;
        banner.classList.remove('hidden');
        setTimeout(() => banner.classList.add('hidden'), 4000);
      }
    },
  });
  initOverpassStandalone();
  document.getElementById('btn-overpass-standalone')?.addEventListener('click', openOverpassStandalone);

  // Export
  initExport();

  // Géocodage
  initGeocoder(mapAnalysis);

  // Vue terrain
  initTerrainButtons(mapAnalysis);

  // Mesure linéaire
  initMeasure(mapAnalysis);

  // Popup coordonnées
  initCoordsDisplay(mapAnalysis);

  // Séparateur et sync cartes
  initPaneDivider();
  initTrackingSync();

  // Visites terrain (Street View / Mapillary / Panoramax)
  initSvVisits(mapTracking, project?.streetviewVisits || []);

  // Labels villes/routes/rues Carto ajoutés EN DERNIER sur la carte de suivi
  // afin d'être au-dessus de tous les layers custom (navlog, zones).
  mapTracking.addSource('carto-labels', {
    type: 'raster',
    tiles: [
      'https://a.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png',
      'https://b.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png',
    ],
    tileSize: 256,
    attribution: '© CARTO © OpenStreetMap contributors',
  });
  mapTracking.addLayer({ id: 'carto-labels', type: 'raster', source: 'carto-labels' });
}

mapAnalysis.on('load', () => { analysisReady = true; tryInit(); });
mapTracking.on('load', () => { trackingReady = true; tryInit(); });

// ── Reset historique navigation ───────────────────────────────────
// Câblé au niveau module (ES modules sont différés = DOM prêt)
// indépendamment de tryInit() pour éviter tout problème d'ordre d'init.

{
  const popup = document.getElementById('reset-navlog-popup');
  const open  = () => popup?.classList.remove('hidden');
  const close = () => popup?.classList.add('hidden');

  document.getElementById('btn-reset-navlog')?.addEventListener('click', open);
  document.getElementById('btn-close-reset-popup')?.addEventListener('click', close);
  document.getElementById('btn-cancel-reset-navlog')?.addEventListener('click', close);
  document.getElementById('btn-confirm-reset-navlog')?.addEventListener('click', () => {
    close();
    resetNavLog();
    // Vider aussi les visites terrain (Street View / Mapillary / Panoramax)
    saveActiveProject({ streetviewVisits: [] });
    reloadSvVisits([]);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
  });
}

// ── Export / Import projet ────────────────────────────────────────

document.getElementById('btn-export-project')?.addEventListener('click', exportProject);

{
  const importInput = document.getElementById('project-import-input');
  document.getElementById('btn-import-project')?.addEventListener('click', () => importInput?.click());

  importInput?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const data = parseProjectImport(evt.target.result);
        createAndSwitchProject(data);
      } catch (err) {
        const banner = document.getElementById('quota-banner');
        const msg    = document.getElementById('quota-message');
        if (banner && msg) {
          msg.textContent = `Erreur d'importation : ${err.message}`;
          banner.classList.remove('hidden');
        }
      }
      importInput.value = '';
    };
    reader.readAsText(file);
  });
}

// ── Visites Street View / Mapillary / Panoramax ───────────────────

const SV_SOURCE = 'sv-visits-source';
const SV_LAYER  = 'sv-visits-layer';

const SV_COLORS = {
  streetview: '#4285F4',
  mapillary:  '#05CB63',
  panoramax:  '#FF6B35',
};

function initSvVisits(trackingMap, visits) {
  const features = _svFeatures(visits || []);
  trackingMap.addSource(SV_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features } });
  trackingMap.addLayer({
    id: SV_LAYER, type: 'circle', source: SV_SOURCE,
    paint: {
      'circle-radius': 7,
      'circle-color': ['match', ['get', 'service'],
        'streetview', SV_COLORS.streetview,
        'mapillary',  SV_COLORS.mapillary,
        'panoramax',  SV_COLORS.panoramax,
        '#ffffff',
      ],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
      'circle-opacity': 0.9,
    },
  });

  // Tooltip
  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'tracking-tooltip' });
  trackingMap.on('mouseenter', SV_LAYER, e => {
    trackingMap.getCanvas().style.cursor = 'pointer';
    const p = e.features[0].properties;
    const d = new Date(p.timestamp);
    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const labels = { streetview: 'Google Street View', mapillary: 'Mapillary', panoramax: 'Panoramax' };
    popup.setLngLat(e.lngLat).setText(`${time} — ${labels[p.service] || p.service}`).addTo(trackingMap);
  });
  trackingMap.on('mouseleave', SV_LAYER, () => {
    trackingMap.getCanvas().style.cursor = '';
    popup.remove();
  });
}

function reloadSvVisits(visits) {
  const src = mapTracking.getSource(SV_SOURCE);
  if (src) src.setData({ type: 'FeatureCollection', features: _svFeatures(visits || []) });
}

function addSvVisit(service, lat, lon) {
  const project = getActiveProject();
  if (!project) return;
  if (!project.streetviewVisits) project.streetviewVisits = [];
  const visit = { id: Date.now(), service, lat, lon, timestamp: new Date().toISOString() };
  project.streetviewVisits.push(visit);
  saveActiveProject({ streetviewVisits: project.streetviewVisits });
  reloadSvVisits(project.streetviewVisits);
}

function _svFeatures(visits) {
  return visits.map(v => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
    properties: { service: v.service, timestamp: v.timestamp },
  }));
}

// ── Vue terrain ───────────────────────────────────────────────────

function initTerrainButtons(map) {
  function center() {
    const c = map.getCenter();
    return { lat: c.lat, lon: c.lng };
  }

  document.getElementById('btn-streetview')?.addEventListener('click', () => {
    const { lat, lon } = center();
    window.open(`https://maps.google.com/?layer=c&cbll=${lat.toFixed(6)},${lon.toFixed(6)}`, '_blank', 'noopener,noreferrer');
    addSvVisit('streetview', lat, lon);
  });

  document.getElementById('btn-mapillary')?.addEventListener('click', () => {
    const { lat, lon } = center();
    window.open(`https://www.mapillary.com/app/?lat=${lat.toFixed(6)}&lng=${lon.toFixed(6)}&z=18`, '_blank', 'noopener,noreferrer');
    addSvVisit('mapillary', lat, lon);
  });

  document.getElementById('btn-panoramax')?.addEventListener('click', () => {
    const { lat, lon } = center();
    window.open(`https://panoramax.ign.fr/?background=streets&focus=pic&map=17/${lat.toFixed(6)}/${lon.toFixed(6)}&speed=250&users=default`, '_blank', 'noopener,noreferrer');
    addSvVisit('panoramax', lat, lon);
  });

  document.getElementById('btn-suncalc')?.addEventListener('click', () => {
    const { lat, lon } = center();
    const zoom = Math.round(map.getZoom());
    const now = new Date();
    const date = `${now.getFullYear()}.${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')}`;
    const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    window.open(`https://www.suncalc.org/#/${lat.toFixed(4)},${lon.toFixed(4)},${zoom}/${date}/${time}/1/3`, '_blank', 'noopener,noreferrer');
  });

  document.getElementById('btn-w3w')?.addEventListener('click', () => {
    const { lat, lon } = center();
    window.open(`https://what3words.com/${lat.toFixed(6)},${lon.toFixed(6)}`, '_blank', 'noopener,noreferrer');
  });
}

// ── Plus Code (Open Location Code) — algo inline ─────────────────

const _OLC_CHARS = '23456789CFGHJMPQRVWX';

function _encodePlusCode(latDeg, lonDeg) {
  const lat = Math.min(90 - 1e-9, Math.max(-90, latDeg)) + 90;  // [0, 180)
  const lon = (((lonDeg % 360) + 540) % 360);                    // [0, 360)

  let code = '';
  const PAIR_RES = [20, 1, 0.05, 0.0025];
  for (let i = 0; i < 4; i++) {
    code += _OLC_CHARS[Math.floor(lat / PAIR_RES[i]) % 20];
    code += _OLC_CHARS[Math.floor(lon / PAIR_RES[i]) % 20];
  }
  // Grid char 1 : 5 lat-rows × 4 lon-cols
  const lat0 = lat % 0.0025, lon0 = lon % 0.0025;
  code += _OLC_CHARS[Math.min(4, Math.floor(lat0 / 0.0005)) * 4 + Math.min(3, Math.floor(lon0 / 0.000625))];
  // Grid char 2 : 4 lat-rows × 5 lon-cols (alternated)
  code += _OLC_CHARS[Math.min(3, Math.floor((lat0 % 0.0005) / 0.000125)) * 5 + Math.min(4, Math.floor((lon0 % 0.000625) / 0.000125))];

  return code.slice(0, 8) + '+' + code.slice(8);
}

function _decodePlusCode(code) {
  const clean = code.toUpperCase().replace(/\+/, '');
  const PAIR_RES = [20, 1, 0.05, 0.0025];
  let lat = 0, lon = 0;
  const pairs = Math.min(4, Math.floor(clean.length / 2));
  for (let i = 0; i < pairs; i++) {
    const li = _OLC_CHARS.indexOf(clean[i * 2]);
    const oi = _OLC_CHARS.indexOf(clean[i * 2 + 1]);
    if (li < 0 || oi < 0) return null;
    lat += li * PAIR_RES[i];
    lon += oi * PAIR_RES[i];
  }
  if (clean.length >= 9) {
    const g = _OLC_CHARS.indexOf(clean[8]);
    if (g >= 0) { lat += Math.floor(g / 4) * 0.0005; lon += (g % 4) * 0.000625; }
  }
  if (clean.length >= 10) {
    const g = _OLC_CHARS.indexOf(clean[9]);
    if (g >= 0) { lat += Math.floor(g / 5) * 0.000125; lon += (g % 5) * 0.000125; }
  }
  const latRes = clean.length >= 10 ? 0.000125 : clean.length >= 9 ? 0.0005 : PAIR_RES[Math.max(0, pairs - 1)];
  const lonRes = clean.length >= 10 ? 0.000125 : clean.length >= 9 ? 0.000625 : PAIR_RES[Math.max(0, pairs - 1)];
  return { lat: lat - 90 + latRes / 2, lon: lon - 180 + lonRes / 2 };
}

// ── Plus Code ─────────────────────────────────────────────────────

function _isPlusCode(s) {
  return /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{0,8}$/i.test(s.replace(/\s/g, ''));
}

// ── Coordonnées centre carte (WGS84 + Lambert 93) ─────────────────

function wgs84ToLambert93(latDeg, lonDeg) {
  // Projection Lambert 93 — EPSG:2154 — calcul analytique
  const a  = 6378137.0;           // demi-grand axe GRS80
  const e  = 0.0818191910428158;  // première excentricité
  const n  = 0.7256077650532670;  // exposant de la conique
  const c  = 11754255.426096;     // constante de projection
  const xs = 700000;              // fausse abscisse
  const ys = 12655612.049876;     // fausse ordonnée
  const lon0 = 3 * Math.PI / 180; // méridien d'origine (3° E)

  const lat = latDeg * Math.PI / 180;
  const lon = lonDeg * Math.PI / 180;

  const esinLat = e * Math.sin(lat);
  const L = Math.log(Math.tan(Math.PI/4 + lat/2) *
            Math.pow((1 - esinLat) / (1 + esinLat), e/2));
  const r = c * Math.exp(-n * L);
  const γ = n * (lon - lon0);

  const x = xs + r * Math.sin(γ);
  const y = ys - r * Math.cos(γ);
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

function _copyWithFeedback(btn, text) {
  navigator.clipboard?.writeText(text).catch(() => {});
  const orig = btn.textContent;
  btn.textContent = '✓';
  setTimeout(() => { btn.textContent = orig; }, 1200);
}

function initCoordsDisplay(map) {
  const elWgs      = document.getElementById('coord-wgs84');
  const elL93      = document.getElementById('coord-l93');
  const elPC       = document.getElementById('coord-pluscode');
  const btnCopyWgs = document.getElementById('btn-copy-wgs84');
  const btnCopyL93 = document.getElementById('btn-copy-l93');
  const btnCopyPC  = document.getElementById('btn-copy-pluscode');

  function updateCoords() {
    const c   = map.getCenter();
    const lat = c.lat, lon = c.lng;
    const wgsStr = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    const { x, y } = wgs84ToLambert93(lat, lon);
    const l93Str = `${x.toFixed(0)} E  ${y.toFixed(0)} N`;
    const pcStr  = _encodePlusCode(lat, lon);
    if (elWgs) { elWgs.textContent = wgsStr; elWgs.dataset.val = wgsStr; }
    if (elL93) { elL93.textContent = l93Str; elL93.dataset.val = l93Str; }
    if (elPC)  { elPC.textContent  = pcStr;  elPC.dataset.val  = pcStr;  }
  }

  map.on('move', updateCoords);
  map.on('load', updateCoords);
  if (map.isStyleLoaded()) updateCoords();

  btnCopyWgs?.addEventListener('click', () => _copyWithFeedback(btnCopyWgs, elWgs?.dataset.val ?? ''));
  btnCopyL93?.addEventListener('click', () => _copyWithFeedback(btnCopyL93, elL93?.dataset.val ?? ''));
  btnCopyPC?.addEventListener('click',  () => _copyWithFeedback(btnCopyPC,  elPC?.dataset.val  ?? ''));
}

// ── Géocodage ─────────────────────────────────────────────────────

function initGeocoder(map) {
  const input = document.getElementById('geocoder-input');
  const results = document.getElementById('geocoder-results');
  const overlay = document.getElementById('geocoder-overlay');
  if (!input || !results) return;

  // Déplace l'overlay dans le container MapLibre pour partager son
  // contexte de stacking et rester au-dessus du canvas WebGL.
  if (overlay) map.getContainer().appendChild(overlay);

  let debounceTimer = null;

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    results.innerHTML = '';

    if (!q) return;

    // Détection coordonnées : deux nombres séparés par virgule ou espace
    const coordMatch = q.match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lon = parseFloat(coordMatch[2]);
      if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        const li = document.createElement('li');
        const mainDiv = document.createElement('div');
        mainDiv.className = 'result-main';
        mainDiv.textContent = `📍 ${lat}, ${lon}`;
        const subDiv = document.createElement('div');
        subDiv.className = 'result-sub';
        subDiv.textContent = 'Coordonnées WGS84';
        li.append(mainDiv, subDiv);
        li.addEventListener('click', () => {
          map.flyTo({ center: [lon, lat], zoom: 17 });
          results.innerHTML = '';
          input.value = `${lat}, ${lon}`;
        });
        results.appendChild(li);
        return;
      }
    }

    debounceTimer = setTimeout(() => _geocoderSearch(q, map, input, results), 300);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      results.innerHTML = '';
      input.blur();
    }
    if (e.key === 'Enter' && results.children.length > 0) {
      results.children[0].click();
    }
  });

  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !results.contains(e.target)) {
      results.innerHTML = '';
    }
  });
}

async function _geocoderSearch(q, map, input, results) {
  // Plus Code
  const pcClean = q.replace(/\s/g, '').toUpperCase();
  if (_isPlusCode(pcClean)) {
    try {
      const dec = _decodePlusCode(pcClean);
      if (!dec) throw new Error('invalid');
      const lat = dec.lat;
      const lon = dec.lon;
      _appendGeocoderItem(results, pcClean, 'Plus Code', () => {
        map.flyTo({ center: [lon, lat], zoom: 17 });
        results.innerHTML = '';
        input.value = pcClean;
      });
      return;
    } catch { /* format invalide, passe à l'adresse */ }
  }

  await fetchAddress(q, map, input, results);
}

function _appendGeocoderItem(results, main, sub, onClick) {
  const li = document.createElement('li');
  const mainDiv = document.createElement('div');
  mainDiv.className = 'result-main';
  mainDiv.textContent = main;
  const subDiv = document.createElement('div');
  subDiv.className = 'result-sub';
  subDiv.textContent = sub;
  li.append(mainDiv, subDiv);
  li.addEventListener('click', onClick);
  results.appendChild(li);
}

async function fetchAddress(q, map, input, results) {
  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=5`;
    const res = await fetch(url);
    if (!res.ok) {
      _showGeocoderError(results, 'Erreur lors de la recherche d\'adresse');
      return;
    }
    const data = await res.json();

    results.innerHTML = '';
    for (const feature of data.features || []) {
      const label = feature.properties.label;
      const context = feature.properties.context || '';
      const [lon, lat] = feature.geometry.coordinates;

      const li = document.createElement('li');
      const mainDiv = document.createElement('div');
      mainDiv.className = 'result-main';
      mainDiv.textContent = label;
      const subDiv = document.createElement('div');
      subDiv.className = 'result-sub';
      subDiv.textContent = context;
      li.append(mainDiv, subDiv);
      li.addEventListener('click', () => {
        map.flyTo({ center: [lon, lat], zoom: 17 });
        results.innerHTML = '';
        input.value = label;
      });
      results.appendChild(li);
    }
  } catch {
    _showGeocoderError(results, 'Erreur réseau — vérifiez votre connexion');
  }
}

function _showGeocoderError(results, message) {
  results.innerHTML = '';
  const li = document.createElement('li');
  li.className = 'result-error';
  li.textContent = message;
  results.appendChild(li);
}
