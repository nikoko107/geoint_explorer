// Import de calques externes (GeoJSON / KML) fusionnés dans le projet actif.
// Parsing KML fait maison (DOMParser) — zéro dépendance externe.

import { saveActiveProject } from './projects.js';

let _map    = null;
let _layers = []; // [{ id, name, geojson, color, visible, createdAt }]

const FILL_FILTER  = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
const LINE_FILTER  = ['match', ['geometry-type'], ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'], true, false];
const POINT_FILTER = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false];

// Couches vectorielles au-dessus desquelles il ne faut jamais passer
// (mêmes ids que dans layers.js/tracking-zones.js)
const VECTOR_LAYER_IDS = ['zones-analysis-line-halo', 'annotations-layer', 'navlog-layer-fill', 'zones-fill'];
function _firstVectorLayer() {
  for (const id of VECTOR_LAYER_IDS) {
    if (_map.getLayer(id)) return id;
  }
  return undefined;
}

function _sourceId(l)     { return `ext-${l.id}`; }
function _fillLayerId(l)  { return `ext-${l.id}-fill`; }
function _lineLayerId(l)  { return `ext-${l.id}-line`; }
function _pointLayerId(l) { return `ext-${l.id}-pt`; }

// ── Rendu MapLibre ────────────────────────────────────────────────

function _addMapLayers(l) {
  const sid = _sourceId(l);
  if (_map.getSource(sid)) return;

  _map.addSource(sid, { type: 'geojson', data: l.geojson });
  const before = _firstVectorLayer();
  const vis = l.visible ? 'visible' : 'none';

  _map.addLayer({
    id: _fillLayerId(l), type: 'fill', source: sid,
    filter: FILL_FILTER,
    layout: { visibility: vis },
    paint: { 'fill-color': l.color, 'fill-opacity': 0.15 },
  }, before);

  _map.addLayer({
    id: _lineLayerId(l), type: 'line', source: sid,
    filter: LINE_FILTER,
    layout: { visibility: vis },
    paint: { 'line-color': l.color, 'line-width': 2 },
  }, before);

  _map.addLayer({
    id: _pointLayerId(l), type: 'circle', source: sid,
    filter: POINT_FILTER,
    layout: { visibility: vis },
    paint: {
      'circle-radius': 6, 'circle-color': l.color,
      'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff',
    },
  }, before);
}

function _removeMapLayers(l) {
  for (const lid of [_fillLayerId(l), _lineLayerId(l), _pointLayerId(l)]) {
    if (_map.getLayer(lid)) _map.removeLayer(lid);
  }
  if (_map.getSource(_sourceId(l))) _map.removeSource(_sourceId(l));
}

function _renderAll() {
  for (const l of _layers) _addMapLayers(l);
}

// ── API publique ─────────────────────────────────────────────────

export function initExternalLayers(map, initialLayers) {
  _map = map;
  _layers = initialLayers || [];
  _renderAll();
  _buildList();
  _wireUI();
}

export function reloadExternalLayers(layers) {
  for (const l of _layers) _removeMapLayers(l);
  _layers = layers || [];
  _renderAll();
  _buildList();
}

export function addLayer({ name, geojson, color }) {
  const layer = {
    id:        `ext_${Date.now()}`,
    name:      name || 'Calque importé',
    geojson,
    color:     color || '#60a5fa',
    visible:   true,
    createdAt: new Date().toISOString(),
  };
  _layers.push(layer);
  _addMapLayers(layer);
  _save();
  _buildList();
  return layer;
}

export function removeLayer(id) {
  const l = _layers.find(x => x.id === id);
  if (!l) return;
  _removeMapLayers(l);
  _layers = _layers.filter(x => x.id !== id);
  _save();
  _buildList();
}

function _setVisible(id, visible) {
  const l = _layers.find(x => x.id === id);
  if (!l) return;
  l.visible = visible;
  for (const lid of [_fillLayerId(l), _lineLayerId(l), _pointLayerId(l)]) {
    if (_map.getLayer(lid)) _map.setLayoutProperty(lid, 'visibility', visible ? 'visible' : 'none');
  }
  _save();
}

function _setColor(id, color) {
  const l = _layers.find(x => x.id === id);
  if (!l) return;
  l.color = color;
  if (_map.getLayer(_fillLayerId(l)))  _map.setPaintProperty(_fillLayerId(l), 'fill-color', color);
  if (_map.getLayer(_lineLayerId(l)))  _map.setPaintProperty(_lineLayerId(l), 'line-color', color);
  if (_map.getLayer(_pointLayerId(l))) _map.setPaintProperty(_pointLayerId(l), 'circle-color', color);
  _save();
}

function _save() {
  saveActiveProject({ importedLayers: _layers.map(l => ({ ...l })) });
}

// ── Parsing fichiers ─────────────────────────────────────────────

export async function importLayerFile(file) {
  const text = await file.text();
  const ext  = file.name.split('.').pop().toLowerCase();
  const geojson = ext === 'kml' ? _parseKML(text) : _normalizeGeoJSON(JSON.parse(text));
  if (!geojson.features.length) throw new Error('Aucune géométrie exploitable trouvée dans le fichier');
  return geojson;
}

function _normalizeGeoJSON(data) {
  if (data?.type === 'FeatureCollection') return data;
  if (data?.type === 'Feature') return { type: 'FeatureCollection', features: [data] };
  if (data?.type && data.coordinates) return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: data, properties: {} }] };
  throw new Error('GeoJSON invalide');
}

function _kmlCoords(text) {
  return text.trim().split(/\s+/).filter(Boolean).map(triplet => {
    const [lng, lat] = triplet.split(',').map(Number);
    return [lng, lat];
  });
}

function _extractKMLGeometries(placemark) {
  const geoms = [];

  for (const pt of placemark.getElementsByTagName('Point')) {
    const c = pt.getElementsByTagName('coordinates')[0]?.textContent;
    const coords = c ? _kmlCoords(c) : [];
    if (coords[0]) geoms.push({ type: 'Point', coordinates: coords[0] });
  }

  for (const ls of placemark.getElementsByTagName('LineString')) {
    const c = ls.getElementsByTagName('coordinates')[0]?.textContent;
    if (c) geoms.push({ type: 'LineString', coordinates: _kmlCoords(c) });
  }

  for (const poly of placemark.getElementsByTagName('Polygon')) {
    const outerText = poly.getElementsByTagName('outerBoundaryIs')[0]
      ?.getElementsByTagName('coordinates')[0]?.textContent;
    if (!outerText) continue;
    const rings = [_kmlCoords(outerText)];
    for (const inner of poly.getElementsByTagName('innerBoundaryIs')) {
      const c = inner.getElementsByTagName('coordinates')[0]?.textContent;
      if (c) rings.push(_kmlCoords(c));
    }
    geoms.push({ type: 'Polygon', coordinates: rings });
  }

  return geoms;
}

function _parseKML(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Fichier KML invalide');

  const features = [];
  for (const pm of doc.getElementsByTagName('Placemark')) {
    const name = pm.getElementsByTagName('name')[0]?.textContent?.trim() || '';
    const desc = pm.getElementsByTagName('description')[0]?.textContent?.trim() || '';
    for (const geometry of _extractKMLGeometries(pm)) {
      features.push({ type: 'Feature', geometry, properties: { name, description: desc } });
    }
  }
  return { type: 'FeatureCollection', features };
}

// ── UI panneau couches ───────────────────────────────────────────

function _buildList() {
  const container = document.getElementById('external-layers-list');
  if (!container) return;
  container.innerHTML = '';
  if (_layers.length === 0) return;

  const sep = document.createElement('div');
  sep.className = 'layer-group-sep';
  sep.textContent = 'Calques importés';
  container.appendChild(sep);

  for (const l of _layers) {
    const item = document.createElement('div');
    item.className = 'layer-item';

    const header = document.createElement('div');
    header.className = 'layer-item-header';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = l.visible;
    chk.addEventListener('change', e => _setVisible(l.id, e.target.checked));

    const lbl = document.createElement('span');
    lbl.className = 'layer-name';
    lbl.textContent = l.name;
    lbl.title = l.name;

    const color = document.createElement('input');
    color.type = 'color';
    color.className = 'ext-layer-color';
    color.value = l.color;
    color.addEventListener('input', e => _setColor(l.id, e.target.value));

    const del = document.createElement('button');
    del.className = 'btn-icon';
    del.title = 'Supprimer le calque';
    del.textContent = '🗑';
    del.addEventListener('click', () => {
      if (confirm(`Supprimer le calque "${l.name}" ?`)) removeLayer(l.id);
    });

    header.append(chk, lbl, color, del);
    item.appendChild(header);
    container.appendChild(item);
  }
}

function _wireUI() {
  const input = document.getElementById('external-layer-input');
  document.getElementById('btn-import-layer')?.addEventListener('click', () => input?.click());

  input?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const geojson = await importLayerFile(file);
      const name = file.name.replace(/\.[^.]+$/, '');
      addLayer({ name, geojson });
    } catch (err) {
      const banner = document.getElementById('quota-banner');
      const msg    = document.getElementById('quota-message');
      if (banner && msg) {
        msg.textContent = `Erreur d'import du calque : ${err.message}`;
        banner.classList.remove('hidden');
      }
    }
    input.value = '';
  });
}
