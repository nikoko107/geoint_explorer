import { getActiveProject } from './projects.js';

export function initExport() {
  document.getElementById('btn-export-geojson')?.addEventListener('click', exportGeoJSON);
  document.getElementById('btn-export-csv')?.addEventListener('click', exportCSV);
}

// ── Export annotations ────────────────────────────────────────────

function exportGeoJSON() {
  const project = getActiveProject();
  if (!project) return;

  const features = (project.annotations || []).map(ann => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: ann.coords },
    properties: {
      label: ann.label,
      category: ann.category,
      createdAt: ann.createdAt,
    },
  }));

  const geojson = { type: 'FeatureCollection', features };
  _download(
    JSON.stringify(geojson, null, 2),
    `annotations_${_safeName(project.name)}_${_dateStamp()}.geojson`,
    'application/geo+json'
  );
}

function exportCSV() {
  const project = getActiveProject();
  if (!project) return;

  const rows = ['id,lat,lon,label,category,createdAt'];
  for (const ann of project.annotations || []) {
    const lat = ann.coords[1];
    const lon = ann.coords[0];
    rows.push([
      ann.id,
      lat,
      lon,
      _csvEscape(ann.label),
      _csvEscape(ann.category),
      ann.createdAt,
    ].join(','));
  }

  _download(
    rows.join('\n'),
    `annotations_${_safeName(project.name)}_${_dateStamp()}.csv`,
    'text/csv;charset=utf-8'
  );
}

// ── Export / Import projet complet ────────────────────────────────

export function exportProject() {
  const project = getActiveProject();
  if (!project) return;

  const payload = {
    geoint_export_version: 1,
    name:          project.name,
    createdAt:     project.createdAt,
    lastView:      project.lastView      || null,
    layerConfig:   project.layerConfig   || [],
    annotations:   project.annotations   || [],
    navLog:        project.navLog        || [],
    trackingZones: project.trackingZones || [],
  };

  _download(
    JSON.stringify(payload, null, 2),
    `projet_${_safeName(project.name)}_${_dateStamp()}.json`,
    'application/json'
  );
}

export function parseProjectImport(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object')          throw new Error('Fichier JSON invalide');
  if (!data.geoint_export_version)                throw new Error('Ce fichier n\'est pas un export GeoINT Explorer');
  if (!data.name || typeof data.name !== 'string') throw new Error('Nom de projet manquant');

  return {
    name:          data.name,
    createdAt:     typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
    lastView:      data.lastView || null,
    layerConfig:   Array.isArray(data.layerConfig)   ? data.layerConfig   : [],
    annotations:   Array.isArray(data.annotations)   ? data.annotations   : [],
    navLog:        Array.isArray(data.navLog)         ? data.navLog        : [],
    trackingZones: Array.isArray(data.trackingZones) ? data.trackingZones : [],
  };
}

// ── Utilitaires ───────────────────────────────────────────────────

function _download(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function _csvEscape(val) {
  if (!val) return '';
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function _safeName(name) {
  return name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
}

function _dateStamp() {
  return new Date().toISOString().slice(0, 10);
}
