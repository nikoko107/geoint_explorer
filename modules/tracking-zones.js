import { saveActiveProject } from './projects.js';
import { getNavLog, coverageLevelRank, COVERAGE_LEVELS } from './tracker.js';
import { hitHigherPriority } from './tracking-hits.js';

const SOURCE_ID    = 'zones-source';
const FILL_LAYER   = 'zones-fill';
const LINE_LAYER   = 'zones-line';

const ANALYSIS_SOURCE = 'zones-analysis-source';
const ANALYSIS_LINE   = 'zones-analysis-line';

const PREVIEW_SOURCE = 'zone-preview-source';
const PREVIEW_LINE   = 'zone-preview-line';
const PREVIEW_FILL   = 'zone-preview-fill';
const PREVIEW_VERTS  = 'zone-preview-verts';

const STATUS_COLORS = { todo: '#ef4444', done: '#22c55e' };

const ISOCHRONE_URL     = 'https://data.geopf.fr/navigation/isochrone';
const ISOCHRONE_TIMEOUT = 20_000;
const EARTH_RADIUS_M    = 6_371_008.8;

// Modes de création depuis un point cliqué sur la carte de suivi
const POINT_MODES = {
  circle:      { label: 'Cercle',      units: ['m', 'km'], defaultValue: 500, defaultUnit: 'm',   profile: false },
  isodistance: { label: 'Isodistance', units: ['m', 'km'], defaultValue: 1,   defaultUnit: 'km',  profile: true  },
  isochrone:   { label: 'Isochrone',   units: ['min'],     defaultValue: 15,  defaultUnit: 'min', profile: true  },
};
const PROFILE_LABELS = { pedestrian: 'à pied', car: 'voiture' };

let _map         = null;
let _mapAnalysis = null;
let _zones       = [];

// État de dessin
let _drawMode   = null; // null | 'poly' | 'circle' | 'isodistance' | 'isochrone'
let _polyPoints = [];   // [{lng, lat}]
let _pointCenter = null; // {lng, lat} — modes point
let _pointBusy   = false;

// Handlers DOM détachables
let _onPolyClick = null;
let _onPolyMove  = null;
let _onPointClick = null;

let _onOverpassRequest = null;

// ── Init ──────────────────────────────────────────────────────────

export function initTrackingZones(mapTracking, mapAnalysis, initialZones, callbacks = {}) {
  _map               = mapTracking;
  _mapAnalysis       = mapAnalysis;
  _zones             = initialZones || [];
  _onOverpassRequest = callbacks.onOverpassRequest || null;

  _initZoneSource();
  _initZoneAnalysisLayer();
  _initPreviewSource();
  _renderZones();
  _wireUI();
}

export function reloadZones(zones) {
  _zones = zones || [];
  _renderZones();
  _refreshZonesList();
}

export function getZones() { return _zones; }

// ── Source zones ──────────────────────────────────────────────────

function _initZoneSource() {
  if (_map.getSource(SOURCE_ID)) return;

  _map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  _map.addLayer({
    id: FILL_LAYER, type: 'fill', source: SOURCE_ID,
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.28 },
  });

  _map.addLayer({
    id: LINE_LAYER, type: 'line', source: SOURCE_ID,
    paint: { 'line-color': ['get', 'color'], 'line-width': 1.5 },
  });

  _map.on('mouseenter', FILL_LAYER, e => {
    if (_drawMode) return;
    _map.getCanvas().style.cursor = 'pointer';
    if (!e.features?.length) return;
    const p = e.features[0].properties;
    const levelLabel = p.maxCoverageLevel ? COVERAGE_LEVELS[p.maxCoverageLevel]?.label : null;
    const statusLabel = p.status === 'done' ? 'Traité' : 'À traiter';
    const sub = levelLabel ? ` — ${levelLabel} (z${p.maxCoverageZoom})` : '';
    _showTooltip(e.lngLat, `${p.name} — ${statusLabel}${sub}`);
  });
  _map.on('mouseleave', FILL_LAYER, () => {
    if (_drawMode) return;
    _map.getCanvas().style.cursor = '';
    _hideTooltip();
  });
  _map.on('click', FILL_LAYER, e => {
    if (_drawMode) return;
    if (hitHigherPriority(_map, e.point, 'zones')) return;
    if (!e.features?.length) return;
    // Localisation uniquement — la modification passe par le panneau ≡ Zones
    const zone = _zones.find(z => z.id === e.features[0].properties.id);
    if (zone) _fitAnalysisToZone(zone);
  });
}

function _renderZones() {
  if (!_map.getSource(SOURCE_ID)) return;
  const navLog = getNavLog();

  const features = _zones.map(zone => {
    const coords = _zoneCoords(zone);
    const bbox   = _zoneBbox(zone);
    const { maxLevel, maxZoom } = _computeMaxCoverage(bbox, navLog);
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [coords] },
      properties: {
        id: zone.id, name: zone.name, status: zone.status,
        color: STATUS_COLORS[zone.status] || '#888',
        maxCoverageLevel: maxLevel, maxCoverageZoom: maxZoom,
      },
    };
  });

  _map.getSource(SOURCE_ID).setData({ type: 'FeatureCollection', features });

  // Mettre à jour les contours sur la carte d'analyse
  if (_mapAnalysis) {
    // Initialisation défensive : réessaie si la source a été perdue
    if (!_mapAnalysis.getSource(ANALYSIS_SOURCE)) _initZoneAnalysisLayer();
    _mapAnalysis.getSource(ANALYSIS_SOURCE)?.setData({ type: 'FeatureCollection', features });
  }
}

function _initZoneAnalysisLayer() {
  if (!_mapAnalysis || _mapAnalysis.getSource(ANALYSIS_SOURCE)) return;

  _mapAnalysis.addSource(ANALYSIS_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  // Insérer avant les annotations pour que les markers restent au-dessus
  const before = _mapAnalysis.getLayer('annotations-layer') ? 'annotations-layer' : undefined;

  // Halo blanc d'abord (couche du dessous)
  _mapAnalysis.addLayer({
    id: ANALYSIS_LINE + '-halo',
    type: 'line',
    source: ANALYSIS_SOURCE,
    paint: {
      'line-color': '#ffffff',
      'line-width': 5,
      'line-opacity': 0.3,
    },
  }, before);

  // Contour coloré par statut par-dessus le halo
  _mapAnalysis.addLayer({
    id: ANALYSIS_LINE,
    type: 'line',
    source: ANALYSIS_SOURCE,
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 2.5,
      'line-opacity': 1,
    },
  }, before);
}

// Retourne les coordonnées fermées du polygone (quel que soit le type)
function _zoneCoords(zone) {
  if (zone.shapeType === 'poly' && zone.coordinates?.length >= 3) {
    const c = zone.coordinates;
    const closed = [...c];
    if (closed[0][0] !== closed[closed.length - 1][0] || closed[0][1] !== closed[closed.length - 1][1]) {
      closed.push(closed[0]);
    }
    return closed;
  }
  if (!zone.bbox) return [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]];
  const [w, s, e, n] = zone.bbox;
  return [[w, s], [e, s], [e, n], [w, n], [w, s]];
}

function _zoneBbox(zone) {
  if (zone.bbox) return zone.bbox;
  if (!zone.coordinates?.length) return [0, 0, 0, 0];
  const lngs = zone.coordinates.map(c => c[0]);
  const lats = zone.coordinates.map(c => c[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

// ── Source de prévisualisation polygone ───────────────────────────

function _initPreviewSource() {
  if (_map.getSource(PREVIEW_SOURCE)) return;

  _map.addSource(PREVIEW_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  _map.addLayer({
    id: PREVIEW_FILL, type: 'fill', source: PREVIEW_SOURCE,
    filter: ['==', '$type', 'Polygon'],
    paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.12 },
  });

  _map.addLayer({
    id: PREVIEW_LINE, type: 'line', source: PREVIEW_SOURCE,
    paint: {
      'line-color': '#22c55e', 'line-width': 2,
      'line-dasharray': [4, 3],
    },
  });

  _map.addLayer({
    id: PREVIEW_VERTS, type: 'circle', source: PREVIEW_SOURCE,
    filter: ['==', '$type', 'Point'],
    paint: {
      'circle-radius': 5, 'circle-color': '#22c55e',
      'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff',
    },
  });
}

function _clearPreview() {
  _map.getSource(PREVIEW_SOURCE)?.setData({ type: 'FeatureCollection', features: [] });
}

function _updatePolyPreview(cursorLngLat) {
  if (!_map.getSource(PREVIEW_SOURCE)) return;
  const pts = _polyPoints;
  if (pts.length === 0) { _clearPreview(); return; }

  const features = [];

  // Points (vertices)
  for (const p of pts) {
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] } });
  }

  // Ligne : points existants + curseur
  const lineCoords = pts.map(p => [p.lng, p.lat]);
  if (cursorLngLat) lineCoords.push([cursorLngLat.lng, cursorLngLat.lat]);

  if (lineCoords.length >= 2) {
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: lineCoords } });
  }

  // Remplissage si ≥ 3 points
  if (pts.length >= 3) {
    const polyCoords = [...pts.map(p => [p.lng, p.lat])];
    polyCoords.push(polyCoords[0]);
    features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [polyCoords] } });
  }

  _map.getSource(PREVIEW_SOURCE).setData({ type: 'FeatureCollection', features });
}

// ── Mode polygone ─────────────────────────────────────────────────

function _enterPolyMode() {
  _drawMode  = 'poly';
  _polyPoints = [];
  document.body.classList.add('draw-poly-mode');
  document.getElementById('btn-draw-poly')?.classList.add('active');
  document.getElementById('poly-draw-bar')?.classList.remove('hidden');
  _updateHint();

  _onPolyClick = e => {
    // Ignorer si clic sur une zone existante
    const hit = _map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER] });
    if (hit.length) return;

    _polyPoints.push({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    _updatePolyPreview(null);
    _updateHint();
  };

  _onPolyMove = e => {
    if (_polyPoints.length === 0) return;
    _updatePolyPreview(e.lngLat);
  };

  _map.on('click', _onPolyClick);
  _map.on('mousemove', _onPolyMove);
}

function _finishPoly() {
  if (_polyPoints.length < 3) return;

  const coordinates = _polyPoints.map(p => [p.lng, p.lat]);
  const lngs = coordinates.map(c => c[0]);
  const lats  = coordinates.map(c => c[1]);
  const bbox  = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];

  _exitDrawMode();
  _openNewZonePopup({ shapeType: 'poly', coordinates, bbox });
}

function _undoLastPoint() {
  if (_polyPoints.length === 0) return;
  _polyPoints.pop();
  _updatePolyPreview(null);
  _updateHint();
}

function _updateHint() {
  const hint = document.getElementById('poly-draw-hint');
  if (!hint) return;
  const n = _polyPoints.length;
  if (n === 0)      hint.textContent = 'Cliquez pour ajouter le 1er point';
  else if (n === 1) hint.textContent = 'Cliquez pour ajouter d\'autres points (min. 3)';
  else if (n === 2) hint.textContent = `${n} points — encore 1 minimum`;
  else              hint.textContent = `${n} points — cliquez "Terminer" pour valider`;
}

// ── Sortie des modes ──────────────────────────────────────────────

function _exitDrawMode(keepPreview = false) {
  if (_drawMode === 'poly') {
    _map.off('click', _onPolyClick);
    _map.off('mousemove', _onPolyMove);
    document.getElementById('poly-draw-bar')?.classList.add('hidden');
    _polyPoints = [];
  } else if (POINT_MODES[_drawMode]) {
    _map.off('click', _onPointClick);
    document.getElementById('point-zone-bar')?.classList.add('hidden');
    _pointCenter = null;
    _pointBusy   = false;
  }
  if (_drawMode) {
    document.body.classList.remove('draw-poly-mode');
    document.getElementById('btn-draw-poly')?.classList.remove('active');
    if (!keepPreview) _clearPreview();
  }
  _drawMode = null;
}

// ── Modes point : cercle / isodistance / isochrone ────────────────

function _enterPointMode(kind) {
  const cfg = POINT_MODES[kind];
  if (!cfg) return;
  _drawMode    = kind;
  _pointCenter = null;
  _pointBusy   = false;
  document.body.classList.add('draw-poly-mode');
  document.getElementById('btn-draw-poly')?.classList.add('active');

  const unitSel = document.getElementById('point-zone-unit');
  unitSel.innerHTML = '';
  for (const u of cfg.units) {
    const opt = document.createElement('option');
    opt.value = u; opt.textContent = u;
    unitSel.appendChild(opt);
  }
  unitSel.value = cfg.defaultUnit;
  unitSel.classList.toggle('hidden', cfg.units.length < 2);
  document.getElementById('point-zone-value').value = cfg.defaultValue;
  document.getElementById('point-zone-profile').classList.toggle('hidden', !cfg.profile);
  document.getElementById('point-zone-bar')?.classList.remove('hidden');
  _setPointHint(`${cfg.label} — cliquez un point sur la carte de suivi`);

  _onPointClick = e => {
    if (_pointBusy) return;
    _pointCenter = { lng: e.lngLat.lng, lat: e.lngLat.lat };
    _updatePointPreview();
    _setPointHint(`${cfg.label} — ${_pointCenter.lat.toFixed(5)}, ${_pointCenter.lng.toFixed(5)}`);
  };
  _map.on('click', _onPointClick);
}

function _setPointHint(text, isError = false) {
  const hint = document.getElementById('point-zone-hint');
  if (!hint) return;
  hint.textContent = text;
  hint.classList.toggle('error', isError);
}

// Lit la valeur saisie, convertie en mètres (cercle / isodistance) ou minutes (isochrone)
function _readPointValue() {
  const raw  = parseFloat(document.getElementById('point-zone-value').value);
  const unit = document.getElementById('point-zone-unit').value;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const value = unit === 'km' ? raw * 1000 : raw;
  return { raw, unit, value };
}

function _updatePointPreview(ring = null) {
  if (!_pointCenter) { _clearPreview(); return; }
  const features = [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [_pointCenter.lng, _pointCenter.lat] } },
  ];
  if (!ring && _drawMode === 'circle') {
    const v = _readPointValue();
    if (v) ring = _circlePolygon(_pointCenter, v.value);
  }
  if (ring) {
    features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] } });
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: ring } });
  }
  _map.getSource(PREVIEW_SOURCE)?.setData({ type: 'FeatureCollection', features });
}

async function _generatePointZone() {
  const kind = _drawMode;
  const cfg  = POINT_MODES[kind];
  if (!cfg || _pointBusy) return;
  if (!_pointCenter) { _setPointHint('Cliquez d\'abord un point sur la carte de suivi', true); return; }
  const v = _readPointValue();
  if (!v) { _setPointHint('Valeur invalide', true); return; }

  const center  = _pointCenter;
  const profile = cfg.profile ? document.getElementById('point-zone-profile').value : null;
  let ring;

  if (kind === 'circle') {
    ring = _circlePolygon(center, v.value);
  } else {
    _pointBusy = true;
    _setPointHint('Calcul IGN en cours…');
    try {
      ring = await _fetchIsochrone(center, {
        costType:  kind === 'isochrone' ? 'time' : 'distance',
        costValue: v.value,
        profile,
      });
    } catch (err) {
      if (_drawMode !== kind) return; // mode quitté pendant l'appel
      _pointBusy = false;
      _setPointHint(`Erreur IGN : ${err.message}`, true);
      return;
    }
    if (_drawMode !== kind) return;
  }

  const ringOpen = ring.slice(0, -1);
  const lngs = ringOpen.map(c => c[0]);
  const lats = ringOpen.map(c => c[1]);
  const bbox = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];

  const valueLabel = `${v.raw} ${v.unit}`;
  const name = profile
    ? `${cfg.label} ${PROFILE_LABELS[profile]} ${valueLabel}`
    : `${cfg.label} ${valueLabel}`;

  _updatePointPreview(ring);
  _exitDrawMode(true);
  _openNewZonePopup({
    shapeType: 'poly',
    coordinates: ringOpen,
    bbox,
    generator: {
      type: kind,
      center: [center.lng, center.lat],
      value: v.raw, unit: v.unit,
      ...(profile ? { profile } : {}),
    },
  }, name);
}

// Cercle géodésique (sphère) — anneau fermé [lng, lat]
function _circlePolygon(center, radiusM, steps = 64) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const lat1 = toRad(center.lat);
  const lng1 = toRad(center.lng);
  const d    = radiusM / EARTH_RADIUS_M;
  const ring = [];
  for (let i = 0; i < steps; i++) {
    const brg  = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
    const lng2 = lng1 + Math.atan2(
      Math.sin(brg) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
    ring.push([toDeg(lng2), toDeg(lat2)]);
  }
  ring.push(ring[0]);
  return ring;
}

// API isochrone/isodistance IGN Géoplateforme — retourne l'anneau extérieur fermé
async function _fetchIsochrone(center, { costType, costValue, profile }) {
  const params = new URLSearchParams({
    point: `${center.lng},${center.lat}`,
    resource: 'bdtopo-valhalla',
    costType,
    costValue: String(costValue),
    profile,
    direction: 'departure',
    timeUnit: 'minute',
    distanceUnit: 'meter',
    geometryFormat: 'geojson',
  });

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ISOCHRONE_TIMEOUT);
  let res, data;
  try {
    res  = await fetch(`${ISOCHRONE_URL}?${params}`, { signal: ctrl.signal });
    data = await res.json().catch(() => null);
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? 'délai dépassé' : 'service injoignable');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(data?.error?.message || `HTTP ${res.status}`);
  }

  const geom = data?.geometry;
  let rings = [];
  if (geom?.type === 'Polygon')           rings = [geom.coordinates[0]];
  else if (geom?.type === 'MultiPolygon') rings = geom.coordinates.map(p => p[0]);
  rings = rings.filter(r => Array.isArray(r) && r.length >= 4);
  if (!rings.length) throw new Error('aucune zone retournée (point hors réseau ?)');

  // Garder le plus grand polygone (aire planaire approchée)
  const area = r => Math.abs(r.reduce((a, c, i) => {
    const n = r[(i + 1) % r.length];
    return a + (c[0] * n[1] - n[0] * c[1]);
  }, 0));
  const ring = rings.reduce((best, r) => area(r) > area(best) ? r : best);

  const closed = ring.map(c => [c[0], c[1]]);
  const f = closed[0], l = closed[closed.length - 1];
  if (f[0] !== l[0] || f[1] !== l[1]) closed.push([f[0], f[1]]);
  return closed;
}

// ── Popup zone ────────────────────────────────────────────────────

let _pendingZone = null; // géométrie en attente de validation
let _editingZoneId = null;

function _openNewZonePopup(geomData, defaultName = '') {
  _pendingZone = geomData;
  _editingZoneId = null;

  const popup = document.getElementById('zone-popup');
  document.getElementById('zone-popup-title').textContent = 'Nouvelle zone';
  document.getElementById('zone-name').value = defaultName;
  document.getElementById('zone-status').value = 'todo';
  document.getElementById('zone-coverage-info').classList.add('hidden');
  document.getElementById('btn-toggle-zone-status').classList.add('hidden');
  document.getElementById('btn-delete-zone').classList.add('hidden');
  document.getElementById('btn-save-zone').classList.remove('hidden');
  document.getElementById('btn-zone-overpass')?.classList.add('hidden');

  popup.classList.remove('hidden');
  const nameInput = document.getElementById('zone-name');
  nameInput.focus();
  nameInput.select();
}

function _showZonePopup(id) {
  const zone = _zones.find(z => z.id === id);
  if (!zone) return;

  _editingZoneId = id;
  _pendingZone   = null;

  document.getElementById('zone-popup-title').textContent = zone.name;
  document.getElementById('zone-name').value = zone.name;
  document.getElementById('zone-status').value = zone.status;

  const navLog = getNavLog();
  const { maxLevel, maxZoom } = _computeMaxCoverage(_zoneBbox(zone), navLog);
  const coverageEl = document.getElementById('zone-coverage-info');
  if (maxLevel && zone.status === 'done') {
    coverageEl.textContent = `Couverture : ${COVERAGE_LEVELS[maxLevel]?.label} (zoom ${maxZoom})`;
    coverageEl.classList.remove('hidden');
  } else {
    coverageEl.classList.add('hidden');
  }

  const btnToggle = document.getElementById('btn-toggle-zone-status');
  btnToggle.textContent = zone.status === 'todo' ? 'Passer à Traité' : 'Passer à À traiter';
  btnToggle.classList.remove('hidden');
  document.getElementById('btn-delete-zone').classList.remove('hidden');
  document.getElementById('btn-save-zone').classList.remove('hidden');

  const btnOverpass = document.getElementById('btn-zone-overpass');
  if (btnOverpass) {
    const hasBbox = Array.isArray(zone.bbox) && zone.bbox.length === 4;
    btnOverpass.classList.toggle('hidden', !hasBbox || !_onOverpassRequest);
  }

  document.getElementById('zone-popup').classList.remove('hidden');
  document.getElementById('zone-name').focus();
}

function _closeZonePopup() {
  document.getElementById('zone-popup')?.classList.add('hidden');
  // Aperçu conservé pendant la saisie d'une zone générée
  if (_pendingZone && !_drawMode) _clearPreview();
  _pendingZone   = null;
  _editingZoneId = null;
}

function _saveZone() {
  const name   = document.getElementById('zone-name').value.trim();
  const status = document.getElementById('zone-status').value;
  if (!name) return;

  if (_editingZoneId) {
    const zone = _zones.find(z => z.id === _editingZoneId);
    if (zone) { zone.name = name; zone.status = status; }
  } else {
    if (!_pendingZone) return;
    _zones.push({
      id: `z_${Date.now()}`,
      name, status,
      shapeType: _pendingZone.shapeType,
      bbox: _pendingZone.bbox,
      coordinates: _pendingZone.coordinates || null,
      ...(_pendingZone.generator ? { generator: _pendingZone.generator } : {}),
      createdAt: new Date().toISOString(),
    });
  }

  saveActiveProject({ trackingZones: _zones });
  _renderZones();
  _refreshZonesList();
  _closeZonePopup();
}

function _deleteZone() {
  if (!_editingZoneId) return;
  const zone = _zones.find(z => z.id === _editingZoneId);
  if (!confirm(`Supprimer la zone "${zone?.name}" ?`)) return;
  _zones = _zones.filter(z => z.id !== _editingZoneId);
  saveActiveProject({ trackingZones: _zones });
  _renderZones();
  _refreshZonesList();
  _closeZonePopup();
}

function _toggleZoneStatus() {
  if (!_editingZoneId) return;
  const zone = _zones.find(z => z.id === _editingZoneId);
  if (!zone) return;
  zone.status = zone.status === 'todo' ? 'done' : 'todo';
  document.getElementById('zone-status').value = zone.status;
  document.getElementById('btn-toggle-zone-status').textContent =
    zone.status === 'todo' ? 'Passer à Traité' : 'Passer à À traiter';
  saveActiveProject({ trackingZones: _zones });
  _renderZones();
  _refreshZonesList();
}

// ── Panneau liste zones ───────────────────────────────────────────

function _refreshZonesList() {
  const panel = document.getElementById('zones-panel');
  if (!panel || panel.classList.contains('hidden')) return;

  const list = document.getElementById('zones-list');
  if (!list) return;
  list.innerHTML = '';

  const navLog = getNavLog();
  for (const zone of _zones) {
    const bbox   = _zoneBbox(zone);
    const { maxLevel } = _computeMaxCoverage(bbox, navLog);
    const lvlLabel    = maxLevel ? COVERAGE_LEVELS[maxLevel]?.label : '';
    const statusLabel = zone.status === 'done' ? 'Traité' : 'À traiter';
    const shapeIcon   = zone.shapeType === 'poly' ? '⬡' : '⬜';

    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = `list-dot ${zone.status === 'done' ? 'dot-done' : 'dot-todo'}`;
    const div = document.createElement('div');
    const main = document.createElement('div');
    main.className = 'list-item-main';
    main.textContent = `${shapeIcon} ${zone.name}`;
    const sub = document.createElement('div');
    sub.className = 'list-item-sub';
    sub.textContent = `${statusLabel}${lvlLabel ? ' · ' + lvlLabel : ''}`;
    div.append(main, sub);
    const edit = document.createElement('button');
    edit.className = 'btn-icon zone-edit-btn';
    edit.title = 'Modifier la zone';
    edit.textContent = '✎';
    edit.addEventListener('click', e => {
      e.stopPropagation();
      _showZonePopup(zone.id);
    });
    li.append(dot, div, edit);
    li.addEventListener('click', () => _fitAnalysisToZone(zone));
    list.appendChild(li);
  }
}

function _fitAnalysisToZone(zone) {
  const [w, s, e, n] = _zoneBbox(zone);
  _mapAnalysis?.fitBounds([[w, s], [e, n]], { padding: 40 });
}

// ── Couverture navLog ─────────────────────────────────────────────

function _computeMaxCoverage(bbox, navLog) {
  let maxRank = 0, maxLevel = null, maxZoom = null;
  for (const entry of navLog) {
    if (!entry.bbox || !_bboxOverlaps(bbox, entry.bbox)) continue;
    const rank = coverageLevelRank(entry.level);
    if (rank > maxRank) { maxRank = rank; maxLevel = entry.level; maxZoom = entry.zoom; }
  }
  return { maxLevel, maxZoom };
}

function _bboxOverlaps(a, b) {
  return !(b[0] > a[2] || b[2] < a[0] || b[1] > a[3] || b[3] < a[1]);
}

// ── Tooltip ───────────────────────────────────────────────────────

let _tooltip = null;
function _showTooltip(lngLat, text) {
  if (!_tooltip) _tooltip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'tracking-tooltip' });
  _tooltip.setLngLat(lngLat).setText(text).addTo(_map);
}
function _hideTooltip() { _tooltip?.remove(); }

// ── Câblage UI ────────────────────────────────────────────────────

function _wireUI() {
  // Bouton ✏ Zone : quitte le mode actif, sinon ouvre le menu des modes
  const btnZone  = document.getElementById('btn-draw-poly');
  const modeMenu = document.getElementById('zone-mode-menu');
  btnZone?.addEventListener('click', e => {
    e.stopPropagation();
    if (_drawMode) { _exitDrawMode(); modeMenu?.classList.add('hidden'); return; }
    if (!modeMenu) { _enterPolyMode(); return; }
    const hidden = modeMenu.classList.toggle('hidden');
    if (!hidden) {
      const r = btnZone.getBoundingClientRect();
      modeMenu.style.left   = `${r.left}px`;
      modeMenu.style.bottom = `${window.innerHeight - r.top + 6}px`;
    }
  });
  modeMenu?.querySelectorAll('.zone-mode-item').forEach(item => {
    item.addEventListener('click', () => {
      modeMenu.classList.add('hidden');
      _closeZonePopup();
      _exitDrawMode();
      const mode = item.dataset.mode;
      if (mode === 'poly') _enterPolyMode();
      else _enterPointMode(mode);
    });
  });
  document.addEventListener('click', e => {
    if (modeMenu && !modeMenu.contains(e.target) && e.target !== btnZone) {
      modeMenu.classList.add('hidden');
    }
  });

  // Barre flottante modes point
  document.getElementById('btn-point-zone-generate')?.addEventListener('click', _generatePointZone);
  document.getElementById('btn-point-zone-cancel')?.addEventListener('click', () => _exitDrawMode());
  for (const id of ['point-zone-value', 'point-zone-unit']) {
    document.getElementById(id)?.addEventListener('input', () => {
      if (_drawMode === 'circle') _updatePointPreview();
    });
  }
  document.getElementById('point-zone-value')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') _generatePointZone();
  });

  // Barre flottante polygone
  document.getElementById('btn-poly-finish')?.addEventListener('click', _finishPoly);
  document.getElementById('btn-poly-undo')?.addEventListener('click', _undoLastPoint);
  document.getElementById('btn-poly-cancel')?.addEventListener('click', _exitDrawMode);

  // Zones list
  document.getElementById('btn-zones-list')?.addEventListener('click', () => {
    document.getElementById('zones-panel')?.classList.toggle('hidden');
    _refreshZonesList();
  });
  document.getElementById('btn-close-zones')?.addEventListener('click', () => {
    document.getElementById('zones-panel')?.classList.add('hidden');
  });

  // Popup zone
  document.getElementById('btn-save-zone')?.addEventListener('click', _saveZone);
  document.getElementById('btn-delete-zone')?.addEventListener('click', _deleteZone);
  document.getElementById('btn-toggle-zone-status')?.addEventListener('click', _toggleZoneStatus);
  document.getElementById('btn-cancel-zone')?.addEventListener('click', _closeZonePopup);
  document.getElementById('btn-close-zone-popup')?.addEventListener('click', _closeZonePopup);
  document.getElementById('btn-zone-overpass')?.addEventListener('click', () => {
    if (!_editingZoneId || !_onOverpassRequest) return;
    const zone = _zones.find(z => z.id === _editingZoneId);
    if (!zone) return;
    _closeZonePopup();
    _onOverpassRequest(zone);
  });
  document.getElementById('zone-name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') _saveZone();
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (_drawMode) _exitDrawMode();
    document.getElementById('zone-mode-menu')?.classList.add('hidden');
    _closeZonePopup();
  });
}
