// Fenêtre "Image de référence" — zoom, rotation, mesure relative sur une
// photo locale. Outil indépendant de la carte (pas de géoréférencement) :
// on calibre une distance connue dans l'image, puis on mesure d'autres
// distances proportionnellement. L'image (compressée), la vue et la
// calibration sont persistées dans le projet actif ; fermer la fenêtre la
// masque simplement.

import { saveActiveProject } from './projects.js';
import { storageGet, storageSet } from './storage.js';

const MAX_PERSIST_DIM = 1600; // plus grand côté de l'image compressée stockée
const SAVE_DEBOUNCE_MS = 500;
const WIN_GEO_KEY = 'geoint_image_tool_window'; // préférence globale, hors projet
const HIT_TOLERANCE_PX = 8; // tolérance de clic sur un segment, en pixels canvas

// Formatage des distances mesurées sur l'image — variante locale à 2
// décimales (contrairement à formatDist() de measure.js, arrondie à l'entier
// pour l'outil de mesure sur la carte, volontairement laissé inchangé).
function _formatMeasureDist(m) {
  if (m < 1000) return `${m.toFixed(2)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

let _win = null, _canvas = null, _ctx = null;
let _img = null;
let _zoom = 1, _rotation = 0, _panX = 0, _panY = 0;
let _mode = 'idle'; // 'idle' | 'calibrate' | 'measure'
let _calibPoints = [];
let _measurePoints = [];
let _previewPt = null;
let _pxToMeter = null;
let _lastMeasureText = null;
let _calibSegment = null;     // { points:[p1,p2], distanceM } — persistant jusqu'à suppression
let _measureSegments = [];    // [{ points:[...], distanceM }, ...] — s'accumulent
let _exif = null;
let _refMeta = null; // reflet de project.referenceImage en cours d'édition
let _onLocateGPS = null;
let _onAddPhotoAnnotation = null;
let _saveTimer = null;
let _winGeoSaveTimer = null;

let _dragging = false, _dragMoved = false, _dragStartClient = null, _panStart = null;
let _winDragging = false, _winDragStart = null, _winRectStart = null;

// ── Transforms image ↔ canvas ────────────────────────────────────

function _canvasToImage(cx, cy) {
  const w = _canvas.width, h = _canvas.height;
  const x = cx - (w / 2 + _panX);
  const y = cy - (h / 2 + _panY);
  const rad = -_rotation * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const rx = x * cos - y * sin;
  const ry = x * sin + y * cos;
  return [rx / _zoom + _img.width / 2, ry / _zoom + _img.height / 2];
}

function _imageToCanvas(ix, iy) {
  const w = _canvas.width, h = _canvas.height;
  const lx = (ix - _img.width / 2) * _zoom;
  const ly = (iy - _img.height / 2) * _zoom;
  const rad = _rotation * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const rx = lx * cos - ly * sin;
  const ry = lx * sin + ly * cos;
  return [rx + w / 2 + _panX, ry + h / 2 + _panY];
}

function _totalImageDist(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return d;
}

// ── Rendu ─────────────────────────────────────────────────────────

function _render() {
  if (!_ctx) return;
  const w = _canvas.width, h = _canvas.height;
  _ctx.clearRect(0, 0, w, h);
  _ctx.fillStyle = '#000';
  _ctx.fillRect(0, 0, w, h);

  if (_img) {
    _ctx.save();
    _ctx.translate(w / 2 + _panX, h / 2 + _panY);
    _ctx.rotate(_rotation * Math.PI / 180);
    _ctx.scale(_zoom, _zoom);
    _ctx.drawImage(_img, -_img.width / 2, -_img.height / 2);
    _ctx.restore();
  }

  _drawOverlay();
  document.getElementById('image-tool-empty')?.classList.toggle('hidden', !!_img);
}

function _drawSegment(points, color, label) {
  if (!points || points.length < 2) return;
  const canvasPts = points.map(p => _imageToCanvas(p[0], p[1]));

  _ctx.save();
  _ctx.strokeStyle = color;
  _ctx.lineWidth = 2;
  _ctx.beginPath();
  canvasPts.forEach(([cx, cy], i) => { if (i === 0) _ctx.moveTo(cx, cy); else _ctx.lineTo(cx, cy); });
  _ctx.stroke();

  for (const [cx, cy] of canvasPts) {
    _ctx.beginPath();
    _ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    _ctx.fillStyle = '#fff';
    _ctx.fill();
    _ctx.stroke();
  }

  // Étiquette positionnée au centroïde du tracé (valable pour un segment à 2
  // points comme pour une mesure multi-points)
  const mx = canvasPts.reduce((s, p) => s + p[0], 0) / canvasPts.length;
  const my = canvasPts.reduce((s, p) => s + p[1], 0) / canvasPts.length;

  _ctx.font = '11px system-ui, sans-serif';
  const textW = _ctx.measureText(label).width;
  _ctx.fillStyle = 'rgba(13,15,18,0.85)';
  _ctx.fillRect(mx - textW / 2 - 4, my - 20, textW + 8, 16);
  _ctx.fillStyle = '#fff';
  _ctx.textAlign = 'center';
  _ctx.fillText(label, mx, my - 8);
  _ctx.textAlign = 'left';
  _ctx.restore();
}

function _drawOverlay() {
  if (!_img) return;

  // Segments persistants (calibration + mesures accumulées) — visibles en permanence
  if (_calibSegment) _drawSegment(_calibSegment.points, '#fbbf24', _formatMeasureDist(_calibSegment.distanceM));
  for (const seg of _measureSegments) _drawSegment(seg.points, '#f87171', _formatMeasureDist(seg.distanceM));

  const pts = _mode === 'calibrate' ? _calibPoints : (_mode === 'measure' ? _measurePoints : []);
  const color = _mode === 'calibrate' ? '#fbbf24' : '#f87171';

  if (pts.length) {
    _ctx.save();
    _ctx.strokeStyle = color;
    _ctx.lineWidth = 2;
    _ctx.beginPath();
    pts.forEach((p, i) => {
      const [cx, cy] = _imageToCanvas(p[0], p[1]);
      if (i === 0) _ctx.moveTo(cx, cy); else _ctx.lineTo(cx, cy);
    });
    _ctx.stroke();

    for (const p of pts) {
      const [cx, cy] = _imageToCanvas(p[0], p[1]);
      _ctx.beginPath();
      _ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      _ctx.fillStyle = '#fff';
      _ctx.fill();
      _ctx.stroke();
    }
    _ctx.restore();
  }

  if (_mode === 'measure' && _previewPt && _measurePoints.length) {
    const last = _measurePoints[_measurePoints.length - 1];
    const [x1, y1] = _imageToCanvas(last[0], last[1]);
    const [x2, y2] = _imageToCanvas(_previewPt[0], _previewPt[1]);
    _ctx.save();
    _ctx.strokeStyle = '#fbbf24';
    _ctx.lineWidth = 2;
    _ctx.setLineDash([4, 3]);
    _ctx.beginPath();
    _ctx.moveTo(x1, y1);
    _ctx.lineTo(x2, y2);
    _ctx.stroke();
    _ctx.restore();
  }
}

function _resizeCanvas() {
  const wrap = document.querySelector('.image-tool-canvas-wrap');
  if (!_canvas || !wrap) return;
  _canvas.width  = wrap.clientWidth;
  _canvas.height = wrap.clientHeight;
  _render();
  clearTimeout(_winGeoSaveTimer);
  _winGeoSaveTimer = setTimeout(_saveWindowGeometry, 400);
}

// ── Fenêtre : position/taille déplaçables et mémorisées ─────────────
// Préférence globale (pas liée au projet) : la disposition de la fenêtre
// est un réglage d'espace de travail, pas une donnée de mission.

function _applyWindowGeometry() {
  const geo = storageGet(WIN_GEO_KEY);
  if (!geo || !_win) return;
  _win.style.left = `${geo.left}px`;
  _win.style.top = `${geo.top}px`;
  _win.style.right = 'auto';
  if (geo.width) _win.style.width = `${geo.width}px`;
  if (geo.height) _win.style.height = `${geo.height}px`;
}

function _saveWindowGeometry() {
  if (!_win) return;
  const rect = _win.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return; // fenêtre masquée
  storageSet(WIN_GEO_KEY, {
    left: Math.round(rect.left), top: Math.round(rect.top),
    width: Math.round(rect.width), height: Math.round(rect.height),
  });
}

// ── Parseur EXIF (JPEG APP1/TIFF, sans dépendance) ─────────────────

const _EXIF_TYPE_SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function _exifReadValue(view, offset, type, count, little) {
  switch (type) {
    case 2: { // ASCII
      let s = '';
      for (let i = 0; i < count - 1; i++) {
        const c = view.getUint8(offset + i);
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      return s;
    }
    case 1: // BYTE
      return count === 1 ? view.getUint8(offset) : Array.from({ length: count }, (_, i) => view.getUint8(offset + i));
    case 3: // SHORT
      return count === 1 ? view.getUint16(offset, little) : Array.from({ length: count }, (_, i) => view.getUint16(offset + i * 2, little));
    case 4: // LONG
      return count === 1 ? view.getUint32(offset, little) : Array.from({ length: count }, (_, i) => view.getUint32(offset + i * 4, little));
    case 5: { // RATIONAL (non signé)
      const readOne = o => view.getUint32(o, little) / (view.getUint32(o + 4, little) || 1);
      return count === 1 ? readOne(offset) : Array.from({ length: count }, (_, i) => readOne(offset + i * 8));
    }
    case 10: { // SRATIONAL (signé — ExposureBiasValue notamment)
      const readOne = o => view.getInt32(o, little) / (view.getInt32(o + 4, little) || 1);
      return count === 1 ? readOne(offset) : Array.from({ length: count }, (_, i) => readOne(offset + i * 8));
    }
    default:
      return null;
  }
}

function _exifReadIFD(view, tiffStart, ifdOffset, little) {
  const count = view.getUint16(ifdOffset, little);
  const tags = {};
  for (let i = 0; i < count; i++) {
    const entryOffset = ifdOffset + 2 + i * 12;
    const tag = view.getUint16(entryOffset, little);
    const type = view.getUint16(entryOffset + 2, little);
    const numValues = view.getUint32(entryOffset + 4, little);
    const size = (_EXIF_TYPE_SIZES[type] || 1) * numValues;
    const valueFieldOffset = entryOffset + 8;
    const dataOffset = size <= 4 ? valueFieldOffset : tiffStart + view.getUint32(valueFieldOffset, little);
    tags[tag] = _exifReadValue(view, dataOffset, type, numValues, little);
  }
  return tags;
}

function _exifDms(arr) {
  // Format standard EXIF : [degrés, minutes, secondes]. Certains encodeurs
  // non conformes écrivent [degrés, minutes.décimales] ou juste [degrés] —
  // on reste tolérant plutôt que de perdre la coordonnée.
  if (!Array.isArray(arr) || arr.length === 0) return null;
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return arr[0] + arr[1] / 60;
  return arr[0] + arr[1] / 60 + arr[2] / 3600;
}

function _exifParseTiff(view, tiffStart) {
  const little = view.getUint16(tiffStart) === 0x4949; // 'II'
  const ifd0Offset = view.getUint32(tiffStart + 4, little);
  const ifd0 = _exifReadIFD(view, tiffStart, tiffStart + ifd0Offset, little);

  const result = {
    make: ifd0[0x010F] || null,
    model: ifd0[0x0110] || null,
    software: ifd0[0x0131] || null,
    imageDescription: ifd0[0x010E] || null,
    dateTaken: null,
    dateDigitized: null,
    exposureTime: null,
    fNumber: null,
    iso: null,
    exposureBias: null,
    exposureProgram: null,
    meteringMode: null,
    flash: null,
    focalLength: null,
    focalLength35mm: null,
    lensModel: null,
    whiteBalance: null,
    pixelWidth: null,
    pixelHeight: null,
    gpsLat: null,
    gpsLon: null,
    gpsAlt: null,
    gpsDirection: null,
    gpsSpeed: null,
    gpsDate: null,
  };

  if (ifd0[0x8769] != null) {
    const exifIFD = _exifReadIFD(view, tiffStart, tiffStart + ifd0[0x8769], little);
    if (exifIFD[0x9003]) result.dateTaken = exifIFD[0x9003];
    if (exifIFD[0x9004]) result.dateDigitized = exifIFD[0x9004];
    if (exifIFD[0x829A] != null) result.exposureTime = exifIFD[0x829A];
    if (exifIFD[0x829D] != null) result.fNumber = exifIFD[0x829D];
    if (exifIFD[0x8827] != null) result.iso = Array.isArray(exifIFD[0x8827]) ? exifIFD[0x8827][0] : exifIFD[0x8827];
    if (exifIFD[0x9204] != null) result.exposureBias = exifIFD[0x9204];
    if (exifIFD[0x8822] != null) result.exposureProgram = exifIFD[0x8822];
    if (exifIFD[0x9207] != null) result.meteringMode = exifIFD[0x9207];
    if (exifIFD[0x9209] != null) result.flash = exifIFD[0x9209];
    if (exifIFD[0x920A] != null) result.focalLength = exifIFD[0x920A];
    if (exifIFD[0xA405] != null) result.focalLength35mm = exifIFD[0xA405];
    if (exifIFD[0xA434]) result.lensModel = exifIFD[0xA434];
    if (exifIFD[0xA403] != null) result.whiteBalance = exifIFD[0xA403];
    if (exifIFD[0xA002] != null) result.pixelWidth = exifIFD[0xA002];
    if (exifIFD[0xA003] != null) result.pixelHeight = exifIFD[0xA003];
  }

  if (ifd0[0x8825] != null) {
    const gpsIFD = _exifReadIFD(view, tiffStart, tiffStart + ifd0[0x8825], little);
    const lat = _exifDms(gpsIFD[0x0002]);
    const lon = _exifDms(gpsIFD[0x0004]);
    if (lat != null) result.gpsLat = gpsIFD[0x0001] === 'S' ? -lat : lat;
    if (lon != null) result.gpsLon = gpsIFD[0x0003] === 'W' ? -lon : lon;
    if (gpsIFD[0x0006] != null) {
      result.gpsAlt = gpsIFD[0x0005] === 1 ? -gpsIFD[0x0006] : gpsIFD[0x0006];
    }
    if (gpsIFD[0x0011] != null) result.gpsDirection = gpsIFD[0x0011];
    if (gpsIFD[0x000D] != null) result.gpsSpeed = gpsIFD[0x000D];
    if (gpsIFD[0x001D]) result.gpsDate = gpsIFD[0x001D];
  }

  return result;
}

function _readExifFromBuffer(buffer) {
  try {
    const view = new DataView(buffer);
    if (view.getUint16(0) !== 0xFFD8) return null; // pas un JPEG
    let offset = 2;
    while (offset < view.byteLength - 4) {
      const marker = view.getUint16(offset);
      if ((marker & 0xFF00) !== 0xFF00) break;
      if (marker === 0xFFE1) {
        const segLength = view.getUint16(offset + 2);
        const segStart = offset + 4;
        if (view.getUint32(segStart) === 0x45786966 && view.getUint16(segStart + 4) === 0x0000) {
          return _exifParseTiff(view, segStart + 6);
        }
        offset += 2 + segLength;
      } else if (marker >= 0xFFD0 && marker <= 0xFFD9) {
        offset += 2;
      } else {
        offset += 2 + view.getUint16(offset + 2);
      }
    }
  } catch {
    // fichier corrompu ou structure inattendue : pas d'EXIF exploitable
  }
  return null;
}

// ── Formatage EXIF pour affichage ───────────────────────────────────

const _FLASH_LABELS = {
  0x00: 'Non déclenché', 0x01: 'Déclenché',
  0x05: 'Déclenché (retour non détecté)', 0x07: 'Déclenché (retour détecté)',
  0x09: 'Déclenché (forcé)', 0x0D: 'Déclenché (forcé, retour non détecté)',
  0x0F: 'Déclenché (forcé, retour détecté)', 0x10: 'Non déclenché (forcé off)',
  0x18: 'Non déclenché (auto)', 0x19: 'Déclenché (auto)',
  0x20: 'Pas de fonction flash', 0x41: 'Déclenché (correction yeux rouges)',
};
const _EXPOSURE_PROGRAM_LABELS = {
  0: 'Non défini', 1: 'Manuel', 2: 'Auto', 3: 'Priorité ouverture',
  4: 'Priorité vitesse', 5: 'Programme créatif', 6: 'Programme action',
  7: 'Portrait', 8: 'Paysage',
};
const _METERING_MODE_LABELS = {
  0: 'Inconnu', 1: 'Moyenne', 2: 'Moyenne pondérée centrale', 3: 'Spot',
  4: 'Multi-spot', 5: 'Multi-zones', 6: 'Partielle',
};
const _WHITE_BALANCE_LABELS = { 0: 'Auto', 1: 'Manuel' };

function _fmtDateExif(v) {
  return v ? v.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$3/$2/$1') : null;
}
function _fmtExposureTime(v) {
  if (v == null) return null;
  if (v >= 1) return `${v.toFixed(1)} s`;
  return `1/${Math.round(1 / v)} s`;
}
function _fmtEnum(labels, v) {
  return v == null ? null : (labels[v] || `#${v}`);
}

function _exifDetailRows() {
  if (!_exif) return [];
  const e = _exif;
  const rows = [];
  const device = [e.make, e.model].filter(Boolean).join(' ');
  if (device) rows.push(['Appareil', device]);
  if (e.lensModel) rows.push(['Objectif', e.lensModel]);
  if (e.dateTaken) rows.push(['Date de prise de vue', _fmtDateExif(e.dateTaken)]);
  if (e.dateDigitized) rows.push(['Date de numérisation', _fmtDateExif(e.dateDigitized)]);
  if (e.exposureTime != null) rows.push(['Vitesse', _fmtExposureTime(e.exposureTime)]);
  if (e.fNumber != null) rows.push(['Ouverture', `f/${e.fNumber.toFixed(1)}`]);
  if (e.iso != null) rows.push(['Sensibilité', `ISO ${e.iso}`]);
  if (e.exposureBias != null) rows.push(['Correction d\'exposition', `${e.exposureBias > 0 ? '+' : ''}${e.exposureBias.toFixed(1)} EV`]);
  if (e.focalLength != null) rows.push(['Focale', `${Math.round(e.focalLength)} mm`]);
  if (e.focalLength35mm != null) rows.push(['Focale (éq. 35mm)', `${Math.round(e.focalLength35mm)} mm`]);
  if (e.exposureProgram != null) rows.push(['Programme d\'exposition', _fmtEnum(_EXPOSURE_PROGRAM_LABELS, e.exposureProgram)]);
  if (e.meteringMode != null) rows.push(['Mode de mesure', _fmtEnum(_METERING_MODE_LABELS, e.meteringMode)]);
  if (e.whiteBalance != null) rows.push(['Balance des blancs', _fmtEnum(_WHITE_BALANCE_LABELS, e.whiteBalance)]);
  if (e.flash != null) rows.push(['Flash', _fmtEnum(_FLASH_LABELS, e.flash)]);
  if (e.pixelWidth && e.pixelHeight) rows.push(['Dimensions', `${e.pixelWidth} × ${e.pixelHeight} px`]);
  if (e.gpsLat != null) rows.push(['GPS', `${e.gpsLat.toFixed(6)}, ${e.gpsLon.toFixed(6)}`]);
  if (e.gpsAlt != null) rows.push(['Altitude GPS', `${e.gpsAlt.toFixed(1)} m`]);
  if (e.gpsDirection != null) rows.push(['Direction GPS', `${e.gpsDirection.toFixed(0)}°`]);
  if (e.gpsSpeed != null) rows.push(['Vitesse GPS', `${e.gpsSpeed.toFixed(1)} km/h`]);
  if (e.gpsDate) rows.push(['Date GPS', e.gpsDate]);
  if (e.software) rows.push(['Logiciel', e.software]);
  if (e.imageDescription) rows.push(['Description', e.imageDescription]);
  return rows;
}

function _renderExifPanel() {
  const el = document.getElementById('image-tool-exif');
  const text = document.getElementById('image-tool-exif-text');
  const btnLocate = document.getElementById('btn-img-locate-gps');
  const btnAddAnnotation = document.getElementById('btn-img-add-annotation');
  const btnToggle = document.getElementById('btn-img-exif-toggle');
  const details = document.getElementById('image-tool-exif-details');
  if (!el || !text) return;

  if (!_img) {
    el.classList.add('hidden');
    details?.classList.add('hidden');
    return;
  }

  const rows = _exifDetailRows();
  if (!rows.length) {
    text.textContent = 'Aucune métadonnée EXIF';
    btnLocate?.classList.add('hidden');
    btnAddAnnotation?.classList.add('hidden');
    btnToggle?.classList.add('hidden');
    details?.classList.add('hidden');
    el.classList.remove('hidden');
    return;
  }

  const parts = [];
  const device = [_exif.make, _exif.model].filter(Boolean).join(' ');
  if (device) parts.push(device);
  if (_exif.dateTaken) parts.push(_fmtDateExif(_exif.dateTaken));
  if (_exif.gpsLat != null) parts.push(`GPS ${_exif.gpsLat.toFixed(6)}, ${_exif.gpsLon.toFixed(6)}`);
  text.textContent = parts.join(' · ') || 'Métadonnées EXIF disponibles';
  el.classList.remove('hidden');
  btnLocate?.classList.toggle('hidden', _exif.gpsLat == null);
  btnAddAnnotation?.classList.toggle('hidden', _exif.gpsLat == null);
  btnToggle?.classList.remove('hidden');

  if (details) {
    details.innerHTML = '';
    for (const [label, value] of rows) {
      const row = document.createElement('div');
      row.className = 'exif-detail-row';
      const l = document.createElement('span'); l.className = 'exif-detail-label'; l.textContent = label;
      const v = document.createElement('span'); v.className = 'exif-detail-value'; v.textContent = value;
      row.append(l, v);
      details.appendChild(row);
    }
  }
}

// ── Persistance (projet actif) ──────────────────────────────────────

function _saveImage(name) {
  if (!_img) return;
  const scale = Math.min(1, MAX_PERSIST_DIM / Math.max(_img.width, _img.height));
  const cw = Math.max(1, Math.round(_img.width * scale));
  const ch = Math.max(1, Math.round(_img.height * scale));
  const off = document.createElement('canvas');
  off.width = cw; off.height = ch;
  off.getContext('2d').drawImage(_img, 0, 0, cw, ch);

  _refMeta = {
    dataUrl: off.toDataURL('image/jpeg', 0.82),
    name: name || _refMeta?.name || 'image',
    width: _img.width,
    height: _img.height,
    zoom: _zoom, rotation: _rotation, panX: _panX, panY: _panY,
    pxToMeter: _pxToMeter,
    calibSegment: null,
    measureSegments: [],
    exif: _exif,
    createdAt: new Date().toISOString(),
  };
  saveActiveProject({ referenceImage: _refMeta });
}

function _saveMeta() {
  if (!_refMeta) return;
  _refMeta = {
    ..._refMeta,
    zoom: _zoom, rotation: _rotation, panX: _panX, panY: _panY,
    pxToMeter: _pxToMeter,
    calibSegment: _calibSegment,
    measureSegments: _measureSegments,
  };
  saveActiveProject({ referenceImage: _refMeta });
}

function _saveMetaDebounced() {
  if (!_refMeta) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_saveMeta, SAVE_DEBOUNCE_MS);
}

function _clearImage() {
  _img = null; _exif = null; _refMeta = null;
  _zoom = 1; _rotation = 0; _panX = 0; _panY = 0;
  _pxToMeter = null; _lastMeasureText = null;
  _calibPoints = []; _measurePoints = []; _previewPt = null;
  _calibSegment = null; _measureSegments = [];
  _setMode('idle');
  document.getElementById('img-rotation-slider').value = 0;
  document.getElementById('btn-img-measure').disabled = true;
  document.getElementById('btn-img-measure-copy')?.classList.add('hidden');
  _updateScale();
  _renderExifPanel();
  _setHint('Aucune image chargée');
  saveActiveProject({ referenceImage: null });
  _render();
}

// ── Chargement image ──────────────────────────────────────────────

function _loadFile(file) {
  const objectUrl = URL.createObjectURL(file);
  file.arrayBuffer().then(buffer => {
    _exif = _readExifFromBuffer(buffer);
    const img = new Image();
    img.onload = () => {
      _img = img;
      _zoom = 1; _rotation = 0; _panX = 0; _panY = 0;
      _calibPoints = []; _measurePoints = []; _previewPt = null;
      _calibSegment = null; _measureSegments = [];
      _pxToMeter = null; _lastMeasureText = null;
      _setMode('idle');
      document.getElementById('img-rotation-slider').value = 0;
      document.getElementById('btn-img-measure').disabled = true;
      document.getElementById('btn-img-measure-copy')?.classList.add('hidden');
      _updateScale();
      _renderExifPanel();
      _setHint('Image chargée — Calibrer l\'échelle avant de mesurer');
      _render();
      _saveImage(file.name);
      URL.revokeObjectURL(objectUrl);
    };
    img.src = objectUrl;
  });
}

// ── Restauration depuis le projet ───────────────────────────────────

export function reloadImageTool(referenceImage) {
  clearTimeout(_saveTimer);
  _refMeta = referenceImage || null;

  if (!referenceImage) {
    _img = null; _exif = null;
    _zoom = 1; _rotation = 0; _panX = 0; _panY = 0;
    _pxToMeter = null; _lastMeasureText = null;
    _calibPoints = []; _measurePoints = []; _previewPt = null;
    _calibSegment = null; _measureSegments = [];
    _setMode('idle');
    if (document.getElementById('img-rotation-slider')) document.getElementById('img-rotation-slider').value = 0;
    const btnMeasureReset = document.getElementById('btn-img-measure');
    if (btnMeasureReset) btnMeasureReset.disabled = true;
    document.getElementById('btn-img-measure-copy')?.classList.add('hidden');
    _updateScale();
    _renderExifPanel();
    _setHint('Aucune image chargée');
    if (_ctx) _render();
    return;
  }

  const img = new Image();
  img.onload = () => {
    _img = img;
    _exif = referenceImage.exif || null;
    _zoom = referenceImage.zoom ?? 1;
    _rotation = referenceImage.rotation ?? 0;
    _panX = referenceImage.panX ?? 0;
    _panY = referenceImage.panY ?? 0;
    _pxToMeter = referenceImage.pxToMeter ?? null;
    _lastMeasureText = null;
    _calibPoints = []; _measurePoints = []; _previewPt = null;
    _calibSegment = referenceImage.calibSegment || null;
    _measureSegments = referenceImage.measureSegments || [];
    _setMode('idle');
    if (document.getElementById('img-rotation-slider')) document.getElementById('img-rotation-slider').value = _rotation;
    const btnMeasure = document.getElementById('btn-img-measure');
    if (btnMeasure) btnMeasure.disabled = !_pxToMeter;
    document.getElementById('btn-img-measure-copy')?.classList.add('hidden');
    _updateScale();
    _renderExifPanel();
    _setHint(_pxToMeter ? 'Image restaurée — échelle calibrée' : 'Image restaurée');
    if (_ctx) _render();
  };
  img.src = referenceImage.dataUrl;
}

// ── Modes calibration / mesure ────────────────────────────────────

function _setMode(mode) {
  _mode = mode;
  document.getElementById('btn-img-calibrate')?.classList.toggle('active', mode === 'calibrate');
  document.getElementById('btn-img-measure')?.classList.toggle('active', mode === 'measure');
  if (_canvas) _canvas.style.cursor = mode === 'idle' ? 'grab' : 'crosshair';
}

function _setHint(text) {
  const el = document.getElementById('image-tool-hint');
  if (el) el.textContent = text;
}

function _updateScale() {
  const el = document.getElementById('image-tool-scale');
  if (!el) return;
  el.textContent = _pxToMeter ? `1 px = ${_pxToMeter.toFixed(4)} m` : '';
}

// ── Suppression des segments persistants au clic ───────────────────

function _distToSegmentCanvas(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function _hitTestSegments(canvasX, canvasY) {
  if (_calibSegment) {
    const [a, b] = _calibSegment.points.map(p => _imageToCanvas(p[0], p[1]));
    if (_distToSegmentCanvas(canvasX, canvasY, a, b) <= HIT_TOLERANCE_PX) return { type: 'calib' };
  }
  for (let i = 0; i < _measureSegments.length; i++) {
    const pts = _measureSegments[i].points.map(p => _imageToCanvas(p[0], p[1]));
    for (let j = 1; j < pts.length; j++) {
      if (_distToSegmentCanvas(canvasX, canvasY, pts[j - 1], pts[j]) <= HIT_TOLERANCE_PX) {
        return { type: 'measure', index: i };
      }
    }
  }
  return null;
}

function _onCanvasClick(clientX, clientY) {
  if (!_img) return;
  const rect = _canvas.getBoundingClientRect();
  const canvasX = clientX - rect.left, canvasY = clientY - rect.top;

  if (_mode === 'idle') {
    const hit = _hitTestSegments(canvasX, canvasY);
    if (hit?.type === 'calib') {
      _calibSegment = null;
      _pxToMeter = null;
      document.getElementById('btn-img-measure').disabled = true;
      _updateScale();
      _setHint('Calibration supprimée — recalibrez pour mesurer');
      _saveMeta();
      _render();
    } else if (hit?.type === 'measure') {
      _measureSegments.splice(hit.index, 1);
      _saveMeta();
      _render();
    }
    return;
  }

  const point = _canvasToImage(canvasX, canvasY);

  if (_mode === 'calibrate') {
    _calibPoints.push(point);
    if (_calibPoints.length === 2) _finishCalibration();
    _render();
  } else if (_mode === 'measure') {
    _measurePoints.push(point);
    _render();
    _updateMeasureHint();
  }
}

function _finishCalibration() {
  const pxDist = Math.hypot(
    _calibPoints[1][0] - _calibPoints[0][0],
    _calibPoints[1][1] - _calibPoints[0][1]
  );
  const points = [..._calibPoints];
  const input = prompt('Distance réelle entre ces deux points (mètres) :');
  const val = parseFloat((input || '').replace(',', '.'));

  _calibPoints = [];
  if (val > 0 && pxDist > 0) {
    _pxToMeter = val / pxDist;
    _calibSegment = { points, distanceM: val };
    document.getElementById('btn-img-measure').disabled = false;
    _setHint('Échelle calibrée — cliquez sur "Mesurer" pour mesurer une distance');
    _saveMeta();
  } else {
    _setHint('Calibration annulée');
  }
  _updateScale();
  _setMode('idle');
  _render();
}

function _updateMeasureHint() {
  if (_mode !== 'measure') return;
  const pts = _previewPt ? [..._measurePoints, _previewPt] : _measurePoints;
  if (pts.length < 2) { _setHint('Cliquez pour mesurer'); return; }
  _setHint(`Distance : ${_formatMeasureDist(_totalImageDist(pts) * _pxToMeter)}`);
}

function _finishMeasure() {
  if (_measurePoints.length >= 2 && _pxToMeter) {
    const distM = _totalImageDist(_measurePoints) * _pxToMeter;
    _lastMeasureText = _formatMeasureDist(distM);
    _measureSegments.push({ points: [..._measurePoints], distanceM: distM });
    _setHint(`✓ ${_lastMeasureText} — cliquez sur ⎘ pour copier`);
    document.getElementById('btn-img-measure-copy')?.classList.remove('hidden');
    _saveMeta();
  } else {
    _setHint('Mesure annulée (pas assez de points)');
  }
  _measurePoints = [];
  _previewPt = null;
  _setMode('idle');
  _render();
}

function _cancelMode() {
  _calibPoints = [];
  _measurePoints = [];
  _previewPt = null;
  _setMode('idle');
  _render();
}

// ── Zoom / rotation / pan ─────────────────────────────────────────

function _zoomAt(cx, cy, factor) {
  if (!_img) return;
  const before = _canvasToImage(cx, cy);
  _zoom = Math.min(20, Math.max(0.05, _zoom * factor));
  const after = _imageToCanvas(before[0], before[1]);
  _panX += cx - after[0];
  _panY += cy - after[1];
  _render();
  _saveMetaDebounced();
}

function _setRotation(deg) {
  _rotation = ((deg + 180) % 360 + 360) % 360 - 180;
  document.getElementById('img-rotation-slider').value = _rotation;
  _render();
  _saveMetaDebounced();
}

function _resetView() {
  // Remet la vue à zéro et efface les segments dessinés, mais conserve la
  // calibration active (_pxToMeter) : pas besoin de recalibrer après.
  _zoom = 1; _panX = 0; _panY = 0; _rotation = 0;
  _calibSegment = null; _measureSegments = [];
  document.getElementById('img-rotation-slider').value = 0;
  _render();
  _saveMetaDebounced();
}

// ── Câblage UI ────────────────────────────────────────────────────

export function initImageTool(referenceImage, { onLocateGPS, onAddPhotoAnnotation } = {}) {
  _win = document.getElementById('image-tool-window');
  _canvas = document.getElementById('image-tool-canvas');
  if (!_win || !_canvas) return;
  _ctx = _canvas.getContext('2d');
  _onAddPhotoAnnotation = onAddPhotoAnnotation || null;
  _onLocateGPS = onLocateGPS || null;

  _applyWindowGeometry();
  new ResizeObserver(_resizeCanvas).observe(document.querySelector('.image-tool-canvas-wrap'));

  document.getElementById('btn-image-tool')?.addEventListener('click', () => {
    _win.classList.toggle('hidden');
    if (!_win.classList.contains('hidden')) _resizeCanvas();
  });
  document.getElementById('btn-close-image-tool')?.addEventListener('click', () => {
    _win.classList.add('hidden');
  });

  // Déplacement de la fenêtre par son en-tête
  const header = document.querySelector('.image-tool-header');
  header?.addEventListener('mousedown', e => {
    if (e.target.closest('#btn-close-image-tool')) return;
    _winDragging = true;
    _winDragStart = [e.clientX, e.clientY];
    const r = _win.getBoundingClientRect();
    _winRectStart = { left: r.left, top: r.top };
    _win.style.right = 'auto';
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!_winDragging) return;
    const dx = e.clientX - _winDragStart[0];
    const dy = e.clientY - _winDragStart[1];
    const left = Math.min(Math.max(_winRectStart.left + dx, -_win.offsetWidth + 120), window.innerWidth - 60);
    const top  = Math.min(Math.max(_winRectStart.top + dy, 0), window.innerHeight - 40);
    _win.style.left = `${left}px`;
    _win.style.top  = `${top}px`;
  });
  window.addEventListener('mouseup', () => {
    if (!_winDragging) return;
    _winDragging = false;
    _saveWindowGeometry();
  });

  const input = document.getElementById('image-tool-input');
  document.getElementById('btn-img-load')?.addEventListener('click', () => input?.click());
  input?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) _loadFile(file);
    input.value = '';
  });

  document.getElementById('btn-img-clear')?.addEventListener('click', () => {
    if (!_img) return;
    if (confirm('Supprimer l\'image de référence de ce projet ?')) _clearImage();
  });

  document.getElementById('btn-img-zoom-in')?.addEventListener('click', () => _zoomAt(_canvas.width / 2, _canvas.height / 2, 1.25));
  document.getElementById('btn-img-zoom-out')?.addEventListener('click', () => _zoomAt(_canvas.width / 2, _canvas.height / 2, 0.8));
  document.getElementById('btn-img-rotate-l')?.addEventListener('click', () => _setRotation(_rotation - 90));
  document.getElementById('btn-img-rotate-r')?.addEventListener('click', () => _setRotation(_rotation + 90));
  document.getElementById('img-rotation-slider')?.addEventListener('input', e => _setRotation(parseFloat(e.target.value)));
  document.getElementById('btn-img-reset-view')?.addEventListener('click', _resetView);

  document.getElementById('btn-img-calibrate')?.addEventListener('click', () => {
    if (!_img) return;
    _cancelMode();
    _setMode(_mode === 'calibrate' ? 'idle' : 'calibrate');
    _setHint(_mode === 'calibrate' ? 'Cliquez 2 points dont vous connaissez la distance réelle' : 'Calibration annulée');
  });
  document.getElementById('btn-img-measure')?.addEventListener('click', () => {
    if (!_img || !_pxToMeter) return;
    _cancelMode();
    _setMode(_mode === 'measure' ? 'idle' : 'measure');
    _setHint(_mode === 'measure' ? 'Cliquez pour mesurer, double-clic pour terminer' : 'Mesure annulée');
  });

  document.getElementById('btn-img-measure-copy')?.addEventListener('click', e => {
    if (!_lastMeasureText) return;
    navigator.clipboard?.writeText(_lastMeasureText).catch(() => {});
    const btn = e.currentTarget;
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = '⎘'; }, 1200);
  });

  document.getElementById('btn-img-locate-gps')?.addEventListener('click', () => {
    if (_exif?.gpsLat != null && _onLocateGPS) _onLocateGPS(_exif.gpsLat, _exif.gpsLon);
  });

  document.getElementById('btn-img-add-annotation')?.addEventListener('click', () => {
    if (_exif?.gpsLat != null && _onAddPhotoAnnotation) {
      _onAddPhotoAnnotation(_exif.gpsLat, _exif.gpsLon, _refMeta?.name || 'Photo');
    }
  });

  document.getElementById('btn-img-exif-toggle')?.addEventListener('click', e => {
    const details = document.getElementById('image-tool-exif-details');
    const nowHidden = details?.classList.toggle('hidden');
    e.currentTarget.textContent = nowHidden ? '▸ Détails' : '▾ Détails';
  });

  // Molette = zoom centré sur le curseur
  _canvas.addEventListener('wheel', e => {
    if (!_img) return;
    e.preventDefault();
    const rect = _canvas.getBoundingClientRect();
    _zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }, { passive: false });

  // Pan (drag) — un mousedown/mouseup sans déplacement significatif vaut clic
  _canvas.addEventListener('mousedown', e => {
    if (!_img) return;
    _dragging = true; _dragMoved = false;
    _dragStartClient = [e.clientX, e.clientY];
    _panStart = [_panX, _panY];
    _canvas.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', e => {
    if (!_dragging) return;
    const dx = e.clientX - _dragStartClient[0];
    const dy = e.clientY - _dragStartClient[1];
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _dragMoved = true;
    _panX = _panStart[0] + dx;
    _panY = _panStart[1] + dy;
    _render();
  });
  window.addEventListener('mouseup', e => {
    if (!_dragging) return;
    _dragging = false;
    _canvas.style.cursor = _mode === 'idle' ? 'grab' : 'crosshair';
    if (!_dragMoved) _onCanvasClick(e.clientX, e.clientY);
    else _saveMetaDebounced();
  });

  // Prévisualisation de mesure au survol
  _canvas.addEventListener('mousemove', e => {
    if (_mode !== 'measure' || _dragging || !_img) return;
    const rect = _canvas.getBoundingClientRect();
    _previewPt = _canvasToImage(e.clientX - rect.left, e.clientY - rect.top);
    _render();
    _updateMeasureHint();
  });

  _canvas.addEventListener('dblclick', e => {
    e.preventDefault();
    if (_mode !== 'measure') return;
    if (_measurePoints.length > 0) _measurePoints.pop(); // retire le doublon du 2e clic
    _finishMeasure();
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || _win.classList.contains('hidden')) return;
    if (_mode !== 'idle') _cancelMode();
  });

  reloadImageTool(referenceImage);
}
