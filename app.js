import { initStorage }        from './modules/storage.js';
import { initProjects, getActiveProject, saveActiveProject, getActiveId, createAndSwitchProject } from './modules/projects.js';
import { initLayers, initLayersPanel, reloadLayers, getLayerConfig } from './modules/layers.js';
import { initTracker, reloadNavLog, resetNavLog } from './modules/tracker.js';
import { initAnnotations, initAnnotationsPanel, initAnnotationsTracking, reloadAnnotations } from './modules/annotations.js';
import { initTrackingZones, reloadZones }                from './modules/tracking-zones.js';
import { initExport, exportProject, parseProjectImport } from './modules/export.js';
import { initStreetView, reloadSvLog } from './modules/streetview.js';

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

  // Recharger journal Street View
  reloadSvLog(project.svLog || []);
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
    initTrackingZones(mapTracking, mapAnalysis, project.trackingZones || []);
  } else {
    initLayers(mapAnalysis, []);
    initTracker(mapAnalysis, mapTracking, []);
    initAnnotations(mapAnalysis, []);
    initAnnotationsTracking(mapTracking);
    initTrackingZones(mapTracking, mapAnalysis, []);
  }

  // Panneau couches
  initLayersPanel();

  // Panneau annotations
  initAnnotationsPanel();

  // Export
  initExport();

  // Géocodage
  initGeocoder(mapAnalysis);

  // Vue terrain
  initTerrainButtons(mapAnalysis);

  // Street View intégré
  initStreetView(mapAnalysis, mapTracking, project?.svLog || []);

  // Séparateur et sync cartes
  initPaneDivider();
  initTrackingSync();

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

// ── Vue terrain ───────────────────────────────────────────────────

function initTerrainButtons(map) {
  function center() {
    const c = map.getCenter();
    return { lat: c.lat.toFixed(6), lon: c.lng.toFixed(6) };
  }

  document.getElementById('btn-streetview')?.addEventListener('click', () => {
    const { lat, lon } = center();
    window.open(`https://maps.google.com/?layer=c&cbll=${lat},${lon}`, '_blank', 'noopener,noreferrer');
  });

  document.getElementById('btn-mapillary')?.addEventListener('click', () => {
    const { lat, lon } = center();
    window.open(`https://www.mapillary.com/app/?lat=${lat}&lng=${lon}&z=18`, '_blank', 'noopener,noreferrer');
  });

  document.getElementById('btn-panoramax')?.addEventListener('click', () => {
    const { lat, lon } = center();
    window.open(`https://panoramax.ign.fr/?background=streets&focus=pic&map=17/${lat}/${lon}&speed=250&users=default`, '_blank', 'noopener,noreferrer');
  });
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

    debounceTimer = setTimeout(() => fetchAddress(q, map, input, results), 300);
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
