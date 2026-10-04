// Priorité des clics sur la carte de suivi : une seule action par clic.
// annotation > visite terrain > rectangle historique > zone > fond vide

export const TRACKING_HIT_LAYERS = {
  annotations: 'annotations-tracking-layer',
  visits:      'sv-visits-layer',
  zones:       'zones-fill',
  navLog:      'navlog-layer-fill',
};

const PRIORITY = ['annotations', 'visits', 'navLog', 'zones'];

/**
 * Vrai si une couche de priorité supérieure à `kind` est sous le point.
 * Pour kind = null (fond vide), toutes les couches interactives sont testées.
 */
export function hitHigherPriority(map, point, kind) {
  const idx    = kind ? PRIORITY.indexOf(kind) : PRIORITY.length;
  const layers = PRIORITY.slice(0, idx)
    .map(k => TRACKING_HIT_LAYERS[k])
    .filter(id => map.getLayer(id));
  if (!layers.length) return false;
  return map.queryRenderedFeatures(point, { layers }).length > 0;
}

export function isDrawingZone() {
  return document.body.classList.contains('draw-poly-mode');
}
