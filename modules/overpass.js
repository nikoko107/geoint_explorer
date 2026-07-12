import { addAnnotationsBatch } from './annotations.js';

// BD TOPO — mode zone (depuis une zone de suivi)
const WFS_ENDPOINT = 'https://data.geopf.fr/wfs/ows';
const WFS_ZAI      = 'BDTOPO_V3:zone_d_activite_ou_d_interet';
const WFS_TRANSP   = 'BDTOPO_V3:equipement_de_transport';
const WFS_VOIRIE   = 'BDTOPO_V3:construction_lineaire';
const WFS_TIMEOUT  = 30_000;

// Overpass — mode standalone (requête brute)
const OP_ENDPOINT  = 'https://overpass-api.de/api/interpreter';
const OP_TIMEOUT   = 45_000;

const MAX_ITEMS = 500;

let _onImportDone    = null;
let _currentZone     = null;
let _results         = [];
let _slResults       = [];
let _zoneImportColor = '#60a5fa';
let _slImportColor   = '#60a5fa';

// ── Groupes de natures BD TOPO ZAI ────────────────────────────────

const NATURE_GROUPS = [
  { id: 'securite',   label: 'Militaire & Sécurité',
    natures: ['Caserne', 'Enceinte militaire', 'Gendarmerie', 'Police',
              'Caserne de pompiers', 'Etablissement pénitentiaire'] },
  { id: 'industrie',  label: 'Industrie & Énergie',
    natures: ['Zone industrielle', 'Usine', 'Divers industriel', 'Centrale électrique', 'Carrière',
              "Station d'épuration", 'Déchèterie', "Usine de production d'eau potable", 'Station de pompage'] },
  { id: 'sante',      label: 'Santé & Social',
    natures: ['Hôpital', 'Etablissement hospitalier', 'Maison de retraite',
              "Structure d'accueil pour personnes handicapées"] },
  { id: 'education',  label: 'Éducation',
    natures: ['Enseignement primaire', 'Collège', 'Lycée', 'Université',
              'Enseignement supérieur', "Autre établissement d'enseignement"] },
  { id: 'sport',      label: 'Sport & Loisirs',
    natures: ['Stade', 'Complexe sportif couvert', 'Autre équipement sportif', 'Golf', 'Hippodrome',
              'Piscine', 'Baignade surveillée', 'Camping', 'Parc zoologique', 'Centre équestre',
              'Equipement de cyclisme', 'Sports en eaux vives', 'Sports mécaniques'] },
  { id: 'culture',    label: 'Culture & Commerce',
    natures: ['Musée', 'Salle de spectacle ou conférence', 'Salle de danse ou de jeux', 'Ecomusée',
              'Parc des expositions', 'Divers commercial', 'Marché'] },
  { id: 'admin',      label: 'Public & Administratif',
    natures: ['Mairie', "Siège d'EPCI", "Autre service déconcentré de l'Etat",
              'Divers public ou administratif', 'Poste', 'Science', 'Centre de documentation',
              "Aire d'accueil des gens du voyage", 'Aire de détente', 'Espace public'] },
  { id: 'patrimoine', label: 'Culte & Patrimoine',
    natures: ['Culte chrétien', 'Culte divers', 'Culte israélite', 'Culte musulman',
              'Monument', 'Tombeau', 'Mégalithe', 'Point de vue'] },
  { id: 'voirie', label: 'Ponts, Tunnels & Voirie', layer: WFS_VOIRIE,
    natures: ['Pont', 'Tunnel', 'Viaduc', 'Barrage', 'Digue', 'Gué ou radier'] },
  { id: 'transport',  label: 'Équipement de transport', layer: WFS_TRANSP,
    natures: ['Gare voyageurs uniquement', 'Gare voyageurs et fret', 'Gare fret uniquement',
              'Gare routière', 'Gare maritime', 'Station de métro', 'Station de tramway',
              'Arrêt voyageurs', 'Port', 'Aérogare', 'Tour de contrôle aérien',
              'Parking', 'Aire de repos ou de service', 'Aire de triage', 'Péage',
              'Autre équipement', 'Service dédié aux véhicules'] },
];

// ── Contextes UI ──────────────────────────────────────────────────

const _CTX_ZONE = {
  resultsList:  'overpass-results-list',
  count:        'overpass-results-count',
  selAllRow:    'overpass-select-all-row',
  checkAll:     'overpass-check-all',
  impFooter:    'overpass-import-footer',
  importOpts:   'overpass-import-options',
  importCatId:  'op-import-category',
  importColId:  'op-import-color',
  loading:      'overpass-loading',
  error:        'overpass-error',
  cbPrefix:     'op-res-',
  natPrefix:    'zone-nat-',
};

const GROUP_COLORS = {
  securite:   '#ef4444',
  industrie:  '#f97316',
  sante:      '#ec4899',
  education:  '#8b5cf6',
  sport:      '#22c55e',
  culture:    '#f59e0b',
  admin:      '#60a5fa',
  patrimoine: '#a78bfa',
  voirie:     '#6366f1',
  transport:  '#14b8a6',
};

const _CTX_SL = {
  resultsList:  'sl-results-list',
  count:        'sl-status',
  selAllRow:    'sl-select-all-row',
  checkAll:     'sl-check-all',
  impFooter:    'sl-import-footer',
  importOpts:   'sl-import-options',
  importCatId:  'sl-import-category',
  importColId:  'sl-import-color',
  cbPrefix:     'sl-res-',
};

// ── API publique ──────────────────────────────────────────────────

export function initOverpass({ onImportDone } = {}) {
  _onImportDone = onImportDone || null;
  _wireUI();
}

export function initOverpassStandalone() {
  _wireUIStandalone();
}

export function openOverpassPanel(zone) {
  if (!zone?.bbox) return;
  _currentZone = zone;
  _results     = [];

  document.getElementById('overpass-zone-name').textContent = zone.name;
  _showPhase(1);
  _renderNatureFilter();
  document.getElementById('overpass-panel')?.classList.remove('hidden');
}

export function openOverpassStandalone() {
  _slResults = [];
  _slClearAll();
  _updateSlRunButton();
  document.getElementById('overpass-standalone-panel')?.classList.remove('hidden');
  document.getElementById('sl-query')?.focus();
}

// ── BD TOPO — filtre nature ───────────────────────────────────────

function _natureId(nature) {
  return nature.toLowerCase().replace(/[^a-z0-9]/g, '-');
}

function _renderNatureFilter() {
  const list = document.getElementById('overpass-preset-list');
  if (!list) return;
  list.innerHTML = '';

  const { natPrefix } = _CTX_ZONE;

  for (const group of NATURE_GROUPS) {
    const li = document.createElement('li');
    li.className = 'overpass-preset-item';

    const header = document.createElement('div');
    header.className = 'overpass-preset-header';

    const arrow = document.createElement('span');
    arrow.className   = 'overpass-preset-arrow';
    arrow.textContent = '▶';

    const title = document.createElement('div');
    title.className   = 'list-item-main';
    title.textContent = group.label;

    header.append(arrow, title);

    const subList = document.createElement('ul');
    subList.className = 'overpass-items-list hidden';

    // "Tout sélectionner" par groupe
    const allLi  = document.createElement('li');
    allLi.className = 'overpass-item-all';
    const allCb  = document.createElement('input');
    allCb.type   = 'checkbox';
    allCb.id     = `${natPrefix}all-${group.id}`;
    allCb.checked = false;
    const allLbl = document.createElement('label');
    allLbl.htmlFor     = allCb.id;
    allLbl.textContent = 'Tout sélectionner';
    allLi.append(allCb, allLbl);
    subList.appendChild(allLi);

    allCb.addEventListener('change', () => {
      subList.querySelectorAll(`input[data-np="${natPrefix}"]`)
        .forEach(cb => { cb.checked = allCb.checked; });
      _updateZoneRunButton();
    });

    for (const nature of group.natures) {
      const subLi = document.createElement('li');
      subLi.className = 'overpass-item-row';
      const cb  = document.createElement('input');
      cb.type   = 'checkbox';
      cb.id     = `${natPrefix}${_natureId(nature)}`;
      cb.dataset.np    = natPrefix;
      cb.dataset.group = group.id;
      cb.checked = false;
      cb.addEventListener('change', () => {
        const groupCbs = [...subList.querySelectorAll(`input[data-np="${natPrefix}"]`)];
        allCb.checked  = groupCbs.every(c => c.checked);
        _updateZoneRunButton();
      });
      const lbl = document.createElement('label');
      lbl.htmlFor     = cb.id;
      lbl.textContent = nature;
      subLi.append(cb, lbl);
      subList.appendChild(subLi);
    }

    header.addEventListener('click', () => {
      const hidden = subList.classList.toggle('hidden');
      arrow.textContent = hidden ? '▶' : '▼';
    });

    li.append(header, subList);
    list.appendChild(li);
  }
}

function _getSelectedNatures() {
  const natures = [];
  for (const group of NATURE_GROUPS) {
    for (const nature of group.natures) {
      const cb = document.getElementById(`${_CTX_ZONE.natPrefix}${_natureId(nature)}`);
      if (cb?.checked) natures.push(nature);
    }
  }
  return natures;
}

// Retourne { layer → { natures, filterField } } pour les natures cochées
function _getSelectedByLayer() {
  const byLayer = {};
  for (const group of NATURE_GROUPS) {
    const layer       = group.layer       || WFS_ZAI;
    const filterField = group.filterField || 'nature';
    for (const nature of group.natures) {
      const cb = document.getElementById(`${_CTX_ZONE.natPrefix}${_natureId(nature)}`);
      if (cb?.checked) {
        if (!byLayer[layer]) byLayer[layer] = { natures: [], filterField };
        byLayer[layer].natures.push(nature);
      }
    }
  }
  return byLayer;
}

function _updateZoneRunButton() {
  const btn = document.getElementById('btn-overpass-run');
  if (btn) btn.disabled = _getSelectedNatures().length === 0;
}

function _activeGroups() {
  return NATURE_GROUPS.filter(group =>
    group.natures.some(nature => {
      const cb = document.getElementById(`${_CTX_ZONE.natPrefix}${_natureId(nature)}`);
      return cb?.checked;
    })
  );
}

function _defaultImportCategory() {
  const groups = _activeGroups();
  return groups.length === 1 ? groups[0].label : '';
}

function _defaultImportColor() {
  const groups = _activeGroups();
  return groups.length === 1 ? (GROUP_COLORS[groups[0].id] || '#60a5fa') : '#60a5fa';
}

// ── BD TOPO — WFS query ───────────────────────────────────────────

async function _queryBdtopo(bbox, layer, natures, filterField, nameMode, nameVal) {
  const [west, south, east, north] = bbox;

  let cql = `BBOX(geometrie,${west.toFixed(6)},${south.toFixed(6)},${east.toFixed(6)},${north.toFixed(6)},'EPSG:4326')`;

  if (natures.length > 0) {
    const natList = natures.map(n => `'${n.replace(/'/g, "''")}'`).join(',');
    cql += ` AND ${filterField} IN (${natList})`;
  }

  if (nameMode && nameVal.trim()) {
    const v = nameVal.trim().toLowerCase().replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_');
    const pattern = nameMode === 'starts' ? `${v}%` : `%${v}%`;
    if (layer === WFS_VOIRIE) {
      cql += ` AND (strToLowerCase(nom_1_gauche) LIKE '${pattern}' OR strToLowerCase(nom_1_droite) LIKE '${pattern}')`;
    } else {
      cql += ` AND strToLowerCase(toponyme) LIKE '${pattern}'`;
    }
  }

  const params = new URLSearchParams({
    SERVICE:      'WFS',
    VERSION:      '2.0.0',
    REQUEST:      'GetFeature',
    TYPENAMES:    layer,
    OUTPUTFORMAT: 'application/json',
    SRSNAME:      'EPSG:4326',
    COUNT:        String(MAX_ITEMS),
    CQL_FILTER:   cql,
  });

  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), WFS_TIMEOUT);
  try {
    const res = await fetch(`${WFS_ENDPOINT}?${params}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Erreur serveur IGN (${res.status})`);
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Pas de réponse après ${WFS_TIMEOUT / 1000}s`);
    throw e;
  } finally {
    clearTimeout(tid);
  }
}

function _centroid(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Point') {
    return { lon: geometry.coordinates[0], lat: geometry.coordinates[1] };
  }
  if (geometry.type === 'LineString') {
    const mid = Math.floor(geometry.coordinates.length / 2);
    return { lon: geometry.coordinates[mid][0], lat: geometry.coordinates[mid][1] };
  }
  if (geometry.type === 'MultiLineString') {
    const line = geometry.coordinates[0];
    const mid  = Math.floor(line.length / 2);
    return { lon: line[mid][0], lat: line[mid][1] };
  }
  const ring = geometry.type === 'Polygon'
    ? geometry.coordinates[0]
    : geometry.type === 'MultiPolygon'
      ? geometry.coordinates[0][0]
      : null;
  if (!ring?.length) return null;
  const lons = ring.map(c => c[0]);
  const lats = ring.map(c => c[1]);
  return {
    lon: (Math.min(...lons) + Math.max(...lons)) / 2,
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
  };
}

function _parseBdtopoFeatures(geojson) {
  const out  = [];
  const seen = new Set();
  for (const f of geojson.features || []) {
    const p  = f.properties || {};
    const pt = _centroid(f.geometry);
    if (!pt) continue;
    const key = `${pt.lat.toFixed(5)},${pt.lon.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const labelRaw = p.toponyme?.trim() || p.nom_1_gauche?.trim() || p.nom_1_droite?.trim() || p.numero?.trim();
    const nature   = p.nature || p.franchissement || 'Info';
    const label    = labelRaw ? `${nature} — ${labelRaw}` : (nature !== 'Info' ? nature : 'Sans nom');
    out.push({ lat: pt.lat, lon: pt.lon, label, sub: nature, category: nature });
  }
  return out;
}

// ── Overpass — standalone (requête brute) ─────────────────────────

async function _executeOverpassQuery(ql) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), OP_TIMEOUT);
  try {
    const res = await fetch(OP_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    `data=${encodeURIComponent(ql)}`,
      signal:  ctrl.signal,
    });
    if (res.status === 429) throw new Error('Quota Overpass dépassé — réessayez dans quelques secondes');
    if (res.status === 504) throw new Error('Timeout Overpass — réduisez la zone ou affinez la requête');
    if (!res.ok) throw new Error(`Erreur serveur Overpass (${res.status})`);
    return (await res.json()).elements || [];
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Pas de réponse après ${OP_TIMEOUT / 1000}s`);
    throw e;
  } finally {
    clearTimeout(tid);
  }
}

function _parseOverpassElements(elements) {
  const seen = new Set();
  const out  = [];
  for (const el of elements) {
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let lat, lon;
    if (el.type === 'node') {
      lat = el.lat; lon = el.lon;
    } else if (el.center) {
      lat = el.center.lat; lon = el.center.lon;
    } else if (el.geometry?.length) {
      lat = el.geometry.reduce((s, p) => s + p.lat, 0) / el.geometry.length;
      lon = el.geometry.reduce((s, p) => s + p.lon, 0) / el.geometry.length;
    }
    if (lat == null || lon == null) continue;
    const tags  = el.tags || {};
    const label = tags.name || tags['name:fr'] || tags.ref || tags.operator || key;
    const addrParts = [
      tags['addr:housenumber'] && tags['addr:street']
        ? `${tags['addr:housenumber']} ${tags['addr:street']}`
        : (tags['addr:street'] || null),
      tags['addr:postcode'],
      tags['addr:city'],
    ].filter(Boolean);
    const sub = addrParts.length ? addrParts.join(', ') : null;
    out.push({ lat, lon, label, sub, category: 'Info' });
  }
  return out;
}

// ── Résultats (partagé) ───────────────────────────────────────────

function _renderResults(items, ctx) {
  const list = document.getElementById(ctx.resultsList);
  if (!list) return;
  list.innerHTML = '';

  const shown   = items.slice(0, MAX_ITEMS);
  const countEl = document.getElementById(ctx.count);
  if (countEl) {
    countEl.textContent = items.length === 0
      ? 'Aucun résultat'
      : `${items.length} résultat${items.length > 1 ? 's' : ''}` +
        (items.length >= MAX_ITEMS ? ` (${MAX_ITEMS} affichés max)` : '');
  }

  const hasResults = shown.length > 0;
  document.getElementById(ctx.selAllRow)?.classList.toggle('hidden', !hasResults);
  document.getElementById(ctx.impFooter)?.classList.toggle('hidden', !hasResults);
  if (ctx.importOpts) {
    document.getElementById(ctx.importOpts)?.classList.toggle('hidden', !hasResults);
    if (hasResults && ctx === _CTX_ZONE) {
      const catEl = document.getElementById('op-import-category');
      const colEl = document.getElementById('op-import-color');
      if (catEl) catEl.value = _defaultImportCategory();
      const col = _defaultImportColor();
      _zoneImportColor = col;
      if (colEl) colEl.value = col;
    }
  }
  const allCb = document.getElementById(ctx.checkAll);
  if (allCb) allCb.checked = hasResults;

  shown.forEach((item, idx) => {
    const li  = document.createElement('li');
    li.className = 'overpass-result-item';
    const cb  = document.createElement('input');
    cb.type   = 'checkbox';
    cb.id     = `${ctx.cbPrefix}${idx}`;
    cb.dataset.idx = idx;
    cb.checked = true;
    const lbl = document.createElement('label');
    lbl.htmlFor = cb.id;
    const main = document.createElement('div');
    main.className   = 'list-item-main';
    main.textContent = item.label;
    if (item.sub) {
      const sub = document.createElement('div');
      sub.className   = 'list-item-sub';
      sub.textContent = item.sub;
      lbl.append(main, sub);
    } else {
      lbl.append(main);
    }
    li.append(cb, lbl);
    list.appendChild(li);
  });
}

function _importSelected(resultsArr, ctx) {
  const checked = document.querySelectorAll(`#${ctx.resultsList} input[type=checkbox]:checked`);
  const items   = [...checked]
    .map(cb => resultsArr[parseInt(cb.dataset.idx, 10)])
    .filter(Boolean);
  if (!items.length) return;

  const catOverride = ctx.importCatId
    ? (document.getElementById(ctx.importCatId)?.value.trim() || null)
    : null;
  const _colDefault = ctx === _CTX_ZONE ? _zoneImportColor : ctx === _CTX_SL ? _slImportColor : null;
  const colOverride = ctx.importColId
    ? (document.getElementById(ctx.importColId)?.value || _colDefault)
    : null;

  addAnnotationsBatch(items.map(i => ({
    lng: i.lon, lat: i.lat, label: i.label,
    category: catOverride || i.category,
    color: colOverride,
  })));
  _onImportDone?.(items.length);
}

// ── Helpers UI — zone panel ───────────────────────────────────────

function _showPhase(n) {
  document.getElementById('overpass-phase-select')?.classList.toggle('hidden', n !== 1);
  document.getElementById('overpass-phase-results')?.classList.toggle('hidden', n !== 2);
}

function _setLoading(on) {
  document.getElementById(_CTX_ZONE.loading)?.classList.toggle('hidden', !on);
  if (on) {
    document.getElementById(_CTX_ZONE.error)?.classList.add('hidden');
    const lst = document.getElementById(_CTX_ZONE.resultsList);
    if (lst) lst.innerHTML = '';
    document.getElementById(_CTX_ZONE.selAllRow)?.classList.add('hidden');
    document.getElementById(_CTX_ZONE.impFooter)?.classList.add('hidden');
    document.getElementById(_CTX_ZONE.importOpts)?.classList.add('hidden');
    const ct = document.getElementById(_CTX_ZONE.count);
    if (ct) ct.textContent = '';
  }
}

function _closePanel() {
  document.getElementById('overpass-panel')?.classList.add('hidden');
  _currentZone = null;
  _results     = [];
}

// ── Helpers UI — standalone panel ────────────────────────────────

function _slSetStatus(type, text) {
  const el = document.getElementById('sl-status');
  if (!el) return;
  el.textContent = text ?? '';
  el.className = 'overpass-sl-status' + (type ? ' status-' + type : '');
}

function _slClearAll() {
  _slSetStatus('', '');
  const lst = document.getElementById(_CTX_SL.resultsList);
  if (lst) lst.innerHTML = '';
  document.getElementById(_CTX_SL.selAllRow)?.classList.add('hidden');
  document.getElementById(_CTX_SL.impFooter)?.classList.add('hidden');
  document.getElementById(_CTX_SL.importOpts)?.classList.add('hidden');
}

function _updateSlRunButton() {
  const val = document.getElementById('sl-query')?.value.trim() || '';
  const btn = document.getElementById('btn-sl-run');
  if (btn) btn.disabled = !val;
}

function _closeStandalone() {
  document.getElementById('overpass-standalone-panel')?.classList.add('hidden');
}

// ── Câblage UI — zone panel ───────────────────────────────────────

function _wireUI() {
  document.getElementById('btn-close-overpass')?.addEventListener('click', _closePanel);
  document.getElementById('btn-overpass-back')?.addEventListener('click', () => _showPhase(1));
  document.getElementById('op-import-color')?.addEventListener('input', e => { _zoneImportColor = e.target.value; });

  document.getElementById('op-name-mode')?.addEventListener('change', e => {
    const nameInput = document.getElementById('op-name-val');
    if (nameInput) nameInput.disabled = !e.target.value;
  });

  document.getElementById('btn-overpass-run')?.addEventListener('click', async () => {
    if (!_currentZone) return;
    const byLayer = _getSelectedByLayer();
    if (!Object.keys(byLayer).length) return;
    const nameMode = document.getElementById('op-name-mode')?.value || '';
    const nameVal  = document.getElementById('op-name-val')?.value || '';

    _showPhase(2);
    _setLoading(true);
    try {
      const queries  = Object.entries(byLayer).map(([layer, { natures, filterField }]) =>
        _queryBdtopo(_currentZone.bbox, layer, natures, filterField, nameMode, nameVal));
      const geojsons = await Promise.all(queries);
      _results = geojsons.flatMap(_parseBdtopoFeatures);
      _renderResults(_results, _CTX_ZONE);
    } catch (e) {
      const errEl = document.getElementById(_CTX_ZONE.error);
      if (errEl) { errEl.textContent = e.message; errEl.classList.remove('hidden'); }
      _results = [];
      _renderResults([], _CTX_ZONE);
    } finally {
      _setLoading(false);
    }
  });

  document.getElementById(_CTX_ZONE.checkAll)?.addEventListener('change', e => {
    document.querySelectorAll(`#${_CTX_ZONE.resultsList} input[type=checkbox]`)
      .forEach(cb => { cb.checked = e.target.checked; });
  });

  document.getElementById('btn-overpass-import')?.addEventListener('click', () => {
    _importSelected(_results, _CTX_ZONE);
    _closePanel();
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('overpass-panel')?.classList.contains('hidden')) _closePanel();
    if (!document.getElementById('overpass-standalone-panel')?.classList.contains('hidden')) _closeStandalone();
  });
}

// ── Câblage UI — standalone panel (Overpass brut) ────────────────

function _wireUIStandalone() {
  document.getElementById('btn-sl-close')?.addEventListener('click', _closeStandalone);
  document.getElementById('sl-import-color')?.addEventListener('input', e => { _slImportColor = e.target.value; });

  document.getElementById('sl-query')?.addEventListener('input', _updateSlRunButton);

  document.getElementById('btn-sl-run')?.addEventListener('click', async () => {
    const rawQl = document.getElementById('sl-query')?.value.trim() || '';
    if (!rawQl) return;

    _slClearAll();
    _slSetStatus('loading', 'Interrogation Overpass…');

    try {
      const elements = await _executeOverpassQuery(rawQl);
      _slResults = _parseOverpassElements(elements);
      _renderResults(_slResults, _CTX_SL);
      // _renderResults écrit le texte dans sl-status via ctx.count ; corriger la classe
      document.getElementById('sl-status')?.classList.replace('status-loading', 'status-count');
    } catch (e) {
      _slSetStatus('error', e.message);
      _slResults = [];
    }
  });

  document.getElementById(_CTX_SL.checkAll)?.addEventListener('change', e => {
    document.querySelectorAll(`#${_CTX_SL.resultsList} input[type=checkbox]`)
      .forEach(cb => { cb.checked = e.target.checked; });
  });

  document.getElementById('btn-sl-import')?.addEventListener('click', () => {
    _importSelected(_slResults, _CTX_SL);
    _closeStandalone();
  });
}
