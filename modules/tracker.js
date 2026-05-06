import { saveActiveProject } from './projects.js';

// Niveaux de couverture
export const COVERAGE_LEVELS = {
  survol:     { label: 'Survol',            minZoom: 14, maxZoom: 16, color: '#fef08a', fillOpacity: 0.25, dotClass: 'dot-survol' },
  inspection: { label: 'Inspection',        minZoom: 17, maxZoom: 19, color: '#fb923c', fillOpacity: 0.25, dotClass: 'dot-inspection' },
  analyse:    { label: 'Analyse détaillée', minZoom: 20, maxZoom: 99, color: '#3b82f6', fillOpacity: 0.25, dotClass: 'dot-analyse' },
};

export function getCoverageLevel(zoom) {
  if (zoom >= 20) return 'analyse';
  if (zoom >= 17) return 'inspection';
  if (zoom >= 14) return 'survol';
  return null;
}

export function coverageLevelRank(level) {
  return level === 'analyse' ? 3 : level === 'inspection' ? 2 : level === 'survol' ? 1 : 0;
}

let _mapAnalysis = null;
let _mapTracking = null;
let _navLog = [];

const SOURCE_ID = 'navlog-source';
const LAYER_ID  = 'navlog-layer';

export function initTracker(mapAnalysis, mapTracking, initialNavLog) {
  _mapAnalysis = mapAnalysis;
  _mapTracking = mapTracking;
  _navLog = initialNavLog || [];

  _positionCaptureRect();
  _initTrackingSource();
  _renderNavLog();

  // Enregistrement sur moveend
  _mapAnalysis.on('moveend', _onMoveEnd);

  // Repositionner le rectangle si la carte est redimensionnée
  _mapAnalysis.on('resize', _positionCaptureRect);
}

export function reloadNavLog(navLog) {
  _navLog = navLog || [];
  _renderNavLog();
}

export function getNavLog() {
  return _navLog;
}

// ── Rectangle de capture ──────────────────────────────────────────

function _captureRectLayout() {
  const container = _mapAnalysis.getContainer();
  const { width: w, height: h } = container.getBoundingClientRect();
  const capW = Math.round(w * 0.6);
  const capH = Math.round(h * 0.6);
  const left = Math.round((w - capW) / 2);
  const top  = Math.round((h - capH) / 2);
  return { capW, capH, left, top };
}

function _positionCaptureRect() {
  const { capW, capH, left, top } = _captureRectLayout();
  const el = document.getElementById('capture-rect');
  if (!el) return;
  el.style.left   = `${left}px`;
  el.style.top    = `${top}px`;
  el.style.width  = `${capW}px`;
  el.style.height = `${capH}px`;
}

function _getCaptureRectBbox() {
  const { capW, capH, left, top } = _captureRectLayout();
  const sw = _mapAnalysis.unproject([left, top + capH]);
  const ne = _mapAnalysis.unproject([left + capW, top]);
  return [sw.lng, sw.lat, ne.lng, ne.lat]; // [minLng, minLat, maxLng, maxLat]
}

// ── Enregistrement ────────────────────────────────────────────────

function _onMoveEnd() {
  const zoom = _mapAnalysis.getZoom();
  if (zoom < 14) return;

  const bbox = _getCaptureRectBbox();
  const center = _mapAnalysis.getCenter();

  // Dédoublonnage : si chevauchement > 80% avec la dernière entrée, on skip
  if (_navLog.length > 0) {
    const last = _navLog[_navLog.length - 1];
    if (_overlapRatio(bbox, last.bbox) > 0.8) return;
  }

  const level = getCoverageLevel(zoom);
  if (!level) return;

  const entry = {
    id: `n_${Date.now()}`,
    bbox,
    zoom: Math.round(zoom * 10) / 10,
    center: [center.lng, center.lat],
    level,
    timestamp: new Date().toISOString(),
  };

  _navLog.push(entry);
  saveActiveProject({ navLog: _navLog });
  _renderNavLog();
}

// ── Calcul chevauchement ──────────────────────────────────────────

function _overlapRatio(a, b) {
  const xOverlap = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const yOverlap = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const intersection = xOverlap * yOverlap;
  if (intersection === 0) return 0;
  const aArea = (a[2] - a[0]) * (a[3] - a[1]);
  const bArea = (b[2] - b[0]) * (b[3] - b[1]);
  const union = aArea + bArea - intersection;
  return union > 0 ? intersection / union : 0;
}

// ── Rendu sur carte de suivi ──────────────────────────────────────

function _initTrackingSource() {
  if (_mapTracking.getSource(SOURCE_ID)) return;

  _mapTracking.addSource(SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  // Fond coloré selon niveau
  _mapTracking.addLayer({
    id: LAYER_ID + '-fill',
    type: 'fill',
    source: SOURCE_ID,
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': 0.22,
    },
  });

  // Contour
  _mapTracking.addLayer({
    id: LAYER_ID + '-line',
    type: 'line',
    source: SOURCE_ID,
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 0.8,
      'line-opacity': 0.6,
    },
  });

  // Tooltip au survol
  _mapTracking.on('mouseenter', LAYER_ID + '-fill', e => {
    _mapTracking.getCanvas().style.cursor = 'pointer';
    if (!e.features?.length) return;
    const f = e.features[0].properties;
    const date = new Date(f.timestamp).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
    const lvl = COVERAGE_LEVELS[f.level]?.label || f.level;
    // Tooltip simple via MapLibre popup
    _showTrackingTooltip(e.lngLat, `${date} — zoom ${f.zoom} — ${lvl}`);
  });
  _mapTracking.on('mouseleave', LAYER_ID + '-fill', () => {
    _mapTracking.getCanvas().style.cursor = '';
    _hideTrackingTooltip();
  });

  // Clic : centrer carte d'analyse
  _mapTracking.on('click', LAYER_ID + '-fill', e => {
    if (!e.features?.length) return;
    const bbox = JSON.parse(e.features[0].properties.bboxJson);
    const lng = (bbox[0] + bbox[2]) / 2;
    const lat = (bbox[1] + bbox[3]) / 2;
    _mapAnalysis.flyTo({ center: [lng, lat], zoom: e.features[0].properties.zoom });
  });
}

let _tooltip = null;
function _showTrackingTooltip(lngLat, text) {
  if (!_tooltip) {
    _tooltip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'tracking-tooltip' });
  }
  _tooltip.setLngLat(lngLat).setText(text).addTo(_mapTracking);
}
function _hideTrackingTooltip() {
  _tooltip?.remove();
}

function _renderNavLog() {
  if (!_mapTracking.getSource(SOURCE_ID)) return;

  // Pour chaque zone géographique, ne conserver que le niveau max atteint.
  // On groupe par zones qui se chevauchent à >60% et on garde le niveau max.
  // Pour simplifier et conserver les performances, on affiche toutes les entrées
  // mais avec la couleur du niveau max local calculé ci-dessous.
  const maxLevelByEntry = _computeMaxLevels(_navLog);

  const features = _navLog.map(entry => {
    const [w, s, e, n] = entry.bbox;
    const effectiveLevel = maxLevelByEntry.get(entry.id) || entry.level;
    const def = COVERAGE_LEVELS[effectiveLevel];
    return {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
      },
      properties: {
        id: entry.id,
        zoom: entry.zoom,
        level: effectiveLevel,
        color: def?.color || '#888',
        timestamp: entry.timestamp,
        bboxJson: JSON.stringify(entry.bbox),
      },
    };
  });

  _mapTracking.getSource(SOURCE_ID).setData({ type: 'FeatureCollection', features });
}

/**
 * Pour chaque entrée, calcule le niveau de couverture maximal historique
 * parmi toutes les entrées qui chevauchent significativement la même zone.
 */
function _computeMaxLevels(navLog) {
  const result = new Map();
  for (const entry of navLog) {
    let maxLevel = entry.level;
    let maxRank = coverageLevelRank(entry.level);
    for (const other of navLog) {
      if (other.id === entry.id) continue;
      if (_overlapRatio(entry.bbox, other.bbox) > 0.4) {
        const rank = coverageLevelRank(other.level);
        if (rank > maxRank) {
          maxRank = rank;
          maxLevel = other.level;
        }
      }
    }
    result.set(entry.id, maxLevel);
  }
  return result;
}

