// Fenêtre "Image de référence" — zoom, rotation, mesure relative sur une
// photo locale. Outil indépendant de la carte (pas de géoréférencement) :
// on calibre une distance connue dans l'image, puis on mesure d'autres
// distances proportionnellement. État gardé en mémoire (pas de persistance
// localStorage — une image peut peser plusieurs Mo) ; fermer la fenêtre la
// masque seulement, l'état est conservé pour un retour rapide.

import { formatDist } from './measure.js';

let _win = null, _canvas = null, _ctx = null;
let _img = null;
let _zoom = 1, _rotation = 0, _panX = 0, _panY = 0;
let _mode = 'idle'; // 'idle' | 'calibrate' | 'measure'
let _calibPoints = [];
let _measurePoints = [];
let _previewPt = null;
let _pxToMeter = null;
let _lastMeasureText = null;

let _dragging = false, _dragMoved = false, _dragStartClient = null, _panStart = null;

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

function _drawOverlay() {
  if (!_img) return;
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
}

// ── Chargement image ──────────────────────────────────────────────

function _loadFile(file) {
  const reader = new FileReader();
  reader.onload = evt => {
    const img = new Image();
    img.onload = () => {
      _img = img;
      _zoom = 1; _rotation = 0; _panX = 0; _panY = 0;
      _calibPoints = []; _measurePoints = []; _previewPt = null;
      _pxToMeter = null; _lastMeasureText = null;
      _setMode('idle');
      document.getElementById('img-rotation-slider').value = 0;
      document.getElementById('btn-img-measure').disabled = true;
      document.getElementById('btn-img-measure-copy')?.classList.add('hidden');
      _updateScale();
      _setHint('Image chargée — Calibrer l\'échelle avant de mesurer');
      _render();
    };
    img.src = evt.target.result;
  };
  reader.readAsDataURL(file);
}

// ── Modes calibration / mesure ────────────────────────────────────

function _setMode(mode) {
  _mode = mode;
  document.getElementById('btn-img-calibrate')?.classList.toggle('active', mode === 'calibrate');
  document.getElementById('btn-img-measure')?.classList.toggle('active', mode === 'measure');
  _canvas.style.cursor = mode === 'idle' ? 'grab' : 'crosshair';
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

function _onCanvasClick(clientX, clientY) {
  if (!_img) return;
  const rect = _canvas.getBoundingClientRect();
  const point = _canvasToImage(clientX - rect.left, clientY - rect.top);

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
  const input = prompt('Distance réelle entre ces deux points (mètres) :');
  const val = parseFloat((input || '').replace(',', '.'));

  _calibPoints = [];
  if (val > 0 && pxDist > 0) {
    _pxToMeter = val / pxDist;
    document.getElementById('btn-img-measure').disabled = false;
    _setHint('Échelle calibrée — cliquez sur "Mesurer" pour mesurer une distance');
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
  _setHint(`Distance : ${formatDist(_totalImageDist(pts) * _pxToMeter)}`);
}

function _finishMeasure() {
  if (_measurePoints.length >= 2 && _pxToMeter) {
    const distM = _totalImageDist(_measurePoints) * _pxToMeter;
    _lastMeasureText = formatDist(distM);
    _setHint(`✓ ${_lastMeasureText} — cliquez sur ⎘ pour copier`);
    document.getElementById('btn-img-measure-copy')?.classList.remove('hidden');
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
}

function _setRotation(deg) {
  _rotation = ((deg + 180) % 360 + 360) % 360 - 180;
  document.getElementById('img-rotation-slider').value = _rotation;
  _render();
}

function _resetView() {
  _zoom = 1; _panX = 0; _panY = 0; _rotation = 0;
  document.getElementById('img-rotation-slider').value = 0;
  _render();
}

// ── Câblage UI ────────────────────────────────────────────────────

export function initImageTool() {
  _win = document.getElementById('image-tool-window');
  _canvas = document.getElementById('image-tool-canvas');
  if (!_win || !_canvas) return;
  _ctx = _canvas.getContext('2d');

  new ResizeObserver(_resizeCanvas).observe(document.querySelector('.image-tool-canvas-wrap'));

  document.getElementById('btn-image-tool')?.addEventListener('click', () => {
    _win.classList.toggle('hidden');
    if (!_win.classList.contains('hidden')) _resizeCanvas();
  });
  document.getElementById('btn-close-image-tool')?.addEventListener('click', () => {
    _win.classList.add('hidden');
  });

  const input = document.getElementById('image-tool-input');
  document.getElementById('btn-img-load')?.addEventListener('click', () => input?.click());
  input?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) _loadFile(file);
    input.value = '';
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
}
