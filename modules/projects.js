import { storageGet, storageSet, storageRemove } from './storage.js';

const INDEX_KEY = 'geoint_index';
let _onProjectSwitch = null; // callback(project)

export function initProjects({ onProjectSwitch }) {
  _onProjectSwitch = onProjectSwitch;

  // Initialisation au premier lancement
  let index = storageGet(INDEX_KEY);
  if (!index || index.length === 0) {
    const project = createProjectData('Projet 1');
    storageSet(INDEX_KEY, [project.id]);
    storageSet(`geoint_project_${project.id}`, project);
    storageSet('geoint_active', project.id);
  }

  _buildSelect();
  _wireButtons();
}

export function getActiveProject() {
  const activeId = storageGet('geoint_active');
  if (!activeId) return null;
  return storageGet(`geoint_project_${activeId}`);
}

export function saveActiveProject(data) {
  const activeId = storageGet('geoint_active');
  if (!activeId) return;
  const existing = storageGet(`geoint_project_${activeId}`) || {};
  const updated = { ...existing, ...data };
  storageSet(`geoint_project_${activeId}`, updated);
  _updateStatus(updated);
}

export function getActiveId() {
  return storageGet('geoint_active');
}

// ── Interne ───────────────────────────────────────────────────────

function createProjectData(name) {
  return {
    id: `p_${Date.now()}`,
    name,
    createdAt: new Date().toISOString(),
    lastView: { center: [2.3488, 48.8534], zoom: 12 }, // Paris par défaut
    layerConfig: [],
    annotations: [],
    navLog: [],
    trackingZones: [],
    streetviewVisits: [],
    importedLayers: [],
  };
}

function _buildSelect() {
  const select = document.getElementById('project-select');
  const index = storageGet(INDEX_KEY) || [];
  const activeId = storageGet('geoint_active');

  select.innerHTML = '';
  for (const id of index) {
    const p = storageGet(`geoint_project_${id}`);
    if (!p) continue;
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === activeId) opt.selected = true;
    select.appendChild(opt);
  }
}

function _wireButtons() {
  const select = document.getElementById('project-select');
  const btnNew = document.getElementById('btn-new-project');
  const btnDel = document.getElementById('btn-delete-project');

  select.addEventListener('change', () => {
    _switchTo(select.value);
  });

  btnNew.addEventListener('click', () => {
    const name = prompt('Nom du nouveau projet :', `Projet ${_nextProjectNumber()}`);
    if (!name || !name.trim()) return;
    const project = createProjectData(name.trim());
    const index = storageGet(INDEX_KEY) || [];
    index.push(project.id);
    storageSet(INDEX_KEY, index);
    storageSet(`geoint_project_${project.id}`, project);
    _buildSelect();
    _switchTo(project.id);
  });

  btnDel.addEventListener('click', () => {
    const activeId = storageGet('geoint_active');
    const index = storageGet(INDEX_KEY) || [];
    if (index.length <= 1) {
      alert('Impossible de supprimer le dernier projet.');
      return;
    }
    const project = storageGet(`geoint_project_${activeId}`);
    if (!confirm(`Supprimer le projet "${project?.name}" ? Cette action est irréversible.`)) return;

    const newIndex = index.filter(id => id !== activeId);
    storageSet(INDEX_KEY, newIndex);
    storageRemove(`geoint_project_${activeId}`);
    _switchTo(newIndex[0]);
    _buildSelect();
  });
}

function _switchTo(id) {
  storageSet('geoint_active', id);
  _buildSelect();
  const project = storageGet(`geoint_project_${id}`);
  _onProjectSwitch?.(project);
  _updateStatus(project);
}

function _updateStatus(project) {
  const el = document.getElementById('project-status');
  if (!el || !project) return;
  const date = new Date(project.createdAt).toLocaleDateString('fr-FR');
  el.textContent = `Créé le ${date} · ${project.annotations?.length ?? 0} annotations · ${project.navLog?.length ?? 0} entrées nav.`;
}

function _nextProjectNumber() {
  const index = storageGet(INDEX_KEY) || [];
  return index.length + 1;
}

export function createAndSwitchProject(data) {
  const project = {
    id:            `p_${Date.now()}`,
    name:          data.name,
    createdAt:     data.createdAt     || new Date().toISOString(),
    lastView:      data.lastView      || { center: [2.3488, 48.8534], zoom: 12 },
    layerConfig:   data.layerConfig   || [],
    annotations:   data.annotations   || [],
    navLog:        data.navLog        || [],
    trackingZones: data.trackingZones || [],
    importedLayers: data.importedLayers || [],
  };
  const index = storageGet(INDEX_KEY) || [];
  index.push(project.id);
  storageSet(INDEX_KEY, index);
  storageSet(`geoint_project_${project.id}`, project);
  _switchTo(project.id);
}

// ── Fusion d'un import dans un projet existant ─────────────────────

export function listProjects() {
  const index = storageGet(INDEX_KEY) || [];
  return index
    .map(id => storageGet(`geoint_project_${id}`))
    .filter(Boolean)
    .map(p => ({ id: p.id, name: p.name }));
}

export function mergeProjectAndSwitch(targetId, data) {
  const target = storageGet(`geoint_project_${targetId}`);
  if (!target) return;

  const ts  = Date.now();
  const rnd = Math.random().toString(36).slice(2, 8);
  const _remapIds = (items, prefix) =>
    (items || []).map((item, i) => ({ ...item, id: `${prefix}_${ts}_${rnd}_${i}` }));

  const updated = {
    ...target,
    annotations:     [...(target.annotations     || []), ..._remapIds(data.annotations,     'merge_a')],
    navLog:          [...(target.navLog          || []), ..._remapIds(data.navLog,          'merge_n')],
    trackingZones:   [...(target.trackingZones   || []), ..._remapIds(data.trackingZones,   'merge_z')],
    streetviewVisits:[...(target.streetviewVisits|| []), ..._remapIds(data.streetviewVisits,'merge_v')],
    importedLayers:  [...(target.importedLayers  || []), ..._remapIds(data.importedLayers,  'merge_l')],
  };

  storageSet(`geoint_project_${targetId}`, updated);
  _switchTo(targetId);
}
