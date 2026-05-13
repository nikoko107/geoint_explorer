// modules/streetview.js — Vue immersive Google Street View intégrée

const GSV_COVERAGE_TILES = [
  'https://maps.googleapis.com/maps/vt?pb=!1m5!1m4!1i{z}!2i{x}!3i{y}!4i256!2m4!1e3!2ssvv!4m2!1scc!2s*211m3*211e2*212b1*213b1*214b1',
];

let _mapAnalysis = null;
let _mapTracking = null;
let _active = false;
let _position = { lat: 48.8534, lng: 2.3488 };
let _heading = 0;
let _marker = null;
let _trackingClickHandler = null;
let _coverageVisible = false;

export function initStreetView(mapAnalysis, mapTracking) {
  _mapAnalysis = mapAnalysis;
  _mapTracking = mapTracking;

  document.getElementById('btn-sv-embed')?.addEventListener('click', () => {
    if (_active) { _closeSV(); return; }
    if (document.body.classList.contains('draw-poly-mode')) return;
    const c = _mapAnalysis.getCenter();
    _openSV(c.lat, c.lng);
  });

  document.getElementById('btn-sv-close')?.addEventListener('click', _closeSV);

  document.getElementById('sv-heading')?.addEventListener('input', e => {
    _updateHeading(parseInt(e.target.value, 10));
  });

  document.getElementById('btn-sv-coverage')?.addEventListener('click', _toggleCoverage);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _active) _closeSV();
  });
}

function _openSV(lat, lng) {
  _position = { lat, lng };
  _heading = 0;
  _active = true;

  document.getElementById('sv-overlay')?.classList.remove('hidden');
  document.getElementById('btn-sv-embed')?.classList.add('active');
  document.getElementById('sv-heading').value = '0';
  document.getElementById('sv-heading-val').textContent = '0°';
  document.body.classList.add('sv-mode');

  _updateCoordsDisplay();
  _loadIframe();
  _createMarker();
  _attachTrackingClick();
}

function _closeSV() {
  if (!_active) return;
  _active = false;

  document.getElementById('sv-overlay')?.classList.add('hidden');
  const iframe = document.getElementById('sv-iframe');
  if (iframe) iframe.src = 'about:blank';
  document.getElementById('btn-sv-embed')?.classList.remove('active');
  document.body.classList.remove('sv-mode');

  _removeMarker();
  _detachTrackingClick();
}

function _navigateTo(lat, lng) {
  const prevPos = { ..._position };
  _position = { lat, lng };

  if (prevPos.lat !== lat || prevPos.lng !== lng) {
    _heading = _computeBearing(prevPos, _position);
    _updateHeadingDisplay(_heading);
  }

  _updateCoordsDisplay();
  _loadIframe();

  if (_marker) {
    _marker.setLngLat([_position.lng, _position.lat]);
    _rotateArrow(_heading);
  }
}

function _loadIframe() {
  const lat = _position.lat.toFixed(6);
  const lng = _position.lng.toFixed(6);
  const hdg = Math.round(_heading);
  const iframe = document.getElementById('sv-iframe');
  if (iframe) {
    iframe.src = `https://www.google.com/maps?q=&layer=c&cbll=${lat},${lng}&cbp=11,${hdg},0,0,0&output=embed&z=17`;
  }
}

function _computeBearing(from, to) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const dLng = toRad(to.lng - from.lng);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function _updateHeading(deg) {
  _heading = ((deg % 360) + 360) % 360;
  _updateHeadingDisplay(_heading);
  _rotateArrow(_heading);
}

function _updateHeadingDisplay(deg) {
  const rounded = Math.round(deg);
  const el = document.getElementById('sv-heading-val');
  if (el) el.textContent = `${rounded}°`;
  const slider = document.getElementById('sv-heading');
  if (slider) slider.value = String(rounded);
}

function _updateCoordsDisplay() {
  const el = document.getElementById('sv-coords');
  if (el) el.textContent = `${_position.lat.toFixed(5)}, ${_position.lng.toFixed(5)}`;
}

function _createMarker() {
  if (_marker) _marker.remove();
  const el = _buildMarkerEl();
  _marker = new maplibregl.Marker({ element: el, anchor: 'center' })
    .setLngLat([_position.lng, _position.lat])
    .addTo(_mapTracking);
}

function _removeMarker() {
  if (_marker) { _marker.remove(); _marker = null; }
}

function _buildMarkerEl() {
  const wrapper = document.createElement('div');
  wrapper.className = 'sv-marker';
  const dot = document.createElement('div');
  dot.className = 'sv-marker-dot';
  const arrow = document.createElement('div');
  arrow.className = 'sv-marker-arrow';
  arrow.style.transform = `rotate(${_heading}deg)`;
  wrapper.append(dot, arrow);
  return wrapper;
}

function _rotateArrow(deg) {
  const arrow = _marker?.getElement()?.querySelector('.sv-marker-arrow');
  if (arrow) arrow.style.transform = `rotate(${deg}deg)`;
}

function _attachTrackingClick() {
  _trackingClickHandler = e => {
    if (!_active) return;
    _navigateTo(e.lngLat.lat, e.lngLat.lng);
  };
  _mapTracking.on('click', _trackingClickHandler);
}

function _detachTrackingClick() {
  if (_trackingClickHandler) {
    _mapTracking.off('click', _trackingClickHandler);
    _trackingClickHandler = null;
  }
}

function _toggleCoverage() {
  _coverageVisible = !_coverageVisible;
  document.getElementById('btn-sv-coverage')?.classList.toggle('active', _coverageVisible);

  if (_coverageVisible) {
    if (!_mapTracking.getSource('gsv-coverage')) {
      _mapTracking.addSource('gsv-coverage', {
        type: 'raster',
        tiles: GSV_COVERAGE_TILES,
        tileSize: 256,
        attribution: '© Google',
      });
    }
    if (!_mapTracking.getLayer('gsv-coverage-layer')) {
      const beforeLayer = _mapTracking.getLayer('carto-labels') ? 'carto-labels' : undefined;
      _mapTracking.addLayer({
        id: 'gsv-coverage-layer',
        type: 'raster',
        source: 'gsv-coverage',
        paint: { 'raster-opacity': 0.85 },
      }, beforeLayer);
    }
  } else {
    if (_mapTracking.getLayer('gsv-coverage-layer')) _mapTracking.removeLayer('gsv-coverage-layer');
    if (_mapTracking.getSource('gsv-coverage')) _mapTracking.removeSource('gsv-coverage');
  }
}
