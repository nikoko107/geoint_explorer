// Module de mesure linéaire sur la carte d'analyse.
// Clic = ajouter un point, double-clic = terminer. Zéro dépendance externe.

let _map = null;
let _active = false;
let _points = [];      // [[lng, lat], ...]
let _preview = null;   // coordonnée courante du curseur

const SRC_LINE   = 'measure-line';
const SRC_PTS    = 'measure-points';
const SRC_PREV   = 'measure-preview';
const LYR_LINE   = 'measure-line-lyr';
const LYR_PTS    = 'measure-pts-lyr';
const LYR_PREV   = 'measure-preview-lyr';

// ── Formule haversine ─────────────────────────────────────────────

function haversine([lng1, lat1], [lng2, lat2]) {
  const R = 6371000; // mètres
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function totalDist(pts) {
  return pts.slice(1).reduce((sum, p, i) => sum + haversine(pts[i], p), 0);
}

export function formatDist(m) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

// ── Sources / layers MapLibre ─────────────────────────────────────

function emptyFC(type = 'LineString') {
  return { type: 'FeatureCollection', features: type === 'Point'
    ? []
    : [{ type: 'Feature', geometry: { type, coordinates: [] }, properties: {} }] };
}

function _initSources() {
  if (_map.getSource(SRC_LINE)) return; // déjà initialisé

  const emptyLine = { type: 'FeatureCollection', features: [] };
  _map.addSource(SRC_LINE, { type: 'geojson', data: emptyLine });
  _map.addSource(SRC_PTS,  { type: 'geojson', data: emptyLine });
  _map.addSource(SRC_PREV, { type: 'geojson', data: emptyLine });

  _map.addLayer({ id: LYR_LINE, type: 'line', source: SRC_LINE,
    paint: { 'line-color': '#f87171', 'line-width': 3 } });

  _map.addLayer({ id: LYR_PREV, type: 'line', source: SRC_PREV,
    paint: { 'line-color': '#fbbf24', 'line-width': 2,
             'line-dasharray': [4, 3], 'line-opacity': 0.8 } });

  _map.addLayer({ id: LYR_PTS, type: 'circle', source: SRC_PTS,
    paint: { 'circle-radius': 6, 'circle-color': '#fff',
             'circle-stroke-width': 2, 'circle-stroke-color': '#f87171' } });
}

function _updateLine() {
  _map.getSource(SRC_LINE)?.setData({
    type: 'FeatureCollection',
    features: _points.length >= 2
      ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: _points }, properties: {} }]
      : [],
  });
  _map.getSource(SRC_PTS)?.setData({
    type: 'FeatureCollection',
    features: _points.map(c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} })),
  });
}

function _updatePreview() {
  const empty = { type: 'FeatureCollection', features: [] };
  if (!_preview || _points.length === 0) {
    _map.getSource(SRC_PREV)?.setData(empty);
    return;
  }
  _map.getSource(SRC_PREV)?.setData({
    type: 'FeatureCollection',
    features: [{ type: 'Feature',
      geometry: { type: 'LineString', coordinates: [_points[_points.length - 1], _preview] },
      properties: {} }],
  });
}

// ── Handlers événements ───────────────────────────────────────────

function _onClick(e) {
  // Ignorer si c'est le 2e clic d'un double-clic (géré par _onDblClick)
  _points.push([e.lngLat.lng, e.lngLat.lat]);
  _updateLine();
  _updatePreview();
  _updateHint();
}

function _onDblClick(e) {
  e.preventDefault();
  // Le double-clic a aussi déclenché onClick → on retire le dernier point ajouté
  if (_points.length > 0) _points.pop();
  _finish();
}

function _onMove(e) {
  _preview = [e.lngLat.lng, e.lngLat.lat];
  _updatePreview();
  if (_points.length === 0) {
    _setHint('Cliquez pour placer le premier point');
  } else {
    const d = totalDist([..._points, _preview]);
    _setHint(`Distance : ${formatDist(d)}`);
  }
}

// ── Barre flottante ───────────────────────────────────────────────

function _setHint(text) {
  const el = document.getElementById('measure-hint');
  if (el) el.textContent = text;
}

function _updateHint() {
  const d = totalDist(_points);
  _setHint(_points.length <= 1 ? 'Cliquez pour mesurer' : `Distance : ${formatDist(d)}`);
}

function _showBar(visible) {
  document.getElementById('measure-bar')?.classList.toggle('hidden', !visible);
}

// ── Start / stop ──────────────────────────────────────────────────

function _start() {
  _active = true;
  _points = [];
  _preview = null;
  _map.getCanvas().style.cursor = 'crosshair';
  _map.doubleClickZoom.disable();
  document.getElementById('btn-measure')?.classList.add('active');
  _showBar(true);
  _setHint('Cliquez pour mesurer');
  _map.on('click',    _onClick);
  _map.on('dblclick', _onDblClick);
  _map.on('mousemove', _onMove);
}

function _finish() {
  _active = false;
  _map.getCanvas().style.cursor = '';
  _map.doubleClickZoom.enable();
  _map.off('click',    _onClick);
  _map.off('dblclick', _onDblClick);
  _map.off('mousemove', _onMove);
  _map.getSource(SRC_PREV)?.setData({ type: 'FeatureCollection', features: [] });

  const d = totalDist(_points);
  const distStr = formatDist(d);
  document.getElementById('btn-measure')?.classList.remove('active');

  if (_points.length >= 2) {
    _setHint(`✓ ${distStr} — Cliquez sur ⎘ pour copier`);
    document.getElementById('btn-measure-copy')?.classList.remove('hidden');
    document.getElementById('btn-measure-copy').dataset.dist = distStr;
  } else {
    _showBar(false);
  }
}

function _cancel() {
  _active = false;
  _points = [];
  _preview = null;
  _map.getCanvas().style.cursor = '';
  _map.doubleClickZoom.enable();
  _map.off('click',    _onClick);
  _map.off('dblclick', _onDblClick);
  _map.off('mousemove', _onMove);
  const empty = { type: 'FeatureCollection', features: [] };
  _map.getSource(SRC_LINE)?.setData(empty);
  _map.getSource(SRC_PTS)?.setData(empty);
  _map.getSource(SRC_PREV)?.setData(empty);
  document.getElementById('btn-measure')?.classList.remove('active');
  document.getElementById('btn-measure-copy')?.classList.add('hidden');
  _showBar(false);
}

// ── API publique ──────────────────────────────────────────────────

export function initMeasure(map) {
  _map = map;
  if (map.isStyleLoaded()) {
    _initSources();
  } else {
    map.once('load', _initSources);
  }

  document.getElementById('btn-measure')?.addEventListener('click', toggleMeasure);

  document.getElementById('btn-measure-finish')?.addEventListener('click', () => {
    if (_active) _finish();
  });

  document.getElementById('btn-measure-undo')?.addEventListener('click', () => {
    if (_points.length > 0) { _points.pop(); _updateLine(); _updateHint(); }
  });

  document.getElementById('btn-measure-cancel')?.addEventListener('click', _cancel);

  document.getElementById('btn-measure-copy')?.addEventListener('click', (e) => {
    const dist = e.currentTarget.dataset.dist;
    navigator.clipboard?.writeText(dist).catch(() => {});
    const btn = e.currentTarget;
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = '⎘'; }, 1200);
  });

  // Échap annule
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _active) _cancel();
  });
}

export function toggleMeasure() {
  if (_active) _cancel();
  else _start();
}
