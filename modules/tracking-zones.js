import { saveActiveProject } from './projects.js';
import { getNavLog, coverageLevelRank, COVERAGE_LEVELS } from './tracker.js';

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

let _map         = null;
let _mapAnalysis = null;
let _zones       = [];

// État de dessin
let _drawMode   = null; // null | 'poly'
let _polyPoints = [];   // [{lng, lat}]

// Handlers DOM détachables
let _onPolyClick = null;
let _onPolyMove  = null;

// ── Init ──────────────────────────────────────────────────────────

export function initTrackingZones(mapTracking, mapAnalysis, initialZones) {
  _map         = mapTracking;
  _mapAnalysis = mapAnalysis;
  _zones       = initialZones || [];

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
    if (document.body.classList.contains('sv-mode')) return;
    if (!e.features?.length) return;
    e.stopPropagation?.();
    _showZonePopup(e.features[0].properties.id);
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

function _exitDrawMode() {
  if (_drawMode === 'poly') {
    _map.off('click', _onPolyClick);
    _map.off('mousemove', _onPolyMove);
    document.body.classList.remove('draw-poly-mode');
    document.getElementById('btn-draw-poly')?.classList.remove('active');
    document.getElementById('poly-draw-bar')?.classList.add('hidden');
    _polyPoints = [];
    _clearPreview();
  }
  _drawMode = null;
}

// ── Popup zone ────────────────────────────────────────────────────

let _pendingZone = null; // géométrie en attente de validation
let _editingZoneId = null;

function _openNewZonePopup(geomData) {
  _pendingZone = geomData;
  _editingZoneId = null;

  const popup = document.getElementById('zone-popup');
  document.getElementById('zone-popup-title').textContent = 'Nouvelle zone';
  document.getElementById('zone-name').value = '';
  document.getElementById('zone-status').value = 'todo';
  document.getElementById('zone-coverage-info').classList.add('hidden');
  document.getElementById('btn-toggle-zone-status').classList.add('hidden');
  document.getElementById('btn-delete-zone').classList.add('hidden');
  document.getElementById('btn-save-zone').classList.remove('hidden');

  popup.classList.remove('hidden');
  document.getElementById('zone-name').focus();
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

  document.getElementById('zone-popup').classList.remove('hidden');
  document.getElementById('zone-name').focus();
}

function _closeZonePopup() {
  document.getElementById('zone-popup')?.classList.add('hidden');
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
    li.append(dot, div);
    li.addEventListener('click', () => {
      const [w, s, e, n] = bbox;
      _mapAnalysis.fitBounds([[w, s], [e, n]], { padding: 40 });
    });
    list.appendChild(li);
  }
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
  document.getElementById('btn-draw-poly')?.addEventListener('click', () => {
    if (_drawMode === 'poly') _exitDrawMode();
    else { _exitDrawMode(); _enterPolyMode(); }
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
  document.getElementById('zone-name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') _saveZone();
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (_drawMode) _exitDrawMode();
    _closeZonePopup();
  });
}
