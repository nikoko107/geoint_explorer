import { saveActiveProject } from './projects.js';

const SOURCE_ID = 'annotations-source';
const LAYER_ID  = 'annotations-layer';

const TRACKING_SOURCE_ID = 'annotations-tracking-source';
const TRACKING_LAYER_ID  = 'annotations-tracking-layer';

let _map           = null;
let _mapTracking   = null;
let _annotations   = [];
let _annotationMode  = false;
let _selectionMode   = false;
let _editingId     = null;
let _pendingCoords = null;

const CATEGORY_COLORS = {
  'Info':       '#60a5fa',
  'Alerte':     '#f87171',
  'Traité':     '#4ade80',
  'À vérifier': '#fbbf24',
};

function categoryDot(cat) {
  const map = { 'Info': 'dot-info', 'Alerte': 'dot-alerte', 'Traité': 'dot-traite', 'À vérifier': 'dot-averifier' };
  return map[cat] || 'dot-default';
}

export function initAnnotations(map, initialAnnotations) {
  _map = map;
  _annotations = initialAnnotations || [];

  _initSource();
  _renderAnnotations();
  _wireUI();
}

export function reloadAnnotations(annotations) {
  _annotations = annotations || [];
  _renderAnnotations();
  _renderAnnotationsTracking();
  _refreshCategoryFilter();
  _refreshAnnotationsList();
}

export function getAnnotations() {
  return _annotations;
}

export function addAnnotationsBatch(items) {
  const ts = Date.now();
  items.forEach((item, i) => {
    _annotations.push({
      id:        `a_${ts}_${i}`,
      coords:    [item.lng, item.lat],
      label:     item.label || '',
      category:  item.category || 'Info',
      color:     item.color || null,
      createdAt: new Date().toISOString(),
    });
  });
  saveActiveProject({ annotations: _annotations });
  _renderAnnotations();
  _renderAnnotationsTracking();
  _refreshCategoryFilter();
  _refreshAnnotationsList();
}

export function initAnnotationsTracking(mapTracking) {
  _mapTracking = mapTracking;
  if (_mapTracking.getSource(TRACKING_SOURCE_ID)) return;

  _mapTracking.addSource(TRACKING_SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  _mapTracking.addLayer({
    id: TRACKING_LAYER_ID,
    type: 'circle',
    source: TRACKING_SOURCE_ID,
    paint: {
      'circle-radius': 5,
      'circle-color': ['get', 'color'],
      'circle-stroke-width': 1,
      'circle-stroke-color': '#fff',
      'circle-opacity': 0.85,
    },
  });

  _renderAnnotationsTracking();
}

function _renderAnnotationsTracking() {
  if (!_mapTracking?.getSource(TRACKING_SOURCE_ID)) return;
  const features = _annotations.map(ann => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: ann.coords },
    properties: { color: ann.color || CATEGORY_COLORS[ann.category] || '#94a3b8' },
  }));
  _mapTracking.getSource(TRACKING_SOURCE_ID).setData({ type: 'FeatureCollection', features });
}

// ── Source GeoJSON ────────────────────────────────────────────────

function _initSource() {
  if (_map.getSource(SOURCE_ID)) return;

  _map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  _map.addLayer({
    id: LAYER_ID,
    type: 'circle',
    source: SOURCE_ID,
    paint: {
      'circle-radius': 7,
      'circle-color': ['get', 'color'],
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#fff',
      'circle-opacity': 0.9,
    },
  });

  // Clic sur marker (mode inactif uniquement)
  _map.on('click', LAYER_ID, e => {
    if (_annotationMode) return;
    const f = e.features?.[0];
    if (!f) return;
    e.stopPropagation?.();
    _showViewPopup(f.properties.id);
  });

  _map.on('mouseenter', LAYER_ID, () => {
    if (!_annotationMode) _map.getCanvas().style.cursor = 'pointer';
  });
  _map.on('mouseleave', LAYER_ID, () => {
    if (!_annotationMode) _map.getCanvas().style.cursor = '';
  });

  // Clic sur la carte en mode annotation
  _map.on('click', e => {
    if (!_annotationMode) return;
    // Ignorer si clic sur un marker existant
    const hit = _map.queryRenderedFeatures(e.point, { layers: [LAYER_ID] });
    if (hit.length > 0) return;
    _pendingCoords = [e.lngLat.lng, e.lngLat.lat];
    _editingId = null;
    _openCreationPopup();
  });
}

function _renderAnnotations() {
  if (!_map.getSource(SOURCE_ID)) return;

  const features = _annotations.map(ann => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: ann.coords },
    properties: {
      id: ann.id,
      label: ann.label,
      category: ann.category,
      createdAt: ann.createdAt,
      color: ann.color || CATEGORY_COLORS[ann.category] || '#94a3b8',
    },
  }));

  _map.getSource(SOURCE_ID).setData({ type: 'FeatureCollection', features });
  _renderAnnotationsTracking();
}

// ── Mode annotation ───────────────────────────────────────────────

function _toggleAnnotationMode(force) {
  _annotationMode = force !== undefined ? force : !_annotationMode;
  const btn = document.getElementById('btn-annotate');
  btn?.classList.toggle('active', _annotationMode);
  document.body.classList.toggle('annotation-mode', _annotationMode);
}

// ── Popup création / édition ──────────────────────────────────────

function _openCreationPopup() {
  const popup = document.getElementById('annotation-popup');
  const title = document.getElementById('annotation-popup-title');
  const labelInput = document.getElementById('annotation-label');
  const catInput = document.getElementById('annotation-category');

  if (_editingId) {
    const ann = _annotations.find(a => a.id === _editingId);
    title.textContent = 'Modifier l\'annotation';
    labelInput.value = ann?.label || '';
    catInput.value = ann?.category || '';
  } else {
    title.textContent = 'Nouvelle annotation';
    labelInput.value = '';
    catInput.value = '';
  }

  popup.classList.remove('hidden');
  labelInput.focus();
}

function _closeCreationPopup() {
  document.getElementById('annotation-popup')?.classList.add('hidden');
  _pendingCoords = null;
  _editingId = null;
}

function _saveAnnotation() {
  const label = document.getElementById('annotation-label').value.trim();
  const category = document.getElementById('annotation-category').value.trim() || 'Info';

  if (_editingId) {
    const ann = _annotations.find(a => a.id === _editingId);
    if (ann) { ann.label = label; ann.category = category; }
  } else {
    if (!_pendingCoords) return;
    _annotations.push({
      id: `a_${Date.now()}`,
      coords: _pendingCoords,
      label,
      category,
      createdAt: new Date().toISOString(),
    });
  }

  saveActiveProject({ annotations: _annotations });
  _renderAnnotations();
  _refreshCategoryFilter();
  _refreshAnnotationsList();
  _closeCreationPopup();
}

// ── Popup visualisation ───────────────────────────────────────────

function _showViewPopup(id) {
  const ann = _annotations.find(a => a.id === id);
  if (!ann) return;

  document.getElementById('view-popup-title').textContent = ann.label || '(sans label)';
  document.getElementById('view-popup-label').textContent = ann.label;
  document.getElementById('view-popup-category').textContent = `Catégorie : ${ann.category}`;
  document.getElementById('view-popup-date').textContent = new Date(ann.createdAt).toLocaleString('fr-FR');

  const popup = document.getElementById('annotation-view-popup');
  popup.classList.remove('hidden');

  document.getElementById('btn-edit-annotation').onclick = () => {
    popup.classList.add('hidden');
    _editingId = id;
    _pendingCoords = ann.coords;
    _openCreationPopup();
  };

  document.getElementById('btn-delete-annotation').onclick = () => {
    if (!confirm(`Supprimer l'annotation "${ann.label}" ?`)) return;
    _annotations = _annotations.filter(a => a.id !== id);
    saveActiveProject({ annotations: _annotations });
    _renderAnnotations();
    _refreshCategoryFilter();
    _refreshAnnotationsList();
    popup.classList.add('hidden');
  };
}

// ── Panneau liste annotations ─────────────────────────────────────

export function initAnnotationsPanel() {
  const btn    = document.getElementById('btn-annotations-list');
  const panel  = document.getElementById('annotations-panel');
  const close  = document.getElementById('btn-close-annotations-panel');
  const search = document.getElementById('annotation-search');
  const filter = document.getElementById('annotation-filter-category');

  btn?.addEventListener('click', () => {
    panel?.classList.toggle('hidden');
    if (!panel?.classList.contains('hidden')) {
      _refreshCategoryFilter();
      _refreshAnnotationsList();
    }
  });
  close?.addEventListener('click', () => {
    panel?.classList.add('hidden');
    if (_selectionMode) _exitSelectionMode();
  });
  search?.addEventListener('input', _refreshAnnotationsList);
  filter?.addEventListener('change', _refreshAnnotationsList);

  document.getElementById('btn-annotations-select')?.addEventListener('click', () => {
    if (_selectionMode) _exitSelectionMode(); else _enterSelectionMode();
  });

  document.getElementById('annotation-check-all')?.addEventListener('change', e => {
    document.querySelectorAll('#annotations-list input[type=checkbox]')
      .forEach(cb => { cb.checked = e.target.checked; });
  });

  document.getElementById('btn-annotations-delete-selected')?.addEventListener('click', _deleteSelected);
}

function _enterSelectionMode() {
  _selectionMode = true;
  document.getElementById('btn-annotations-select')?.classList.add('active');
  document.getElementById('annotations-delete-bar')?.classList.remove('hidden');
  _refreshAnnotationsList();
}

function _exitSelectionMode() {
  _selectionMode = false;
  document.getElementById('btn-annotations-select')?.classList.remove('active');
  document.getElementById('annotations-delete-bar')?.classList.add('hidden');
  const checkAll = document.getElementById('annotation-check-all');
  if (checkAll) checkAll.checked = false;
  _refreshAnnotationsList();
}

function _syncCheckAll() {
  const checkAll = document.getElementById('annotation-check-all');
  if (!checkAll) return;
  const all = [...document.querySelectorAll('#annotations-list input[type=checkbox]')];
  checkAll.checked = all.length > 0 && all.every(cb => cb.checked);
  checkAll.indeterminate = all.length > 0 && !checkAll.checked && all.some(cb => cb.checked);
}

function _deleteSelected() {
  const checkboxes = document.querySelectorAll('#annotations-list input[type=checkbox]:checked');
  const ids = [...checkboxes].map(cb => cb.dataset.id);
  if (!ids.length) return;
  if (!confirm(`Supprimer ${ids.length} annotation${ids.length > 1 ? 's' : ''} ?`)) return;
  const idSet = new Set(ids);
  _annotations = _annotations.filter(a => !idSet.has(a.id));
  saveActiveProject({ annotations: _annotations });
  _renderAnnotations();
  _refreshCategoryFilter();
  _refreshAnnotationsList();
}

function _refreshCategoryFilter() {
  const select = document.getElementById('annotation-filter-category');
  if (!select) return;
  const current = select.value;
  const cats = [...new Set(_annotations.map(a => a.category).filter(Boolean))].sort();
  select.innerHTML = '<option value="">Toutes catégories</option>';
  for (const cat of cats) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    if (cat === current) opt.selected = true;
    select.appendChild(opt);
  }
}

function _refreshAnnotationsList() {
  const panel = document.getElementById('annotations-panel');
  if (!panel || panel.classList.contains('hidden')) return;

  const search = document.getElementById('annotation-search')?.value.toLowerCase() || '';
  const filterCat = document.getElementById('annotation-filter-category')?.value || '';

  const filtered = _annotations.filter(ann => {
    const matchSearch = !search || (ann.label || '').toLowerCase().includes(search);
    const matchCat = !filterCat || ann.category === filterCat;
    return matchSearch && matchCat;
  });

  const list = document.getElementById('annotations-list');
  if (!list) return;
  list.innerHTML = '';

  for (const ann of filtered) {
    const li   = document.createElement('li');
    const date = new Date(ann.createdAt).toLocaleDateString('fr-FR');

    if (_selectionMode) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.id = ann.id;
      cb.className = 'annotation-select-cb';
      cb.addEventListener('change', _syncCheckAll);
      li.appendChild(cb);
    }

    const dot = document.createElement('span');
    if (ann.color) {
      dot.className = 'list-dot';
      dot.style.backgroundColor = ann.color;
    } else {
      dot.className = `list-dot ${categoryDot(ann.category)}`;
    }
    const div  = document.createElement('div');
    const main = document.createElement('div');
    main.className  = 'list-item-main';
    main.textContent = ann.label || '(sans label)';
    const sub = document.createElement('div');
    sub.className   = 'list-item-sub';
    sub.textContent = `${ann.category} · ${date}`;
    div.append(main, sub);
    li.append(dot, div);

    if (!_selectionMode) {
      li.addEventListener('click', () => _map.flyTo({ center: ann.coords, zoom: 17 }));
    }
    list.appendChild(li);
  }

  if (_selectionMode) _syncCheckAll();
}

// ── Câblage UI ────────────────────────────────────────────────────

function _wireUI() {
  // Bouton mode annotation
  document.getElementById('btn-annotate')?.addEventListener('click', () => {
    _toggleAnnotationMode();
  });

  // Popup création
  document.getElementById('btn-save-annotation')?.addEventListener('click', _saveAnnotation);
  document.getElementById('btn-cancel-annotation')?.addEventListener('click', _closeCreationPopup);
  document.getElementById('btn-close-annotation-popup')?.addEventListener('click', _closeCreationPopup);

  // Popup visualisation
  document.getElementById('btn-close-view-popup')?.addEventListener('click', () => {
    document.getElementById('annotation-view-popup')?.classList.add('hidden');
  });

  // Échap pour quitter les modes
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (_annotationMode) _toggleAnnotationMode(false);
    document.getElementById('annotation-popup')?.classList.add('hidden');
    document.getElementById('annotation-view-popup')?.classList.add('hidden');
    _pendingCoords = null;
    _editingId = null;
  });

  // Entrée dans le champ label pour valider
  document.getElementById('annotation-label')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') _saveAnnotation();
  });
}
