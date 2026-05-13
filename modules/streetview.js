// modules/streetview.js — Vue immersive Street View + journal des positions visitées

import { saveActiveProject } from './projects.js';

let _mapAnalysis = null;
let _mapTracking = null;
let _active = false;
let _position = { lat: 48.8534, lng: 2.3488 };
let _heading = 0;
let _marker = null;
let _trackingClickHandler = null;
let _coverageVisible = false;
let _coverageTimer = null;
let _svLog = [];

export function initStreetView(mapAnalysis, mapTracking, initialSvLog = []) {
  _mapAnalysis = mapAnalysis;
  _mapTracking = mapTracking;
  _svLog = initialSvLog;

  _initSvLogSource();
  _renderSvLog();

  document.getElementById('btn-sv-embed')?.addEventListener('click', () => {
    if (_active) { _closeSV(); return; }
    if (document.body.classList.contains('draw-poly-mode')) return;
    const c = _mapAnalysis.getCenter();
    _openSV(c.lat, c.lng);
  });

  document.getElementById('btn-sv-close')?.addEventListener('click', _closeSV);

  document.getElementById('sv-heading')?.addEventListener('input', e => {
    _updateHeading(parseInt(e.target.value, 10));
  });

  document.getElementById('btn-sv-coverage')?.addEventListener('click', _toggleCoverage);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _active) _closeSV();
  });
}

export function reloadSvLog(log) {
  _svLog = log || [];
  _renderSvLog();
}

export function getSvLog() {
  return _svLog;
}

// ── SV Log : source et layers ────────────────────────────────────────

function _initSvLogSource() {
  _mapTracking.addSource('sv-log-source', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  // Ligne reliant les positions visitées
  _mapTracking.addLayer({
    id: 'sv-log-line',
    type: 'line',
    source: 'sv-log-source',
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: {
      'line-color': '#a855f7',
      'line-width': 2,
      'line-opacity': 0.85,
      'line-dasharray': [3, 2],
    },
  });

  // Points à chaque position visitée
  _mapTracking.addLayer({
    id: 'sv-log-dots',
    type: 'circle',
    source: 'sv-log-source',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 4,
      'circle-color': '#a855f7',
      'circle-opacity': 0.9,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#fff',
    },
  });
}

function _renderSvLog() {
  const src = _mapTracking.getSource('sv-log-source');
  if (!src) return;

  const features = [];

  if (_svLog.length >= 2) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: _svLog.map(e => e.coords) },
      properties: {},
    });
  }

  for (const entry of _svLog) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: entry.coords },
      properties: { heading: entry.heading, timestamp: entry.timestamp },
    });
  }

  src.setData({ type: 'FeatureCollection', features });
}

function _recordPosition(lat, lng, heading) {
  const entry = {
    id: `sv_${Date.now()}`,
    coords: [lng, lat],
    heading: Math.round(heading),
    timestamp: new Date().toISOString(),
  };
  _svLog = [..._svLog, entry];
  _renderSvLog();
  saveActiveProject({ svLog: _svLog });
}

// ── Ouverture / fermeture ────────────────────────────────────────────

function _openSV(lat, lng) {
  _position = { lat, lng };
  _heading = 0;
  _active = true;

  document.getElementById('sv-overlay')?.classList.remove('hidden');
  document.getElementById('btn-sv-embed')?.classList.add('active');
  const slider = document.getElementById('sv-heading');
  if (slider) slider.value = '0';
  const val = document.getElementById('sv-heading-val');
  if (val) val.textContent = '0°';
  document.body.classList.add('sv-mode');

  _updateCoordsDisplay();
  _loadIframe();
  _createMarker();
  _attachTrackingClick();
  _recordPosition(lat, lng, 0);
}

function _closeSV() {
  if (!_active) return;
  _active = false;

  document.getElementById('sv-overlay')?.classList.add('hidden');
  const iframe = document.getElementById('sv-iframe');
  if (iframe) iframe.src = 'about:blank';
  document.getElementById('btn-sv-embed')?.classList.remove('active');
  document.body.classList.remove('sv-mode');

  _removeMarker();
  _detachTrackingClick();
}

function _navigateTo(lat, lng) {
  const prevPos = { ..._position };
  _position = { lat, lng };

  if (prevPos.lat !== lat || prevPos.lng !== lng) {
    _heading = _computeBearing(prevPos, _position);
    _updateHeadingDisplay(_heading);
  }

  _updateCoordsDisplay();
  _loadIframe();

  if (_marker) {
    _marker.setLngLat([_position.lng, _position.lat]);
    _rotateArrow(_heading);
  }

  _recordPosition(lat, lng, _heading);
}

// ── iframe ───────────────────────────────────────────────────────────

function _loadIframe() {
  const lat = _position.lat.toFixed(6);
  const lng = _position.lng.toFixed(6);
  const hdg = Math.round(_heading);
  const iframe = document.getElementById('sv-iframe');
  if (iframe) {
    iframe.src = `https://www.instantstreetview.com/@${lat},${lng},${hdg}h,0p,1z`;
  }
}

// ── Utilitaires ──────────────────────────────────────────────────────

function _computeBearing(from, to) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const dLng = toRad(to.lng - from.lng);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function _updateHeading(deg) {
  _heading = ((deg % 360) + 360) % 360;
  _updateHeadingDisplay(_heading);
  _rotateArrow(_heading);
}

function _updateHeadingDisplay(deg) {
  const rounded = Math.round(deg);
  const el = document.getElementById('sv-heading-val');
  if (el) el.textContent = `${rounded}°`;
  const slider = document.getElementById('sv-heading');
  if (slider) slider.value = String(rounded);
}

function _updateCoordsDisplay() {
  const el = document.getElementById('sv-coords');
  if (el) el.textContent = `${_position.lat.toFixed(5)}, ${_position.lng.toFixed(5)}`;
}

// ── Marqueur de position actuelle ────────────────────────────────────

function _createMarker() {
  if (_marker) _marker.remove();
  const el = _buildMarkerEl();
  _marker = new maplibregl.Marker({ element: el, anchor: 'center' })
    .setLngLat([_position.lng, _position.lat])
    .addTo(_mapTracking);
}

function _removeMarker() {
  if (_marker) { _marker.remove(); _marker = null; }
}

function _buildMarkerEl() {
  const wrapper = document.createElement('div');
  wrapper.className = 'sv-marker';
  const dot = document.createElement('div');
  dot.className = 'sv-marker-dot';
  const arrow = document.createElement('div');
  arrow.className = 'sv-marker-arrow';
  arrow.style.transform = `rotate(${_heading}deg)`;
  wrapper.append(dot, arrow);
  return wrapper;
}

function _rotateArrow(deg) {
  const arrow = _marker?.getElement()?.querySelector('.sv-marker-arrow');
  if (arrow) arrow.style.transform = `rotate(${deg}deg)`;
}

// ── Clic sur la carte de suivi ───────────────────────────────────────

function _attachTrackingClick() {
  _trackingClickHandler = e => {
    if (!_active) return;
    _navigateTo(e.lngLat.lat, e.lngLat.lng);
  };
  _mapTracking.on('click', _trackingClickHandler);
}

function _detachTrackingClick() {
  if (_trackingClickHandler) {
    _mapTracking.off('click', _trackingClickHandler);
    _trackingClickHandler = null;
  }
}

// ── Couche de disponibilité Panoramax ────────────────────────────────

function _toggleCoverage() {
  _coverageVisible = !_coverageVisible;
  document.getElementById('btn-sv-coverage')?.classList.toggle('active', _coverageVisible);

  if (_coverageVisible) {
    if (!_mapTracking.getSource('panoramax-coverage')) {
      _mapTracking.addSource('panoramax-coverage', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    if (!_mapTracking.getLayer('panoramax-coverage-dots')) {
      const before = _mapTracking.getLayer('carto-labels') ? 'carto-labels' : undefined;
      _mapTracking.addLayer({
        id: 'panoramax-coverage-dots',
        type: 'circle',
        source: 'panoramax-coverage',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 5],
          'circle-color': '#4299e1',
          'circle-opacity': 0.75,
          'circle-stroke-width': 0,
        },
      }, before);
    }
    _fetchCoverageData();
    _mapTracking.on('moveend', _onCoverageMoveEnd);
  } else {
    _mapTracking.off('moveend', _onCoverageMoveEnd);
    clearTimeout(_coverageTimer);
    if (_mapTracking.getLayer('panoramax-coverage-dots')) _mapTracking.removeLayer('panoramax-coverage-dots');
    if (_mapTracking.getSource('panoramax-coverage')) _mapTracking.removeSource('panoramax-coverage');
  }
}

function _onCoverageMoveEnd() {
  clearTimeout(_coverageTimer);
  _coverageTimer = setTimeout(_fetchCoverageData, 400);
}

async function _fetchCoverageData() {
  if (!_coverageVisible) return;
  const b = _mapTracking.getBounds();
  const bbox = `${b.getWest().toFixed(5)},${b.getSouth().toFixed(5)},${b.getEast().toFixed(5)},${b.getNorth().toFixed(5)}`;
  try {
    const res = await fetch(`https://panoramax.ign.fr/api/search?bbox=${bbox}&limit=500`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return;
    const data = await res.json();
    const src = _mapTracking.getSource('panoramax-coverage');
    if (src) src.setData(data);
  } catch { /* dégradation silencieuse */ }
}
