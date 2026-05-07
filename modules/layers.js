import { saveActiveProject } from './projects.js';

// Couches raster disponibles.
// type 'wmts' → URL IGN Géoplateforme
// type 'xyz'  → tuiles XYZ standard (tableau de tiles pour load balancing)
const LAYER_DEFS = [
  // ── IGN Géoplateforme ─────────────────────────────────────────
  {
    id: 'plan', label: 'Plan IGN', group: 'IGN',
    type: 'wmts', layer: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', format: 'image/png',
    minZoom: 6, maxZoom: 18,
  },
  {
    id: 'ortho', label: 'Ortho HR', group: 'IGN',
    type: 'wmts', layer: 'ORTHOIMAGERY.ORTHOPHOTOS', format: 'image/jpeg',
    minZoom: 6, maxZoom: 21,
  },
  {
    id: 'ortho20', label: 'Ortho 20cm', group: 'IGN',
    type: 'wmts', layer: 'HR.ORTHOIMAGERY.ORTHOPHOTOS', format: 'image/jpeg',
    minZoom: 16, maxZoom: 21, warnZoom: 16,
  },
  {
    id: 'pcrs', label: 'PCRS Image', group: 'IGN',
    type: 'wmts', layer: 'PCRS.GRAPHE.PCRS', format: 'image/png',
    minZoom: 18, maxZoom: 21, warnZoom: 18,
  },
  {
    id: 'cadastre', label: 'Cadastre', group: 'IGN',
    type: 'wmts', layer: 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS', format: 'image/png',
    minZoom: 13, maxZoom: 20,
  },
  {
    id: 'routes', label: 'Routes', group: 'IGN',
    type: 'wmts', layer: 'TRANSPORTNETWORKS.ROADS', format: 'image/png',
    minZoom: 6, maxZoom: 18,
  },
  // ── Google ────────────────────────────────────────────────────
  {
    id: 'google-sat', label: 'Google Satellite', group: 'Google',
    type: 'xyz',
    tiles: [
      'https://mt0.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
      'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
      'https://mt2.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
      'https://mt3.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    ],
    minZoom: 0, maxZoom: 22,
    attribution: '© Google',
  },
  {
    id: 'google-hybrid', label: 'Google Hybride', group: 'Google',
    type: 'xyz',
    tiles: [
      'https://mt0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      'https://mt2.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      'https://mt3.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    ],
    minZoom: 0, maxZoom: 22,
    attribution: '© Google',
  },
  {
    id: 'google-map', label: 'Google Maps', group: 'Google',
    type: 'xyz',
    tiles: [
      'https://mt0.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
      'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
      'https://mt2.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
      'https://mt3.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    ],
    minZoom: 0, maxZoom: 22,
    attribution: '© Google',
  },
];

function wmtsUrl(def) {
  return `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${def.layer}&STYLE=normal&FORMAT=${def.format}&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
}

function layerId(def) { return `lyr-${def.id}`; }
function sourceId(def) { return `lyr-${def.id}`; }

// Couche avant laquelle insérer les rasters (tous les layers vectoriels doivent rester dessus)
const VECTOR_LAYER_IDS = ['zones-analysis-line-halo', 'annotations-layer', 'navlog-layer-fill', 'zones-fill'];
function _firstVectorLayer() {
  for (const id of VECTOR_LAYER_IDS) {
    if (_map.getLayer(id)) return id;
  }
  return undefined;
}

let _map = null;
let _config = [];

// ── Init / reload ─────────────────────────────────────────────────

export function initLayers(map, initialConfig) {
  _map = map;
  _config = _normalizeConfig(initialConfig);
  _applyToMap();
  _buildUI();
  _wireMapZoom();
}

export function getLayerConfig() {
  return _config.map(c => ({ ...c }));
}

export function reloadLayers(config) {
  _config = _normalizeConfig(config);
  _applyToMap();
  _buildUI();
}

function _normalizeConfig(config) {
  if (!config || config.length === 0) {
    return LAYER_DEFS.map(def => ({
      id: def.id,
      enabled: def.id === 'google-sat',
      opacity: 100,
    }));
  }
  const existing = new Map(config.map(c => [c.id, c]));
  return LAYER_DEFS.map(def => existing.get(def.id) || { id: def.id, enabled: false, opacity: 100 });
}

// ── Rendu MapLibre ────────────────────────────────────────────────

function _applyToMap() {
  if (!_map || !_map.isStyleLoaded()) return;
  for (const def of LAYER_DEFS) {
    if (_map.getLayer(layerId(def))) _map.removeLayer(layerId(def));
    if (_map.getSource(sourceId(def))) _map.removeSource(sourceId(def));
  }
  for (const cfg of _config) {
    const def = LAYER_DEFS.find(d => d.id === cfg.id);
    if (!def || !cfg.enabled) continue;
    _addLayer(def, cfg.opacity / 100);
  }
}

function _addLayer(def, opacity) {
  const sid = sourceId(def);
  const lid = layerId(def);

  const tiles = def.type === 'wmts' ? [wmtsUrl(def)] : def.tiles;

  _map.addSource(sid, {
    type: 'raster',
    tiles,
    tileSize: 256,
    minzoom: def.minZoom,
    maxzoom: def.maxZoom,
    attribution: def.attribution || '© IGN-Géoplateforme',
  });

  // Toujours insérer AVANT les couches vectorielles (annotations, navlog, zones)
  const before = _firstVectorLayer();
  _map.addLayer({
    id: lid,
    type: 'raster',
    source: sid,
    paint: { 'raster-opacity': opacity },
  }, before);
}

// ── UI du sélecteur ───────────────────────────────────────────────

function _buildUI() {
  const container = document.getElementById('layers-list');
  if (!container) return;
  container.innerHTML = '';

  let currentGroup = null;
  for (const cfg of _config) {
    const def = LAYER_DEFS.find(d => d.id === cfg.id);
    if (!def) continue;

    if (def.group !== currentGroup) {
      currentGroup = def.group;
      const sep = document.createElement('div');
      sep.className = 'layer-group-sep';
      sep.textContent = currentGroup;
      container.appendChild(sep);
    }

    const item = document.createElement('div');
    item.className = 'layer-item';
    item.dataset.id = def.id;

    // Header
    const header = document.createElement('div');
    header.className = 'layer-item-header';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.id = `lchk-${def.id}`;
    chk.checked = cfg.enabled;

    const lbl = document.createElement('label');
    lbl.htmlFor = `lchk-${def.id}`;
    lbl.className = 'layer-name';
    lbl.textContent = def.label;

    const orderBtns = document.createElement('div');
    orderBtns.className = 'layer-order-btns';

    const btnUp   = document.createElement('button');
    btnUp.title   = 'Monter';
    btnUp.textContent = '▲';

    const btnDown  = document.createElement('button');
    btnDown.title  = 'Descendre';
    btnDown.textContent = '▼';

    orderBtns.append(btnUp, btnDown);
    header.append(chk, lbl, orderBtns);
    item.appendChild(header);

    if (def.warnZoom) {
      const warn = document.createElement('div');
      warn.className = 'layer-warn';
      warn.id = `lwarn-${def.id}`;
      warn.textContent = `Non disponible avant zoom ${def.warnZoom}`;
      item.appendChild(warn);
    }

    // Opacité
    const opRow = document.createElement('div');
    opRow.className = `layer-opacity-row${cfg.enabled ? ' enabled' : ''}`;

    const slider = document.createElement('input');
    slider.type  = 'range';
    slider.id    = `lopa-${def.id}`;
    slider.min   = '0';
    slider.max   = '100';
    slider.value = String(cfg.opacity);

    const opVal = document.createElement('span');
    opVal.className  = 'layer-opacity-val';
    opVal.id         = `lopav-${def.id}`;
    opVal.textContent = `${cfg.opacity}%`;

    opRow.append(slider, opVal);
    item.appendChild(opRow);

    container.appendChild(item);

    // Événements — références directes aux éléments créés ci-dessus
    chk.addEventListener('change', e => {
      _setCfg(def.id, 'enabled', e.target.checked);
      _applyToMap();
      _refreshOpacityRow(def.id);
      _save();
    });

    slider.addEventListener('input', e => {
      const val = parseInt(e.target.value);
      opVal.textContent = `${val}%`;
      _setCfg(def.id, 'opacity', val);
      const lid = layerId(def);
      if (_map.getLayer(lid)) _map.setPaintProperty(lid, 'raster-opacity', val / 100);
      _save();
    });

    for (const btn of [btnUp, btnDown]) {
      btn.addEventListener('click', () => {
        const idx = _config.findIndex(c => c.id === def.id);
        if (btn === btnUp && idx > 0) {
          [_config[idx - 1], _config[idx]] = [_config[idx], _config[idx - 1]];
        } else if (btn === btnDown && idx < _config.length - 1) {
          [_config[idx], _config[idx + 1]] = [_config[idx + 1], _config[idx]];
        }
        _applyToMap();
        _buildUI();
        _save();
      });
    }
  }

  _updateZoomWarnings();
}

function _wireMapZoom() {
  _map.off('zoom', _updateZoomWarnings);
  _map.on('zoom', _updateZoomWarnings);
}

function _updateZoomWarnings() {
  if (!_map) return;
  const zoom = _map.getZoom();
  for (const def of LAYER_DEFS) {
    if (!def.warnZoom) continue;
    const el = document.getElementById(`lwarn-${def.id}`);
    if (!el) continue;
    el.classList.toggle('visible', zoom < def.warnZoom);
  }
}

function _refreshOpacityRow(id) {
  const cfg = _config.find(c => c.id === id);
  const row = document.querySelector(`.layer-item[data-id="${id}"] .layer-opacity-row`);
  if (!row || !cfg) return;
  row.classList.toggle('enabled', cfg.enabled);
}

function _setCfg(id, key, value) {
  const cfg = _config.find(c => c.id === id);
  if (cfg) cfg[key] = value;
}

function _save() {
  saveActiveProject({ layerConfig: getLayerConfig() });
}

// ── Toggle panneau couches ────────────────────────────────────────

export function initLayersPanel() {
  const btn   = document.getElementById('btn-layers');
  const panel = document.getElementById('layers-panel');
  if (!btn || !panel) return;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const hidden = panel.classList.toggle('hidden');
    if (!hidden) {
      // Positionner en fixed au-dessus du bouton, hors du contexte overflow
      const r = btn.getBoundingClientRect();
      panel.style.left   = `${r.left}px`;
      panel.style.bottom = `${window.innerHeight - r.top + 6}px`;
    }
  });

  document.addEventListener('click', e => {
    if (!panel.contains(e.target) && e.target !== btn) {
      panel.classList.add('hidden');
    }
  });
}
