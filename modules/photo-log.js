// modules/photo-log.js — journal des consultations d'images terrain

import { saveActiveProject } from './projects.js';

const SERVICE_COLORS = {
  streetview: '#34d399',
  mapillary:  '#fb923c',
  panoramax:  '#818cf8',
};

const SERVICE_LABELS = {
  streetview: '🚶 Google Street View',
  mapillary:  '📷 Mapillary',
  panoramax:  '🌐 Panoramax IGN',
};

let _mapTracking = null;
let _log = [];

export function initPhotoLog(mapAnalysis, mapTracking, initialLog = []) {
  _mapTracking = mapTracking;
  _log = initialLog;

  _initSource();
  _renderLog();
  _attachPopup();
}

export function addPhotoEntry(service, lat, lng, url) {
  _log = [..._log, {
    id: `photo_${Date.now()}`,
    service,
    coords: [lng, lat],
    timestamp: new Date().toISOString(),
    url,
  }];
  _renderLog();
  saveActiveProject({ photoLog: _log });
}

export function reloadPhotoLog(log) {
  _log = log || [];
  _renderLog();
}

export function getPhotoLog() {
  return _log;
}

// ── Source et layer ──────────────────────────────────────────────────

function _initSource() {
  _mapTracking.addSource('photo-log-source', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  _mapTracking.addLayer({
    id: 'photo-log-layer',
    type: 'circle',
    source: 'photo-log-source',
    paint: {
      'circle-radius': 7,
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-width': 2,
      'circle-stroke-color': ['match', ['get', 'service'],
        'streetview', SERVICE_COLORS.streetview,
        'mapillary',  SERVICE_COLORS.mapillary,
        'panoramax',  SERVICE_COLORS.panoramax,
        '#aaa',
      ],
      'circle-stroke-opacity': 0.9,
    },
  });
}

function _renderLog() {
  const src = _mapTracking?.getSource('photo-log-source');
  if (!src) return;

  src.setData({
    type: 'FeatureCollection',
    features: _log.map(entry => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: entry.coords },
      properties: {
        service:    entry.service,
        timestamp:  entry.timestamp,
        url:        entry.url,
        coordsJson: JSON.stringify(entry.coords),
      },
    })),
  });
}

// ── Popup au clic ────────────────────────────────────────────────────

function _attachPopup() {
  _mapTracking.on('click', 'photo-log-layer', e => {
    const p = e.features[0].properties;
    const coords = JSON.parse(p.coordsJson);
    const date = new Date(p.timestamp).toLocaleString('fr-FR');
    const label = SERVICE_LABELS[p.service] ?? p.service;
    const safeUrl = p.url.replace(/'/g, '%27');

    new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
      .setLngLat(coords)
      .setHTML(`
        <div class="photo-popup">
          <div class="photo-popup-service">${label}</div>
          <div class="photo-popup-date">${date}</div>
          <div class="photo-popup-coords">${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}</div>
          <button class="photo-popup-reopen" onclick="window.open('${safeUrl}','_blank','noopener,noreferrer')">↗ Rouvrir</button>
        </div>
      `)
      .addTo(_mapTracking);
  });

  _mapTracking.on('mouseenter', 'photo-log-layer', () => {
    _mapTracking.getCanvas().style.cursor = 'pointer';
  });
  _mapTracking.on('mouseleave', 'photo-log-layer', () => {
    _mapTracking.getCanvas().style.cursor = '';
  });
}
