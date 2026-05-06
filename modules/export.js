import { getActiveProject } from './projects.js';

export function initExport() {
  document.getElementById('btn-export-geojson')?.addEventListener('click', exportGeoJSON);
  document.getElementById('btn-export-csv')?.addEventListener('click', exportCSV);
}

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
