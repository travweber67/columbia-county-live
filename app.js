/* Columbia County Live — v1.1
   Two kinds of data, both honest about freshness:
   (a) LIVE browser-direct feeds with open CORS — NWS alerts/forecast, USGS
       rivers + earthquakes, NOAA nowCOAST radar, NIFC WFIGS wildfires,
       wheretheiss.at ISS position.
   (b) SNAPSHOTS in data/*.json, collected every few minutes by our fetcher
       (runs on Travis's computer) from sources a browser can't read directly
       — ODOT TripCheck, WSDOT, the Wahkiakum ferry page, CivicPlus city
       calendars, AISStream — plus aircraft, because every keyless ADS-B API
       blocks browser CORS. Snapshot panels always show their fetched time.
   Every panel fails independently. No backend. */
'use strict';

/* ---------- config ---------- */
const TOWNS = [
  { name: 'St. Helens',    lat: 45.8595, lon: -122.8210 },
  { name: 'Scappoose',     lat: 45.7407, lon: -122.8773 },
  { name: 'Rainier',       lat: 46.0890, lon: -122.9360 },
  { name: 'Clatskanie',    lat: 46.1018, lon: -123.2037 },
  { name: 'Vernonia',      lat: 45.8596, lon: -123.1911 },
  { name: 'Columbia City', lat: 45.8907, lon: -122.8078 },
  { name: 'Warren',        lat: 45.8193, lon: -122.8743 }
];

const GAUGES = [
  { site: '14246900', label: 'Columbia River at Port Westward', sub: 'Near Quincy · serves Clatskanie / Westport end', lat: 46.1812, lon: -123.1835 },
  { site: '14299800', label: 'Nehalem River near Vernonia',     sub: "Vernonia's flood-watch gauge",                  lat: 45.8071, lon: -123.2832 },
  { site: '14243000', label: 'Cowlitz River at Castle Rock, WA', sub: 'Longview commute side of the bridge',          lat: 46.2748, lon: -122.9146 }
];

// County bounding box + modest buffer (from county.geojson) — shared scope.
const BBOX = { s: 45.57, w: -123.52, n: 46.34, e: -122.61 };
const inBox = (lat, lon) => lat != null && lon != null
  && lat >= BBOX.s && lat <= BBOX.n && lon >= BBOX.w && lon <= BBOX.e;

const NWS_ALERTS_URL = 'https://api.weather.gov/alerts/active?zone=ORC009';
const USGS_IV_URL = 'https://waterservices.usgs.gov/nwis/iv/?format=json&sites='
  + GAUGES.map(g => g.site).join(',') + '&parameterCd=00065,00060&period=P2D';
const ISS_URL = 'https://api.wheretheiss.at/v1/satellites/25544';
const WFIGS_POINTS_URL = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/'
  + 'WFIGS_Incident_Locations_Current/FeatureServer/0/query?where=1%3D1'
  + '&geometry=' + [BBOX.w, BBOX.s, BBOX.e, BBOX.n].join(',')
  + '&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects'
  + '&outFields=IncidentName,IncidentSize,PercentContained,FireDiscoveryDateTime,IncidentTypeCategory'
  + '&returnGeometry=true&f=geojson';
const WFIGS_PERIM_URL = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/'
  + 'WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?where=1%3D1'
  + '&geometry=' + [BBOX.w, BBOX.s, BBOX.e, BBOX.n].join(',')
  + '&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects'
  + '&outFields=poly_IncidentName,attr_PercentContained&returnGeometry=true&f=geojson';

function quakeUrl() {
  const start = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  return 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson'
    + '&starttime=' + start
    + '&minlatitude=45.4&maxlatitude=46.4&minlongitude=-123.6&maxlongitude=-122.4'
    + '&minmagnitude=1&orderby=time';
}

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = d => new Intl.DateTimeFormat('en-US',
  { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(d);
const fmtDayTime = d => new Intl.DateTimeFormat('en-US',
  { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(d);
const fmtDay = d => new Intl.DateTimeFormat('en-US',
  { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric' }).format(d);
const num = (v, dec) => Number(v).toLocaleString('en-US',
  { minimumFractionDigits: dec, maximumFractionDigits: dec });

async function getJSON(url, headers) {
  const r = await fetch(url, { headers: headers || {} });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function getSnapshot(name) {
  const r = await fetch('data/' + name, { cache: 'no-cache' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
const FRESH = {};
function setUpdated(id) {
  const el = $(id);
  if (el) el.textContent = 'Updated ' + fmtTime(new Date());
  FRESH[id] = Date.now();
}
function setSnapUpdated(id, fetchedAtIso) {
  const el = $(id);
  if (!el) return;
  const d = new Date(fetchedAtIso);
  el.textContent = isNaN(d) ? '' : 'Snapshot · collected ' + fmtDayTime(d);
  if (!isNaN(d)) FRESH[id] = d.getTime();
}
function ago(date) {
  const mins = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (mins < 60) return mins + ' min ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return hrs + ' hr ago';
  return Math.round(hrs / 24) + ' days ago';
}
const emojiIcon = (ch, size) => (typeof L !== 'undefined')
  ? L.divIcon({ className: 'emoji-pin', html: ch, iconSize: [size || 22, size || 22], iconAnchor: [(size || 22) / 2, (size || 22) / 2] })
  : null;

/* ---------- clock ---------- */
function tickClock() {
  const el = $('clock');
  if (el) el.textContent = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit'
  }).format(new Date());
}
setInterval(tickClock, 1000); tickClock();

/* ---------- map + layers ---------- */
let map = null, quakeLayer = null, aircraftLayer = null, shipLayer = null,
    fireLayer = null, issLayer = null, issMarker = null, salmonLayer = null;
function initMap() {
  if (typeof L === 'undefined') return; // Leaflet CDN failed; panels still work
  map = L.map('map', { scrollWheelZoom: false }).setView([46.02, -122.98], 10);
  map.on('focus', () => map.scrollWheelZoom.enable());
  map.on('blur', () => map.scrollWheelZoom.disable());
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  // County boundary (geometry from the NWS county zone for ORC009)
  fetch('county.geojson').then(r => r.json()).then(gj => {
    L.geoJSON(gj, { style: { color: '#38bdf8', weight: 2, fillColor: '#38bdf8', fillOpacity: 0.05 } }).addTo(map);
  }).catch(() => { /* boundary is decorative; skip silently */ });

  // Towns
  TOWNS.forEach(t => {
    L.circleMarker([t.lat, t.lon], { radius: 5, color: '#0b1220', weight: 1, fillColor: '#38bdf8', fillOpacity: 1 })
      .addTo(map).bindPopup('<strong>' + esc(t.name) + '</strong><br>Columbia County, Oregon');
  });
  // Gauges
  GAUGES.forEach(g => {
    L.circleMarker([g.lat, g.lon], { radius: 6, color: '#0b1220', weight: 1, fillColor: '#34d399', fillOpacity: 1 })
      .addTo(map).bindPopup('<strong>' + esc(g.label) + '</strong><br>USGS gauge ' + g.site
        + '<br><a href="https://waterdata.usgs.gov/monitoring-location/' + g.site + '/" target="_blank" rel="noopener">Live data at USGS →</a>');
  });
  // Landmarks: bridge + ferry
  const pin = html => L.divIcon({ className: 'emoji-pin', html: html, iconSize: [22, 22], iconAnchor: [11, 11] });
  L.marker([46.1058, -122.9607], { icon: pin('🌉') }).addTo(map)
    .bindPopup('<strong>Lewis &amp; Clark Bridge</strong><br>SR 433 · Rainier ↔ Longview<br><a href="https://wsdot.com/traffic/" target="_blank" rel="noopener">WSDOT traffic →</a>');
  L.marker([46.1328, -123.3717], { icon: pin('⛴️') }).addTo(map)
    .bindPopup('<strong>Oscar B Ferry — Westport landing (approx.)</strong><br>Oregon side departs :15 past the hour');
  L.marker([46.1597, -123.3797], { icon: pin('⛴️') }).addTo(map)
    .bindPopup('<strong>Oscar B Ferry — Puget Island landing (approx.)</strong><br>WA side departs on the hour');
  L.polyline([[46.1328, -123.3717], [46.1597, -123.3797]],
    { color: '#fbbf24', weight: 2, dashArray: '5 6' }).addTo(map);

  // Toggleable live layers
  quakeLayer = L.layerGroup().addTo(map);
  aircraftLayer = L.layerGroup().addTo(map);
  shipLayer = L.layerGroup();
  salmonLayer = L.layerGroup();
  fireLayer = L.layerGroup().addTo(map);
  issLayer = L.layerGroup().addTo(map);
  const radarLayer = L.tileLayer.wms(
    'https://nowcoast.noaa.gov/geoserver/observations/weather_radar/ows', {
      layers: 'conus_base_reflectivity_mosaic', format: 'image/png',
      transparent: true, version: '1.1.1', opacity: 0.65,
      attribution: 'NOAA nowCOAST · MRMS radar'
    });
  const layersCtl = L.control.layers(null, {
    '🌧️ Weather radar (NOAA)': radarLayer,
    '✈️ Aircraft (ADS-B)': aircraftLayer,
    '🚢 Ships (AIS)': shipLayer,
    '🐟 Salmon heat (estimate)': salmonLayer,
    '🔥 Wildfire perimeters': fireLayer,
    '🛰️ Space station (ISS)': issLayer,
    '🫨 Earthquakes': quakeLayer
  }, { collapsed: true }).addTo(map);
  /* WS-1d 2026-11-04 (Travis, from his phone): the layers panel used to
     sit permanently open over the map (collapsed:false) — on a phone it
     covered most of the map with no way to shrink it away. Now the panel
     starts collapsed everywhere: on desktop it expands on hover
     (Leaflet's standard pattern), on touch a tap on the layer button
     opens it, tapping the map closes it, and tapping the button while
     it is open closes it too (Leaflet's own touch handler only ever
     expands, so the close half is wired here, capture-phase, and keeps
     the event from re-opening it). Mobile sizing caps are in style.css:
     ≤70vw wide, max-height with internal scroll, compact rows. */
  try {
    map.on('click', () => { if (layersCtl && layersCtl.collapse) layersCtl.collapse(); });
    const ctlBox = layersCtl && layersCtl.getContainer ? layersCtl.getContainer() : null;
    /* The Leaflet map click above does not fire when the tap lands on a
       marker (markers don't bubble their click to the map by default,
       and Leaflet stops marker click events from bubbling in the DOM
       too — a bubble-phase listener on the container never sees them;
       both failure modes were measured live). So the same close also
       listens on the map container in the CAPTURE phase: any tap inside
       the map that isn't on the layers control itself collapses the
       panel, whatever it lands on. */
    const mapEl = $('map');
    if (mapEl && mapEl.addEventListener) {
      mapEl.addEventListener('click', e => {
        if (ctlBox && ctlBox.contains && e.target && ctlBox.contains(e.target)) return;
        if (layersCtl && layersCtl.collapse) layersCtl.collapse();
      }, true);
    }
    const ctlLink = ctlBox && ctlBox.querySelector
      ? ctlBox.querySelector('.leaflet-control-layers-toggle') : null;
    if (ctlBox && ctlLink) {
      ctlLink.setAttribute('aria-label', 'Map layers — show or hide the layer list');
      ctlBox.addEventListener('click', e => {
        if (e.target === ctlLink
            && ctlBox.classList.contains('leaflet-control-layers-expanded')) {
          e.preventDefault();
          e.stopPropagation();
          layersCtl.collapse();
        }
      }, true);
    }
  } catch (e) { /* the panel still works Leaflet's way without the close wiring */ }
}

/* ---------- map toolbar: near me, town jumps, full screen ---------- */
let meMarker = null;
function initMapTools() {
  const townsWrap = $('map-towns');
  if (townsWrap) {
    TOWNS.forEach(t => {
      const b = document.createElement('button');
      b.className = 'map-town-chip';
      b.type = 'button';
      b.textContent = t.name;
      b.addEventListener('click', () => { if (map) map.flyTo([t.lat, t.lon], 12, { duration: 0.8 }); });
      townsWrap.appendChild(b);
    });
  }
  const nearBtn = $('map-near-btn');
  if (nearBtn) {
    nearBtn.addEventListener('click', () => {
      if (!map || !navigator.geolocation) return;
      nearBtn.textContent = '📍 Locating…';
      navigator.geolocation.getCurrentPosition(pos => {
        const lat = pos.coords.latitude, lon = pos.coords.longitude;
        if (meMarker) meMarker.remove();
        meMarker = L.marker([lat, lon], { icon: emojiIcon('📍', 24) }).addTo(map)
          .bindPopup(inBox(lat, lon)
            ? '<strong>You are here</strong><br>Inside the Columbia County box.'
            : '<strong>You are here</strong><br>Outside the Columbia County box — the county is the blue outline.');
        map.flyTo([lat, lon], 12, { duration: 0.8 });
        // Open the popup once the flight lands — bindPopup alone leaves the
        // "You are here" answer hidden behind a second tap on the pin
        // (feature audit 2026-11-04: marker placed, popup never opened).
        setTimeout(() => { if (meMarker) { try { meMarker.openPopup(); } catch (e) { /* popup is a bonus */ } } }, 900);
        nearBtn.textContent = '📍 Near me';
      }, () => {
        nearBtn.textContent = '📍 Location unavailable';
        setTimeout(() => { nearBtn.textContent = '📍 Near me'; }, 3000);
      }, { timeout: 8000 });
    });
  }
  const fullBtn = $('map-full-btn');
  if (fullBtn) {
    fullBtn.addEventListener('click', () => {
      const el = $('map');
      if (el && el.requestFullscreen) el.requestFullscreen().catch(() => {});
    });
  }
  document.addEventListener('fullscreenchange', () => {
    setTimeout(() => { if (map) map.invalidateSize(); }, 250);
  });
}

/* ---------- sticky bar status pills ---------- */
function setPill(id, text, cls) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'sticky-pill' + (cls ? ' ' + cls : '');
}

/* ---------- weather alerts (NWS) ---------- */
async function loadAlerts() {
  const body = $('alerts-body');
  try {
    const d = await getJSON(NWS_ALERTS_URL, { 'Accept': 'application/geo+json' });
    const feats = d.features || [];
    const banner = $('alert-banner');
    if (!feats.length) {
      body.innerHTML = '<p class="no-alerts">✅ No active watches, warnings, or advisories for Columbia County right now.</p>';
      banner.hidden = true;
      setPill('sticky-weather', '✅ Weather clear', 'ok');
    } else {
      const anyWarning = feats.some(f => /warning/i.test((f.properties || {}).event || ''));
      setPill('sticky-weather', '⚠️ ' + feats.length + (feats.length === 1 ? ' alert' : ' alerts'), anyWarning ? 'bad' : 'warn');
      body.innerHTML = feats.map(f => {
        const p = f.properties || {};
        const sev = /warning/i.test(p.event || '') ? ' severe' : '';
        const when = p.ends ? ' · until ' + fmtDayTime(new Date(p.ends)) : '';
        return '<div class="alert-item' + sev + '"><h3>' + esc(p.event) + '</h3><p>'
          + esc(p.headline || p.areaDesc || '') + esc(when) + '</p></div>';
      }).join('');
      const first = feats[0].properties || {};
      banner.innerHTML = '<strong>' + esc(first.event) + ':</strong> ' + esc(first.headline || 'See Weather Alerts below.');
      banner.hidden = false;
    }
    setUpdated('alerts-updated');
  } catch (e) {
    body.innerHTML = '<p class="fallback">⚠️ Couldn\'t load alerts just now. Check the '
      + '<a href="https://www.weather.gov/pqr/" target="_blank" rel="noopener">National Weather Service</a> directly — and treat any severe weather as in effect until you confirm otherwise.</p>';
    setPill('sticky-weather', '⚠️ Weather — check NWS', 'warn');
  }
}

/* ---------- forecast (NWS points → gridpoint forecast) ---------- */
const forecastUrlCache = {};
let currentTown = TOWNS[0];
async function loadForecast(town) {
  currentTown = town;
  document.querySelectorAll('.town-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.town === town.name);
    if (b.setAttribute) b.setAttribute('aria-pressed', b.dataset.town === town.name ? 'true' : 'false');
  });
  const body = $('forecast-body');
  body.innerHTML = '<p class="loading">Loading forecast for ' + esc(town.name) + '…</p>';
  try {
    if (!forecastUrlCache[town.name]) {
      const pts = await getJSON('https://api.weather.gov/points/'
        + town.lat.toFixed(4) + ',' + town.lon.toFixed(4));
      forecastUrlCache[town.name] = pts.properties.forecast;
    }
    const fc = await getJSON(forecastUrlCache[town.name]);
    const periods = (fc.properties.periods || []).slice(0, 6);
    body.innerHTML = '<div class="forecast-periods">' + periods.map(p =>
      '<div class="period"><h4>' + esc(p.name) + '</h4>'
      + '<span class="temp">' + p.temperature + '°' + esc(p.temperatureUnit) + '</span>'
      + '<p>' + esc(p.shortForecast) + '</p>'
      + '<p>Wind ' + esc(p.windSpeed) + ' ' + esc(p.windDirection)
      + (p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value != null
          ? ' · Rain ' + p.probabilityOfPrecipitation.value + '%' : '')
      + '</p></div>').join('') + '</div>';
    setUpdated('forecast-updated');
  } catch (e) {
    body.innerHTML = '<p class="fallback">⚠️ Forecast unavailable right now. See '
      + '<a href="https://forecast.weather.gov/MapClick.php?lat=' + town.lat + '&lon=' + town.lon
      + '" target="_blank" rel="noopener">weather.gov for ' + esc(town.name) + '</a>.</p>';
  }
}
function initTownPicker() {
  const wrap = $('town-picker');
  TOWNS.forEach(t => {
    const b = document.createElement('button');
    b.className = 'town-btn' + (t === currentTown ? ' active' : '');
    b.textContent = t.name;
    if (b.setAttribute) b.setAttribute('aria-pressed', t === currentTown ? 'true' : 'false');
    b.dataset.town = t.name;
    b.addEventListener('click', () => loadForecast(t));
    wrap.appendChild(b);
  });
}

/* ---------- river levels (USGS NWIS) ---------- */
async function loadRivers() {
  const body = $('rivers-body');
  try {
    const d = await getJSON(USGS_IV_URL);
    const bySite = {};
    (d.value.timeSeries || []).forEach(ts => {
      const code = ts.sourceInfo.siteCode[0].value;
      const varCode = ts.variable.variableCode[0].value;
      const vals = (ts.values[0] && ts.values[0].value) || [];
      if (!vals.length) return;
      const clean = vals.filter(v => v.value !== '-999999');
      if (!clean.length) return;
      const last = clean[clean.length - 1];
      bySite[code] = bySite[code] || {};
      if (varCode === '00065') {
        bySite[code].height = parseFloat(last.value);
        bySite[code].time = new Date(last.dateTime);
        // value closest to 24h before the latest reading (same tide phase on the Columbia)
        const target = bySite[code].time.getTime() - 24 * 3600 * 1000;
        let best = clean[0], bd = Infinity;
        clean.forEach(v => {
          const dd = Math.abs(new Date(v.dateTime).getTime() - target);
          if (dd < bd) { bd = dd; best = v; }
        });
        bySite[code].height24 = parseFloat(best.value);
        bySite[code].series = clean
          .filter((v, i) => i % 4 === 0 || i === clean.length - 1)
          .map(v => ({ t: new Date(v.dateTime).getTime(), v: parseFloat(v.value) }));
      }
      if (varCode === '00060') bySite[code].flow = parseFloat(last.value);
    });
    const rows = GAUGES.map(g => {
      const s = bySite[g.site];
      if (!s || s.height == null) {
        return '<div class="river-row"><div><div class="river-name">' + esc(g.label) + '</div>'
          + '<div class="river-sub">' + esc(g.sub) + '</div></div>'
          + '<div class="river-nums"><span class="river-sub">no reading right now</span></div></div>';
      }
      let trend = '<span class="trend-flat">→ steady vs 24 hrs ago</span>';
      if (s.height24 != null) {
        const delta = s.height - s.height24;
        if (delta > 0.05) trend = '<span class="trend-up">▲ ' + num(delta, 2) + ' ft vs 24 hrs ago</span>';
        else if (delta < -0.05) trend = '<span class="trend-down">▼ ' + num(Math.abs(delta), 2) + ' ft vs 24 hrs ago</span>';
      }
      let spark = '';
      if (s.series && s.series.length > 3) {
        const vals = s.series.map(p => p.v);
        const lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
        const range = (hi - lo) || 1;
        const pts = s.series.map((p, i) =>
          (i / (s.series.length - 1) * 260).toFixed(1) + ',' + (42 - ((p.v - lo) / range) * 38).toFixed(1)
        ).join(' ');
        const rising = (vals[vals.length - 1] - vals[0]) > 0.5;
        const stroke = rising ? '#fbbf24' : '#53c7de';
        spark = '<div class="river-spark"><svg viewBox="0 0 260 46" preserveAspectRatio="none" role="img" aria-label="River height, last 48 hours">'
          + '<polygon points="0,46 ' + pts + ' 260,46" fill="' + stroke + '" opacity="0.13"></polygon>'
          + '<polyline points="' + pts + '" fill="none" stroke="' + stroke + '" stroke-width="1.8" stroke-linejoin="round"></polyline></svg>'
          + '<div class="river-spark-cap">Last 48 hrs · low ' + num(lo, 2) + ' ft · high ' + num(hi, 2) + ' ft'
          + (rising ? ' · <span class="trend-up">rising over the window</span>' : '') + '</div></div>';
      }
      return '<div class="river-row"><div><div class="river-name">' + esc(g.label) + '</div>'
        + '<div class="river-sub">' + esc(g.sub) + ' · read ' + ago(s.time) + '</div>'
        + '<div class="river-sub">' + trend + '</div></div>'
        + '<div class="river-nums"><div class="big">' + num(s.height, 2) + ' ft</div>'
        + '<div class="river-sub">' + (s.flow != null ? num(s.flow, s.flow < 100 ? 1 : 0) + ' cfs flow' : '') + '</div></div>'
        + spark + '</div>';
    }).join('');
    body.innerHTML = rows;
    setUpdated('rivers-updated');
  } catch (e) {
    body.innerHTML = '<p class="fallback">⚠️ Couldn\'t load gauge readings just now. See '
      + '<a href="https://waterdata.usgs.gov/" target="_blank" rel="noopener">USGS Water Data</a> for the latest.</p>';
  }
}

/* ---------- earthquakes (USGS FDSN) ---------- */
async function loadQuakes() {
  const body = $('quakes-body');
  try {
    const d = await getJSON(quakeUrl());
    const feats = (d.features || []).slice(0, 8);
    if (quakeLayer) {
      quakeLayer.clearLayers();
      (d.features || []).forEach(f => {
        const c = f.geometry.coordinates, p = f.properties;
        L.circleMarker([c[1], c[0]], {
          radius: Math.max(4, p.mag * 2.4), color: '#7f1d1d', weight: 1,
          fillColor: '#f87171', fillOpacity: 0.75
        }).addTo(quakeLayer).bindPopup('<strong>M' + p.mag + '</strong> — ' + esc(p.place)
          + '<br>' + fmtDayTime(new Date(p.time)) + ' · depth ' + num(c[2], 1) + ' km');
      });
    }
    body.innerHTML = feats.length ? feats.map(f => {
      const p = f.properties;
      return '<div class="quake-row"><div class="quake-mag' + (p.mag >= 2.5 ? ' hot' : '') + '">'
        + num(p.mag, 1) + '</div><div><div class="quake-place">' + esc(p.place) + '</div>'
        + '<div class="quake-time">' + fmtDayTime(new Date(p.time)) + ' · ' + ago(new Date(p.time)) + '</div></div></div>';
    }).join('') : '<p class="no-alerts">✅ No earthquakes M1+ recorded in the region in the last 30 days.</p>';
    setUpdated('quakes-updated');
  } catch (e) {
    body.innerHTML = '<p class="fallback">⚠️ Couldn\'t load earthquake data just now. See '
      + '<a href="https://earthquake.usgs.gov/earthquakes/map/" target="_blank" rel="noopener">USGS Latest Earthquakes</a>.</p>';
  }
}

/* ---------- wildfires (NIFC WFIGS, live from browser) ---------- */
async function loadFires() {
  const body = $('fires-body');
  try {
    const [pts, per] = await Promise.all([
      getJSON(WFIGS_POINTS_URL).catch(() => null),
      getJSON(WFIGS_PERIM_URL).catch(() => null)
    ]);
    const feats = (pts && pts.features) || [];
    if (fireLayer && per && per.features && per.features.length) {
      fireLayer.clearLayers();
      L.geoJSON(per, { style: { color: '#f97316', weight: 2, fillColor: '#f97316', fillOpacity: 0.25 } })
        .addTo(fireLayer);
    }
    if (!pts) throw new Error('points feed failed');
    body.innerHTML = feats.length ? feats.map(f => {
      const p = f.properties || {};
      const size = p.IncidentSize != null ? num(p.IncidentSize, 0) + ' acres' : 'size not yet reported';
      const cont = p.PercentContained != null ? p.PercentContained + '% contained' : 'containment not yet reported';
      return '<div class="fire-row"><div class="fire-name">🔥 ' + esc(p.IncidentName || 'Unnamed incident') + '</div>'
        + '<div class="fire-sub">' + esc(size) + ' · ' + esc(cont) + '</div></div>';
    }).join('') : '<p class="no-alerts">✅ No active wildfire incidents reported in or near Columbia County right now.</p>';
    setUpdated('fires-updated');
  } catch (e) {
    body.innerHTML = '<p class="fallback">⚠️ Couldn\'t load wildfire data just now. See '
      + '<a href="https://inciweb.wildfire.gov/" target="_blank" rel="noopener">InciWeb</a> for official incident information.</p>';
  }
}

/* ---------- sky: aircraft (fetcher snapshot) + ISS ---------- */
let skyCache = null;
let currentSkyFilter = 'all';
function drawSkyMarkers(list) {
  if (!aircraftLayer) return;
  aircraftLayer.clearLayers();
  list.forEach(a => {
    if (a.lat == null || a.lon == null) return;
    const rot = a.track != null ? ' style="display:inline-block;transform:rotate(' + (Number(a.track) - 45) + 'deg)"' : '';
    L.marker([a.lat, a.lon], {
      icon: L.divIcon({ className: 'emoji-pin plane-pin', html: '<span' + rot + '>✈️</span>', iconSize: [20, 20], iconAnchor: [10, 10] })
    }).addTo(aircraftLayer).bindPopup('<strong>' + esc(a.callsign || a.hex || 'Aircraft') + '</strong>'
      + (a.type ? '<br>Type ' + esc(a.type) : '')
      + (a.alt_ft != null && a.alt_ft !== 'ground' ? '<br>' + num(a.alt_ft, 0) + ' ft' : '<br>On the ground')
      + (a.gs_kn != null ? ' · ' + num(a.gs_kn, 0) + ' kt' : ''));
  });
}
function renderSkyList() {
  const body = $('sky-body');
  if (!skyCache) return;
  const list = skyCache.list, sourceLabel = skyCache.sourceLabel;
  if (!list.length) {
    body.innerHTML = '<p class="no-alerts">No aircraft inside the county box at the last reading — normal for a rural county; Portland traffic passes just south and east.</p>';
    return;
  }
  let shown, sortFn;
  if (currentSkyFilter === 'low') {
    shown = list.filter(a => a.alt_ft !== 'ground' && a.alt_ft != null && Number(a.alt_ft) < 10000);
    sortFn = (x, y) => (Number(x.alt_ft) || 0) - (Number(y.alt_ft) || 0);
  } else if (currentSkyFilter === 'ground') {
    shown = list.filter(a => a.alt_ft === 'ground');
    sortFn = () => 0;
  } else {
    shown = list.slice();
    sortFn = (x, y) => (Number(y.alt_ft) || 0) - (Number(x.alt_ft) || 0);
  }
  if (!shown.length) {
    body.innerHTML = '<p class="sky-count"><strong>' + list.length + '</strong> aircraft over the county <span class="river-sub">(' + esc(sourceLabel) + ')</span></p>'
      + '<p class="no-alerts">' + (currentSkyFilter === 'low'
        ? 'Nothing low and local right now — everything overhead is cruise traffic passing through.'
        : 'Nothing on the ground at a county strip right now.') + '</p>';
    return;
  }
  const sorted = shown.sort(sortFn);
  body.innerHTML = '<p class="sky-count"><strong>' + list.length + '</strong> aircraft over the county <span class="river-sub">(' + esc(sourceLabel) + ' · refreshes every 45 sec)</span></p>'
    + sorted.slice(0, 8).map(a =>
      '<div class="sky-row"><span class="sky-cs">' + esc(a.callsign || a.hex || '—') + '</span>'
      + '<span class="sky-meta">' + esc(a.type || '') + '</span>'
      + '<span class="sky-alt">' + (a.alt_ft === 'ground' ? 'ground' : (a.alt_ft != null ? num(a.alt_ft, 0) + ' ft' : '')) + '</span></div>'
    ).join('');
}
function renderAircraft(list, sourceLabel) {
  skyCache = { list: list, sourceLabel: sourceLabel };
  drawSkyMarkers(list);
  renderSkyList();
}
function initSkyFilters() {
  const wrap = $('sky-filters');
  if (!wrap) return;
  wrap.querySelectorAll('.sky-filter-btn').forEach(b => {
    b.addEventListener('click', () => {
      currentSkyFilter = b.dataset.skyfilter;
      wrap.querySelectorAll('.sky-filter-btn').forEach(x => {
        x.classList.toggle('active', x === b);
        if (x.setAttribute) x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
      });
      renderSkyList();
    });
  });
}
async function loadAircraft() {
  // Snapshot only — the fetcher collects ADS-B and publishes data/aircraft.json.
  // The browser used to try adsb.fi direct first, but their API sends no CORS
  // headers, so every load burned failed fetches and sat on the "Loading…"
  // state for seconds before falling back to this same snapshot. Removed
  // 2026-11-09 (v54, full-audit defect); the snapshot is the one data route.
  try {
    const snap = await getSnapshot('aircraft.json');
    renderAircraft(snap.aircraft || [], 'ADS-B snapshot');
    setSnapUpdated('sky-updated', snap.fetched_at);
  } catch (e) {
    $('sky-body').innerHTML = '<p class="fallback">⚠️ Aircraft data unavailable right now.</p>';
  }
}
async function loadISS() {
  const body = $('iss-body');
  try {
    const d = await getJSON(ISS_URL);
    const lat = Number(d.latitude), lon = Number(d.longitude);
    if (issLayer) {
      issLayer.clearLayers();
      issMarker = L.marker([lat, lon], { icon: emojiIcon('🛰️', 24) }).addTo(issLayer)
        .bindPopup('<strong>International Space Station</strong><br>' + num(d.altitude, 0)
          + ' km up · ' + num(d.velocity, 0) + ' km/h');
    }
    const here = inBox(lat, lon);
    body.innerHTML = '<p>🛰️ <strong>ISS</strong> is currently over <strong>'
      + num(Math.abs(lat), 1) + '° ' + (lat >= 0 ? 'N' : 'S') + ', '
      + num(Math.abs(lon), 1) + '° ' + (lon >= 0 ? 'E' : 'W') + '</strong>'
      + (here ? ' — <strong>that\'s over Columbia County right now.</strong> Look up!'
              : ' — not over the county at the moment; it circles the Earth every ~93 minutes.')
      + '</p>';
  } catch (e) {
    body.innerHTML = '<p class="fallback">ISS position unavailable right now.</p>';
  }
}

/* ---------- incident rows: what / why / since when / source ----------
   (build batch 2026-11-04, research ADD 2: WSDOT's most-quoted complaint
   is a red road with no reason why — every incident row here carries its
   place, its impact, when ODOT first reported it, and its source.) */
function incidentRow(i) {
  const meta = [];
  if (i.place) meta.push(i.place);
  else if (i.route) meta.push(i.route);
  if (i.impact) meta.push(i.impact);
  if (i.start) {
    const sd = new Date(i.start);
    if (!isNaN(sd)) meta.push('since ' + fmtDayTime(sd));
  }
  meta.push('Source: ' + (i.source || 'ODOT TripCheck'));
  return '<div class="incident-row"><strong>' + esc(i.title) + '</strong>'
    + (i.route ? ' <span class="river-sub">' + esc(i.route) + '</span>' : '')
    + (i.desc ? '<p>' + esc(i.desc) + '</p>' : '')
    + '<div class="incident-meta">' + esc(meta.join(' · ')) + '</div></div>';
}

/* ---------- My Route camera strip (build batch 2026-11-04, ADD 1 / R3) ----------
   The most-loved pattern in the DOT-app reviews is cameras grouped by
   route; CCL already had them on the map and in one flat list — this
   strip puts the commute corridors' stills in driving order, so the
   morning check is one horizontal sweep instead of 37 thumbnails. */
function renderMyRoute(camerasSnap) {
  const el = $('myroute-body');
  if (!el) return;
  const cams = (camerasSnap && camerasSnap.cameras) || [];
  if (!cams.length) {
    el.innerHTML = '<p class="status-note">📷 Route cameras arrive with the ODOT camera snapshot.</p>';
    return;
  }
  const bust = encodeURIComponent((camerasSnap && camerasSnap.fetched_at) || 'live');
  const src = u => esc(u + (u.indexOf('?') >= 0 ? '&' : '?') + 'snap=' + bust);
  const groups = [
    { label: 'US-30 northwest — St. Helens → Rainier → the Lewis & Clark Bridge',
      list: cams.filter(c => c.route === 'US30' && c.lon != null && c.lon <= -122.90)
                .sort((a, b) => b.lon - a.lon) },
    { label: 'US-30 southeast — St. Johns Bridge & the Portland end',
      list: cams.filter(c => c.route === 'US30' && c.lon != null && c.lon > -122.90)
                .sort((a, b) => b.lat - a.lat) },
    { label: 'Cornelius Pass Rd (OR-127) — the ridge detour',
      list: cams.filter(c => c.route === 'OR127')
                .sort((a, b) => a.name.localeCompare(b.name)) },
    { label: 'I-5 — the Columbia crossing',
      list: cams.filter(c => c.route === 'I5')
                .sort((a, b) => a.lat - b.lat) }
  ].filter(g => g.list.length);
  if (!groups.length) {
    el.innerHTML = '<p class="status-note">No corridor cameras in the latest snapshot.</p>';
    return;
  }
  el.innerHTML = groups.map(g =>
    '<div class="route-group"><div class="route-group-name">' + esc(g.label) + '</div>'
    + '<div class="route-strip">' + g.list.map(c =>
        '<figure class="camera-fig">'
        + (c.image_url ? '<img loading="lazy" src="' + src(c.image_url) + '" alt="Road camera: ' + esc(c.name) + '" onerror="this.parentNode.classList.add(\'cam-dead\');this.remove();">' : '')
        + '<figcaption>' + esc(c.name) + '</figcaption></figure>').join('')
    + '</div></div>').join('');
}

/* ---------- snapshot: roads + bridge + cameras ---------- */
function renderRoads(roads, camerasSnap) {
  setSnapUpdated('roads-updated', roads.fetched_at);
  // Bridge block
  const b = roads.bridge || {};
  // Commute verdict — one synthesized sentence from everything the snapshot knows
  const vEl = $('commute-verdict');
  if (vEl) {
    const incCount = (roads.incidents || []).length;
    const wzCount = (b.work_zones || []).length;
    const alertCount = (b.alerts || []).length;
    const odotPending = (((roads.sources || [])[0]) || {}).status !== 'ok';
    let level, head;
    if (b.status === 'alert' || alertCount > 0) {
      level = 'bad'; head = '⛔ Trouble on the corridor — read the bridge alert before you leave';
    } else if (incCount > 0 || wzCount > 0) {
      const n = incCount + wzCount;
      level = 'warn'; head = '⚠️ Mostly clear — ' + n + (n === 1 ? ' thing' : ' things') + ' to know below';
    } else if (b.status === 'work') {
      level = 'warn'; head = '⚠️ Bridge work scheduled — expect possible delays';
    } else {
      level = 'ok'; head = '✅ Clear run right now';
    }
    const parts = [];
    parts.push('Lewis & Clark Bridge: ' + (alertCount ? alertCount + ' alert(s) posted' : wzCount ? 'work zones posted' : 'no alerts'));
    if (incCount) parts.push(incCount + ' ODOT incident(s) in the county area');
    if (odotPending) parts.push('ODOT incident feed still pending its free key — verdict is from bridge + WSDOT sources');
    if (level !== 'ok') parts.push('US-30 blocked? Cornelius Pass or the St. Johns Bridge are the usual detours');
    vEl.className = 'commute-verdict cv-' + level;
    vEl.innerHTML = '<div class="cv-head">' + esc(head) + '</div><div class="cv-sub">' + esc(parts.join(' · ')) + '</div>';
  }
  const bEl = $('bridge-body');
  const icon = { clear: '✅', work: '🚧', alert: '⛔', unknown: '❔' }[b.status] || '❔';
  let bh = '<div class="bridge-box bridge-' + esc(b.status || 'unknown') + '">'
    + '<div class="bridge-title">' + icon + ' Lewis &amp; Clark Bridge — '
    + ({ clear: 'no alerts', work: 'work scheduled', alert: 'ALERT posted', unknown: 'status unknown' }[b.status] || 'status unknown')
    + '</div><p>' + esc(b.note || '') + '</p>';
  (b.alerts || []).forEach(a => {
    bh += '<div class="incident-row"><strong>' + esc(a.title) + '</strong><p>' + esc(a.desc) + '</p></div>';
  });
  (b.work_zones || []).forEach(z => {
    bh += '<div class="incident-row"><strong>🚧 Work zone</strong> — ' + esc(z.description || (z.roads || []).join(', '))
      + (z.start ? '<p>' + esc(z.start) + (z.end ? ' → ' + esc(z.end) : '') + '</p>' : '')
      + '<div class="incident-meta">Source: WSDOT</div></div>';
  });
  bh += '</div>';
  bEl.innerHTML = bh;
  setPill('sticky-bridge',
    '🌉 Bridge ' + ({ clear: 'clear', work: 'work posted', alert: 'ALERT', unknown: 'unknown' }[b.status] || 'unknown'),
    b.status === 'clear' ? 'ok' : b.status === 'alert' ? 'bad' : 'warn');
  // ODOT incidents — scoped by the fetcher to the ones ODOT locates in
  // the county area (build batch 2026-11-04, research ADD 2 / R1: the
  // verdict and this list used to carry the whole statewide feed count).
  const iEl = $('incidents-body');
  const tc = (roads.sources || [])[0] || {};
  if ((roads.incidents || []).length) {
    const scopeNote = (typeof roads.odot_active_statewide === 'number')
      ? '<p class="incident-scope">ODOT lists ' + roads.odot_active_statewide
        + ' active incidents across Oregon right now — these ' + roads.incidents.length
        + ' are the ones it locates in the county &amp; commute corridors.</p>'
      : '';
    iEl.innerHTML = scopeNote + roads.incidents.map(incidentRow).join('');
  } else if (tc.status === 'ok') {
    iEl.innerHTML = '<p class="no-alerts">✅ No ODOT incidents reported in the county area in the latest snapshot.</p>';
  } else {
    iEl.innerHTML = '<p class="status-note">🛠️ The bridge status above and event/ferry panels are live now. ODOT\'s incident feed itself needs ODOT\'s free developer key added to our fetcher — the plumbing is built and waiting on that one signup (it\'s free; it just has to be done by a person). Until then, the snapshot above is WSDOT + county sources only for roads.</p>';
  }
  // Cameras
  const cEl = $('cameras-body');
  const cams = (camerasSnap && camerasSnap.cameras) || [];
  if (cams.length) {
    // TripCheck stills live at static URLs that update in place — without a
    // per-snapshot cache-buster, browsers/CDNs keep serving the first frame
    // they cached. Key the bust to this snapshot's fetched_at: a fresh
    // snapshot yields fresh stills, an unchanged one stays cached.
    const camBust = encodeURIComponent((camerasSnap && camerasSnap.fetched_at) || 'live');
    const camSrc = u => esc(u + (u.indexOf('?') >= 0 ? '&' : '?') + 'snap=' + camBust);
    cEl.innerHTML = '<div class="camera-grid">' + cams.map(c =>
      '<figure class="camera-fig">'
      + (c.image_url ? '<img loading="lazy" src="' + camSrc(c.image_url) + '" alt="Road camera: ' + esc(c.name) + '" onerror="this.parentNode.classList.add(\'cam-dead\');this.remove();">' : '')
      + '<figcaption>' + esc(c.name) + (c.route ? ' · ' + esc(c.route) : '') + '</figcaption></figure>').join('') + '</div>'
      + '<p class="card-note small">Camera stills are the latest snapshot frame; the fetcher refreshes the list every run.</p>';
    if (map && !renderRoads._camsDrawn) {
      renderRoads._camsDrawn = true;
      cams.forEach(c => {
        if (c.lat != null && c.lon != null) {
          L.circleMarker([c.lat, c.lon], { radius: 4, color: '#0b1220', weight: 1, fillColor: '#f59e0b', fillOpacity: 0.9 })
            .addTo(map).bindPopup('<strong>📷 ' + esc(c.name) + '</strong>');
        }
      });
    }
  } else {
    cEl.innerHTML = '<p class="status-note">📷 Camera inventory arrives with the same free ODOT key as incidents — one signup unlocks both.</p>';
  }
  renderMyRoute(camerasSnap);
}
async function loadRoads() {
  try {
    const [roads, cams] = await Promise.all([
      getSnapshot('roads.json'),
      getSnapshot('cameras.json').catch(() => null)
    ]);
    renderRoads(roads, cams);
  } catch (e) {
    const vEl2 = $('commute-verdict');
    if (vEl2) { vEl2.className = 'commute-verdict cv-warn'; vEl2.innerHTML = '<div class="cv-head">❔ Corridor status unavailable</div><div class="cv-sub">The road snapshot didn\'t load — check TripCheck or WSDOT directly before you drive.</div>'; }
    $('bridge-body').innerHTML = '<p class="fallback">⚠️ Road snapshot unavailable right now — check <a href="https://www.tripcheck.com/" target="_blank" rel="noopener">TripCheck</a> and <a href="https://wsdot.com/traffic/" target="_blank" rel="noopener">WSDOT</a> directly before you drive.</p>';
    $('incidents-body').innerHTML = '';
    $('cameras-body').innerHTML = '';
    const mrEl = $('myroute-body');
    if (mrEl) mrEl.innerHTML = '';
  }
}

/* ---------- route-ahead forecast (build batch 2026-11-04, ADD 3) ----------
   An Oregon 511 reviewer asked for a route forecast to anticipate ice
   and snow; this is the commute-window version: the next 8 hourly NWS
   periods for the US-30 corridor towns plus the Portland end, with the
   hazards flagged in plain words. Keyless NWS, same pattern (and the
   same points->forecastHourly route) as the forecast card. */
const CORRIDOR_POINTS = [
  { name: 'Rainier', lat: 46.0890, lon: -122.9360 },
  { name: 'St. Helens', lat: 45.8595, lon: -122.8210 },
  { name: 'Scappoose', lat: 45.7407, lon: -122.8773 },
  { name: 'Portland end — St. Johns', lat: 45.5897, lon: -122.7730 }
];
const routeHourlyCache = {};
function wxFlags(periods) {
  const flags = [], seen = {};
  const push = t => { if (!seen[t]) { seen[t] = 1; flags.push(t); } };
  periods.forEach(p => {
    const s = (p.shortForecast || '').toLowerCase();
    const pop = p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value;
    if (/snow|flurr|squall/.test(s)) push('❄️ snow');
    if (/freezing|sleet|\bice\b|icy/.test(s) || (p.temperature <= 32 && pop != null && pop >= 30)) push('🧊 ice risk');
    if (/fog/.test(s)) push('🌫️ fog');
    if (/heavy rain|downpour/.test(s) || (pop != null && pop >= 80 && /rain/.test(s))) push('🌧️ heavy rain');
    if (/thunder/.test(s)) push('⛈️ thunderstorms');
  });
  return flags;
}
async function loadRouteAhead() {
  const body = $('routeahead-body');
  if (!body) return;
  const blocks = await Promise.all(CORRIDOR_POINTS.map(async pt => {
    try {
      if (!routeHourlyCache[pt.name]) {
        const pts = await getJSON('https://api.weather.gov/points/'
          + pt.lat.toFixed(4) + ',' + pt.lon.toFixed(4));
        routeHourlyCache[pt.name] = pts.properties.forecastHourly;
      }
      const fc = await getJSON(routeHourlyCache[pt.name]);
      const now = Date.now();
      const periods = (fc.properties.periods || [])
        .filter(p => new Date(p.endTime) > now).slice(0, 8);
      if (!periods.length) throw new Error('no hourly periods');
      const flags = wxFlags(periods);
      return '<div class="ra-town"><div class="ra-town-name">' + esc(pt.name) + '</div>'
        + '<div class="ra-strip">' + periods.map(p =>
            '<div class="ra-chip"><div class="ra-hour">' + esc(fmtTime(new Date(p.startTime))) + '</div>'
            + '<div class="ra-temp">' + p.temperature + '°' + esc(p.temperatureUnit) + '</div>'
            + '<div class="ra-wx">' + esc(p.shortForecast) + '</div>'
            + (p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value != null
                ? '<div class="ra-pop">💧 ' + p.probabilityOfPrecipitation.value + '%</div>' : '')
            + '</div>').join('') + '</div>'
        + (flags.length
            ? '<div class="ra-flags">Watch for: ' + esc(flags.join(' · ')) + '</div>'
            : '<div class="ra-flags ra-clear">Nothing flagged for ice, fog, or snow in this window.</div>')
        + '</div>';
    } catch (e) {
      return '<div class="ra-town"><div class="ra-town-name">' + esc(pt.name) + '</div>'
        + '<p class="fallback">Hourly forecast unavailable for this point right now.</p></div>';
    }
  }));
  body.innerHTML = blocks.join('');
}

/* ---------- the Bend run (build batch 2026-11-04, Travis's add) ----------
   Pass cameras + incidents come from the fetcher's passes.json (fast
   lane); the summit weather is keyless NWS hourly, fetched client-side
   like the rest of the page's weather. The card's one job, in Travis's
   words: knowing if there's snow over the pass. */
const PASS_POINTS = {
  govcamp: { label: 'Government Camp', lat: 45.3492, lon: -121.7728 },
  santiam: { label: 'Santiam Pass summit', lat: 44.4237, lon: -121.7868 }
};
const passHourlyCache = {};
async function loadBend() {
  const body = $('bend-body');
  if (!body) return;
  let snap = null;
  try { snap = await getSnapshot('passes.json'); } catch (e) { /* handled below */ }
  if (snap) setSnapUpdated('bend-updated', snap.fetched_at);
  const areas = (snap && snap.areas) || [];
  if (!areas.length) {
    body.innerHTML = '<p class="status-note">🏔️ Pass conditions ride the fetcher\'s ODOT snapshot — if this note sticks around, that snapshot didn\'t load.</p>';
    return;
  }
  const bust = encodeURIComponent((snap && snap.fetched_at) || 'live');
  const src = u => esc(u + (u.indexOf('?') >= 0 ? '&' : '?') + 'snap=' + bust);
  const blocks = await Promise.all(areas.map(async area => {
    let wx = '';
    const pt = PASS_POINTS[area.id];
    if (pt) {
      try {
        if (!passHourlyCache[area.id]) {
          const pts = await getJSON('https://api.weather.gov/points/'
            + pt.lat.toFixed(4) + ',' + pt.lon.toFixed(4));
          passHourlyCache[area.id] = pts.properties.forecastHourly;
        }
        const fc = await getJSON(passHourlyCache[area.id]);
        const now = Date.now();
        const periods = (fc.properties.periods || [])
          .filter(p => new Date(p.endTime) > now).slice(0, 12);
        if (periods.length) {
          const cur = periods[0];
          const flags = wxFlags(periods);
          wx = '<p class="bend-wx">🌡️ At the pass now: <strong>' + cur.temperature + '°'
            + esc(cur.temperatureUnit) + ', ' + esc(cur.shortForecast) + '</strong>'
            + (flags.length
                ? ' · Next 12 hours — watch for ' + esc(flags.join(' · '))
                : ' · No snow or ice flagged in the next 12 hours')
            + ' <span class="river-sub">(NWS forecast for ' + esc(pt.label) + ')</span></p>';
        }
      } catch (e) { /* the weather line is a bonus; cameras + incidents still render */ }
    }
    const inc = (area.incidents || []).map(incidentRow).join('');
    const camFig = (c, lead) =>
      '<figure class="camera-fig' + (lead ? ' bend-lead' : '') + '">'
      + (c.image_url ? '<img loading="lazy" src="' + src(c.image_url) + '" alt="Pass camera: ' + esc(c.name) + '" onerror="this.parentNode.classList.add(\'cam-dead\');this.remove();">' : '')
      + '<figcaption>' + esc(c.name)
      + (lead ? '<span class="cam-dist">' + c.__distMi.toFixed(1) + ' mi from the summit</span>' : '')
      + '</figcaption></figure>';
    /* v6: the Mt. Hood section leads with its SUMMIT PAIR — the two
       Government Camp cameras nearest the pass summit anchor the code
       already defines (PASS_POINTS.govcamp), shown large. Selection is
       computed, never hand-picked: haversine distance from the anchor
       to each camera's own lat/lon in this same snapshot; the two
       smallest distances lead and leave the strip, the rest of the
       cameras follow below as before. Cameras without coordinates in
       the snapshot simply stay in the strip. */
    let featured = '';
    let stripCams = area.cameras || [];
    if (area.id === 'govcamp' && pt && stripCams.length > 2) {
      const R = 3958.8, rad = Math.PI / 180;
      const scored = stripCams.map(c => {
        if (typeof c.lat !== 'number' || typeof c.lon !== 'number') return { c, d: Infinity };
        const dp = (c.lat - pt.lat) * rad, dl = (c.lon - pt.lon) * rad;
        const h = Math.pow(Math.sin(dp / 2), 2)
          + Math.cos(pt.lat * rad) * Math.cos(c.lat * rad) * Math.pow(Math.sin(dl / 2), 2);
        return { c, d: 2 * R * Math.asin(Math.sqrt(h)) };
      }).sort((a, b) => a.d - b.d);
      const lead = scored.slice(0, 2).filter(s => isFinite(s.d));
      if (lead.length === 2) {
        lead.forEach(s => { s.c.__distMi = s.d; });
        const leadSet = new Set(lead.map(s => s.c));
        featured = '<p class="bend-summit-note">📍 Closest to the summit — the two Government Camp cameras nearest the pass, shown large. The rest follow below.</p>'
          + '<div class="bend-featured">' + lead.map(s => camFig(s.c, true)).join('') + '</div>';
        stripCams = stripCams.filter(c => !leadSet.has(c));
      }
    }
    const cams = stripCams.length
      ? '<div class="route-strip">' + stripCams.map(c => camFig(c, false)).join('') + '</div>'
      : '';
    return '<div class="bend-area"><h3 class="subhead">' + esc(area.name) + '</h3>' + wx
      + featured
      + (inc || '<p class="no-alerts">✅ No ODOT incidents reported on this stretch in the latest snapshot.</p>')
      + cams + '</div>';
  }));
  body.innerHTML = blocks.join('');
}

/* ---------- fish counts + salmon tracker (2026-11-04) ----------
   Counts are facts: U.S. Army Corps of Engineers dam counts via the
   Fish Passage Center (latest day + season totals) and DART (the daily
   series), snapshotted by the fetcher into fish.json. The tracker is an
   estimation model built on those counts and nothing else: wave windows
   use the pace band the 2026 season itself measured (fish.json "model"
   carries the basis text the card prints), steelhead are never
   projected because their dam-to-dam travel failed that same check,
   and every projected element is worded as the estimate it is. */
const FISH_TOWNS = [
  { name: 'Clatskanie', rm: 49 }, { name: 'Rainier', rm: 67 },
  { name: 'Columbia City', rm: 82 }, { name: 'St. Helens', rm: 86 },
  { name: 'Scappoose', rm: 96 }
];
const DAY_MS = 86400000;
function isoDay(isoStr) {
  const p = String(isoStr).split('-');
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12)); // UTC noon: PT-safe
}
function ptTodayDate() {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  return isoDay(s);
}
const fmtMD = d => new Intl.DateTimeFormat('en-US',
  { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(d);
function winText(a, b) {
  return fmtMD(a) === fmtMD(b) ? fmtMD(a) : fmtMD(a) + '–' + fmtMD(b);
}
const FISH_SP_LABEL = { chinook: 'Chinook', coho: 'Coho',
  steelhead: 'Steelhead', sockeye: 'Sockeye', chum: 'Chum' };
const spLabel = sp => sp === 'coho' ? 'coho' : 'Chinook';
function fishSeries(fish, damId, sp) {
  const daily = (fish.daily || {})[damId] || [];
  let rows = daily.filter(r => r[sp] != null)
    .map(r => [isoDay(r.date), r[sp]]);
  if (!rows.length) {
    const rec = ((fish.dams || {})[damId] || {}).recent_days || [];
    rows = rec.filter(r => (r.counts || {})[sp] != null)
      .map(r => [isoDay(r.date), r.counts[sp]]);
  }
  return rows.sort((a, b) => a[0] - b[0]);
}


/* ----- the counts card ----- */
function fishCountRows(counts) {
  const jackFor = { chinook: 'chinook_jack', coho: 'coho_jack' };
  return ['chinook', 'coho', 'steelhead', 'sockeye', 'chum']
    .filter(sp => counts && counts[sp] != null).map(sp => {
      const j = jackFor[sp] ? counts[jackFor[sp]] : null;
      return '<div class="fish-sp"><span class="fish-sp-name">'
        + FISH_SP_LABEL[sp] + '</span><span class="fish-sp-num">'
        + num(counts[sp]) + '</span>'
        + (j != null && j > 0
            ? '<span class="fish-sp-jack">+' + num(j) + ' jacks</span>' : '')
        + '</div>';
    }).join('');
}
function fishSeasonLine(ytd) {
  if (!ytd) return '';
  const parts = [];
  if (ytd.chinook != null) {
    let s = '<strong>' + num(ytd.chinook) + ' Chinook</strong>';
    const subs = [['fall_chinook', 'fall'], ['spring_chinook', 'spring'],
      ['summer_chinook', 'summer']]
      .filter(([k]) => ytd[k] != null && ytd[k] > 0);
    if (subs.length) {
      s += ' (' + subs.map(([k, l]) => num(ytd[k]) + ' ' + l).join(' · ')
        + ')';
    }
    parts.push(s);
  }
  if (ytd.coho != null) parts.push('<strong>' + num(ytd.coho) + ' coho</strong>');
  if (ytd.steelhead != null) {
    parts.push('<strong>' + num(ytd.steelhead) + ' steelhead</strong>');
  }
  if (ytd.sockeye != null) {
    parts.push('<strong>' + num(ytd.sockeye) + ' sockeye</strong>');
  }
  return parts.length
    ? '<p class="fish-season">Season so far at Bonneville: '
      + parts.join(' · ') + '.</p>'
    : '';
}
function fishLadderLine(fish) {
  const dams = fish.dams || {};
  const parts = [];
  ['TDA', 'JDA'].forEach(id => {
    const d = dams[id];
    if (!d || !d.counts) return;
    const bits = ['chinook', 'coho', 'steelhead']
      .filter(sp => d.counts[sp] != null)
      .map(sp => FISH_SP_LABEL[sp] + ' ' + num(d.counts[sp])).join(' · ');
    parts.push('<strong>' + esc(d.name.replace(' Dam', '')) + '</strong> ('
      + fmtMD(isoDay(d.latest_date)) + '): ' + bits);
  });
  if (!parts.length) return '';
  let lag = '';
  const bon = dams.BON || {}, tda = dams.TDA;
  if (bon.latest_date && tda && tda.latest_date
      && Math.round((isoDay(bon.latest_date) - isoDay(tda.latest_date))
        / DAY_MS) >= 2) {
    lag = ' The Dalles posts a few days behind Bonneville — its video'
      + ' counts are reviewed before they publish.';
  }
  return '<p class="fish-ladder">Up the ladder — ' + parts.join(' &nbsp;·&nbsp; ')
    + '.' + lag + '</p>';
}
const FISH_RUNS = [
  { name: 'Spring Chinook', win: 'Mar – Jun', sp: 'spring_chinook', months: [3, 4, 5, 6] },
  { name: 'Summer Chinook', win: 'mid-Jun – Jul', sp: 'summer_chinook', months: [6, 7] },
  { name: 'Sockeye', win: 'Jun – Jul', sp: 'sockeye', months: [6, 7] },
  { name: 'Fall Chinook', win: 'Aug – Oct', sp: 'fall_chinook', countSp: 'chinook', months: [8, 9, 10], timing: 'fall_chinook' },
  { name: 'Coho', win: 'Aug – Nov', sp: 'coho', months: [8, 9, 10, 11], timing: 'coho' },
  { name: 'Steelhead', win: 'summer + winter runs', sp: 'steelhead', months: [] }
];
function runState(run, fish, month) {
  const bon = (fish.dams || {}).BON || {};
  const ytd = bon.ytd || {};
  const counts = bon.counts || {};
  const latest = counts[run.countSp || run.sp];
  const latestTxt = latest != null && bon.latest_date
    ? num(latest) + ' counted ' + fmtMD(isoDay(bon.latest_date)) : null;
  const timing = run.timing && fish.timing && fish.timing.by_species
    ? fish.timing.by_species[run.timing] : null;
  if (run.sp === 'steelhead') {
    return 'Two runs a year (summer + winter) — counted, not wave-tracked:'
      + ' their dam-to-dam travel was too erratic to project honestly'
      + ' (see the Tracker).'
      + (latestTxt ? ' Latest at Bonneville: ' + latestTxt + '.' : '');
  }
  if (run.months.indexOf(month) >= 0) {
    let s = 'In its typical window now.';
    if (timing) {
      s += ' In a typical year ~' + timing.pct_past_typical
        + '% of this run has passed Bonneville by now (' + timing.years + ').';
    }
    if (latestTxt) s += ' Latest at Bonneville: ' + latestTxt + '.';
    return s;
  }
  if (timing && latest != null && latest > 0) {
    return 'Winding down — in a typical year ~' + timing.pct_past_typical
      + '% of this run has passed Bonneville by now (' + timing.years
      + '), and the tail is still moving: ' + latestTxt + ' at Bonneville.';
  }
  if (ytd[run.sp] != null) {
    return 'Done for this year — ' + num(ytd[run.sp])
      + ' past Bonneville for the season.';
  }
  return 'Outside its typical window.';
}

/* ----- the tracker ----- */
function waveTownWindow(waveDate, rm, slow, fast) {
  const dist = 146 - rm;
  return [new Date(waveDate.getTime() - Math.ceil(dist / slow) * DAY_MS),
          new Date(waveDate.getTime() - Math.floor(dist / fast) * DAY_MS)];
}
function waveDamWindow(waveDate, damRm, slow, fast) {
  const dist = damRm - 146;
  return [new Date(waveDate.getTime() + Math.ceil(dist / fast) * DAY_MS),
          new Date(waveDate.getTime() + Math.ceil(dist / slow) * DAY_MS)];
}
/* ----- the likelihood surface: counted waves + run bodies, 5-mi bins -----
   Each bin's score is the strongest signal in it: a counted wave's kernel
   (crisp near its anchor dam, widening as it travels — uncertainty grows
   honestly) or an active run's body through the lower river. A bin with
   no signal stays gray: "the counts say nothing here," never "no fish." */
const HEAT_BIN_MI = 5, HEAT_MAX_RM = 230;
const HEAT_COLORS = ['#fdeeda', '#fbd9a8', '#f5b74d', '#ee8f2e', '#c2540a'];
const HEAT_WORDS = ['a few fish around', 'some fish moving through',
  'fish likely here', 'a strong push likely here',
  'hot — fish likely here now'];
function heatBucket(score) {
  if (!(score > 0.02)) return -1;
  return Math.min(4, Math.floor(score * 5));
}
const RUN_BASELINES = [
  { sp: 'spring_chinook', label: 'spring Chinook', div: 900, months: [3, 4, 5, 6] },
  { sp: 'summer_chinook', label: 'summer Chinook', div: 900, months: [6, 7] },
  { sp: 'sockeye', label: 'sockeye', div: 1600, months: [6, 7] },
  { sp: 'chinook', label: 'fall Chinook', div: 1200, months: [8, 9, 10, 11], timing: 'fall_chinook' },
  { sp: 'coho', label: 'coho', div: 450, months: [8, 9, 10, 11, 12], timing: 'coho' }
];
function runTrend(fish, sp) {
  const rows = fishSeries(fish, 'BON', sp);
  if (!rows.length) return null;
  const avg = a => a.reduce((s, r) => s + r[1], 0) / a.length;
  const a3 = avg(rows.slice(-3));
  const prev3 = rows.slice(-6, -3);
  let word = 'holding steady';
  if (prev3.length === 3) {
    const p3 = avg(prev3);
    if (p3 > 0 && a3 >= p3 * 1.25) word = 'building';
    else if (p3 > 0 && a3 <= p3 * 0.8) word = 'tapering off';
  }
  return { avg3: a3, latest: rows[rows.length - 1][1],
    latestDate: rows[rows.length - 1][0], word };
}
function heatModel(fish, dayOffset) {
  const nBins = HEAT_MAX_RM / HEAT_BIN_MI;
  const scores = new Array(nBins).fill(0);
  const target = new Date(ptTodayDate().getTime()
    + (dayOffset || 0) * DAY_MS);
  const month = target.getUTCMonth() + 1;
  const pace = (fish.model || {}).pace_mi_per_day || [13, 26];
  const mid = (pace[0] + pace[1]) / 2, spread = (pace[1] - pace[0]) / 2;
  (fish.waves || []).forEach(w => {
    const dt = Math.round((target - isoDay(w.date)) / DAY_MS);
    if (dt < 0) return;
    const center = 146 + mid * dt;
    const halfW = Math.max(9, spread * dt);
    const weight = Math.min(1, w.count / 2500);
    for (let i = 0; i < nBins; i++) {
      const rm = i * HEAT_BIN_MI + HEAT_BIN_MI / 2;
      const k = Math.max(0, 1 - Math.abs(rm - center) / halfW) * weight;
      if (k > scores[i]) scores[i] = k;
    }
  });
  const timing = (fish.timing || {}).by_species || {};
  const runs = [];
  RUN_BASELINES.forEach(rb => {
    if (rb.months.indexOf(month) < 0) return;
    const tr = runTrend(fish, rb.sp);
    if (!tr || tr.avg3 < 5) return;
    let inten = Math.min(0.8, tr.avg3 / rb.div);
    const t = rb.timing ? timing[rb.timing] : null;
    if (t && t.pct_past_typical >= 97) inten *= 0.5;
    else if (t && t.pct_past_typical >= 90) inten *= 0.75;
    if (inten <= 0.02) return;
    runs.push({ label: rb.label, sp: rb.sp, inten, trend: tr, timing: t });
    for (let i = 0; i < nBins; i++) {
      const rm = i * HEAT_BIN_MI + HEAT_BIN_MI / 2;
      let v = 0;
      if (rm >= 5 && rm <= 146) v = inten;
      else if (rm > 146 && rm <= 216) v = inten * 0.35;
      else if (rm < 5) v = inten * 0.5;
      if (v > scores[i]) scores[i] = v;
    }
  });
  runs.sort((a, b) => b.inten - a.inten);
  return {
    scores, runs, driver: runs.length ? runs[0] : null,
    homeScore(rm) {
      let sum = 0, n = 0;
      for (let i = 0; i < nBins; i++) {
        const c = i * HEAT_BIN_MI + HEAT_BIN_MI / 2;
        if (Math.abs(c - rm) <= 12) { sum += scores[i]; n++; }
      }
      return n ? sum / n : 0;
    }
  };
}
function verdictHTML(fish, model) {
  const townName = (homeTown && homeTown.name) || 'St. Helens';
  const tref = TOWN_RIVER[townName] || TOWN_RIVER['St. Helens'];
  const hs = model.homeScore(tref.rm);
  const rating = hs >= 0.45 ? 'GOOD' : hs >= 0.18 ? 'FAIR' : 'SLOW';
  const d = model.driver;
  let clause;
  if (d && rating !== 'SLOW') {
    clause = 'the ' + d.label + ' run is the story — ' + num(d.trend.latest)
      + ' counted at Bonneville on ' + fmtMD(d.trend.latestDate)
      + ', about ' + num(Math.round(d.trend.avg3)) + ' a day lately, '
      + d.trend.word + '.';
  } else if (d) {
    clause = 'very little is moving — the latest ' + d.label
      + ' count was ' + num(d.trend.latest) + ' at Bonneville on '
      + fmtMD(d.trend.latestDate) + '.';
  } else {
    clause = 'no run is moving right now that the dam counts can see.';
  }
  let html = '<div class="verdict"><span class="verdict-pill pill-'
    + rating.toLowerCase() + '">' + rating + '</span>'
    + '<p class="verdict-text">Fishing below <strong>' + esc(tref.at)
    + '</strong> today: ' + clause + '</p></div>';
  if (rating !== 'GOOD'
      && heatModel(fish, 1).homeScore(tref.rm) >= 0.45) {
    html += '<p class="verdict-tomorrow">Tomorrow looks better on your'
      + ' stretch — the same math puts it at GOOD.</p>';
  }
  return html;
}
function whyHTML(fish, model, slow, fast) {
  const bon = (fish.dams || {}).BON || {};
  const parts = [];
  if (bon.counts && bon.latest_date) {
    const bits = ['chinook', 'coho', 'steelhead']
      .filter(sp => bon.counts[sp] != null)
      .map(sp => num(bon.counts[sp]) + ' '
        + FISH_SP_LABEL[sp].toLowerCase());
    if (bits.length) {
      parts.push('On ' + fmtDay(isoDay(bon.latest_date))
        + ', Bonneville counted ' + bits.join(', ') + '.');
    }
  }
  const d = model.driver;
  if (d) {
    parts.push('The ' + d.label + ' run drives the call: about '
      + num(Math.round(d.trend.avg3))
      + ' a day over the last three counted days, ' + d.trend.word + '.');
    if (d.timing) {
      parts.push('Season clock: in a typical year ~'
        + d.timing.pct_past_typical + '% of the ' + d.label
        + ' run has passed Bonneville by now (' + d.timing.years + ').');
    }
  }
  const w = (fish.waves || [])[0];
  if (w) {
    const wd = isoDay(w.date);
    const sh = waveTownWindow(wd, 86, slow, fast);
    parts.push('The biggest recent surge: ' + num(w.count) + ' '
      + spLabel(w.species) + ' counted at Bonneville on ' + fmtDay(wd)
      + ' — at the measured pace it passed St. Helens about '
      + winText(sh[0], sh[1]) + '.');
  }
  parts.push('The pace is measured, not guessed: in 2026\'s own counts,'
    + ' surges took about 2 days from Bonneville to The Dalles and 3 to'
    + ' John Day — inside the published 13–26 miles a day for Columbia'
    + ' Chinook.');
  let basis = '';
  const bm = fish.model || {};
  if (bm.basis) {
    basis = '<p>How these estimates are made: a “wave” is a day whose'
      + ' Bonneville count is at least twice the median of the 14 days'
      + ' before it, and at least 100 fish. ' + esc(bm.basis)
      + ' Positions are bands, never points — a real school spreads'
      + ' over miles and days.</p>';
  }
  return '<details class="why-box"><summary>Why this call? — the counts'
    + ' behind it</summary><p>This call is an estimate built from the'
    + ' dam counts on the card above — where the runs are, at the pace'
    + ' this year’s counts actually measured. Counted numbers are'
    + ' facts; positions and ratings are the honest math between'
    + ' them.</p><p>' + parts.join(' ') + '</p>' + basis + '</details>';
}
function renderSalmonLayer(model) {
  if (!salmonLayer || typeof L === 'undefined'
      || typeof salmonLayer.clearLayers !== 'function'
      || typeof L.polyline !== 'function') return;
  salmonLayer.clearLayers();
  for (let i = 0; i < RIVER_LINE.length - 1; i++) {
    const a = RIVER_LINE[i], b = RIVER_LINE[i + 1];
    const midRM = (a[2] + b[2]) / 2;
    const s = model.scores[Math.floor(midRM / HEAT_BIN_MI)] || 0;
    const bk = heatBucket(s);
    if (bk < 0) continue;
    L.polyline([[a[0], a[1]], [b[0], b[1]]],
      { color: HEAT_COLORS[bk], weight: 7, opacity: 0.85 })
      .addTo(salmonLayer)
      .bindPopup('<strong>River miles ~' + a[2] + '–' + b[2]
        + ':</strong> ' + HEAT_WORDS[bk]
        + ' (estimate)<br>From today\'s dam counts — the Salmon Tracker'
        + ' card in Outdoors shows the work.');
  }
}
function heatStripHTML(model) {
  const pct = rm => (rm / HEAT_MAX_RM * 100).toFixed(1) + '%';
  let bins = '';
  model.scores.forEach(s => {
    const b = heatBucket(s);
    bins += '<span class="heat-bin" style="background:'
      + (b < 0 ? '#dde3ea' : HEAT_COLORS[b]) + '"></span>';
  });
  /* Positions under the strip are bare ticks — the five towns and the
     three dams. Text is limited to three anchors that cannot crowd
     each other: Ocean (left edge), Bonneville Dam, John Day. The old
     two-row town labels collided into mush at phone width; now the
     county stretch carries the only other words, as one zone label
     above the strip. fitHeatLabels() below enforces the no-overlap
     rule mechanically after every render. */
  let ticks = '';
  FISH_TOWNS.forEach(t => {
    ticks += '<span class="heat-tick" style="left:' + pct(t.rm)
      + '"></span>';
  });
  [146, 192, 216].forEach(rm => {
    ticks += '<span class="heat-tick tick-dam" style="left:' + pct(rm)
      + '"></span>';
  });
  const anchors =
      '<span class="heat-anchor a-l" style="left:0">Ocean</span>'
    + '<span class="heat-anchor a-c" style="left:' + pct(146)
    + '">Bonneville Dam <span class="a-rm">· 146</span></span>'
    + '<span class="heat-anchor a-r" style="left:' + pct(216)
    + '">John Day <span class="a-rm">· 216</span></span>';
  return '<div class="heat-wrap">'
    + '<div class="heat-zone"><span style="left:' + pct(72)
    + '">Columbia County · RM 44–100</span></div>'
    + '<div class="heat-box"><div class="heat-county" style="left:'
    + pct(44) + ';width:' + pct(100 - 44) + '"></div>'
    + '<div class="heat-row">' + bins + '</div>'
    + '<div class="heat-ticks">' + ticks + '</div></div>'
    + '<div class="heat-anchors">' + anchors + '</div></div>'
    + '<p class="heat-legend"><span class="lg" style="background:#c2540a">'
    + '</span>Strong · <span class="lg" style="background:#f5b74d">'
    + '</span>Some · <span class="lg" style="background:#fdeeda"></span>'
    + 'A few · <span class="lg" style="background:#dde3ea"></span>'
    + 'No signal</p>'
    + '<p class="track-caption">Estimated from today’s dam counts, by'
    + ' river mile. Gray means no signal from the counts — not that'
    + ' the water is empty.</p>';
}
/* The no-overlap rule, enforced mechanically: once the strip is in
   the page, measure the three anchor labels (2D — labels on separate
   lines cannot clash). If any pair overlaps, first drop John Day to
   its own line (.split, suffixes kept); then shed the river-mile
   suffixes (.no-rm); only then drop to ticks only (.no-labels). At
   360px the one-line labels collide by ~55px and even the bare names
   by ~11px — both measured on the live page — while the split layout
   fits outright. The check runs after render, on resize, and when
   the Outdoors view is shown (the strip renders inside a hidden view
   on most visits, where there is no layout to measure). In the
   mini-DOM harness there is no layout — the guard simply returns. */
function fitHeatLabels() {
  const row = document.querySelector('.heat-anchors');
  if (!row || typeof row.getBoundingClientRect !== 'function') return;
  const labels = Array.prototype.slice.call(
    row.querySelectorAll('.heat-anchor'));
  if (labels.length < 2) return;
  const overlaps = () => {
    const rects = labels.map(el => el.getBoundingClientRect());
    if (rects.some(r => !r.width)) return null; // no layout — bail
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        if (rects[i].left < rects[j].right - 2
            && rects[j].left < rects[i].right - 2
            && rects[i].top < rects[j].bottom - 2
            && rects[j].top < rects[i].bottom - 2) return true;
      }
    }
    return false;
  };
  row.classList.remove('no-labels');
  row.classList.remove('no-rm');
  row.classList.remove('split');
  let o = overlaps();
  if (o === null) return;
  if (o) { row.classList.add('split'); o = overlaps(); }
  if (o) { row.classList.add('no-rm'); o = overlaps(); }
  if (o) row.classList.add('no-labels');
}
let heatFitTimer = null;
window.addEventListener('resize', () => {
  if (heatFitTimer) return;
  heatFitTimer = setTimeout(() => {
    heatFitTimer = null; fitHeatLabels();
  }, 150);
});
function waveList(fish, slow, fast) {
  const waves = (fish.waves || []).slice(0, 4);
  if (!waves.length) {
    return '<p class="status-note">No distinct surge in the last 45 days'
      + ' of Bonneville counts — lately the runs have moved as a'
      + ' trickle, not in waves. The next surge day (a count at least'
      + ' twice the recent two-week median) will appear here with its'
      + ' estimated windows.</p>';
  }
  const today = ptTodayDate();
  const items = waves.map(w => {
    const wd = isoDay(w.date);
    const sh = waveTownWindow(wd, 86, slow, fast);
    const ra = waveTownWindow(wd, 67, slow, fast);
    const tda = waveDamWindow(wd, 192, slow, fast);
    const jda = waveDamWindow(wd, 216, slow, fast);
    const dt = Math.round((today - wd) / DAY_MS);
    const lo = 146 + slow * dt, hi = 146 + fast * dt;
    let nowTxt;
    if (dt === 0) nowTxt = 'It is at Bonneville today.';
    else if (hi < 192) nowTxt = 'Today it is estimated between Bonneville and The Dalles.';
    else if (lo < 192) nowTxt = 'Today it is estimated around The Dalles.';
    else if (hi < 216) nowTxt = 'Today it is estimated between The Dalles and John Day.';
    else if (lo < 216) nowTxt = 'Today it is estimated around John Day.';
    else nowTxt = 'By now it is estimated past John Day.';
    return '<li><strong>' + spLabel(w.species) + ' wave — ' + num(w.count)
      + ' counted at Bonneville on ' + fmtDay(wd) + '.</strong><br>'
      + 'Estimated past St. Helens ' + winText(sh[0], sh[1])
      + ' · past Rainier ' + winText(ra[0], ra[1]) + '<br>'
      + 'At The Dalles about ' + winText(tda[0], tda[1])
      + ' · John Day about ' + winText(jda[0], jda[1]) + '. ' + nowTxt
      + '</li>';
  });
  return '<ul class="wave-list">' + items.join('') + '</ul>';
}
/* ----- the river's current: the quadrant's engine -----
   NOAA CO-OPS publishes real tidal CURRENT predictions, but only
   two stations serve the county reach — PCT1251 Walker Island
   (~RM 64) and PCT1231 Cathlamet Channel (~RM 38). Walker Island
   is the reference the fishing quadrant's tide axis reads. If
   CO-OPS doesn't answer, loadCurrents falls back to an estimate
   synthesized from the St. Helens tide curve the tides card
   already loads — and says so. (The day-plan card and the
   "Worth Going?" chooser that also drank from this feed were
   retired 2026-11-11 — Travis: no fill-in widgets, the square
   only.) */
const CURRENT_STATION = { id: 'PCT1251',
  label: 'Walker Island, below Rainier (river mile ~64)' };
let currentEvents = null; // [{t: epoch ms, vel: knots, + flood / - ebb}]
let currentMode = null;   // 'noaa' | 'tidecurve'
function currentsUrl() {
  const parts = todayStrPT().split('-').map(Number);
  const base = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  return 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter'
    + '?begin_date=' + tideYmd(base - DAY_MS)
    + '&end_date=' + tideYmd(base + 6 * DAY_MS)
    + '&station=' + CURRENT_STATION.id
    + '&product=currents_predictions&datum=MLLW&time_zone=lst_ldt'
    + '&interval=MAX_SLACK&units=english'
    + '&application=columbiacountylive&format=json';
}
function interpVel(events, t) {
  if (!events || !events.length) return 0;
  if (t <= events[0].t) return events[0].vel;
  if (t >= events[events.length - 1].t) {
    return events[events.length - 1].vel;
  }
  for (let i = 0; i < events.length - 1; i++) {
    const a = events[i], b = events[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = (t - a.t) / Math.max(1, b.t - a.t);
      return a.vel + (b.vel - a.vel) * f;
    }
  }
  return 0;
}
function ptDayStr(offset) {
  const d = new Date(ptTodayDate().getTime() + (offset || 0) * DAY_MS);
  const p = n => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-'
    + p(d.getUTCDate());
}
/* ----- the fishing call: one square, four ways to fish -----
   Travis's redesign (2026-11-11): no method picker, no remembered
   settings, nothing to fill in — pick a day and read the dot.
   The square: further right = stronger tide push, higher up =
   rougher weather. Corners: strong push + calm = Anchoring;
   strong push + rough = Trolling; slack + rough = Plunking;
   slack + calm = Bank steelhead. X comes from the same NOAA
   Walker Island current predictions the day plan always used
   (peak + mean |current| across the 5 AM–8 PM fishing day);
   Y comes from the NWS daily forecast for St. Helens (wind,
   gusts, rain chance). The why-line quotes the real numbers,
   and the small ghost dots are the days either side. */
let quadDay = 0;
let quadWx = null;        // { 'YYYY-MM-DD': {wind, gust, pop, short} }
let quadWxState = 'idle'; // idle | loading | done | failed
function quadClamp01(v) { return Math.max(0, Math.min(1, v)); }
function quadTideX(offset) {
  const dayStr = ptDayStr(offset);
  let peak = 0, sum = 0, n = 0;
  for (let mins = 300; mins < 1200; mins += 30) {
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    const t = tideInstant(dayStr + ' ' + hh + ':' + mm);
    const v = Math.abs(interpVel(currentEvents, t + 15 * 60000));
    if (v > peak) peak = v;
    sum += v; n++;
  }
  const mean = n ? sum / n : 0;
  return { x: quadClamp01((0.55 * peak + 0.45 * mean) / 1.05),
    peak: peak, mean: mean };
}
function quadWeather(dayStr) {
  if (!quadWx || !quadWx[dayStr]) return null;
  const w = quadWx[dayStr];
  const rough = quadClamp01(0.40 * ((w.gust || w.wind || 0) / 34)
    + 0.30 * ((w.wind || 0) / 24) + 0.30 * ((w.pop || 0) / 100));
  return { rough: rough, w: w };
}
async function loadQuadWx() {
  if (quadWxState === 'loading' || quadWxState === 'done') return;
  quadWxState = 'loading';
  try {
    const town = TOWNS[0]; // St. Helens
    if (!forecastUrlCache[town.name]) {
      const pts = await getJSON('https://api.weather.gov/points/'
        + town.lat.toFixed(4) + ',' + town.lon.toFixed(4));
      forecastUrlCache[town.name] = pts.properties.forecast;
    }
    const fc = await getJSON(forecastUrlCache[town.name]);
    const map = {};
    (fc.properties.periods || []).forEach(p => {
      if (!p.isDaytime) return;
      const nums = String(p.windSpeed || '').match(/\d+/g) || [];
      const wind = nums.length
        ? Math.max.apply(null, nums.map(Number)) : 0;
      const gnums = String(p.windGust || '').match(/\d+/g) || [];
      const gust = gnums.length
        ? Math.max.apply(null, gnums.map(Number)) : wind;
      map[String(p.startTime).slice(0, 10)] = {
        wind: wind, gust: gust,
        pop: (p.probabilityOfPrecipitation
          && p.probabilityOfPrecipitation.value) || 0,
        short: p.shortForecast || '' };
    });
    quadWx = map;
    quadWxState = 'done';
  } catch (e) { quadWxState = 'failed'; }
  renderDayPlan();
}
const QUAD_CORNERS = {
  anchor: { name: 'Anchoring', cls: 'qc-br', icon: 'preview-icon-anchor.jpg',
    line: 'Anchor up and let the push work your gear.' },
  troll: { name: 'Trolling', cls: 'qc-tr', icon: 'preview-icon-troll.jpg',
    line: 'Too rough to sit still — keep moving and troll through it.' },
  plunk: { name: 'Plunking', cls: 'qc-tl', icon: 'preview-icon-plunk.jpg',
    line: 'Bank weather — plunk it with enough lead to hold bottom.' },
  steel: { name: 'Bank steelhead', cls: 'qc-bl', icon: 'preview-icon-steel.jpg',
    line: 'Soft water — work the bank and the creeks.' }
};
function quadCall(x, rough) {
  if (x >= 0.5) return rough >= 0.5 ? 'troll' : 'anchor';
  return rough >= 0.5 ? 'plunk' : 'steel';
}
function quadDayLabel(offset) {
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  try {
    return new Intl.DateTimeFormat('en-US',
      { weekday: 'long', timeZone: 'America/Los_Angeles' })
      .format(new Date(tideInstant(ptDayStr(offset) + ' 12:00')));
  } catch (e) { return 'Day +' + offset; }
}
function renderDayPlan() {
  const body = $('dayplan-body');
  if (!body) return;
  if (!currentEvents) {
    body.innerHTML = '<p class="status-note">🌊 The current predictions'
      + ' didn\'t load — no fishing call right now. The tide card above'
      + ' still shows the turns, and slack water is dead time for'
      + ' plunking and wobblers either way.</p>';
    return;
  }
  if (quadWxState === 'idle') loadQuadWx();
  const chips = [0, 1, 2, 3, 4].map(o =>
    '<button type="button" class="plan-chip'
    + (quadDay === o ? ' active' : '') + '" data-qday="' + o + '">'
    + (o === 0 ? 'Today' : quadDayLabel(o).slice(0, 3)) + '</button>'
  ).join('');
  const t = quadTideX(quadDay);
  const wq = quadWeather(ptDayStr(quadDay));
  const rough = wq ? wq.rough : 0.5;
  const call = quadCall(t.x, rough);
  const disp = v => (6 + v * 88).toFixed(1); // keep the dot off the edges
  let ghosts = '';
  [quadDay - 1, quadDay + 1].forEach(o => {
    if (o < 0 || o > 4) return;
    const gw = quadWeather(ptDayStr(o));
    if (!gw) return;
    const gx = quadTideX(o).x;
    ghosts += '<span class="quad-ghost" style="left:' + disp(gx)
      + '%;bottom:' + disp(gw.rough) + '%"></span>';
  });
  const corners = Object.keys(QUAD_CORNERS).map(k =>
    '<span class="quad-corner ' + QUAD_CORNERS[k].cls
    + (k === call ? ' on' : '') + '"><img class="quad-ico" src="'
    + QUAD_CORNERS[k].icon + '" alt="" aria-hidden="true" loading="lazy">'
    + '<span>' + QUAD_CORNERS[k].name + '</span></span>'
  ).join('');
  const quad = '<div class="quad" role="img" aria-label="Fishing call'
    + ' chart: the dot leans toward ' + QUAD_CORNERS[call].name
    + ' for ' + quadDayLabel(quadDay) + '">'
    + '<span class="quad-axis-y">rougher weather &uarr;</span>'
    + corners + ghosts
    + '<span class="quad-dot" style="left:' + disp(t.x) + '%;bottom:'
    + disp(rough) + '%"></span></div>'
    + '<p class="quad-axis-x">&larr; slack water &middot; tide push'
    + ' &middot; strong push &rarr;</p>';
  const tidePhrase = t.peak >= 0.9
      ? 'a hard push (peak ' + t.peak.toFixed(1) + ' kn)'
    : t.peak >= 0.55
      ? 'a working push (peak ' + t.peak.toFixed(1) + ' kn)'
    : t.peak >= 0.3
      ? 'a gentle push (peak ' + t.peak.toFixed(1) + ' kn)'
    : 'mostly slack water (peak ' + t.peak.toFixed(1) + ' kn)';
  let wxPhrase;
  if (wq) {
    const w = wq.w;
    wxPhrase = rough >= 0.66
      ? 'wind and rain in the forecast (gusts ' + w.gust
        + ' mph, rain ' + w.pop + '%)'
      : rough >= 0.4
      ? 'some weather around (wind ' + w.wind + ' mph, rain '
        + w.pop + '%)'
      : 'calm, settled weather (wind ' + w.wind + ' mph, rain '
        + w.pop + '%)';
  } else {
    wxPhrase = quadWxState === 'failed'
      ? 'the weather feed didn\'t answer, so this call leans on'
        + ' the tide alone'
      : 'the forecast still loading, so this call leans on the'
        + ' tide alone for now';
  }
  const why = '<p class="quad-why">🎣 <strong>' + quadDayLabel(quadDay)
    + ': ' + QUAD_CORNERS[call].name + '.</strong> The river has '
    + tidePhrase + ' at Walker Island, with ' + wxPhrase + ' — '
    + QUAD_CORNERS[call].line + '</p>';
  const src = currentMode === 'noaa'
    ? 'Currents: NOAA predictions for Walker Island (RM ~64), the'
      + ' county\'s lower-river reference. Weather: National Weather'
      + ' Service for St. Helens. A rough guide, not a promise —'
      + ' the river gets the last word.'
    : 'Currents estimated from the St. Helens tide curve — NOAA\'s'
      + ' current station didn\'t answer. Weather: National Weather'
      + ' Service for St. Helens. A rough guide, not a promise.';
  body.innerHTML = '<div class="plan-chips">' + chips + '</div>'
    + quad + why + '<p class="card-note small">' + src + '</p>';
  body.querySelectorAll('[data-qday]').forEach(btn => {
    btn.addEventListener('click', () => {
      quadDay = Number(btn.dataset.qday) || 0;
      renderDayPlan();
    });
  });
}

async function loadCurrents() {
  const body = $('dayplan-body');
  if (!body) return;
  try {
    const d = await getJSON(currentsUrl());
    const cp = (d && d.current_predictions
      && d.current_predictions.cp) || [];
    const ev = cp.map(p => ({ t: tideInstant(p.Time),
        vel: parseFloat(p.Velocity_Major) }))
      .filter(e => !isNaN(e.t) && !isNaN(e.vel))
      .sort((a, b) => a.t - b.t);
    if (ev.length >= 6) {
      currentEvents = ev; currentMode = 'noaa';
      renderDayPlan();
      return;
    }
    throw new Error('thin currents response');
  } catch (e) { /* fall through to the tide-curve estimate */ }
  const preds = tideData['9439201'];
  if (preds && preds.length >= 3) {
    const ev = [];
    preds.forEach((p, i) => {
      ev.push({ t: p.t, vel: 0 });
      const nx = preds[i + 1];
      if (nx) {
        ev.push({ t: (p.t + nx.t) / 2, vel: nx.type === 'L' ? -0.8 : 0.4 });
      }
    });
    currentEvents = ev.sort((a, b) => a.t - b.t);
    currentMode = 'tidecurve';
  }
  renderDayPlan();
}

let fishData = null; // the loaded fish.json, shared with the tracker
async function loadFish() {
  const fbody = $('fish-body'), tbody = $('tracker-body');
  if (!fbody && !tbody) return;
  let fish = null;
  try { fish = await getSnapshot('fish.json'); } catch (e) { /* below */ }
  if (!fish || !fish.dams || !fish.dams.BON) {
    const msg = '<p class="status-note">🐟 The dam counts didn\'t load'
      + ' — the fish snapshot is missing from the latest collection.'
      + ' The counters\' numbers will be back with the next one.</p>';
    if (fbody) fbody.innerHTML = msg;
    if (tbody) tbody.innerHTML = msg;
    return;
  }
  fishData = fish;
  setSnapUpdated('fish-updated', fish.fetched_at);
  setSnapUpdated('tracker-updated', fish.fetched_at);
  const month = ptTodayDate().getUTCMonth() + 1;
  if (fbody) {
    const bon = fish.dams.BON;
    fbody.innerHTML =
      '<h3 class="subhead">Bonneville Dam — counted '
      + fmtDay(isoDay(bon.latest_date)) + '</h3>'
      + '<div class="fish-rows">' + fishCountRows(bon.counts || {}) + '</div>'
      + fishSeasonLine(bon.ytd)
      + fishLadderLine(fish)
      + '<h3 class="subhead">Run timing — what\'s moving, what\'s next</h3>'
      + '<div class="run-rows">' + FISH_RUNS.map(r =>
          '<div class="run-row"><span class="run-name">' + r.name
          + '</span><span class="run-win">' + r.win
          + '</span><span class="run-state">' + runState(r, fish, month)
          + '</span></div>').join('') + '</div>';
  }
  if (tbody) {
    const model = fish.model || { pace_mi_per_day: [13, 26] };
    const slow = model.pace_mi_per_day[0], fast = model.pace_mi_per_day[1];
    const heat = heatModel(fish, 0);
    tbody.innerHTML = verdictHTML(fish, heat)
      + heatStripHTML(heat)
      + whyHTML(fish, heat, slow, fast)
      + '<details class="wave-details"><summary>Wave detail — the'
      + ' counted surges and their windows</summary>'
      + waveList(fish, slow, fast) + '</details>';
    renderSalmonLayer(heat);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(fitHeatLabels);
    }
  }
}

/* ---------- Steelhead Day Index (small rivers) ----------
   Per-river "is it a good day for steelhead?" judged from CONDITIONS —
   never from fish positions. There are no in-season machine-readable
   steelhead counts for these creeks: the hatchery traps (Big Creek, NF
   Klaskanine, Nehalem, Bonnie Falls on NF Scappoose Creek) are counted,
   but the numbers reach the public only as episodic ODFW prose and
   lagged annual PDFs (research: steelhead-tributary-research-2026-11-04
   .md). So the index scores what an angler can honestly check the night
   before: run timing, flow, clarity, cold, and weather.
   Inputs: USGS NWIS gauges fetched live in the browser (Wilson River
   14301500; Nehalem at Foss 14301000 + at Vernonia 14299800, with each
   gauge's typical range for the date from NWIS daily statistics);
   basin rainfall from the fetcher's steelhead.json (NOAA MRMS radar-
   gauge rain averaged over each creek's drainage); the NWS hourly
   forecast for each river's nearest town; first light from the
   almanac's sun math. Model basis (research doc): fish enter on the
   rise and the fishing turns on as the river drops; the falling limb
   is clearer than the rising limb at the same flow; the first big
   storm after a dry spell (first flush) dirties the water longest;
   small creeks clear first (ODFW's published clearing order), so each
   river carries a clearing-speed class. The cold tiers are Travis's
   own practitioner rule — he fishes these rivers: near/below freezing
   the rod guides and line ice up, and below about 28°F the reel
   freezes too and most anglers stay home. No agency is cited for
   those numbers; they are labeled as local knowledge on the card.
   Verdict for TODAY before noon Pacific, TOMORROW after — it is a
   plan-the-trip call, built from the river's state right now plus
   the target day's forecast. */

const SH_RIVERS = [
  { id: 'wilson', name: 'Wilson River', kind: 'gauge', gauge: '14301500',
    gaugeLabel: 'Wilson River gauge (USGS)', hardLowQ: 35,
    basin: 'wilson', tau: 1.3,
    season: [[1201, 1214, 0.45], [1215, 131, 0.8], [201, 331, 1.0], [401, 415, 0.72]],
    window: 'its hatchery and wild fish run January–April, wild peak February–March',
    anchor: { key: 'tillamook', lat: 45.4568, lon: -123.8446 },
    sun: { lat: 45.54, lon: -123.62 } },
  { id: 'nehalem', name: 'Nehalem River', kind: 'gauge', gauge: '14301000',
    gaugeLabel: 'Nehalem River gauge at Foss (USGS)', rainGauge: '14299800',
    basin: 'nehalem', tau: 1.9,
    season: [[1120, 1130, 0.45], [1201, 131, 0.72], [201, 320, 1.0], [321, 410, 0.72]],
    window: 'its wild run peaks February–March, with fish January–April',
    anchor: { key: 'vernonia', lat: 45.8597, lon: -123.1927 },
    sun: { lat: 45.86, lon: -123.19 } },
  { id: 'nf_nehalem', name: 'North Fork Nehalem', kind: 'proxy',
    basin: 'nf_nehalem', tau: 1.3,
    season: [[1110, 1119, 0.45], [1120, 1209, 0.72], [1210, 131, 1.0], [201, 320, 0.72], [321, 331, 0.45]],
    window: 'its hatchery run starts in December; broodstock and wild fish run into March',
    anchor: { key: 'nfnehalem', lat: 46.005, lon: -123.595 },
    sun: { lat: 46.0, lon: -123.6 } },
  { id: 'big_creek', name: 'Big Creek', kind: 'rain',
    basin: 'big_creek', tau: 0.7,
    season: [[1110, 1119, 0.45], [1120, 1209, 0.72], [1210, 131, 1.0], [201, 215, 0.72], [216, 228, 0.45]],
    window: 'it has the region\u2019s earliest hatchery run — fish from December into January',
    anchor: { key: 'knappa', lat: 46.13, lon: -123.60 },
    sun: { lat: 46.14, lon: -123.58 } },
  { id: 'gnat_creek', name: 'Gnat Creek', kind: 'rain',
    basin: 'gnat_creek', tau: 0.7,
    season: [[1115, 1124, 0.45], [1125, 1219, 0.72], [1220, 205, 1.0], [206, 220, 0.72]],
    window: 'its hatchery fish run late December–February',
    anchor: { key: 'knappa', lat: 46.13, lon: -123.60 },
    sun: { lat: 46.12, lon: -123.55 } },
  { id: 'klaskanine', name: 'Klaskanine River', kind: 'rain',
    basin: 'klaskanine', tau: 0.7,
    season: [[1115, 1124, 0.45], [1125, 1219, 0.72], [1220, 205, 1.0], [206, 225, 0.72]],
    window: 'its hatchery fish run late December–February',
    anchor: { key: 'astoria', lat: 46.1879, lon: -123.8310 },
    sun: { lat: 46.10, lon: -123.75 } },
  { id: 'clatskanie', name: 'Clatskanie River', kind: 'rain',
    basin: 'clatskanie', tau: 1.0,
    season: [[1201, 1214, 0.45], [1215, 131, 0.72], [201, 320, 1.0], [321, 331, 0.72]],
    window: 'its wild fish run January–March',
    anchor: { key: 'clatskanie', lat: 46.1035, lon: -123.2038 },
    sun: { lat: 46.10, lon: -123.20 } },
  { id: 'scappoose', name: 'Scappoose Creek', kind: 'rain',
    basin: 'scappoose', tau: 1.0,
    season: [[1201, 1214, 0.45], [1215, 131, 0.72], [201, 320, 1.0], [321, 331, 0.72]],
    window: 'its wild fish run January–March; a trap at Bonnie Falls counts them, but the counts are published only after the season',
    anchor: { key: 'scappoose', lat: 45.7475, lon: -122.8775 },
    sun: { lat: 45.78, lon: -122.90 } },
];

const shState = { fc: {} };
let shByDay = null; // per-day index results, shared with the answer card

function shPtParts(d) {
  const parts = {};
  try {
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).forEach(p => { parts[p.type] = p.value; });
  } catch (e) { /* fall back to local getters below */ }
  if (!parts.year) {
    parts.year = String(d.getFullYear());
    parts.month = String(d.getMonth() + 1).padStart(2, '0');
    parts.day = String(d.getDate()).padStart(2, '0');
    parts.hour = String(d.getHours()).padStart(2, '0');
  }
  return parts;
}

async function shFetchJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/* NWIS instantaneous values (5 days) for the three gauges. */
function shParseIv(j) {
  const out = {};
  ((j && j.value && j.value.timeSeries) || []).forEach(ts => {
    const site = ts.sourceInfo.siteCode[0].value;
    const code = ts.variable.variableCode[0].value;
    const vals = ((ts.values || [])[0] || {}).value || [];
    const series = vals.map(p => ({ t: Date.parse(p.dateTime), v: parseFloat(p.value) }))
      .filter(p => !isNaN(p.t) && !isNaN(p.v) && p.v > -999000);
    if (series.length) { out[site] = out[site] || {}; out[site][code] = series; }
  });
  return out;
}

/* NWIS daily statistics (typical range for the date) per gauge. */
async function shFetchStats() {
  const url = 'https://waterservices.usgs.gov/nwis/stat/?format=rdb'
    + '&sites=14301500,14301000,14299800&parameterCd=00060'
    + '&statTypeCd=p10,p25,p50,p75,p95';
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const lines = (await r.text()).split('\n').filter(l => l && l[0] !== '#');
  const idx = {};
  lines[0].split('\t').forEach((h, i) => { idx[h.trim()] = i; });
  const out = {};
  lines.slice(2).forEach(l => {
    const c = l.split('\t');
    const site = c[idx.site_no];
    const md = (+c[idx.month_nu]) * 100 + (+c[idx.day_nu]);
    if (!site || !md) return;
    const g = name => parseFloat(c[idx[name]]);
    out[site] = out[site] || {};
    out[site][md] = { p10: g('p10_va'), p25: g('p25_va'), p50: g('p50_va'),
                      p75: g('p75_va'), p95: g('p95_va') };
  });
  return out;
}

function shAnalyzeGauge(series, stats, hardLowQ) {
  if (!series || !series.length) return null;
  const nowMs = series[series.length - 1].t;
  const qNow = series[series.length - 1].v;
  const mean = arr => arr.length ? arr.reduce((a, p) => a + p.v, 0) / arr.length : null;
  const last72 = series.filter(p => p.t >= nowMs - 72 * 3600e3);
  let peak = -1, tPeak = 0;
  last72.forEach(p => { if (p.v > peak) { peak = p.v; tPeak = p.t; } });
  const mean3 = mean(series.filter(p => p.t >= nowMs - 3 * 3600e3));
  const meanPrev = mean(series.filter(p => p.t <= nowMs - 21 * 3600e3 && p.t >= nowMs - 27 * 3600e3));
  const hrsSincePeak = peak > 0 ? (nowMs - tPeak) / 3600e3 : 99;
  let state;
  if (peak > 0 && qNow <= 0.93 * peak && hrsSincePeak <= 72) state = 'dropping';
  else if (mean3 != null && meanPrev != null && mean3 > meanPrev * 1.12) state = 'rising';
  else if (mean3 != null && meanPrev != null && mean3 < meanPrev * 0.88) state = 'dropping';
  else state = (peak > 0 && qNow > 0.95 * peak && hrsSincePeak <= 12) ? 'at its peak' : 'steady';
  let level = null;
  if (stats && !isNaN(stats.p25) && !isNaN(stats.p75)) {
    if (hardLowQ && qNow < hardLowQ) level = 'too low to fish well';
    else if (qNow < stats.p25) level = 'low';
    else if (qNow <= stats.p75) level = 'in the fishable band';
    else if (stats.p95 && qNow > stats.p95) level = 'blown high';
    else level = 'high';
  }
  let score;
  if (level === 'blown high') score = 0;
  else if (level === 'too low to fish well') score = 6;
  else if (level === 'low') score = state === 'dropping' ? 17 : 13;
  else if (level === 'high') score = state === 'dropping' ? 21 : (state === 'rising' ? 6 : 12);
  else score = state === 'dropping' ? 35 : state === 'rising' ? 17 : 30;
  return { qNow, peak, hrsSincePeak, state, level, score, statsUsed: !!level };
}

function shRainFlow(basin) {
  if (!basin || basin.p24_in == null || basin.p72_in == null) return null;
  const p24 = basin.p24_in, p72 = basin.p72_in;
  if (p72 < 0.15) return { state: 'low', score: 10, daysSincePeak: 4, p24, p72 };
  if (p24 >= 0.45 && p24 >= 0.5 * p72) return { state: 'rising', score: 16, daysSincePeak: 0.15, p24, p72 };
  if (p72 >= 0.6 && p24 < 0.4 * p72) return { state: 'dropping', score: 33, daysSincePeak: 1.4, p24, p72 };
  if (p72 >= 0.3 && p24 < 0.25 * p72) return { state: 'dropping', score: 30, daysSincePeak: 1.8, p24, p72 };
  return { state: 'holding', score: 22, daysSincePeak: 0.5, p24, p72 };
}

function shClarity(rainFlow, daysSincePeak, tau, firstFlush, risingHard) {
  if (!rainFlow) return null;
  let load = rainFlow.p24 * 22 + Math.max(0, rainFlow.p72 - rainFlow.p24) * 9;
  if (firstFlush) load *= 1.45;
  let t = 3 + load * Math.exp(-daysSincePeak / tau);
  if (risingHard) t = Math.max(t, 48);
  const band = t < 8 ? 'clear' : t < 16 ? 'steelhead green' : t < 30 ? 'stained' : t < 55 ? 'muddy' : 'blown out';
  const score = { 'steelhead green': 30, stained: 25, clear: 13, muddy: 7, 'blown out': 0 }[band];
  return { index: t, band, score };
}

function shTiming(river, md) {
  for (const seg of river.season) {
    const s = seg[0], e = seg[1], m = seg[2];
    const hit = s <= e ? (md >= s && md <= e) : (md >= s || md <= e);
    if (hit) return { mult: m, inSeason: true };
  }
  return { mult: 0.2, inSeason: false };
}

async function shForecastPeriods(anchor) {
  if (shState.fc[anchor.key]) return shState.fc[anchor.key];
  const pts = await shFetchJson('https://api.weather.gov/points/' + anchor.lat + ',' + anchor.lon);
  const hourly = await shFetchJson(pts.properties.forecastHourly);
  const periods = hourly.properties.periods || [];
  shState.fc[anchor.key] = periods;
  return periods;
}

/* Forecast rain for a future day, shaped like the fetcher's measured
   basin read: p24 = the QPF total for the target Pacific day itself,
   p72 = the target day plus the two before it (the windows END with
   the target day, so the rain expected ON that day counts toward its
   state — by midday it is part of the river). Returns null when the
   hourly forecast carries no QPF values in the window at all, so the
   caller can decline honestly instead of inventing rain. */
function shForecastRain(periods, keys) {
  if (!periods || !periods.length) return null;
  let p24 = 0, p72 = 0, cov = 0, inWindow = 0;
  periods.forEach(p => {
    const pp = shPtParts(new Date(p.startTime));
    const idx = keys.indexOf(pp.year + '-' + pp.month + '-' + pp.day);
    if (idx < 0) return;
    inWindow++;
    const q = p.quantitativePrecipitation
      && p.quantitativePrecipitation.value;
    if (q == null) return;
    cov++;
    p72 += q / 25.4;
    if (idx === 2) p24 += q / 25.4;
  });
  if (!inWindow || !cov) return null;
  return { p24_in: p24, p72_in: p72 };
}

function shDayWeather(periods, targetKey) {
  const day = periods.filter(p => {
    const pp = shPtParts(new Date(p.startTime));
    return pp.year + '-' + pp.month + '-' + pp.day === targetKey;
  });
  let tMin = null;
  day.forEach(p => {
    const h = +shPtParts(new Date(p.startTime)).hour;
    if (h >= 4 && h <= 11 && (tMin == null || p.temperature < tMin)) tMin = p.temperature;
  });
  let qpf = 0, pop = 0, gust = 0, hasQpf = false;
  day.forEach(p => {
    const h = +shPtParts(new Date(p.startTime)).hour;
    if (h < 5 || h > 17) return;
    if (p.quantitativePrecipitation && p.quantitativePrecipitation.value != null) {
      qpf += p.quantitativePrecipitation.value / 25.4; hasQpf = true;
    }
    if (p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value != null) {
      pop = Math.max(pop, p.probabilityOfPrecipitation.value);
    }
    const g = parseInt(p.windGust, 10);
    if (!isNaN(g)) gust = Math.max(gust, g);
  });
  return { tMin, qpfIn: qpf, hasQpf, pop, gust };
}

/* One river’s index computation, extracted verbatim from the card
   renderer so the answer card can read the same verdicts for BOTH
   target days (today and tomorrow). The math is unchanged: ctx
   carries the target day (month-day, forecast key, Pacific date
   parts), env the shared fetched inputs, fossAnalysis the Foss
   gauge read for that day. Returns the card HTML plus the pieces
   the answer card summarizes — verdict, why, first light. */
function shStatFor(stats, site, md) {
  return (stats && stats[site]) ? stats[site][md] : null;
}
function shRiverResult(river, ctx, env, fossAnalysis) {
  const fc = !!ctx.forecast;
  const basin = env.snap && env.snap.basins ? env.snap.basins[river.basin] : null;
  const rainFlow = shRainFlow(basin);
  const timing = shTiming(river, ctx.md);
  let flow = null, flowLine = '', daysSincePeak = rainFlow ? rainFlow.daysSincePeak : 3;
  if (fc) {
    /* Forecast mode (the answer card's days +2..+4): nothing about
       that day is measured, so flow for EVERY river kind — gauged
       included, there is no measured future flow — comes from the
       synthetic forecast basin through the same shRainFlow mapping
       the ungauged creeks use. The weights below (clarity, freeze,
       weather, timing, the base formula) are the index's own,
       untouched; only the inputs are forecast, and the lines say so. */
    if (rainFlow) {
      flow = { state: rainFlow.state, score: rainFlow.score };
      flowLine = 'Flow \u2014 forecast read: no gauge can measure a day that has not happened, so the rain expected over the basin runs through the same rain-to-river read the ungauged creeks use \u2014 '
        + rainFlow.p24.toFixed(2) + ' in in 24 h, ' + rainFlow.p72.toFixed(2)
        + ' in in 72 h through that day: ' + rainFlow.state + '. Forecast estimate.';
    } else {
      flow = { state: 'unknown', score: 12 };
      flowLine = 'Flow \u2014 the forecast feed carried no rain amounts for that day, so the river part of this call leans on timing and weather alone.';
    }
  } else if (river.kind === 'gauge') {
    const g = env.gauges[river.gauge] ? shAnalyzeGauge(
      env.gauges[river.gauge]['00060'], shStatFor(env.stats, river.gauge, ctx.md),
      river.hardLowQ || null) : null;
    if (g) {
      flow = { state: g.state, score: g.score };
      daysSincePeak = g.hrsSincePeak / 24;
      flowLine = 'Flow \u2014 ' + esc(river.gaugeLabel) + ': ' + Math.round(g.qNow)
        + ' cfs right now, ' + g.state
        + (g.level ? ', ' + g.level + ' for this date' : '')
        + (g.peak > 0 && g.state === 'dropping'
          ? ' (down from ' + Math.round(g.peak) + ' cfs in the last 3 days)' : '') + '.';
      if (river.rainGauge && env.gauges[river.rainGauge] && env.gauges[river.rainGauge]['00060']) {
        const v = env.gauges[river.rainGauge]['00060'];
        flowLine += ' Higher up at Vernonia: ' + Math.round(v[v.length - 1].v) + ' cfs.';
      }
    } else if (rainFlow) {
      flow = { state: rainFlow.state, score: Math.round(rainFlow.score * 0.8) };
      flowLine = 'Flow \u2014 the gauge feed did not answer, so this falls back to basin rain: '
        + rainFlow.p24.toFixed(2) + ' in in the last 24 hours over the basin \u2014 read as ' + rainFlow.state + '.';
    }
  } else if (river.kind === 'proxy') {
    if (rainFlow) {
      flow = { state: rainFlow.state, score: rainFlow.score };
      if (fossAnalysis) {
        flow.score = Math.round((rainFlow.score + fossAnalysis.score) / 2);
        if (fossAnalysis.state === 'rising' && rainFlow.p24 >= 0.3) flow.state = 'rising';
      }
      flowLine = 'Flow \u2014 no gauge on this fork. Read from rain over its own basin ('
        + rainFlow.p24.toFixed(2) + ' in in 24 h, ' + rainFlow.p72.toFixed(2) + ' in in 72 h \u2014 ' + rainFlow.state + ')'
        + (fossAnalysis ? ' and the Foss gauge on the main Nehalem (' + fossAnalysis.state + ' at '
          + Math.round(fossAnalysis.qNow) + ' cfs)' : '') + '. Estimate.';
    }
  } else if (rainFlow) {
    flow = { state: rainFlow.state, score: rainFlow.score };
    flowLine = 'Flow \u2014 ungauged creek: no gauge exists here, so flow is read from rain over its basin \u2014 '
      + rainFlow.p24.toFixed(2) + ' in in the last 24 hours, ' + rainFlow.p72.toFixed(2)
      + ' in in the last 72: ' + rainFlow.state + '. Rain-based estimate.';
  }
  if (!flow) {
    flow = { state: 'unknown', score: 12 };
    flowLine = 'Flow \u2014 neither the env.gauges nor the basin-rain snapshot answered this time; the call leans on timing and weather alone.';
  }

  const risingHard = flow.state === 'rising' && rainFlow && rainFlow.p24 >= 0.75;
  const clarity = shClarity(rainFlow, daysSincePeak, river.tau,
    !!(basin && basin.first_flush), risingHard);
  let clarityScore = clarity ? clarity.score : 10;
  if (flow.score <= 17) clarityScore = Math.min(clarityScore, 16); /* low water: even green water fishes hard */
  if (flow.state === 'rising') clarityScore = Math.min(clarityScore, 20);
  const clarityLine = clarity
    ? (fc
      ? 'Clarity \u2014 forecast ' + clarity.band + ' (estimate). Modeled from the rain expected over the basin '
        + 'and this creek\u2019s clearing speed \u2014 a forecast read, not measured water'
        + (basin && basin.first_flush
          ? '; this is the season\u2019s first big rain after a dry spell, which dirties the water longest' : '') + '.'
      : 'Clarity \u2014 ' + clarity.band + ' (estimate). Modeled from basin rain, how long since the river peaked, '
        + 'and this creek\u2019s clearing speed' + (basin && basin.first_flush
          ? '; this is the season\u2019s first big rain after a dry spell, which dirties the water longest' : '') + '.')
    : (fc
      ? 'Clarity \u2014 no forecast rain data for that day, so clarity is not scored.'
      : 'Clarity \u2014 no basin-rain data this time, so clarity is not scored.');

  const periods = env.forecasts[river.anchor.key];
  const wx = periods ? shDayWeather(periods, ctx.key) : null;
  let freeze = 0, coldLine = 'Cold \u2014 forecast unavailable this time.';
  if (wx && wx.tMin != null) {
    if (wx.tMin < 28) freeze = -40;
    else if (wx.tMin < 32) freeze = -15;
    else if (wx.tMin < 34) freeze = -5;
    coldLine = 'Cold \u2014 ' + wx.tMin + '\u00b0F around first light. ' + (wx.tMin < 28
      ? 'Below about 28\u00b0F the line, the rod guides and the reel all freeze \u2014 most anglers stay home. (Local knowledge, not an agency number.)'
      : wx.tMin < 32
        ? 'Below freezing the rod guides and line ice up \u2014 fishable, but you will be picking ice out of the guides. (Local knowledge, not an agency number.)'
        : wx.tMin < 34
          ? 'Right at the edge of icing \u2014 guides may skim over early.'
          : 'Above freezing \u2014 no icing problem.');
  }
  let weatherPen = 0, weatherLine = 'Weather \u2014 forecast unavailable this time.';
  if (wx) {
    if (wx.hasQpf && wx.qpfIn >= 0.3) weatherPen -= 10;
    else if (wx.hasQpf && wx.qpfIn >= 0.15) weatherPen -= 6;
    else if (wx.hasQpf && wx.qpfIn >= 0.05) weatherPen -= 3;
    else if (!wx.hasQpf && wx.pop >= 80) weatherPen -= 6;
    if (wx.gust >= 30) weatherPen -= 5; else if (wx.gust >= 22) weatherPen -= 2;
    weatherPen = Math.max(weatherPen, -14);
    weatherLine = 'Weather \u2014 ' + (wx.hasQpf
      ? (wx.qpfIn >= 0.05
        ? 'about ' + wx.qpfIn.toFixed(2) + ' in of rain expected in daylight hours \u2014 the river may rise again'
        : 'little or no rain expected in daylight hours')
      : (wx.pop >= 50 ? wx.pop + '% chance of rain in daylight hours' : 'rain not expected in daylight hours'))
      + (wx.gust >= 22 ? '; gusts to ' + wx.gust + ' mph make casting work' : '') + '.';
  }

  let base = Math.round((flow.score + clarityScore) / 65 * 100) + freeze + weatherPen;
  base = Math.max(0, Math.min(100, base));
  const score = Math.round(base * timing.mult);
  const blown = (clarity && clarity.band === 'blown out') || flow.state === 'blown high';
  let verdict = score >= 65 ? 'Good day' : score >= 40 ? 'Fair day' : 'Poor day';
  if (blown || !timing.inSeason) verdict = 'Poor day';

  let why;
  if (!timing.inSeason) {
    /* Every season profile here starts in Nov–Dec and ends by
       mid-April, so an out-of-season date from May on is BEFORE the
       next run; one in Jan–Apr is past this year's. */
    const before = ctx.md >= 501;
    why = (before ? 'Too early for this river \u2014 ' : 'Past this river\u2019s run for the year \u2014 ') + river.window + '.'
      + (base >= 55 ? ' The water itself is in decent shape.' : '');
  } else if (clarity && clarity.band === 'blown out') {
    why = 'Blown out \u2014 too much color in the water after the rain. Wait for the drop.';
  } else if (freeze <= -40) {
    why = 'Bitter cold at first light \u2014 line, guides and reel will freeze. Most anglers stay home.';
  } else if (flow.state === 'dropping' && clarity && (clarity.band === 'steelhead green' || clarity.band === 'stained')) {
    why = 'Dropping into ' + clarity.band + ' \u2014 the window every winter angler waits for'
      + (timing.mult >= 1 ? ', and the run is on' : '') + '.';
  } else if (flow.state === 'rising') {
    why = 'On the rise \u2014 fresh fish push in on water like this; the fishing turns on as it starts to drop.';
  } else if (flow.state === 'low') {
    why = 'Low water \u2014 what fish are here will be spooky. Go small, quiet, and early.';
  } else if (freeze === -15) {
    why = 'Fishable water, but below freezing at first light \u2014 expect iced guides and stiff fingers.';
  } else if (clarity && clarity.band === 'muddy') {
    why = 'Still muddy from the last rain \u2014 it fishes better a day or two into the drop.';
  } else {
    why = 'A workable day \u2014 nothing blown out, nothing perfect. First light is your best shot.';
  }

  const sun = almDay(ctx.tp, river.sun);
  let lightLine = 'First light \u2014 ';
  if (sun.dawn && sun.rise && sun.set) {
    const legalStart = new Date(sun.rise.getTime() - 3600e3);
    const legalEnd = new Date(sun.set.getTime() + 3600e3);
    lightLine += almClock(sun.dawn) + ' (sunrise ' + almClock(sun.rise) + '). General Oregon rule: steelhead '
      + 'angling hours run ' + almClock(legalStart) + '\u2013' + almClock(legalEnd)
      + ' here today \u2014 one hour before sunrise to one hour after sunset; check your river\u2019s regs for exceptions.';
  } else {
    lightLine += 'sun times unavailable this time.';
  }
  const timingLine = 'Timing \u2014 ' + (timing.inSeason
    ? (timing.mult >= 1 ? 'heart of the run: ' : timing.mult >= 0.7 ? 'in season: ' : 'edge of the season: ')
      + river.window + '.'
    : 'outside the run: ' + river.window + '.');
  const tag = river.kind === 'gauge' ? 'Gauged' : river.kind === 'proxy' ? 'Proxy gauge' : 'Ungauged \u00b7 rain estimate';
  const pillClass = verdict === 'Good day' ? 'sh-good' : verdict === 'Fair day' ? 'sh-fair' : 'sh-poor';
  const dawnTxt = (sun.dawn && sun.rise && sun.set) ? almClock(sun.dawn) : null;
  const html = '<div class="sh-row">'
    + '<button type="button" class="sh-head" data-sh="' + river.id + '" aria-expanded="false">'
    + '<span class="sh-name">' + esc(river.name) + ' <span class="sh-tag">' + tag + '</span></span>'
    + '<span class="sh-pill ' + pillClass + '">' + verdict + '</span></button>'
    + '<p class="sh-why">' + esc(why) + '</p>'
    + '<div class="sh-detail" hidden>'
    + '<p>' + flowLine + '</p>'
    + '<p>' + clarityLine + '</p>'
    + '<p>' + esc(coldLine) + '</p>'
    + '<p>' + esc(weatherLine) + '</p>'
    + '<p>' + esc(timingLine) + '</p>'
    + '<p>' + esc(lightLine) + '</p>'
    + '</div></div>';
  return { html, verdict, why, dawnTxt };
}

/* The forecast-mode env for one river and one future day: a copy of
   env whose basin entry for this river is synthetic — p24/p72 built
   from the NWS hourly QPF at the river's anchor over the three
   Pacific days ending with the target day (shForecastRain). Gauges,
   stats and forecasts pass through, but shRiverResult's forecast
   branch never reads the measured gauges. first_flush carries over
   from the measured basin: it is a property of the rain EVENT — if
   the season's first-flush storm is the one in the forecast window,
   its extra dirtiness belongs in the future call too. */
function shForecastEnv(river, off, env, ctxFor) {
  const periods = env.forecasts[river.anchor.key];
  const keys = [off - 2, off - 1, off].map(o => ctxFor(o).key);
  const rain = shForecastRain(periods, keys);
  const ob = env.snap && env.snap.basins
    ? env.snap.basins[river.basin] : null;
  const basins = Object.assign({}, env.snap && env.snap.basins);
  basins[river.basin] = rain
    ? { p24_in: rain.p24_in, p72_in: rain.p72_in,
        first_flush: !!(ob && ob.first_flush) }
    : null;
  return { snap: Object.assign({}, env.snap, { basins }),
    gauges: env.gauges, stats: env.stats, forecasts: env.forecasts };
}

async function loadSteelhead() {
  const rowsEl = $('steelhead-rows');
  if (!rowsEl) return;
  const nowParts = shPtParts(new Date());
  const targetOffset = (+nowParts.hour) < 12 ? 0 : 1;
  const tp = almPtDate(targetOffset);   /* {y, m (0-based), d} Pacific parts */
  const md = (tp.m + 1) * 100 + tp.d;
  const targetKey = tp.y + '-'
    + String(tp.m + 1).padStart(2, '0') + '-'
    + String(tp.d).padStart(2, '0');
  const targetDateObj = new Date(tp.y, tp.m, tp.d, 12);
  const targetEl = $('steelhead-target');
  if (targetEl) {
    targetEl.textContent = (targetOffset === 0 ? 'Today\u2019s call' : 'Tomorrow\u2019s call')
      + ' \u2014 ' + fmtDay(targetDateObj)
      + ' \u00b7 river state as of right now, weather from the forecast';
  }

  const [snap, iv, stats] = await Promise.all([
    getSnapshot('steelhead.json').catch(() => null),
    shFetchJson('https://waterservices.usgs.gov/nwis/iv/?format=json'
      + '&sites=14301500,14301000,14299800&period=P5D&parameterCd=00060,00065,00045')
      .then(shParseIv).catch(() => null),
    shFetchStats().catch(() => null),
  ]);
  if (snap) setSnapUpdated('steelhead-updated', snap.fetched_at);
  const gauges = iv || {};

  const forecasts = {};
  await Promise.all([...new Set(SH_RIVERS.map(r => r.anchor.key))].map(async key => {
    const river = SH_RIVERS.find(r => r.anchor.key === key);
    try { forecasts[key] = await shForecastPeriods(river.anchor); }
    catch (e) { forecasts[key] = null; }
  }));

  /* Both target days are computed from the same fetched inputs —
     the index card renders its own day (today before noon Pacific,
     tomorrow after); the answer card reads either on demand. */
  const env = { snap, gauges, stats, forecasts };
  const ctxFor = offset => {
    const p = almPtDate(offset);
    return { tp: p, md: (p.m + 1) * 100 + p.d,
      key: p.y + '-' + String(p.m + 1).padStart(2, '0') + '-'
        + String(p.d).padStart(2, '0') };
  };
  const byDay = {};
  [0, 1].forEach(off => {
    const ctx = ctxFor(off);
    const foss = gauges['14301000']
      ? shAnalyzeGauge(gauges['14301000']['00060'],
          shStatFor(stats, '14301000', ctx.md), null)
      : null;
    byDay[off] = {};
    SH_RIVERS.forEach(river => {
      byDay[off][river.id] = shRiverResult(river, ctx, env, foss);
    });
  });
  /* Days +2..+4 exist only as forecast calls, for the answer card:
     the same index, run in forecast mode (ctx.forecast) on forecast
     inputs — NWS rain amounts through the rain-to-river mapping for
     flow and clarity, the same day's forecast for cold and weather,
     the calendar for timing. The index card itself keeps rendering
     its own measured day (today/tomorrow), exactly as before. */
  [2, 3, 4].forEach(off => {
    const ctx = Object.assign(ctxFor(off), { forecast: true });
    byDay[off] = {};
    SH_RIVERS.forEach(river => {
      byDay[off][river.id] = shRiverResult(river, ctx,
        shForecastEnv(river, off, env, ctxFor), null);
    });
  });
  shByDay = byDay;
  const cards = SH_RIVERS.map(r => byDay[targetOffset][r.id].html);

  rowsEl.innerHTML = cards.join('');
  rowsEl.querySelectorAll('.sh-head').forEach(btn => {
    btn.addEventListener('click', () => {
      const detail = btn.parentElement.querySelector('.sh-detail');
      const open = detail.hidden;
      detail.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    });
  });
  const noteEl = $('steelhead-note');
  if (noteEl) {
    noteEl.textContent = 'How this works: no fish counts exist for these creeks mid-season, so this judges the day, not the fish \u2014 '
      + 'run timing, flow, clarity, cold and weather. Gauges: USGS. Rain: NOAA MRMS over each creek\u2019s basin'
      + (snap && snap.valid_time ? ' (through ' + esc(almClock(new Date(snap.valid_time))) + ')' : '')
      + '. Clarity and ungauged flow are estimates, labeled as such.';
  }
}

/* ---------- ships "passing soon" (build batch 2026-11-04, ADD 4 / R2) ----------
   MarineTraffic's redesign is hated for burying the simple near-me list;
   this IS that list: vessels sorted by when they pass the visitor's home
   town. The ETA projects each AIS position onto a Columbia River
   reference line (river miles), reads direction off course vs. the
   channel bearing, and divides the along-river distance by the
   along-river speed. Honesty rules: no ETA when the position report is
   stale (>20 min), the along-river speed is under a knot, or the ship is
   heading away — the row says so instead of inventing a time. */
// [lat, lon, river mile], Astoria -> Portland (RM from the USACE channel survey, approx.)
const RIVER_LINE = [
  [46.245, -123.795, 14], [46.190, -123.440, 44], [46.105, -123.250, 56],
  [46.090, -122.954, 68], [45.965, -122.795, 80], [45.860, -122.820, 86],
  [45.700, -122.800, 95], [45.620, -122.674, 106]
];
// Where each home town meets the river: river mile + the name to print.
const TOWN_RIVER = {
  'St. Helens': { rm: 86, at: 'St. Helens' },
  'Columbia City': { rm: 84, at: 'Columbia City' },
  'Warren': { rm: 88, at: 'Warren' },
  'Scappoose': { rm: 90, at: 'Scappoose' },
  'Rainier': { rm: 68, at: 'Rainier' },
  'Clatskanie': { rm: 57, at: 'Clatskanie' },
  'Vernonia': { rm: 86, at: 'St. Helens (nearest river point)' }
};
function riverProject(lat, lon) {
  let best = null;
  for (let i = 0; i < RIVER_LINE.length - 1; i++) {
    const A = RIVER_LINE[i], B = RIVER_LINE[i + 1];
    const dx = B[1] - A[1], dy = B[0] - A[0];
    const L2 = dx * dx + dy * dy;
    let t = L2 ? ((lon - A[1]) * dx + (lat - A[0]) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = A[1] + t * dx, py = A[0] + t * dy;
    const d2 = (lon - px) * (lon - px) + (lat - py) * (lat - py);
    if (!best || d2 < best.d2) {
      best = { d2, rm: A[2] + t * (B[2] - A[2]),
               bearing: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 };
    }
  }
  return best;
}
function parseAisTime(s) {
  const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}
function shipEtaInfo(s, townRef, snapMs) {
  const out = { dir: null, etaMin: null, moving: false, rm: null, toward: false };
  if (s.lat == null || s.lon == null) return out;
  const proj = riverProject(s.lat, s.lon);
  if (!proj) return out;
  out.rm = proj.rm;
  out.moving = s.sog_kn != null && s.sog_kn >= 0.5;
  if (!out.moving || s.cog == null) return out;
  const dot = Math.cos((s.cog - proj.bearing) * Math.PI / 180);
  out.dir = dot > 0.35 ? 'up' : dot < -0.35 ? 'down' : null;
  if (!out.dir) return out;
  const dRm = townRef.rm - proj.rm;
  out.toward = (out.dir === 'up' && dRm > 0.5) || (out.dir === 'down' && dRm < -0.5);
  const reported = parseAisTime(s.updated);
  const ageMin = reported ? (snapMs - reported.getTime()) / 60000 : null;
  const alongKn = Math.abs(dot) * s.sog_kn;
  if (out.toward && alongKn >= 1 && ageMin != null && ageMin <= 20) {
    const eta = Math.abs(dRm) * 0.868976 / alongKn * 60; // river miles are statute
    if (eta <= 12 * 60) out.etaMin = eta;
  }
  return out;
}
function renderShipEtas(ships, fetchedAt) {
  const townName = (homeTown && homeTown.name) || 'St. Helens';
  const townRef = TOWN_RIVER[townName] || TOWN_RIVER['St. Helens'];
  const snapMs = fetchedAt ? new Date(fetchedAt).getTime() : Date.now();
  const snapAgeMin = Math.max(0, (Date.now() - snapMs) / 60000);
  const rows = ships.map(s => ({ s, info: shipEtaInfo(s, townRef, snapMs) }));
  const rank = r => r.info.etaMin != null ? 0 : r.info.moving ? 1 : 2;
  rows.sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d) return d;
    if (a.info.etaMin != null && b.info.etaMin != null) return a.info.etaMin - b.info.etaMin;
    const da = a.info.rm == null ? 999 : Math.abs(a.info.rm - townRef.rm);
    const db = b.info.rm == null ? 999 : Math.abs(b.info.rm - townRef.rm);
    return da - db;
  });
  const head = snapAgeMin > 20
    ? '<p class="incident-scope">This snapshot\'s positions are ' + Math.round(snapAgeMin)
      + ' min old — too old for honest ETAs, so none are shown.</p>'
    : '';
  return head + rows.map(({ s, info }) => {
    const dirTxt = info.dir === 'up' ? '▲ Upriver (toward Portland)'
      : info.dir === 'down' ? '▼ Downriver (toward Astoria)'
      : info.moving ? 'Underway' : 'Moored or anchored';
    let etaTxt = '';
    if (info.etaMin != null) {
      etaTxt = info.etaMin < 2
        ? 'Passing ' + townRef.at + ' right about now'
        : 'Passes ' + townRef.at + ' ≈ ' + fmtTime(new Date(Date.now() + info.etaMin * 60000))
          + ' — ' + fmtAway(Math.round(info.etaMin)) + ' at its current reported speed';
    } else if (info.moving && info.dir) {
      etaTxt = info.toward
        ? 'Heading toward ' + townRef.at + ' — no ETA shown (position too old or speed too low to call)'
        : 'Heading away from ' + townRef.at + ' for now';
    }
    return '<div class="ship-row"><div><div class="river-name">🚢 ' + esc(s.name || ('MMSI ' + s.mmsi)) + '</div>'
      + '<div class="river-sub">' + esc(dirTxt) + (etaTxt ? ' · ' + esc(etaTxt) : '') + '</div>'
      + '<div class="river-sub">' + (s.destination ? 'Bound for ' + esc(s.destination) : 'Destination not broadcast')
      + '</div></div><div class="river-nums"><div class="big">' + (s.sog_kn != null ? num(s.sog_kn, 1) + ' kt' : '—') + '</div>'
      + '<div class="river-sub">' + (s.cog != null ? 'course ' + num(s.cog, 0) + '°' : '') + '</div></div></div>';
  }).join('');
}

/* ---------- snapshot: ships ---------- */
async function loadShips() {
  const body = $('ships-body');
  try {
    const snap = await getSnapshot('ships.json');
    setSnapUpdated('ships-updated', snap.fetched_at);
    const ships = snap.ships || [];
    if (shipLayer) {
      shipLayer.clearLayers();
      ships.forEach(s => {
        if (s.lat == null || s.lon == null) return;
        L.marker([s.lat, s.lon], { icon: emojiIcon('🚢', 22) }).addTo(shipLayer)
          .bindPopup('<strong>' + esc(s.name || ('MMSI ' + s.mmsi)) + '</strong>'
            + (s.sog_kn != null ? '<br>' + num(s.sog_kn, 1) + ' kt' : '')
            + (s.destination ? '<br>Bound for ' + esc(s.destination) : ''));
      });
    }
    if (snap.status === 'ok' && ships.length) {
      body.innerHTML = renderShipEtas(ships, snap.fetched_at);
    } else if (snap.status === 'ok') {
      body.innerHTML = '<p class="no-alerts">No vessels broadcasting AIS inside the county box at the last collection — the river has quiet stretches, especially at night.</p>';
    } else {
      body.innerHTML = '<p class="status-note">🛠️ River traffic is wired end-to-end — the map layer, panel, and collector are built. Ship positions come from AISStream\'s free tier, which needs a free API key added to our fetcher (a person has to do the 2-minute signup; we don\'t create accounts silently). The moment that key lands, live Columbia River ships appear here and on the map.</p>';
    }
  } catch (e) {
    body.innerHTML = '<p class="fallback">⚠️ River traffic snapshot unavailable right now.</p>';
  }
}

/* ---------- snapshot: ferry alerts ---------- */
async function loadFerry() {
  try {
    const snap = await getSnapshot('ferry.json');
    setSnapUpdated('ferry-updated', snap.fetched_at);
    ferryAlertActive = (snap.status === 'ok' && !!snap.alert);
    tickFerryNext();
    const el = $('ferry-alert-body');
    if (snap.status === 'ok' && snap.alert) {
      el.innerHTML = '<div class="alert-item severe"><h3>⚠️ Ferry closure alert posted</h3><p>' + esc(snap.alert) + '</p></div>';
    } else if (snap.status === 'ok') {
      el.innerHTML = '<p class="no-alerts">✅ No ferry closure alerts posted on the county page at the last check — the Oscar B is running its normal schedule.</p>';
    } else {
      el.innerHTML = '<p class="status-note">Ferry alert check didn\'t complete in the latest snapshot — if you\'re counting on the ferry, glance at the official page linked below.</p>';
    }
  } catch (e) {
    $('ferry-alert-body').innerHTML = '';
  }
}

/* ---------- ferry: next-boat countdown (from the fixed timetable) ---------- */
let ferryAlertActive = false;
const FERRY_SIDES = [
  { key: 'or', label: 'Westport, OR side', to: 'Puget Island', minute: 15, firstHour: 5, lastHour: 22 },
  { key: 'wa', label: 'Puget Island, WA side', to: 'Westport', minute: 0, firstHour: 5, lastHour: 22 }
];
function ptNowParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour12: false,
    hour: '2-digit', minute: '2-digit', weekday: 'short'
  }).formatToParts(new Date());
  const get = t => (parts.find(p => p.type === t) || {}).value;
  return { h: parseInt(get('hour'), 10) % 24, m: parseInt(get('minute'), 10) };
}
function nextSailing(side, now) {
  const nowMin = now.h * 60 + now.m;
  for (let h = side.firstHour; h <= side.lastHour; h++) {
    const dep = h * 60 + side.minute;
    if (dep > nowMin) return { minsAway: dep - nowMin, hour: h, minute: side.minute, tomorrow: false, isLast: h === side.lastHour };
  }
  const first = side.firstHour * 60 + side.minute;
  return { minsAway: (24 * 60 - nowMin) + first, hour: side.firstHour, minute: side.minute, tomorrow: true, isLast: false };
}
function fmtClock(h, m) {
  const hr12 = ((h + 11) % 12) + 1;
  return hr12 + ':' + String(m).padStart(2, '0') + ' ' + (h >= 12 ? 'PM' : 'AM');
}
function fmtAway(mins) {
  if (mins < 1) return 'now';
  if (mins < 60) return 'in ' + mins + ' min';
  return 'in ' + Math.floor(mins / 60) + ' hr ' + (mins % 60 ? (mins % 60) + ' min' : '').trim();
}
function tickFerryNext() {
  const el = $('ferry-next');
  if (!el) return;
  if (ferryAlertActive) {
    el.innerHTML = '<div class="ferry-next-head">⏱️ Sailings may be disrupted — see the closure alert above before heading to the landing.</div>';
    return;
  }
  const now = ptNowParts();
  const nexts = FERRY_SIDES.map(s => ({ side: s, n: nextSailing(s, now) }));
  const soonest = nexts.slice().sort((a, b) => a.n.minsAway - b.n.minsAway)[0];
  el.innerHTML = '<div class="ferry-next-head">⏱️ Next Oscar B sailing: '
    + esc(soonest.side.label.replace(' side', '')) + ' → ' + esc(soonest.side.to)
    + ' <span class="fn-when">' + esc(fmtAway(soonest.n.minsAway)) + '</span>'
    + (soonest.n.tomorrow ? ' (tomorrow, ' + fmtClock(soonest.n.hour, soonest.n.minute) + ')' : ' (' + fmtClock(soonest.n.hour, soonest.n.minute) + ')')
    + '</div>'
    + '<div class="ferry-next-grid">' + nexts.map(({ side, n }) =>
        '<div class="ferry-next-box' + (n.isLast ? ' last-boat' : '') + '">'
        + '<div class="fn-side">From ' + esc(side.label) + (n.isLast ? '<span class="fn-last">Last boat today</span>' : '') + '</div>'
        + '<div class="fn-count">' + esc(fmtAway(n.minsAway)) + '</div>'
        + '<div class="fn-time">Departs ' + fmtClock(n.hour, n.minute) + (n.tomorrow ? ' tomorrow' : '') + ' · cash/check fares</div>'
        + '</div>').join('') + '</div>';
}

/* ---------- snapshot: events ---------- */
function parseTimeToMinutes(t) {
  const m = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i.exec(t || '');
  if (!m) return 0;
  let h = parseInt(m[1], 10) % 12;
  if (/PM/i.test(m[3])) h += 12;
  return h * 60 + parseInt(m[2] || '0', 10);
}
let eventsCache = null;
let currentEventFilter = 'all';
/* Facebook public events (data/fb-events.json, refreshed ~twice a day by
   the FB events checker) merge into the calendar list below: same
   normalized title + same date means the calendar entry wins; FB-only
   events ride along tagged source "Facebook" with their permalink. */
let fbEventsSnapPromise = null;
function getFbEventsSnap() {
  if (!fbEventsSnapPromise) {
    fbEventsSnapPromise = getSnapshot('fb-events.json').catch(() => null);
  }
  return fbEventsSnapPromise;
}
function normalizeEventTitle(t) {
  return (t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function mergeFbInto(events, fbSnap) {
  const base = events || [];
  if (!fbSnap || !Array.isArray(fbSnap.events)) return base.slice();
  const seen = new Set(base.map(ev => ev.date + '|' + normalizeEventTitle(ev.title)));
  const out = base.slice();
  fbSnap.events.forEach(ev => {
    if (!ev || !ev.date || !ev.title) return;
    const key = ev.date + '|' + normalizeEventTitle(ev.title);
    if (seen.has(key)) return; // the calendar version wins
    seen.add(key);
    out.push({ date: ev.date, time: ev.time || '', title: ev.title, source: 'Facebook',
               url: ev.url || '', location: ev.location || '' });
  });
  return out;
}
function eventDayDiff(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [ty, tm, td] = todayStrPT().split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
}
function eventMatchesFilter(ev, filter) {
  const diff = eventDayDiff(ev.date);
  if (filter === 'today') return diff === 0;
  if (filter === 'week') return diff >= 0 && diff <= 6;
  if (filter === 'weekend') {
    if (diff < 0 || diff > 7) return false;
    const dow = new Date(ev.date + 'T12:00:00').getDay();
    return dow === 0 || dow === 6;
  }
  return diff >= -0; // 'all' = today onward within the snapshot window
}
function renderEvents() {
  const body = $('events-body');
  if (!eventsCache) return;
  const snap = eventsCache;
  const evs = (snap.events || []).slice().sort((a, b) =>
    a.date === b.date ? parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time)
                      : (a.date < b.date ? -1 : 1));
  const shown = evs.filter(ev => eventMatchesFilter(ev, currentEventFilter)).slice(0, 16);
  const today = todayStrPT();
  let html = '';
  if (shown.length) {
    let lastDate = '';
    html = shown.map(ev => {
      const head = ev.date !== lastDate
        ? '<div class="event-date">' + esc(fmtDay(new Date(ev.date + 'T12:00:00'))) + (ev.date === today ? ' <span class="event-today-badge">Today</span>' : '') + '</div>' : '';
      lastDate = ev.date;
      return head + '<div class="event-row"><span class="event-time">' + esc(ev.time || '') + '</span>'
        + '<span class="event-title">' + (ev.url ? '<a href="' + esc(ev.url) + '" target="_blank" rel="noopener">' + esc(ev.title) + '</a>' : esc(ev.title)) + '</span>'
        + (ev.source === 'Facebook'
          ? '<span class="event-fb-tag">Facebook</span>' + (ev.location ? '<span class="event-src">' + esc(ev.location) + '</span>' : '')
          : '<span class="event-src">' + esc(ev.source || '') + '</span>') + '</div>';
    }).join('');
  } else {
    html = '<p class="no-alerts">' + ({
      today: 'Nothing left on the calendars for today — the full two weeks are under "All".',
      weekend: 'Nothing on the calendars this weekend in the current snapshot — try "Next 7 days".',
      week: 'Nothing on the calendars in the next 7 days in the current snapshot.'
    }[currentEventFilter] || 'No upcoming events found on the city calendars for the next two weeks.') + '</p>';
  }
  const county = (snap.sources || []).find(s => /Columbia County/.test(s.name));
  if (county && county.status === 'blocked_needs_browser') {
    html += '<p class="status-note">🏛️ Columbia County\'s own calendar is the one holdout: their website only reveals events inside a full web browser (no readable feed exists). Capturing it from Travis\'s computer is the next fetcher step — the city calendars above are already flowing.</p>';
  }
  if (shown.some(ev => ev.source === 'Facebook')) {
    html += '<p class="status-note">' + (langCur === 'es'
      ? '📘 Además, eventos públicos de Facebook — los más grandes; no todos los volantes aparecen allí.'
      : '📘 Plus public events from Facebook — the big ones; not every flyer gets listed there.') + '</p>';
  }
  body.innerHTML = html;
}
function initEventFilters() {
  const wrap = $('event-filters');
  if (!wrap) return;
  wrap.querySelectorAll('.event-filter-btn').forEach(b => {
    b.addEventListener('click', () => {
      currentEventFilter = b.dataset.filter;
      wrap.querySelectorAll('.event-filter-btn').forEach(x => {
        x.classList.toggle('active', x === b);
        if (x.setAttribute) x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
      });
      renderEvents();
    });
  });
}
async function loadEvents() {
  const body = $('events-body');
  try {
    const snap = await getSnapshot('events.json');
    setSnapUpdated('events-updated', snap.fetched_at);
    eventsCache = snap;
    const fbSnap = await getFbEventsSnap();
    eventsCache.events = mergeFbInto(snap.events || [], fbSnap);
    renderEvents();
  } catch (e) {
    body.innerHTML = '<p class="fallback">⚠️ Events snapshot unavailable right now.</p>';
  }
}

/* ---------- at a glance (synthesis strip) ---------- */
/* The river tile leads with the TIDE (Travis, 2026-11-05): at a
   glance it must say high / low / incoming in plain words, with the
   Port Westward gauge level demoted to the sub-line. The tide state
   comes from the same NOAA predictions the tides card loads
   (tideData['9439201'], St. Helens) — never estimated here. Until
   those land (or if they fail), the tile honestly carries the gauge
   reading it always had. */
let glanceGauge = null; // { h, arrow, glyph } from the USGS fetch below
function glanceTideText() {
  const preds = tideData['9439201'];
  if (!preds || !preds.length) return null;
  const now = Date.now();
  const next = preds.find(p => p.t > now);
  if (!next) return null;
  const when = fmtTime(new Date(next.t));
  const es = langCur === 'es';
  if (next.t - now <= 30 * 60000) { // at the turn: name the tide itself
    return (next.type === 'H'
      ? (es ? 'Marea alta ' : 'High tide ')
      : (es ? 'Marea baja ' : 'Low tide ')) + when + (es ? ' · ahora' : ' · now');
  }
  return next.type === 'H'
    ? (es ? 'Marea entrante · Alta ' : 'Incoming tide · High ') + when
    : (es ? 'Marea saliente · Baja ' : 'Outgoing tide · Low ') + when;
}
function updateGlanceRiver() {
  const valEl = $('glance-river-val');
  if (!valEl) return;
  const subEl = $('glance-river-sub');
  const es = langCur === 'es';
  const tide = glanceTideText();
  if (tide) {
    valEl.textContent = tide;
    if (subEl) subEl.textContent = glanceGauge
      ? (es ? 'Río ' : 'River ') + num(glanceGauge.h, 2) + ' ft ' + glanceGauge.glyph + ' · Port Westward'
      : 'St. Helens · NOAA';
  } else if (glanceGauge) {
    valEl.textContent = num(glanceGauge.h, 2) + ' ft' + glanceGauge.arrow;
    if (subEl) subEl.textContent = es ? 'Medidor de Port Westward · USGS' : 'Port Westward gauge · USGS';
  }
}
function todayStrPT() {
  return new Intl.DateTimeFormat('en-CA',
    { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
async function loadGlance() {
  // Bridge tile — from the roads snapshot
  try {
    const roads = await getSnapshot('roads.json');
    const b = roads.bridge || {};
    const el = $('glance-bridge-val');
    el.textContent = { clear: 'Clear', work: 'Work scheduled', alert: 'ALERT posted', unknown: 'Status unknown' }[b.status] || 'Status unknown';
    el.className = 'glance-val ' + (b.status === 'clear' ? 'ok' : b.status === 'alert' ? 'bad' : b.status === 'work' ? 'warn' : '');
  } catch (e) { /* tile keeps its placeholder */ }
  // Alerts tile — live from NWS
  try {
    const d = await getJSON(NWS_ALERTS_URL, { 'Accept': 'application/geo+json' });
    const feats = d.features || [];
    const el = $('glance-alerts-val');
    if (!feats.length) { el.textContent = 'All clear'; el.className = 'glance-val ok'; }
    else {
      const ev = (feats[0].properties || {}).event || 'Alert';
      el.textContent = feats.length + (feats.length === 1 ? ' alert' : ' alerts') + ' · ' + ev;
      el.className = 'glance-val ' + (/warning/i.test(ev) ? 'bad' : 'warn');
    }
  } catch (e) { /* keep placeholder */ }
  // River tile — Columbia at Port Westward, live from USGS
  try {
    const d = await getJSON(USGS_IV_URL);
    const ts = (d.value.timeSeries || []).find(t =>
      t.sourceInfo.siteCode[0].value === GAUGES[0].site && t.variable.variableCode[0].value === '00065');
    const clean = ((ts.values[0] && ts.values[0].value) || []).filter(v => v.value !== '-999999');
    if (clean.length) {
      const last = clean[clean.length - 1];
      const h = parseFloat(last.value);
      const target = new Date(last.dateTime).getTime() - 24 * 3600 * 1000;
      let best = clean[0], bd = Infinity;
      clean.forEach(v => { const dd = Math.abs(new Date(v.dateTime).getTime() - target); if (dd < bd) { bd = dd; best = v; } });
      const delta = h - parseFloat(best.value);
      const arrow = delta > 0.05 ? ' ▲ rising' : delta < -0.05 ? ' ▼ falling' : ' → steady';
      glanceGauge = { h: h, arrow: arrow, glyph: delta > 0.05 ? '▲' : delta < -0.05 ? '▼' : '→' };
      updateGlanceRiver();
    }
  } catch (e) { /* keep placeholder */ }
  // Next event tile — from the events snapshot, FB events merged in
  try {
    const snap = await getSnapshot('events.json');
    const fbSnap = await getFbEventsSnap();
    const today = todayStrPT();
    const evs = mergeFbInto(snap.events || [], fbSnap).filter(ev => ev.date >= today).slice().sort((a, b) =>
      a.date === b.date ? parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time)
                        : (a.date < b.date ? -1 : 1));
    const el = $('glance-events-val');
    if (evs.length) {
      const ev = evs[0];
      const when = ev.date === today ? 'Today ' + (ev.time || '')
        : fmtDay(new Date(ev.date + 'T12:00:00')) + ' ' + (ev.time || '');
      el.textContent = ev.title;
      el.title = ev.title;
      el.closest('.glance-tile').querySelector('.glance-sub').textContent = when + (ev.source ? ' · ' + ev.source : '');
    } else {
      el.textContent = 'None scheduled';
    }
  } catch (e) { /* keep placeholder */ }
}

/* ---------- share + home-screen install ---------- */
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
});
function initShare() {
  const shareBtn = $('share-btn');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      const payload = {
        title: 'Columbia County Live',
        text: 'Roads, rivers, weather & the Oscar B ferry for Columbia County, Oregon — one live look:',
        url: 'https://travweber67.github.io/columbia-county-live/'
      };
      if (navigator.share) {
        try { await navigator.share(payload); } catch (e) { /* user dismissed */ }
      } else if (navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(payload.url);
          shareBtn.textContent = '✅ Link copied — paste it anywhere';
          setTimeout(() => { shareBtn.textContent = '📤 Share this page'; }, 3500);
        } catch (e) { /* clipboard unavailable */ }
      }
    });
  }
  const installBtn = $('install-btn');
  const help = $('install-help');
  if (installBtn && help) {
    installBtn.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        try { await deferredInstallPrompt.userChoice; } catch (e) { /* ignore */ }
        deferredInstallPrompt = null;
        return;
      }
      const ua = navigator.userAgent || '';
      if (/iphone|ipad|ipod/i.test(ua)) {
        help.textContent = 'On iPhone/iPad: tap the Share button in Safari (the square with an arrow), then choose "Add to Home Screen".';
      } else if (/android/i.test(ua)) {
        help.textContent = 'On Android: open your browser menu (⋮) and choose "Add to Home screen" or "Install app".';
      } else {
        help.textContent = 'On a computer: look for the install icon at the right of the address bar in Chrome or Edge, or just bookmark this page (Ctrl/Cmd + D) — it updates itself.';
      }
      help.hidden = false;
    });
  }
}

/* ---------- the ONE install card (v5, PWA finish) ----------
   The browser's install offer is captured at the top of this file's
   share module (beforeinstallprompt → deferredInstallPrompt). This
   card — in Events & More, the share bar's home — is the single
   proactive surface for it: it appears only when an install is
   actually on offer, the page isn't already running installed, and
   the visitor hasn't dismissed it (the dismissal is remembered in
   localStorage). The share bar's Add-to-home-screen button keeps its
   manual instructions for browsers that never fire the event. */
const INSTALL_DISMISS_KEY = 'ccl-install-dismissed-v1';
/* v40: the dismissal is a timestamp that EXPIRES after 30 days — the
   v5 code stored a bare flag, so one accidental ✕ tap in week one hid
   the card forever. (Values written by the old code don't parse as a
   recent timestamp, so they read as already-expired — intended.) */
const INSTALL_DISMISS_MS = 30 * 24 * 60 * 60 * 1000;
function installDismissed() {
  try {
    const ts = parseInt(window.localStorage.getItem(INSTALL_DISMISS_KEY) || '', 10);
    return !!ts && (Date.now() - ts) < INSTALL_DISMISS_MS;
  } catch (e) { return false; }
}
function initInstallCard() {
  const card = $('install-card');
  if (!card) return;
  let dismissed = installDismissed();
  const standalone = !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  function maybeShow() {
    if (dismissed || standalone || !deferredInstallPrompt) return;
    card.hidden = false;
  }
  window.addEventListener('beforeinstallprompt', () => setTimeout(maybeShow, 600));
  window.addEventListener('appinstalled', () => { card.hidden = true; });
  const go = $('install-card-btn');
  if (go) go.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    try { await deferredInstallPrompt.userChoice; } catch (e) { /* ignore */ }
    deferredInstallPrompt = null;
    card.hidden = true;
  });
  const dis = $('install-card-dismiss');
  if (dis) dis.addEventListener('click', () => {
    card.hidden = true;
    try { window.localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now())); } catch (e) { /* session-only */ }
  });
  maybeShow();
}

/* ---------- get the app: the install sheet (v40) ----------
   The diagnosis (~/workspace/ccl-install-fix/DIAGNOSIS.md): the only
   install doors lived in Events & More, and the proactive card only
   appears when beforeinstallprompt fires — never inside Facebook's
   browser, never on iOS. Three neighbours told the 4C's group they
   "cannot see a button anywhere", and they were right. This sheet is
   the fix: a masthead button + drawer entry open it from anywhere;
   inside, the visitor gets STEP 0 first when they're trapped in an
   app webview (Facebook/Instagram, or a non-Safari iOS browser —
   where Add to Home Screen silently no-ops, per Travis's field
   report), then numbered steps for the device they're actually on,
   the other devices' steps folded below, and a real Install button
   whenever the browser has offered one. All copy is static chrome in
   index.html (data-i18n / LANG_ES); this module only decides what
   shows and wires the prompt. */
function initGetApp() {
  const sheet = $('getapp-sheet'), backdrop = $('getapp-backdrop');
  if (!sheet) return;
  const openBtns = [$('getapp-btn'), $('drawer-getapp-btn')].filter(Boolean);
  const closeBtn = $('getapp-close');
  const installBtn = $('getapp-install');
  const step0fb = $('getapp-step0-fb'), step0ios = $('getapp-step0-ios');
  const plats = { ios: $('getapp-ios'), android: $('getapp-android'), desktop: $('getapp-desktop') };
  const other = $('getapp-other'), otherBody = $('getapp-other-body');
  const ua = navigator.userAgent || '';
  const isIOS = /iphone|ipad|ipod/i.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /android/i.test(ua);
  const inAppBrowser = /FBAN|FBAV|FB_IAB|Instagram/i.test(ua);
  const iosNonSafari = isIOS && /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  const platform = isIOS ? 'ios' : isAndroid ? 'android' : 'desktop';
  /* Show the detected platform; fold the others into the details. */
  Object.keys(plats).forEach(k => {
    const el = plats[k];
    if (!el) return;
    if (k === platform) { el.hidden = false; }
    else if (otherBody) { el.hidden = false; otherBody.appendChild(el); }
  });
  if (other && otherBody && otherBody.children.length) other.hidden = false;
  function render() {
    if (step0fb) step0fb.hidden = !(inAppBrowser && !isIOS);
    if (step0ios) step0ios.hidden = !(isIOS && (inAppBrowser || iosNonSafari));
    if (installBtn) installBtn.hidden = !deferredInstallPrompt;
  }
  window.addEventListener('beforeinstallprompt', render);
  window.addEventListener('appinstalled', () => { if (installBtn) installBtn.hidden = true; });
  let lastFocus = null;
  function openSheet() {
    render();
    lastFocus = document.activeElement;
    sheet.hidden = false;
    if (backdrop) backdrop.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      sheet.classList.add('open');
      if (backdrop) backdrop.classList.add('open');
    }));
    document.body.classList.add('getapp-on');
    openBtns.forEach(b => b.setAttribute('aria-expanded', 'true'));
    if (closeBtn) closeBtn.focus();
  }
  function closeSheet() {
    if (sheet.hidden) return;
    sheet.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    document.body.classList.remove('getapp-on');
    openBtns.forEach(b => b.setAttribute('aria-expanded', 'false'));
    setTimeout(() => { sheet.hidden = true; if (backdrop) backdrop.hidden = true; }, 320);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  openBtns.forEach(b => b.addEventListener('click', () => {
    /* The drawer entry: close the drawer first, then open the sheet. */
    if (b.id === 'drawer-getapp-btn') {
      const dc = $('drawer-close');
      if (dc && !$('drawer').hidden) { dc.click(); setTimeout(openSheet, 340); return; }
    }
    openSheet();
  }));
  if (closeBtn) closeBtn.addEventListener('click', closeSheet);
  if (backdrop) backdrop.addEventListener('click', closeSheet);
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeSheet(); });
  if (installBtn) installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    try { await deferredInstallPrompt.userChoice; } catch (e) { /* ignore */ }
    deferredInstallPrompt = null;
    installBtn.hidden = true;
    closeSheet();
  });
  window.CCLOpenGetApp = openSheet;
}

/* ---------- end-of-Today signpost (v40) ---------- */
function initSignpost() {
  document.querySelectorAll('[data-signpost-view]').forEach(b =>
    b.addEventListener('click', () => {
      cclShowView(b.dataset ? b.dataset.signpostView : null);
      if (window.scrollTo) { try { window.scrollTo(0, 0); } catch (e) { /* noop */ } }
    }));
}

/* ---------- freshness board ---------- */
const FRESH_ROWS = [
  ['National Weather Service — alerts', 'alerts-updated', 'live'],
  ['National Weather Service — town forecasts', 'forecast-updated', 'live'],
  ['USGS — river gauges', 'rivers-updated', 'live'],
  ['NOAA — river tide predictions', 'tides-updated', 'live'],
  ['Sun & moon — computed on this page (almanac)', 'almanac-updated', 'live'],
  ['USGS — earthquakes', 'quakes-updated', 'live'],
  ['NIFC WFIGS — wildfires', 'fires-updated', 'live'],
  ['Air quality — Open-Meteo model estimate', 'air-updated', 'live'],
  ['ADS-B — aircraft overhead', 'sky-updated', 'mixed'],
  ['ISS orbit data — pass predictions (CelesTrak)', 'iss-passes-updated', 'live'],
  ['Tonight\u2019s sky — clouds & aurora (Open-Meteo / NOAA SWPC)', 'dark-updated', 'live'],
  ['Fetcher — roads, bridge & cameras (ODOT/WSDOT)', 'roads-updated', 'snapshot'],
  ['Fetcher — Bend run passes (ODOT)', 'bend-updated', 'snapshot'],
  ['Fetcher — Oscar B ferry alerts (Wahkiakum Co.)', 'ferry-updated', 'snapshot'],
  ['Fetcher — events (city & county calendars)', 'events-updated', 'snapshot'],
  ['Fetcher — river traffic (AIS)', 'ships-updated', 'snapshot'],
  ['Fetcher — fish counts & salmon tracker (FPC / DART)', 'fish-updated', 'snapshot'],
  ['Fetcher — steelhead basin rain (NOAA MRMS)', 'steelhead-updated', 'snapshot']
];
function renderFreshness() {
  const body = $('freshness-body');
  if (!body) return;
  body.innerHTML = FRESH_ROWS.map(([label, id, kind]) => {
    const t = FRESH[id];
    if (!t) {
      return '<div class="fresh-row"><span class="fresh-dot dot-none"></span><span class="fresh-label">'
        + esc(label) + '</span><span class="fresh-age">not loaded yet</span></div>';
    }
    const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    const cls = mins < 25 ? 'dot-ok' : mins < 75 ? 'dot-warn' : 'dot-bad';
    const age = mins < 1 ? 'just now' : mins < 60 ? mins + ' min old' : Math.round(mins / 60) + ' hr old';
    const verb = kind === 'snapshot' ? 'collected ' : 'updated ';
    return '<div class="fresh-row"><span class="fresh-dot ' + cls + '"></span><span class="fresh-label">'
      + esc(label) + '</span><span class="fresh-age">' + verb + age + '</span></div>';
  }).join('');
}

/* ---------- go ---------- */
initMap();
initMapTools();
initTownPicker();
initShare();
initInstallCard();
initGetApp();
initSignpost();
initEventFilters();
initSkyFilters();
loadGlance();
loadAlerts();
loadForecast(currentTown);
loadRivers();
loadQuakes();
loadFires();
loadAircraft();
loadISS();
loadRoads();
loadRouteAhead();
loadBend();

loadShips();
loadFerry();
tickFerryNext();
loadEvents();
setInterval(loadGlance, 10 * 60 * 1000);
setInterval(loadAlerts, 10 * 60 * 1000);
setInterval(loadRivers, 10 * 60 * 1000);
setInterval(loadQuakes, 30 * 60 * 1000);
setInterval(loadFires, 15 * 60 * 1000);
setInterval(loadAircraft, 45 * 1000);
setInterval(loadISS, 15 * 1000);
setInterval(loadRoads, 10 * 60 * 1000);
setInterval(loadBend, 10 * 60 * 1000);
setInterval(loadFish, 10 * 60 * 1000);
setInterval(loadCurrents, 30 * 60 * 1000);
setInterval(loadRouteAhead, 30 * 60 * 1000);
setInterval(loadShips, 10 * 60 * 1000);
setInterval(loadFerry, 10 * 60 * 1000);
setInterval(tickFerryNext, 20 * 1000);
setInterval(loadEvents, 30 * 60 * 1000);
setTimeout(renderFreshness, 2500);
setInterval(renderFreshness, 30 * 1000);

/* ---------- since you were away (return-visit briefing) ---------- */
const SINCE_KEY = 'ccl-since-v1';
function sinceLoad() {
  try { return JSON.parse(localStorage.getItem(SINCE_KEY) || 'null'); } catch (e) { return null; }
}
function sinceSave(state) {
  try { localStorage.setItem(SINCE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
}
async function initSince() {
  const card = $('since-card');
  const body = $('since-body');
  if (!card || !body) return;
  const dismiss = $('since-dismiss');
  if (dismiss) dismiss.addEventListener('click', () => { card.hidden = true; });
  const prev = sinceLoad();
  const cur = { t: Date.now(), alerts: null, riverFt: null, evKeys: null, evList: null };
  // Weather alerts — live from NWS, the same feed the alerts card uses
  try {
    const d = await getJSON(NWS_ALERTS_URL, { 'Accept': 'application/geo+json' });
    cur.alerts = (d.features || []).map(f => (f.properties || {}).event || 'Alert');
  } catch (e) { /* signal unavailable this visit */ }
  // Columbia River at Port Westward — live from USGS, the same series as the river tile
  try {
    const d = await getJSON(USGS_IV_URL);
    const ts = (d.value.timeSeries || []).find(t =>
      t.sourceInfo.siteCode[0].value === GAUGES[0].site && t.variable.variableCode[0].value === '00065');
    const clean = ((ts.values[0] && ts.values[0].value) || []).filter(v => v.value !== '-999999');
    if (clean.length) cur.riverFt = parseFloat(clean[clean.length - 1].value);
  } catch (e) { /* signal unavailable this visit */ }
  // Events — the same calendar snapshot the events card renders
  try {
    const snap = await getSnapshot('events.json');
    const today = todayStrPT();
    const evs = (snap.events || []).filter(ev => ev.date >= today).slice().sort((a, b) =>
      a.date === b.date ? parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time)
                        : (a.date < b.date ? -1 : 1));
    cur.evList = evs.map(ev => ({ key: ev.date + '|' + ev.title, title: ev.title, date: ev.date, time: ev.time || '' }));
    cur.evKeys = cur.evList.map(e => e.key);
  } catch (e) { /* signal unavailable this visit */ }

  if (!prev) {
    body.innerHTML = '<p class="since-welcome">👋 <strong>First visit?</strong> This spot keeps watch between your visits. Come back later and it will tell you what changed while you were away — new weather alerts, river movement, and new events on the calendar.</p>';
    card.hidden = false;
  } else if (cur.alerts || cur.riverFt != null || cur.evKeys) {
    const when = fmtDayTime(new Date(prev.t));
    const items = [];
    if (prev.alerts && cur.alerts) {
      const fresh = cur.alerts.filter(a => !prev.alerts.includes(a));
      const cleared = prev.alerts.filter(a => !cur.alerts.includes(a));
      fresh.slice(0, 2).forEach(a => items.push('⚠️ <strong>New alert:</strong> ' + esc(a)));
      if (fresh.length > 2) items.push('⚠️ …and ' + (fresh.length - 2) + ' more new alerts — see Weather Alerts below.');
      if (!fresh.length && cleared.length) {
        items.push('✅ Cleared since then: ' + esc(cleared[0]) + (cleared.length > 1 ? ' and ' + (cleared.length - 1) + ' more' : '') + '.');
      }
    }
    if (prev.riverFt != null && cur.riverFt != null) {
      const delta = cur.riverFt - prev.riverFt;
      if (Math.abs(delta) >= 0.3) {
        items.push('🌊 The Columbia at Port Westward is <strong>' + (delta > 0 ? 'up ' : 'down ')
          + num(Math.abs(delta), 1) + ' ft</strong> since your last visit — now ' + num(cur.riverFt, 2) + ' ft.');
      }
    }
    if (prev.evKeys && cur.evKeys) {
      const freshKeys = cur.evKeys.filter(k => !prev.evKeys.includes(k));
      if (freshKeys.length) {
        const first = (cur.evList || []).find(e => freshKeys.includes(e.key));
        items.push('📅 <strong>' + freshKeys.length + (freshKeys.length === 1 ? ' new event' : ' new events')
          + '</strong> added to the calendar' + (first
            ? ' — soonest: ' + esc(first.title) + ' (' + esc(fmtDay(new Date(first.date + 'T12:00:00'))) + (first.time ? ' ' + esc(first.time) : '') + ')'
            : '') + '.');
      }
    }
    body.innerHTML = '<p class="since-when">Since your last visit · ' + esc(when) + '</p>'
      + (items.length
        ? '<ul class="since-list">' + items.map(i => '<li>' + i + '</li>').join('') + '</ul>'
        : '<p class="since-quiet">All quiet — no new alerts, the river is holding, and nothing new on the calendar. The good kind of boring.</p>');
    card.hidden = false;
  }
  // This visit becomes the new baseline — per signal, so a feed that failed
  // today never erases a good older reading for that signal.
  sinceSave({ t: cur.t,
    alerts: cur.alerts || (prev && prev.alerts) || null,
    riverFt: cur.riverFt != null ? cur.riverFt : (prev && prev.riverFt != null ? prev.riverFt : null),
    evKeys: cur.evKeys || (prev && prev.evKeys) || null });
}
initSince();

/* ---------- the county briefing: today's answers, ready to take with you ----------
   Composed entirely from what the panels on this page are already showing —
   it never claims anything the page itself isn't showing. Anything still
   loading (or failed) is left out or said plainly, never filled in. */
function briefingClean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
function briefingPending(txt) { return !txt || /Loading|Checking|Locating|Working out|Putting/.test(txt); }
function buildBriefing() {
  const now = new Date();
  const lines = ['🌲 COLUMBIA COUNTY LIVE — ' + fmtDay(now) + ' · ' + fmtTime(now) + ' PT', ''];
  // rows = the same gathered facts, structured for the card's visual front.
  // One pass over the panels feeds both renderings — the designed summary a
  // visitor reads and the plain-text note the Copy button produces — so the
  // two can never drift apart.
  const rows = [];
  let ready = 0;
  // Weather alerts — from the alerts panel's own rendered state
  const ab = $('alerts-body');
  if (ab) {
    if (ab.querySelector('.no-alerts')) {
      lines.push('⚠️ Weather: no active watches, warnings, or advisories for Columbia County.');
      rows.push({ icon: '⚠️', label: 'Weather', body: 'No active watches, warnings, or advisories for Columbia County.' });
      ready++;
    } else {
      const heads = ab.querySelectorAll('.alert-item h3');
      if (heads.length) {
        lines.push('⚠️ WEATHER ALERTS IN EFFECT:');
        const items = [];
        heads.forEach(h => { const t = briefingClean(h.textContent); lines.push('• ' + t); items.push(t); });
        rows.push({ icon: '⚠️', label: 'Weather alerts in effect', items, alert: true });
        ready++;
      } else if (ab.querySelector('.fallback')) {
        lines.push('⚠️ Weather alerts couldn\'t load just now — check weather.gov before heading out.');
        rows.push({ icon: '⚠️', label: 'Weather', body: 'Alerts couldn\'t load just now — check weather.gov before heading out.' });
      }
    }
  }
  // Forecast — the first period of the town the forecast card is showing
  const fb = $('forecast-body');
  if (fb) {
    const per = fb.querySelector('.period');
    if (per) {
      const name = briefingClean((per.querySelector('h4') || {}).textContent);
      const temp = briefingClean((per.querySelector('.temp') || {}).textContent);
      const paras = per.querySelectorAll('p');
      const short = paras.length ? briefingClean(paras[0].textContent) : '';
      const extra = paras.length > 1 ? briefingClean(paras[1].textContent) : '';
      lines.push('🌦️ ' + currentTown.name + (name ? ' · ' + name : '') + ': ' + temp
        + (short ? ' — ' + short : '') + (extra ? ' (' + extra + ')' : ''));
      rows.push({ icon: '🌦️', label: currentTown.name + (name ? ' · ' + name : ''),
        temp, body: (short ? ' — ' + short : '') + (extra ? ' (' + extra + ')' : '') });
      ready++;
    }
  }
  // Commute verdict — the headline sentence from the roads card
  const cv = $('commute-verdict');
  if (cv) {
    const head = cv.querySelector('.cv-head');
    if (head && !briefingPending(head.textContent)) {
      const t = briefingClean(head.textContent);
      lines.push('🚗 Commute: ' + t);
      rows.push({ icon: '🚗', label: 'Commute', body: t });
      ready++;
    }
  }
  // Bridge + river — the same glance tiles at the top of the page
  const bv = briefingClean(($('glance-bridge-val') || {}).textContent);
  if (bv && !briefingPending(bv)) { lines.push('🌉 Lewis & Clark Bridge: ' + bv + '.'); rows.push({ icon: '🌉', label: 'Lewis & Clark Bridge', body: bv + '.' }); ready++; }
  const rv = briefingClean(($('glance-river-val') || {}).textContent);
  if (rv && !briefingPending(rv)) { lines.push('🌊 Columbia River at Port Westward: ' + rv + '.'); rows.push({ icon: '🌊', label: 'Columbia River at Port Westward', body: rv + '.' }); ready++; }
  // Ferry — the next-boat headline the ferry card is showing
  const fn = $('ferry-next');
  if (fn) {
    const head = fn.querySelector('.ferry-next-head');
    if (head && !briefingPending(head.textContent)) {
      const t = briefingClean(head.textContent);
      lines.push('⛴️ ' + t);
      rows.push({ icon: '⛴️', body: t });
      ready++;
    }
  }
  // Today's events — from the same snapshot the events card renders
  if (eventsCache && (eventsCache.events || []).length) {
    const today = todayStrPT();
    const todays = eventsCache.events.filter(ev => ev.date === today)
      .slice().sort((a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time));
    if (todays.length) {
      lines.push('📅 Today around the county (' + todays.length + (todays.length === 1 ? ' event' : ' events') + '):');
      const items = [];
      todays.slice(0, 4).forEach(ev => {
        const t = (ev.time ? ev.time + ' — ' : '') + ev.title + (ev.source ? ' (' + ev.source + ')' : '');
        lines.push('• ' + t); items.push(t);
      });
      const row = { icon: '📅', label: 'Today around the county · ' + todays.length + (todays.length === 1 ? ' event' : ' events'), items };
      if (todays.length > 4) { const more = '…and ' + (todays.length - 4) + ' more — the full list is on the page.'; lines.push('• ' + more); row.note = more; }
      rows.push(row);
    } else {
      lines.push('📅 Nothing on the city/county calendars today.');
      rows.push({ icon: '📅', body: 'Nothing on the city/county calendars today.' });
    }
    ready++;
  }
  lines.push('');
  lines.push('Live page (updates all day): https://travweber67.github.io/columbia-county-live/');
  lines.push('Sources: National Weather Service · USGS · ODOT/WSDOT snapshots · city & county calendars. Assembled '
    + fmtTime(now) + ' PT — the live page always has the newest numbers.');
  return { text: lines.join('\n'), ready, rows };
}
/* The card's visual front: the briefing rendered as designed rows, built
   from the same structured pass (buildBriefing) that produces the copied
   text — so what a visitor reads here and what they paste from the Copy
   button are the same words from the same source. The raw note text is
   never displayed; it is generated in the background for copy/share. */
function briefingRowHtml(r) {
  let h = '<div class="briefing-row' + (r.alert ? ' briefing-row-alert' : '') + '">'
    + '<span class="briefing-ico" aria-hidden="true">' + r.icon + '</span>'
    + '<div class="briefing-main">';
  if (r.label) h += '<div class="briefing-label">' + esc(r.label) + '</div>';
  if (r.temp || r.body) {
    h += '<div class="briefing-body">'
      + (r.temp ? '<span class="briefing-temp">' + esc(r.temp) + '</span>' : '')
      + (r.body ? esc(r.body) : '') + '</div>';
  }
  if (r.items && r.items.length) {
    h += '<ul class="briefing-items">' + r.items.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>';
  }
  if (r.note) h += '<div class="briefing-more">' + esc(r.note) + '</div>';
  return h + '</div></div>';
}
/* v40: the composed HTML is cached and the DOM is only replaced when
   it actually changed. The old code rebuilt #briefing-view from
   scratch every 30 s; on browsers without scroll anchoring (iOS
   Safari, app webviews) each rebuild could yank the page back to the
   card — the "it bounces back to the briefing" report. Identical
   rebuilds, the common case, are now no-ops: the node is untouched. */
let lastBriefingHtml = null;
function refreshBriefing() {
  const view = $('briefing-view');
  if (!view) return;
  const b = buildBriefing();
  const html = b.ready
    ? b.rows.map(briefingRowHtml).join('')
      + '<p class="briefing-foot">Sources: National Weather Service · USGS · ODOT/WSDOT snapshots · city &amp; county calendars. The live page always has the newest numbers.</p>'
    : '<p class="briefing-loading">Still gathering today\'s answers — the panels on this page update first, and this summary follows within the minute.</p>';
  if (html !== lastBriefingHtml) {
    lastBriefingHtml = html;
    view.innerHTML = html;
  }
  const up = $('briefing-updated');
  if (up && b.ready) up.textContent = 'Assembled ' + fmtTime(new Date());
}
function initBriefing() {
  if (!$('briefing-card')) return;
  const note = $('briefing-note');
  const showNote = msg => { if (note) { note.textContent = msg; note.hidden = false; } };
  const copyBtn = $('briefing-copy-btn');
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    refreshBriefing();
    const text = buildBriefing().text;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) { /* clipboard API unavailable — manual fallback below */ }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = !!document.execCommand('copy');
        ta.remove();
      } catch (e) { ok = false; }
    }
    showNote(ok
      ? '✅ Copied — paste it into a text, a post, anywhere. It is stamped with the time it was assembled; the live page stays newer.'
      : 'Copy didn\'t work in this browser — try again, or use Share as text if that button shows above.');
  });
  const shareBtn = $('briefing-share-btn');
  if (shareBtn && navigator.share) {
    shareBtn.hidden = false;
    shareBtn.addEventListener('click', async () => {
      refreshBriefing();
      try { await navigator.share({ title: 'Columbia County Live — today\'s briefing', text: buildBriefing().text }); }
      catch (e) { /* the visitor closed the share sheet — nothing to report */ }
    });
  }
  setTimeout(refreshBriefing, 6000);
  setInterval(refreshBriefing, 30 * 1000);
}
initBriefing();

/* ---------- my town: the page tunes itself around where you live ----------
   Phase 1 is a daily habit, and habits are personal. Pick a home town once
   (kept in this browser's local storage) and the
   forecast opens on it, the map starts there, that town's calendar events
   wear a 📍 badge, and the at-a-glance strip prefers its next event. */
const HOME_KEY = 'ccl-home-town-v1';
let homeTown = null;
let homeVisitor = false;
let homeForecastTouched = false;
// Towns whose calendars the fetcher actually reads (see data/events.json sources).
const HOME_CAL_TOWNS = ['St. Helens', 'Scappoose'];

function homeLoadPref() {
  try {
    const v = window.localStorage.getItem(HOME_KEY);
    if (v === 'visitor') homeVisitor = true;
    else if (v) homeTown = TOWNS.find(t => t.name === v) || null;
  } catch (e) { /* storage blocked — the picker still works for this visit */ }
}
function homeSavePref() {
  try {
    if (homeTown) window.localStorage.setItem(HOME_KEY, homeTown.name);
    else if (homeVisitor) window.localStorage.setItem(HOME_KEY, 'visitor');
    else window.localStorage.removeItem(HOME_KEY);
  } catch (e) { /* non-fatal */ }
}
function renderHome() {
  const body = $('home-body');
  if (!body) return;
  if (homeTown) {
    body.innerHTML = '<p class="home-status">🏠 Your town: <strong>' + esc(homeTown.name) + '</strong> — the forecast opens on '
      + esc(homeTown.name) + ', the map starts there, and the at-a-glance strip prefers its next event. '
      + '<span id="home-cal-note"></span></p>'
      + '<div class="home-actions">'
      + '<button class="share-btn" id="home-change-btn" type="button">Change town</button>'
      + '<button class="share-btn" id="home-clear-btn" type="button">Show the whole county</button></div>';
    $('home-change-btn').addEventListener('click', renderHomePicker);
    $('home-clear-btn').addEventListener('click', () => {
      homeTown = null; homeVisitor = false; homeSavePref();
      renderHomePicker();
      homeApplyBadges();
      loadGlance(); // restore the county-wide next-event tile
      loadShips(); // ETAs fall back to the St. Helens river point
    });
    homeRefreshCalNote();
  } else if (homeVisitor) {
    body.innerHTML = '<p class="home-status">🌎 Showing the whole county, no home town set. '
      + '<button class="home-linkbtn" id="home-pick-btn" type="button">Pick a home town instead</button></p>';
    $('home-pick-btn').addEventListener('click', renderHomePicker);
  } else {
    renderHomePicker();
  }
}
function renderHomePicker() {
  const body = $('home-body');
  if (!body) return;
  body.innerHTML = '<p class="card-note">Where\'s home? Pick your town once and this page remembers, and tunes itself around you: your forecast first, your town on the map, your town\'s events badged, its next event preferred up top.</p>'
    + '<div class="home-chips">' + TOWNS.map(t =>
        '<button class="home-chip' + (homeTown && homeTown.name === t.name ? ' active' : '')
        + '" type="button" data-home-town="' + esc(t.name) + '">' + esc(t.name) + '</button>').join('') + '</div>'
    + '<p class="home-visit"><button class="home-linkbtn" id="home-visitor-btn" type="button">Just visiting — show me the whole county</button></p>';
  body.querySelectorAll('.home-chip').forEach(b => b.addEventListener('click', () => {
    const t = TOWNS.find(x => x.name === b.dataset.homeTown);
    if (!t) return;
    homeTown = t; homeVisitor = false; homeSavePref();
    renderHome();
    homeApplyAll(true);
  }));
  $('home-visitor-btn').addEventListener('click', () => {
    homeTown = null; homeVisitor = true; homeSavePref();
    renderHome();
    homeApplyBadges();
  });
}
function homeRefreshCalNote() {
  const note = $('home-cal-note');
  if (!note || !homeTown) return;
  if (HOME_CAL_TOWNS.indexOf(homeTown.name) === -1) {
    note.textContent = homeTown.name + ' doesn\'t have a calendar in our sources yet, so events stay county-wide for you.';
    return;
  }
  if (!eventsCache) {
    note.textContent = 'Events from ' + homeTown.name + '\'s calendar wear a 📍 badge.';
    return;
  }
  const n = (eventsCache.events || []).filter(ev => (ev.source || '').indexOf(homeTown.name) !== -1).length;
  note.textContent = n
    ? n + ' upcoming event' + (n === 1 ? '' : 's') + ' from ' + homeTown.name + '\'s calendar below wear a 📍 Your town badge.'
    : homeTown.name + '\'s calendar is in our sources — it\'s quiet right now, and its events will wear a 📍 badge when they appear.';
}
// Switch the forecast once the boot-time load has settled, so the two loads
// never race to paint the card. Gives up if the visitor picks a forecast
// town by hand in the meantime.
function homeForecastSettle() {
  if (!homeTown || homeTown.name === currentTown.name) return;
  const attempt = () => {
    if (!homeTown || homeForecastTouched || currentTown.name === homeTown.name) return true;
    const b = $('forecast-body');
    if (b && !/Loading/.test(b.textContent || '')) { loadForecast(homeTown); return true; }
    return false;
  };
  if (attempt()) return;
  let tries = 0;
  const iv = setInterval(() => { tries++; if (attempt() || tries > 20) clearInterval(iv); }, 400);
}
function homeApplyBadges() {
  const body = $('events-body');
  if (!body) return;
  const want = homeTown ? homeTown.name : '';
  const hasBadges = !!body.querySelector('.event-home-badge');
  if (body.dataset.homeBadged === want && hasBadges === !!want) return; // converged — observer-safe
  body.querySelectorAll('.event-home-badge').forEach(el => el.remove());
  body.querySelectorAll('.event-row-home').forEach(el => el.classList.remove('event-row-home'));
  if (want) {
    body.querySelectorAll('.event-row').forEach(row => {
      const src = row.querySelector('.event-src');
      if (src && src.textContent.indexOf(want) !== -1) {
        row.classList.add('event-row-home');
        const badge = document.createElement('span');
        badge.className = 'event-home-badge';
        badge.textContent = '📍 Your town';
        row.appendChild(badge);
      }
    });
  }
  body.dataset.homeBadged = want;
}
// Prefer the home town's next event in the at-a-glance tile; if the town has
// nothing coming up, leave the county-wide answer the glance loader put there.
function homeGlancePass() {
  if (!homeTown || !eventsCache || !eventsCache.events) return;
  const today = todayStrPT();
  const mine = eventsCache.events
    .filter(ev => ev.date >= today && (ev.source || '').indexOf(homeTown.name) !== -1)
    .sort((a, b) => a.date === b.date
      ? parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time)
      : (a.date < b.date ? -1 : 1));
  if (!mine.length) return;
  const ev = mine[0];
  const el = $('glance-events-val');
  if (!el) return;
  const tile = el.closest('.glance-tile');
  const sub = tile && tile.querySelector('.glance-sub');
  const when = ev.date === today ? 'Today ' + (ev.time || '')
    : fmtDay(new Date(ev.date + 'T12:00:00')) + ' ' + (ev.time || '');
  const wantSub = when + ' · in ' + homeTown.name;
  if (el.textContent !== ev.title) el.textContent = ev.title;
  el.title = ev.title;
  if (sub && sub.textContent !== wantSub) sub.textContent = wantSub;
}
function homeApplyAll(flyMap) {
  if (!homeTown) return;
  homeForecastSettle();
  if (flyMap && map) { try { map.flyTo([homeTown.lat, homeTown.lon], 12); } catch (e) { /* map is decorative here */ } }
  homeApplyBadges();
  homeGlancePass();
  loadShips(); // the passing-soon ETAs are computed at the home town
}
function initHome() {
  homeLoadPref();
  renderHome();
  const tp = $('town-picker');
  if (tp) tp.addEventListener('click', () => { homeForecastTouched = true; }, true);
  if (window.MutationObserver) {
    const eb = $('events-body');
    if (eb) new MutationObserver(() => { homeApplyBadges(); homeGlancePass(); homeRefreshCalNote(); })
      .observe(eb, { childList: true, subtree: true });
    const gv = $('glance-events-val');
    const tile = gv && gv.closest('.glance-tile');
    if (tile) new MutationObserver(() => homeGlancePass())
      .observe(tile, { childList: true, subtree: true, characterData: true });
  }
  if (homeTown) homeApplyAll(true);
}
initHome();

/* ---------- offline: service worker + the honest offline note (X20 R4) ----------
   The corridor has dead zones, and the moments this page matters most —
   storms, closures, high water — are the moments signal is worst. A service
   worker (sw.js) keeps the shell, the photos, and the last real snapshots on
   the phone: return visits load instantly, and an offline visit shows the
   last collected readings instead of a browser error. Live feeds are never
   cached by the worker, so nothing offline ever pretends to be live — the
   snapshot stamps and the freshness board keep telling their true ages.
   Registration failure is silent: the site works exactly as before without it. */
function initOffline() {
  if ('serviceWorker' in navigator) {
    try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) { /* no worker, no problem */ }
  }
  const note = $('offline-note');
  if (!note) return;
  const paint = () => { note.hidden = navigator.onLine !== false; };
  window.addEventListener('offline', paint);
  window.addEventListener('online', paint);
  paint();
}
initOffline();

/* ---------- tonight & tomorrow: the evening planning brief (X20 R5) ----------
   Every synthesis on this page so far is present-tense — the glance, the
   commute verdict, the since-card, the briefing all answer "right now". But
   a commuter county runs on two checks a day, and the second one happens
   the night before: tonight's low and frost, tomorrow morning's drive
   weather, the first ferry sailings, what's on tomorrow. This card
   assembles that forward brief from the same official feeds the rest of
   the page already uses (NWS forecast periods, USGS gauge series, the
   Wahkiakum timetable, the calendar snapshot) — nothing is predicted here
   that a source didn't say first, and each line is omitted or stated
   plainly when its source can't be read. */
function planPtDateStr(date) {
  return new Intl.DateTimeFormat('en-CA',
    { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function planTomorrowStr() {
  const parts = new Intl.DateTimeFormat('en-CA',
    { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const get = t => parseInt((parts.find(p => p.type === t) || {}).value, 10);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day') + 1)).toISOString().slice(0, 10);
}
async function planForecastLines(town) {
  if (!forecastUrlCache[town.name]) {
    const pts = await getJSON('https://api.weather.gov/points/'
      + town.lat.toFixed(4) + ',' + town.lon.toFixed(4));
    forecastUrlCache[town.name] = pts.properties.forecast;
  }
  const fc = await getJSON(forecastUrlCache[town.name]);
  const periods = fc.properties.periods || [];
  const nowMs = Date.now();
  const tonight = periods.find(p => !p.isDaytime && new Date(p.endTime).getTime() > nowMs) || null;
  let morning = null;
  if (tonight) {
    const tEnd = new Date(tonight.endTime).getTime();
    morning = periods.find(p => p.isDaytime && new Date(p.startTime).getTime() >= tEnd - 60000) || null;
  }
  if (!morning) {
    const tm = planTomorrowStr();
    morning = periods.find(p => p.isDaytime && planPtDateStr(new Date(p.startTime)) === tm) || null;
  }
  const lines = [];
  if (tonight) {
    lines.push('<li><span class="plan-ico">🌙</span><span><strong>' + esc(tonight.name)
      + ' in ' + esc(town.name) + ':</strong> ' + esc(tonight.shortForecast)
      + ' · low around ' + tonight.temperature + '°' + esc(tonight.temperatureUnit) + '.</span></li>');
  }
  if (morning) {
    const rain = (morning.probabilityOfPrecipitation && morning.probabilityOfPrecipitation.value != null)
      ? ' · rain ' + morning.probabilityOfPrecipitation.value + '%' : '';
    let warn = '';
    if (/(snow|ice|icy|frost|freez)/i.test(morning.shortForecast || '')) {
      warn = ' <span class="plan-warn">⚠️ The forecast itself mentions it — that can mean slick roads before sunrise; leave extra margin.</span>';
    }
    lines.push('<li><span class="plan-ico">🌅</span><span><strong>Tomorrow morning ('
      + esc(fmtDay(new Date(morning.startTime))) + '):</strong> ' + esc(morning.shortForecast)
      + ' · ' + morning.temperature + '°' + esc(morning.temperatureUnit) + rain + '.' + warn + '</span></li>');
  }
  return lines;
}
async function planFerryLine() {
  let alert = false;
  try {
    const snap = await getSnapshot('ferry.json');
    alert = (snap.status === 'ok' && !!snap.alert);
  } catch (e) { /* timetable below is fixed regardless */ }
  const firsts = FERRY_SIDES.map(s => {
    const n = nextSailing(s, { h: 0, m: 1 });
    return { label: s.label.replace(' side', ''), when: fmtClock(n.hour, n.minute) };
  }).sort((a, b) => parseTimeToMinutes(a.when) - parseTimeToMinutes(b.when));
  let html = '<li><span class="plan-ico">⛴️</span><span><strong>First Oscar B sailings tomorrow:</strong> '
    + firsts.map(f => esc(f.label) + ' ' + esc(f.when)).join(' · ') + '.';
  if (alert) html += ' <span class="plan-warn">⚠️ A ferry closure alert is posted — check the ferry card below before counting on them.</span>';
  return html + '</span></li>';
}
async function planEventsLine() {
  const snap = await getSnapshot('events.json');
  const fbSnap = await getFbEventsSnap();
  const allEvents = mergeFbInto(snap.events || [], fbSnap);
  const tm = planTomorrowStr();
  const list = allEvents.filter(ev => ev.date === tm)
    .slice().sort((a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time));
  const tp = tm.split('-').map(Number);
  const label = fmtDay(new Date(Date.UTC(tp[0], tp[1] - 1, tp[2], 12)));
  if (!list.length) {
    return '<li><span class="plan-ico">📅</span><span><strong>Tomorrow (' + esc(label)
      + '):</strong> nothing on the city or county calendars.</span></li>';
  }
  const named = list.slice(0, 3).map(ev =>
    (ev.time ? esc(ev.time) + ' ' : '') + esc(ev.title)).join(' · ');
  const more = list.length > 3 ? ' · +' + (list.length - 3) + ' more in the events card' : '';
  return '<li><span class="plan-ico">📅</span><span><strong>Tomorrow (' + esc(label) + '):</strong> '
    + list.length + (list.length === 1 ? ' event' : ' events') + ' around the county — ' + named + more + '.</span></li>';
}
async function planRiverLine() {
  const d = await getJSON(USGS_IV_URL);
  const want = { '14246900': 'Columbia at Port Westward', '14299800': 'Nehalem at Vernonia' };
  const found = {};
  (d.value.timeSeries || []).forEach(ts => {
    const code = ts.sourceInfo.siteCode[0].value;
    if (!want[code] || ts.variable.variableCode[0].value !== '00065') return;
    const clean = ((ts.values[0] && ts.values[0].value) || []).filter(v => v.value !== '-999999');
    if (clean.length < 2) return;
    const last = clean[clean.length - 1];
    const target = new Date(last.dateTime).getTime() - 6 * 3600 * 1000;
    let best = clean[0], bd = Infinity;
    clean.forEach(v => {
      const dd = Math.abs(new Date(v.dateTime).getTime() - target);
      if (dd < bd) { bd = dd; best = v; }
    });
    const delta = parseFloat(last.value) - parseFloat(best.value);
    found[code] = { v: parseFloat(last.value), dir: delta > 0.05 ? 'rising' : (delta < -0.05 ? 'falling' : 'steady') };
  });
  const bits = Object.keys(want).filter(c => found[c])
    .map(c => want[c] + ' ' + num(found[c].v, 2) + ' ft and ' + found[c].dir);
  if (!bits.length) return null;
  return '<li><span class="plan-ico">🌊</span><span><strong>Rivers heading into tomorrow:</strong> '
    + esc(bits.join(' · ')) + ' (last 6 hours).</span></li>';
}
async function buildPlan() {
  const body = $('plan-body');
  if (!body) return;
  const town = homeTown || TOWNS[0];
  const settle = p => p.catch(() => null);
  const [fcLines, ferry, events, river] = await Promise.all([
    settle(planForecastLines(town)), settle(planFerryLine()),
    settle(planEventsLine()), settle(planRiverLine())
  ]);
  const lines = [];
  if (fcLines) lines.push.apply(lines, fcLines);
  if (river) lines.push(river);
  if (ferry) lines.push(ferry);
  if (events) lines.push(events);
  if (!lines.length) {
    body.innerHTML = '<p class="fallback">Tonight\'s brief couldn\'t be assembled just now — the panels below carry the live numbers as always.</p>';
    return;
  }
  body.innerHTML = '<ul class="plan-lines">' + lines.join('') + '</ul>'
    + '<p class="plan-src">Sources: National Weather Service forecast for ' + esc(town.name)
    + ' · USGS gauges · Wahkiakum County ferry timetable · city &amp; county calendars.</p>';
  const up = $('plan-updated');
  if (up) up.textContent = 'Assembled ' + fmtTime(new Date());
}
function initPlan() {
  if (!$('plan-card')) return;
  buildPlan();
  setTimeout(buildPlan, 10000);
  setInterval(buildPlan, 5 * 60 * 1000);
}
initPlan();

/* ---------- events: take it with you (add to your own calendar) ---------- */
// The events card stops being read-only. Every upcoming event gets a
// one-tap "＋ Add" that builds a real .ics calendar file on the spot —
// title, the Pacific start time converted to UTC, the listing source, and
// the official event page — so the visitor's own phone calendar becomes
// the reminder system: it pings them the day of the library storytime or
// the council meeting, and every ping is a reason this page exists.
// The file is generated in the browser from the same snapshot the card
// renders. Cancelled
// events get no button — adding a cancelled meeting to your calendar is
// a trap, not a feature. The calendar block is set to one hour and the
// file says so honestly, pointing at the official page for the real end
// time; events with no listed time become all-day entries.
let evcalByKey = {};
function evcalKeyOf(ev) {
  return [ev.date || '', ev.time || '', ev.title || ''].join('|');
}
function evcalIsCancelled(ev) {
  return /cancel{1,2}ed/i.test(ev.title || '');
}
function evcalHasTime(ev) {
  return /\d{1,2}(:\d{2})?\s*(AM|PM)/i.test(ev.time || '');
}
function evcalPtOffsetMs(utcMs) {
  // How far Pacific Time's wall clock sits ahead of UTC at this instant.
  const parts = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(utcMs))
    .forEach(p => { parts[p.type] = p.value; });
  const wallAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day,
    (+parts.hour) % 24, +parts.minute, +parts.second);
  return wallAsUtc - Math.floor(utcMs / 1000) * 1000;
}
function evcalStartUtc(ev) {
  const [y, mo, d] = String(ev.date || '').split('-').map(Number);
  if (!y || !mo || !d) return null;
  const mins = parseTimeToMinutes(ev.time);
  const wallUtc = Date.UTC(y, mo - 1, d, Math.floor(mins / 60), mins % 60);
  // Two passes: the offset depends on the instant, which depends on it.
  let utc = wallUtc - evcalPtOffsetMs(wallUtc + 8 * 3600e3);
  utc = wallUtc - evcalPtOffsetMs(utc);
  return new Date(utc);
}
function evcalStamp(date) {
  const p = n => String(n).padStart(2, '0');
  return date.getUTCFullYear() + p(date.getUTCMonth() + 1) + p(date.getUTCDate())
    + 'T' + p(date.getUTCHours()) + p(date.getUTCMinutes()) + p(date.getUTCSeconds()) + 'Z';
}
function evcalDateStr(dateStr, addDays) {
  const [y, mo, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !mo || !d) return '';
  const dt = new Date(Date.UTC(y, mo - 1, d + (addDays || 0)));
  const p = n => String(n).padStart(2, '0');
  return dt.getUTCFullYear() + p(dt.getUTCMonth() + 1) + p(dt.getUTCDate());
}
function evcalEscText(s) {
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;')
    .replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function evcalFold(line) {
  // RFC 5545 folds content lines at 75 octets; titles here are short, this
  // guards the long description / URL lines.
  const out = [];
  let rest = String(line);
  while (rest.length > 73) { out.push(rest.slice(0, 73)); rest = ' ' + rest.slice(73); }
  out.push(rest);
  return out;
}
function evcalUid(ev) {
  const s = evcalKeyOf(ev);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return 'evcal-' + h.toString(16) + '@columbiacountylive';
}
function evcalIcs(ev) {
  const desc = 'Listed by ' + (ev.source || 'a local calendar')
    + ' and collected by Columbia County Live.'
    + (evcalHasTime(ev)
      ? ' The calendar block is set to one hour — check the official event page for the real end time, the place, and any changes: '
      : ' No start time was listed — this is an all-day entry. Check the official event page for the time, the place, and any changes: ')
    + (ev.url || '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'PRODID:-//Columbia County Live//Events//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + evcalUid(ev),
    'DTSTAMP:' + evcalStamp(new Date())
  ];
  if (evcalHasTime(ev)) {
    const start = evcalStartUtc(ev);
    if (!start) return null;
    lines.push('DTSTART:' + evcalStamp(start), 'DURATION:PT1H');
  } else {
    const day = evcalDateStr(ev.date, 0);
    if (!day) return null;
    lines.push('DTSTART;VALUE=DATE:' + day, 'DTEND;VALUE=DATE:' + evcalDateStr(ev.date, 1));
  }
  lines.push('SUMMARY:' + evcalEscText(ev.title));
  lines.push('DESCRIPTION:' + evcalEscText(desc));
  if (ev.url) lines.push('URL:' + ev.url);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.flatMap(evcalFold).join('\r\n') + '\r\n';
}
function evcalDownload(ev, btn) {
  const ics = evcalIcs(ev);
  if (!ics) return;
  try {
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ccl-' + String(ev.title || 'event').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) + '.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 4000);
    if (btn) {
      const old = btn.textContent;
      btn.textContent = '✓ Added — open the file';
      btn.classList.add('evcal-added');
      setTimeout(() => { btn.textContent = old; btn.classList.remove('evcal-added'); }, 3500);
    }
  } catch (e) { /* very old browser: the row's official-page link still works */ }
}
function evcalAddButtons() {
  const body = $('events-body');
  if (!body || !eventsCache || !eventsCache.events) return;
  evcalByKey = {};
  eventsCache.events.forEach(ev => { evcalByKey[evcalKeyOf(ev)] = ev; });
  body.querySelectorAll('.event-row').forEach(row => {
    if (row.querySelector('.evcal-btn')) return; // already served — observer-safe
    const timeEl = row.querySelector('.event-time');
    const titleEl = row.querySelector('.event-title');
    if (!titleEl) return;
    const link = titleEl.querySelector('a');
    const title = (link ? link.textContent : titleEl.textContent || '').trim();
    const time = timeEl ? (timeEl.textContent || '').trim() : '';
    const href = link
      ? (typeof link.getAttribute === 'function' ? link.getAttribute('href')
         : (link.attrs && link.attrs.href) || link.href || '')
      : '';
    const cands = eventsCache.events.filter(e =>
      (e.title || '') === title && (e.time || '') === time);
    if (!cands.length) return;
    const ev = (cands.length > 1 && href
      ? cands.find(e => e.url === href) : null) || cands[0];
    if (!ev || evcalIsCancelled(ev)) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'evcal-btn';
    btn.textContent = '＋ Add';
    btn.title = 'Add "' + ev.title + '" to your calendar';
    btn.dataset.evcal = evcalKeyOf(ev);
    row.appendChild(btn);
  });
}
function initEvCal() {
  const body = $('events-body');
  if (!body) return;
  body.addEventListener('click', e => {
    const t = e && e.target;
    const btn = t && typeof t.closest === 'function' ? t.closest('.evcal-btn') : null;
    if (!btn) return;
    const ev = evcalByKey[btn.dataset.evcal];
    if (ev) evcalDownload(ev, btn);
  });
  if (typeof MutationObserver !== 'undefined') {
    let busy = false;
    const obs = new MutationObserver(() => {
      if (busy) return;
      busy = true;
      try { evcalAddButtons(); } finally { busy = false; }
    });
    obs.observe(body, { childList: true, subtree: true });
  }
  evcalAddButtons();
}
initEvCal();

/* ---------- hear it: the spoken briefing ----------
   Sixteen changes in, everything on this page was visual — but the page's
   core moments are eyes-busy: the US-30 drive the commute verdict serves,
   the run to the ferry landing, hands full, eyes tired, low vision. So the
   briefing card grows a voice. The script is composed for ears from the
   same rendered panel state the text briefing reads — weather alerts
   first, by name; anything not yet loaded is skipped, never invented; a
   failed alerts feed is announced out loud, not hidden. Speech uses the
   phone's own built-in voice (SpeechSynthesis). Each composed line is
   its own short utterance, which also dodges the long-utterance cutoffs
   some browsers impose. The button only appears where the browser can actually speak —
   the same progressive-enhancement rule as the share button. */
let voiceOn = false;
let voiceSession = 0;
function voiceClean(s) {
  return briefingClean(s)
    .replace(/&/g, ' and ')
    .replace(/·/g, ', ')
    .replace(/[—–]/g, ', ')
    .replace(/°F/g, ' degrees')
    .replace(/\(s\)/g, 's')
    .replace(/\bSt\./g, 'Saint')
    .replace(/\bMt\./g, 'Mount')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}\u{2500}-\u{25FF}\u{2190}-\u{21FF}\uFE0F]/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .trim();
}
function buildSpokenBriefing() {
  const now = new Date();
  const lines = ['Columbia County Live. Your county briefing for ' + fmtDay(now)
    + ', as of ' + fmtTime(now) + ' Pacific time.'];
  let ready = 0;
  // Weather alerts first — safety before everything, by name
  const ab = $('alerts-body');
  if (ab) {
    if (ab.querySelector('.no-alerts')) {
      lines.push('Weather alerts: none in effect for Columbia County.');
      ready++;
    } else {
      const names = [];
      ab.querySelectorAll('.alert-item h3').forEach(h => names.push(voiceClean(h.textContent)));
      if (names.length) {
        lines.push('Weather alerts in effect: ' + names.join('. ') + '.');
        ready++;
      } else if (ab.querySelector('.fallback')) {
        lines.push('Weather alerts could not load just now. Check weather dot gov before heading out.');
      }
    }
  }
  // Forecast — the town and first period the forecast card is showing
  const fb = $('forecast-body');
  if (fb) {
    const per = fb.querySelector('.period');
    if (per) {
      const name = briefingClean((per.querySelector('h4') || {}).textContent);
      const temp = briefingClean((per.querySelector('.temp') || {}).textContent);
      const paras = per.querySelectorAll('p');
      const short = paras.length ? briefingClean(paras[0].textContent) : '';
      const extra = paras.length > 1 ? briefingClean(paras[1].textContent) : '';
      lines.push(voiceClean(currentTown.name + ' forecast' + (name ? ', ' + name : '') + ': '
        + temp + (short ? '. ' + short : '') + (extra ? '. ' + extra : '') + '.'));
      ready++;
    }
  }
  // Commute verdict — the headline, plus its specifics when it isn't clear
  const cv = $('commute-verdict');
  if (cv) {
    const head = cv.querySelector('.cv-head');
    if (head && !briefingPending(head.textContent)) {
      let line = 'Commute: ' + voiceClean(head.textContent) + '.';
      const sub = cv.querySelector('.cv-sub');
      if (sub && /(cv-warn|cv-bad)/.test(cv.className)) line += ' ' + voiceClean(sub.textContent) + '.';
      lines.push(line);
      ready++;
    }
  }
  // Bridge + river — the glance tiles, translated for ears
  const bv = briefingClean(($('glance-bridge-val') || {}).textContent);
  if (bv && !briefingPending(bv)) { lines.push('Lewis and Clark Bridge: ' + voiceClean(bv) + '.'); ready++; }
  let rv = briefingClean(($('glance-river-val') || {}).textContent);
  if (rv && !briefingPending(rv)) {
    rv = rv.replace('▲ rising', 'and rising').replace('▼ falling', 'and falling').replace('→ steady', 'and steady')
           .replace('▲', 'and rising').replace('▼', 'and falling').replace('→', 'and steady')
           .replace(/\bft\b/g, 'feet');
    lines.push('Columbia River at Port Westward: ' + voiceClean(rv) + '.');
    ready++;
  }
  // Ferry — the next-boat headline, arrows and abbreviations spelled out
  const fn = $('ferry-next');
  if (fn) {
    const head = fn.querySelector('.ferry-next-head');
    if (head && !briefingPending(head.textContent)) {
      lines.push(voiceClean(head.textContent.replace(/→/g, ' to ')
        .replace(/\b(\d+) min\b/g, '$1 minutes')) + '.');
      ready++;
    }
  }
  // Today's events — counted, soonest few named
  if (eventsCache && (eventsCache.events || []).length) {
    const today = todayStrPT();
    const todays = eventsCache.events.filter(ev => ev.date === today)
      .slice().sort((a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time));
    if (todays.length) {
      let line = 'Today around the county, ' + todays.length + (todays.length === 1 ? ' event' : ' events') + ': '
        + todays.slice(0, 3).map(ev => (ev.time ? ev.time + ', ' : '') + ev.title
            + (ev.source ? ', ' + ev.source : '')).join('. ') + '.';
      if (todays.length > 3) line += ' And ' + (todays.length - 3) + ' more on the page.';
      lines.push(voiceClean(line));
    } else {
      lines.push('Nothing on the city or county calendars today.');
    }
    ready++;
  }
  if (!ready) {
    return { lines: ['Today\'s answers are still loading. Give the page a few seconds, then try listening again.'], ready: 0 };
  }
  lines.push('That\'s the briefing. The live page has the newest numbers, updated all day.');
  return { lines, ready };
}
function voiceSetBtn(on) {
  voiceOn = on;
  const btn = $('briefing-listen-btn');
  if (!btn) return;
  btn.classList.toggle('speaking', on);
  btn.textContent = on ? '⏹ Stop the briefing' : '🔊 Hear the briefing';
  if (btn.setAttribute) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}
function voiceStop() {
  voiceSession++;
  try { window.speechSynthesis.cancel(); } catch (e) { /* no engine — nothing to stop */ }
  voiceSetBtn(false);
}
function voiceSpeak() {
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
  refreshBriefing();
  const b = buildSpokenBriefing();
  voiceStop();
  const session = voiceSession;
  voiceSetBtn(true);
  let pending = b.lines.length;
  const done = () => { if (session === voiceSession && --pending <= 0) voiceSetBtn(false); };
  b.lines.forEach(text => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 1.02;
    u.onend = done;
    u.onerror = done;
    synth.speak(u);
  });
}
function initVoice() {
  const btn = $('briefing-listen-btn');
  if (!btn) return;
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return;
  try { window.speechSynthesis.getVoices(); } catch (e) { /* warm-up only */ }
  btn.hidden = false;
  btn.addEventListener('click', () => { if (voiceOn) voiceStop(); else voiceSpeak(); });
  addEventListener('pagehide', voiceStop);
}
initVoice();

/* ---------- river tides: the ocean, on a schedule (X20 R8) ----------
   Seventeen changes deep, the page knew the river's height (USGS gauges),
   its 48-hour shape (sparklines), and its direction into tomorrow — but
   never the river's own timetable. The Columbia is tidal the whole way
   past St. Helens: twice a day the ocean reaches up the channel and turns
   around, and for anyone launching a boat, working a dock, walking a
   river beach, or timing a fishing hour, the turn IS the schedule. NOAA
   Tides & Currents publishes predictions for two stations inside the
   county — St. Helens (9439201) and Wauna (9439099) — on a free, keyless,
   CORS-open API, the same class of feed as NWS and USGS, so it loads
   browser-direct like they do and the service worker never touches it.
   The card answers three things per station: which way the tide is
   moving right now, when it next turns (with a live countdown), and the
   next four turns after that. Predictions are labeled as predictions —
   river flow shoves real water off them — and each station fails on its
   own with an honest pointer to NOAA. */
const TIDE_STATIONS = [
  { id: '9439201', label: 'St. Helens', sub: 'Downtown waterfront · Columbia City shore' },
  { id: '9439099', label: 'Wauna', sub: 'Up past Clatskanie · the Westport ferry end' }
];
let tideData = {}; // station id -> [{ t: ms epoch, v: feet, type: 'H'|'L' }] sorted by t
function tideYmd(ms) {
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate());
}
function tideWindow() {
  // Pacific calendar days yesterday..tomorrow, so "now" is always bracketed
  // by a previous and a next turn. Date math runs on the PT date in UTC.
  const parts = todayStrPT().split('-').map(Number);
  const base = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  return [tideYmd(base - 864e5), tideYmd(base + 864e5)];
}
function tideInstant(tstr) {
  // NOAA's lst_ldt strings are Pacific wall-clock ("2026-11-04 13:28").
  // Convert with the same two-pass offset the calendar module uses — the
  // offset depends on the instant, which depends on the offset.
  const m = String(tstr || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return NaN;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let utc = wall - evcalPtOffsetMs(wall + 8 * 3600e3);
  utc = wall - evcalPtOffsetMs(utc);
  return utc;
}
function tideUrl(st) {
  const w = tideWindow();
  return 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=' + w[0]
    + '&end_date=' + w[1] + '&station=' + st.id + '&product=predictions&datum=MLLW'
    + '&time_zone=lst_ldt&interval=hilo&units=english'
    + '&application=columbiacountylive&format=json';
}
function tideAway(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'any minute now';
  if (mins < 60) return 'in ' + mins + ' min';
  const h = Math.floor(mins / 60), r = mins % 60;
  return 'in ' + h + (r ? 'h ' + String(r).padStart(2, '0') + 'm' : ' hr');
}
async function loadTides() {
  const body = $('tides-body');
  if (!body) return;
  let any = false;
  await Promise.all(TIDE_STATIONS.map(async st => {
    try {
      const d = await getJSON(tideUrl(st));
      const preds = (d.predictions || []).map(p => ({
        t: tideInstant(p.t), v: parseFloat(p.v), type: p.type
      })).filter(p => !isNaN(p.t) && !isNaN(p.v)).sort((a, b) => a.t - b.t);
      if (preds.length) { tideData[st.id] = preds; any = true; }
    } catch (e) { /* this station keeps its last good predictions — or its honest fallback below */ }
  }));
  if (any) setUpdated('tides-updated');
  renderTides();
  updateGlanceRiver(); // the glance tile leads with this same tide data
}
function renderTides() {
  const body = $('tides-body');
  if (!body) return;
  const now = Date.now();
  body.innerHTML = TIDE_STATIONS.map(st => {
    const head = '<div><div class="river-name">' + esc(st.label) + '</div>'
      + '<div class="river-sub">' + esc(st.sub) + '</div></div>';
    const preds = tideData[st.id];
    if (!preds || !preds.length) {
      return '<div class="tide-station">' + head
        + '<p class="fallback">Tide predictions couldn\'t load just now — the official numbers live at '
        + '<a href="https://tidesandcurrents.noaa.gov/stationhome.html?id=' + st.id
        + '" target="_blank" rel="noopener">NOAA Tides &amp; Currents</a>.</p></div>';
    }
    const nextIdx = preds.findIndex(p => p.t > now);
    const next = nextIdx >= 0 ? preds[nextIdx] : null;
    if (!next) {
      return '<div class="tide-station">' + head
        + '<p class="tide-line">The prediction window ran out — a reload brings the next turns.</p></div>';
    }
    const kind = next.type === 'H' ? 'High tide' : 'Low tide';
    let line;
    if (next.t - now <= 30 * 60000) {
      line = '🌊 About <strong>slack water</strong> now — ' + kind.toLowerCase() + ' '
        + num(next.v, 1) + ' ft at ' + fmtTime(new Date(next.t))
        + ' (' + tideAway(next.t - now) + ').';
    } else {
      line = 'The tide is <strong>' + (next.type === 'H' ? 'coming in' : 'going out')
        + '</strong> — next, <strong>' + kind.toLowerCase() + ' ' + num(next.v, 1)
        + ' ft</strong> at ' + fmtTime(new Date(next.t))
        + ' (' + tideAway(next.t - now) + ').';
    }
    const turns = preds.slice(nextIdx, nextIdx + 4).map(p =>
      '<li><span class="tide-turn-t">' + (p.type === 'H' ? '▲ High' : '▼ Low') + ' '
      + fmtTime(new Date(p.t)) + '</span><span class="tide-turn-v">'
      + num(p.v, 1) + ' ft</span></li>').join('');
    return '<div class="tide-station">' + head
      + '<p class="tide-line">' + line + '</p>'
      + '<ul class="tide-turns">' + turns + '</ul></div>';
  }).join('');
}
function tickTides() { if (Object.keys(tideData).length) { renderTides(); updateGlanceRiver(); } }
function initTides() {
  loadTides();
  setInterval(loadTides, 30 * 60 * 1000);
  setInterval(tickTides, 60 * 1000);
}
initTides();

/* ---------- see the station: ISS pass predictions ---------- */
/* X20 Round 9. The Sky card always knew where the station IS (a dot on
   the map, a lat/lon line) but never when to LOOK — and the look-up
   moment is the whole payoff: a bright, silent, Venus-bright streak
   crossing your own sky, the most shareable thing this page can offer
   and a reason to come back at a specific minute. So the page now does
   real orbital math in the browser: it fetches the station's published
   orbit (a two-line element set — NORAD data via the keyless, CORS-open
   tle.ivanstanojevic.me, with CelesTrak as fallback; cached 12 hours in
   the visitor's own browser) and propagates it with the satellite.js
   library (the same class of versioned CDN as Leaflet) to find every
   crossing over the visitor's home town (Round 3's pref, else
   St. Helens) in the next 48 hours. Each crossing is classified at its
   peak with real sun geometry — the observer's sun elevation plus an
   Earth-shadow test — so "visible" is earned, never assumed: daylight
   crossings and shadow crossings are labeled as what they are. Only
   crossings peaking at 20° or higher are listed — high enough to clear
   a forested county's treeline. Everything degrades honestly: no
   library or no orbit data means a plain fallback line and the live
   position above keeps working. $0, keyless. */
const PASS_TLE_KEY = 'ccl-iss-tle-v1';
const PASS_TLE_JSON = 'https://tle.ivanstanojevic.me/api/tle/25544';
const PASS_TLE_TEXT = 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE';
let passPasses = null;     // crossings computed for passObsName
let passObsName = '';      // town passPasses were computed for
let passStampText = '';    // 'Updated …' text for the iss-passes-updated span
let passState = 'loading'; // loading | ok | nolib | notle

function passSatLib() {
  try {
    return (typeof satellite !== 'undefined' && satellite && satellite.twoline2satrec)
      ? satellite : null;
  } catch (e) { return null; }
}
function passObserver() {
  try { if (typeof homeTown !== 'undefined' && homeTown) return homeTown; } catch (e) { /* fall through */ }
  return TOWNS[0];
}
function passCompass(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
function passAway(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'any minute now';
  if (mins < 60) return 'in ' + mins + ' min';
  const h = Math.floor(mins / 60), r = mins % 60;
  return 'in ' + h + (r ? 'h ' + String(r).padStart(2, '0') + 'm' : ' hr');
}
function passSunEci(date) {
  // Low-precision solar position (Astronomical Almanac) — a unit vector
  // in ECI coordinates; good to ~0.01°, far more than a visible/not call needs.
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0; // days since J2000.0
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * Math.PI / 180;
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * Math.PI / 180;
  const eps = (23.439 - 0.0000004 * n) * Math.PI / 180;
  return { x: Math.cos(lam), y: Math.cos(eps) * Math.sin(lam), z: Math.sin(eps) * Math.sin(lam) };
}
function passSunlit(pos, sun) {
  // Sunlit unless the Earth itself blocks the sun: satellite on the
  // anti-sun side with a perpendicular miss distance under one Earth radius.
  const dot = pos.x * sun.x + pos.y * sun.y + pos.z * sun.z;
  if (dot >= 0) return true;
  const px = pos.x - dot * sun.x, py = pos.y - dot * sun.y, pz = pos.z - dot * sun.z;
  return Math.sqrt(px * px + py * py + pz * pz) >= 6371;
}
async function passFetchTle() {
  try {
    const c = JSON.parse(window.localStorage.getItem(PASS_TLE_KEY) || 'null');
    if (c && c.line1 && c.line2 && Date.now() - c.at < 12 * 3600e3) return c;
  } catch (e) { /* no cache — fetch below */ }
  const save = c => {
    try { window.localStorage.setItem(PASS_TLE_KEY, JSON.stringify(c)); } catch (e) { /* storage unavailable */ }
    return c;
  };
  try {
    const d = await getJSON(PASS_TLE_JSON);
    if (d && d.line1 && d.line2) return save({ line1: String(d.line1), line2: String(d.line2), at: Date.now() });
  } catch (e) { /* primary source down — try CelesTrak directly */ }
  try {
    const r = await fetch(PASS_TLE_TEXT);
    if (r && r.ok && r.text) {
      const lines = (await r.text()).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const i = lines.findIndex(l => l.indexOf('1 25544') === 0);
      if (i >= 0 && lines[i + 1]) return save({ line1: lines[i], line2: lines[i + 1], at: Date.now() });
    }
  } catch (e) { /* both sources down */ }
  return null;
}
function passLook(sat, satrec, date, obsGd) {
  const pv = sat.propagate(satrec, date);
  // A decayed or mangled orbit can propagate to NaN — treat it as no reading.
  if (!pv || !pv.position || !isFinite(pv.position.x)) return null;
  const ecf = sat.eciToEcf(pv.position, sat.gstime(date));
  const la = sat.ecfToLookAngles(obsGd, ecf);
  return { el: sat.radiansToDegrees(la.elevation), az: sat.radiansToDegrees(la.azimuth) };
}
function passCompute(sat, tle, town) {
  const satrec = sat.twoline2satrec(tle.line1, tle.line2);
  const obsGd = {
    longitude: sat.degreesToRadians(town.lon),
    latitude: sat.degreesToRadians(town.lat),
    height: 0.05
  };
  const start = Date.now() - 10 * 60000;      // catch a crossing already overhead
  const end = Date.now() + 48 * 3600e3;
  const step = 20000;
  const passes = [];
  let cur = null, lastAz = 0;
  for (let t = start; t <= end; t += step) {
    const look = passLook(sat, satrec, new Date(t), obsGd);
    const el = look ? look.el : -90;
    if (look) lastAz = look.az;
    if (el > 10) {
      if (!cur) cur = { start: t, end: t, peakT: t, peakEl: el, peakAz: look.az, riseAz: look.az };
      else {
        cur.end = t;
        if (el > cur.peakEl) { cur.peakEl = el; cur.peakT = t; cur.peakAz = look.az; }
      }
    } else if (cur) { cur.setAz = lastAz; passes.push(cur); cur = null; }
  }
  if (cur) { cur.setAz = lastAz; passes.push(cur); }
  passes.forEach(p => {
    // Refine the peak on a 4-second grid around the coarse sample.
    for (let t = p.peakT - step; t <= p.peakT + step; t += 4000) {
      const look = passLook(sat, satrec, new Date(t), obsGd);
      if (look && look.el > p.peakEl) { p.peakEl = look.el; p.peakT = t; p.peakAz = look.az; }
    }
    // Classify at the peak with real sun geometry.
    const date = new Date(p.peakT);
    const pv = sat.propagate(satrec, date);
    const sun = passSunEci(date);
    const lit = pv && pv.position ? passSunlit(pv.position, sun) : false;
    const sunEcf = sat.eciToEcf(
      { x: sun.x * 1.496e8, y: sun.y * 1.496e8, z: sun.z * 1.496e8 }, sat.gstime(date));
    const sunEl = sat.radiansToDegrees(sat.ecfToLookAngles(obsGd, sunEcf).elevation);
    p.kind = !lit ? 'shadow' : (sunEl >= 0 ? 'daylight' : 'visible');
  });
  return passes.filter(p => p.peakEl >= 20);
}
function renderPasses() {
  const box = $('iss-passes');
  if (!box) return;
  const town = passObserver();
  const head = '<div class="iss-passes-head">🛰️ <strong>See the station from ' + esc(town.name)
    + '</strong> <span class="updated" id="iss-passes-updated">' + esc(passStampText) + '</span></div>';
  if (passState === 'nolib') {
    box.innerHTML = head + '<p class="fallback">Pass predictions need a small orbit library that '
      + 'couldn\'t load just now — the live position above still updates every few seconds.</p>';
    return;
  }
  if (passState === 'notle') {
    box.innerHTML = head + '<p class="fallback">The station\'s orbit data couldn\'t load just now, '
      + 'so pass times are unavailable — the live position above still updates.</p>';
    return;
  }
  if (!passPasses) {
    box.innerHTML = head + '<p class="loading">Working out when the station passes over the county…</p>';
    return;
  }
  const now = Date.now();
  const upcoming = passPasses.filter(p => p.end > now);
  let h = head;
  const vis = upcoming.find(p => p.kind === 'visible');
  if (vis) {
    let count = '';
    if (vis.start <= now) count = ' — <strong>it\'s overhead right now, look up!</strong>';
    else if (vis.start - now < 3 * 3600e3) count = ' — starts <strong>' + passAway(vis.start - now) + '</strong>';
    h += '<p class="iss-pass-hero">👀 <strong>Next pass you can actually see: '
      + esc(fmtDayTime(new Date(vis.start))) + '</strong>' + count + '<br>'
      + 'Rises in the ' + passCompass(vis.riseAz) + ' at ' + fmtTime(new Date(vis.start))
      + ', climbs to <strong>' + Math.round(vis.peakEl) + '° up</strong> in the ' + passCompass(vis.peakAz)
      + ', and slips away in the ' + passCompass(vis.setAz) + ' by ' + fmtTime(new Date(vis.end)) + '.</p>';
  } else {
    h += '<p class="iss-pass-hero">No naked-eye passes from ' + esc(town.name)
      + ' in the next two days — the station still crosses overhead, just in daylight or in the '
      + 'Earth\'s shadow. The next crossings:</p>';
  }
  const rows = upcoming.slice(0, 3).map(p => {
    const label = p.kind === 'visible' ? '👀 Visible — look up'
      : p.kind === 'daylight' ? '☀️ Daylight at its peak — too bright to spot'
      : '🌑 In Earth\'s shadow at its peak';
    return '<li><span class="iss-pass-t">' + esc(fmtDayTime(new Date(p.start))) + ' – '
      + esc(fmtTime(new Date(p.end))) + '</span>'
      + '<span class="iss-pass-d">peaks ' + Math.round(p.peakEl) + '° · '
      + passCompass(p.riseAz) + ' → ' + passCompass(p.setAz) + '</span>'
      + '<span class="iss-pass-k">' + label + '</span></li>';
  }).join('');
  h += '<ul class="iss-pass-list">' + rows + '</ul>'
    + '<p class="card-note small">Crossings climbing at least 20° — high enough to clear the '
    + 'treeline. Figured in your browser from the station\'s published orbit (NORAD data via '
    + 'CelesTrak), for ' + esc(town.name) + '; times are good to about a minute. A visible pass '
    + 'looks like a bright star gliding across — no blinking, about as bright as Venus.</p>';
  box.innerHTML = h;
}
async function computePasses() {
  const sat = passSatLib();
  if (!sat) { passState = 'nolib'; renderPasses(); return; }
  const tle = await passFetchTle();
  if (!tle) {
    if (!passPasses) { passState = 'notle'; renderPasses(); }
    return;
  }
  try {
    const town = passObserver();
    passPasses = passCompute(sat, tle, town);
    passObsName = town.name;
    passState = 'ok';
    passStampText = 'Updated ' + fmtTime(new Date());
    FRESH['iss-passes-updated'] = Date.now();
    renderPasses();
  } catch (e) {
    if (!passPasses) { passState = 'notle'; renderPasses(); }
  }
}
function tickPasses() {
  if (passState !== 'ok' || !passPasses) return;
  if (passObserver().name !== passObsName) { computePasses(); return; }
  renderPasses();
}
function initPasses() {
  computePasses();
  setInterval(computePasses, 20 * 60 * 1000);
  setInterval(tickPasses, 30 * 1000);
}
initPasses();

/* ---------- catch the boat: the ferry leave-by planner ----------
   The countdown above answers "when does the next boat leave the dock?"
   — but the question at the kitchen table is "when do I have to walk out
   the door, and is the boat I want already out of reach?" That answer is
   the timetable plus a drive plus a dock cushion, and until now every
   visitor did that subtraction in their head — for the one trip where
   missing by two minutes costs a full hour, and exactly when the ferry
   matters most: when the commute verdict is sending US-30 drivers here
   as the bridge detour. Pick a direction and where you're leaving from
   (your home town from "Make it yours" if you've set one) and the
   planner answers in one line — leave by X, the Y boat, across by about
   Z — with the miss-it boat after it, an honest tight/no-more-boats
   state, and full deference to a posted closure alert, the countdown's
   own rule. Drive times are labeled typicals and the cushion is stated
   in the open on the card. */
const FP_KEY = 'ccl-ferry-plan-v1';
const FP_BUFFER = 10;   // minutes at the dock: parking, fares, loading
const FP_CROSS = 15;    // the crossing itself, roughly
const FP_DRIVE = {      // typical minutes to the Westport landing, US-30 / OR-47
  'Clatskanie': 12, 'Rainier': 32, 'Columbia City': 28, 'St. Helens': 32,
  'Warren': 35, 'Scappoose': 45, 'Vernonia': 55
};
let fpDir = 'or';       // 'or' = sail from Westport to Washington; 'wa' = sail from Puget Island home
let fpTownName = null;  // one of TOWNS — the Oregon-side starting point

function fpClock(mins) { return fmtClock(Math.floor(mins / 60) % 24, ((mins % 60) + 60) % 60); }
function fpSide() { return FERRY_SIDES.find(s => s.key === fpDir) || FERRY_SIDES[0]; }
function fpDrive() { return FP_DRIVE[fpTownName] != null ? FP_DRIVE[fpTownName] : 32; }
function fpLoadPref() {
  try {
    const v = JSON.parse(window.localStorage.getItem(FP_KEY) || 'null');
    if (v && (v.dir === 'or' || v.dir === 'wa')) fpDir = v.dir;
    if (v && TOWNS.some(t => t.name === v.town)) fpTownName = v.town;
  } catch (e) { /* storage blocked — the defaults below still apply */ }
  if (!fpTownName) fpTownName = (typeof homeTown !== 'undefined' && homeTown) ? homeTown.name : 'St. Helens';
}
function fpSavePref() {
  try { window.localStorage.setItem(FP_KEY, JSON.stringify({ dir: fpDir, town: fpTownName })); } catch (e) { /* non-fatal */ }
}
function fpRenderTowns() {
  const box = $('fp-towns');
  if (!box) return;
  box.hidden = fpDir !== 'or';
  if (fpDir !== 'or') { box.innerHTML = ''; return; }
  box.innerHTML = '<span class="fp-from">Leaving from:</span>' + TOWNS.map(t =>
    '<button class="fp-town-chip' + (t.name === fpTownName ? ' active' : '') + '" type="button" data-fp-town="' + esc(t.name) + '">' + esc(t.name) + '</button>').join('');
  box.querySelectorAll('.fp-town-chip').forEach(b => b.addEventListener('click', () => {
    fpTownName = b.dataset.fpTown;
    fpSavePref();
    renderFerryPlan(true);
  }));
}
let fpLastSig = null;
function renderFerryPlan(force) {
  const body = $('fp-body');
  if (!body) return;
  const now = ptNowParts();
  const nowMin = now.h * 60 + now.m;
  // Cheap change detection: a 5-second ticker re-renders only when the
  // minute, the direction, the town, or the closure-alert flag moved —
  // so a posted alert stops the planning within seconds, not at the
  // next half-minute, and an idle page does no DOM work at all.
  const sig = fpDir + '|' + fpTownName + '|' + nowMin + '|' + (ferryAlertActive ? 1 : 0);
  if (!force && sig === fpLastSig) return;
  fpLastSig = sig;
  document.querySelectorAll('.fp-dir-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.fpDir === fpDir);
    if (b.setAttribute) b.setAttribute('aria-pressed', b.dataset.fpDir === fpDir ? 'true' : 'false');
  });
  fpRenderTowns();
  if (ferryAlertActive) {
    body.innerHTML = '<div class="fp-verdict fp-alert">⛔ The county is reporting a ferry alert — read the closure notice above before planning around the boat. No leave-by math while sailings are in doubt.</div>';
    return;
  }
  const side = fpSide();
  const deps = [];
  for (let h = side.firstHour; h <= side.lastHour; h++) deps.push(h * 60 + side.minute);
  if (fpDir === 'or') {
    const drive = fpDrive();
    const legs = deps.map(dep => ({ dep, leaveBy: dep - drive - FP_BUFFER }))
      .filter(l => l.leaveBy >= nowMin);
    if (!legs.length) {
      body.innerHTML = '<div class="fp-verdict fp-done">No more boats you can still catch from ' + esc(fpTownName) + ' today.</div>'
        + '<p class="fp-next">First boat tomorrow: <strong>' + fpClock(deps[0]) + '</strong> from Westport — you\'d leave ' + esc(fpTownName) + ' by <strong>' + fpClock(deps[0] - drive - FP_BUFFER) + '</strong>.</p>';
      return;
    }
    const leg = legs[0];
    const minsLeft = leg.leaveBy - nowMin;
    const tight = minsLeft <= 15;
    let html = '<div class="fp-verdict' + (tight ? ' fp-tight' : '') + '">'
      + '<div class="fp-leave">Leave ' + esc(fpTownName) + ' by <span class="fp-time">' + fpClock(leg.leaveBy) + '</span> <span class="fp-away">(' + esc(fmtAway(minsLeft)) + ')</span></div>'
      + '<div class="fp-sub">Catch the <strong>' + fpClock(leg.dep) + '</strong> boat from Westport → across in about ' + FP_CROSS + ' minutes, docking at Puget Island around <strong>' + fpClock(leg.dep + FP_CROSS) + '</strong>.'
      + (tight ? ' That\'s tight — go now, and don\'t stop on the way.' : '') + '</div></div>';
    if (legs.length > 1) {
      html += '<p class="fp-next">Miss it? Next chance: leave by <strong>' + fpClock(legs[1].leaveBy) + '</strong> for the ' + fpClock(legs[1].dep) + ' boat.</p>';
    } else {
      html += '<p class="fp-next fp-last">That\'s the <strong>last boat today</strong> — miss it and the ferry is done until ' + fpClock(deps[0]) + ' tomorrow.</p>';
    }
    body.innerHTML = html;
  } else {
    const legs = deps.map(dep => ({ dep, dockBy: dep - FP_BUFFER }))
      .filter(l => l.dockBy >= nowMin);
    if (!legs.length) {
      body.innerHTML = '<div class="fp-verdict fp-done">No more boats from Puget Island today.</div>'
        + '<p class="fp-next">First boat tomorrow: <strong>' + fpClock(deps[0]) + '</strong> — be at the dock by <strong>' + fpClock(deps[0] - FP_BUFFER) + '</strong>.</p>';
      return;
    }
    const leg = legs[0];
    const minsLeft = leg.dockBy - nowMin;
    const tight = minsLeft <= 15;
    let html = '<div class="fp-verdict' + (tight ? ' fp-tight' : '') + '">'
      + '<div class="fp-leave">Be at the Puget Island dock by <span class="fp-time">' + fpClock(leg.dockBy) + '</span> <span class="fp-away">(' + esc(fmtAway(minsLeft)) + ')</span></div>'
      + '<div class="fp-sub">For the <strong>' + fpClock(leg.dep) + '</strong> boat to Westport — across in about ' + FP_CROSS + ' minutes, docking around <strong>' + fpClock(leg.dep + FP_CROSS) + '</strong>. Fares are cash or check.'
      + (tight ? ' That\'s tight — head for the dock now.' : '') + '</div></div>';
    if (legs.length > 1) {
      html += '<p class="fp-next">Running late? Next boat: <strong>' + fpClock(legs[1].dep) + '</strong> — be at the dock by ' + fpClock(legs[1].dockBy) + '.</p>';
    } else {
      html += '<p class="fp-next fp-last">That\'s the <strong>last boat today</strong> — miss it and the ferry is done until ' + fpClock(deps[0]) + ' tomorrow.</p>';
    }
    body.innerHTML = html;
  }
}
function initFerryPlan() {
  const wrap = $('ferry-plan');
  if (!wrap || !$('fp-body')) return;
  fpLoadPref();
  wrap.querySelectorAll('.fp-dir-btn').forEach(b => b.addEventListener('click', () => {
    fpDir = b.dataset.fpDir;
    fpSavePref();
    renderFerryPlan(true);
  }));
  renderFerryPlan(true);
  setInterval(() => renderFerryPlan(false), 5 * 1000);
}
initFerryPlan();

/* ---------- the county almanac: daylight & the moon (X20 R11) ----------
   Twenty rounds in, the page could answer roads, river, ferry and sky —
   but never the oldest county question of all: how much light is left?
   At 46°N the day swings from about 8½ hours in December to nearly 16
   in June, and in November the sun is gone before the workday ends —
   yet nothing on the page said when it gets dark, how fast the days
   are shrinking, or what the moon is doing. The almanac computes all
   of it on this page from the sun's and moon's positions (the NOAA
   solar approximation and the moon's synodic age): no feed, no key,
   nothing that can go stale, good to a few minutes like every printed
   almanac. It follows the visitor's home town (the Round 3 pref). */
const ALM_SYNODIC = 29.530588853;
const ALM_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // a known new moon

function almPtDate(offsetDays) {
  const d = new Date(Date.now() + (offsetDays || 0) * 86400000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric', day: 'numeric'
  }).formatToParts(d);
  const get = t => parseInt((parts.find(p => p.type === t) || {}).value, 10);
  return { y: get('year'), m: get('month') - 1, d: get('day') };
}

// NOAA solar approximation: the instant of a sun event on a Pacific
// calendar date, or null if the sun never crosses that zenith that day.
function almSunEvent(date, lat, lon, zenith, isRise) {
  const rad = Math.PI / 180;
  const N = Math.round((Date.UTC(date.y, date.m, date.d) - Date.UTC(date.y, 0, 0)) / 86400000);
  const lngHour = lon / 15;
  const t = isRise ? N + ((6 - lngHour) / 24) : N + ((18 - lngHour) / 24);
  const M = (0.9856 * t) - 3.289;
  let L = M + 1.916 * Math.sin(M * rad) + 0.020 * Math.sin(2 * M * rad) + 282.634;
  L = ((L % 360) + 360) % 360;
  let RA = Math.atan(0.91764 * Math.tan(L * rad)) / rad;
  RA = ((RA % 360) + 360) % 360;
  RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90;
  RA /= 15;
  const sinDec = 0.39782 * Math.sin(L * rad);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(zenith * rad) - sinDec * Math.sin(lat * rad)) / (cosDec * Math.cos(lat * rad));
  if (cosH > 1 || cosH < -1) return null;
  let H = Math.acos(cosH) / rad;
  if (isRise) H = 360 - H;
  H /= 15;
  let UT = H + RA - 0.06571 * t - 6.622 - lngHour;
  UT = ((UT % 24) + 24) % 24;
  // A 4:54 PM PST sunset is 00:54 UTC the *next* day — pin the raw
  // instant within ±12 hours of Pacific noon so the date stays true.
  const anchor = Date.UTC(date.y, date.m, date.d, 20);
  let ms = Date.UTC(date.y, date.m, date.d) + UT * 3600000;
  while (ms < anchor - 12 * 3600000) ms += 86400000;
  while (ms > anchor + 12 * 3600000) ms -= 86400000;
  return new Date(ms);
}

function almDay(date, town) {
  const rise = almSunEvent(date, town.lat, town.lon, 90.833, true);
  const set = almSunEvent(date, town.lat, town.lon, 90.833, false);
  const dawn = almSunEvent(date, town.lat, town.lon, 96, true);
  const dusk = almSunEvent(date, town.lat, town.lon, 96, false);
  return { rise, set, dawn, dusk, lenMs: (rise && set) ? set.getTime() - rise.getTime() : null };
}

function almClock(date) {
  if (!date || isNaN(date)) return '—';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit'
  }).formatToParts(date);
  const get = t => parseInt((parts.find(p => p.type === t) || {}).value, 10);
  return fmtClock(get('hour') % 24, get('minute'));
}

function almDur(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return mins + ' min';
  return Math.floor(mins / 60) + 'h ' + String(mins % 60).padStart(2, '0') + 'm';
}

function almMoon(now) {
  let age = ((now.getTime() - ALM_NEW_MOON) / 86400000) % ALM_SYNODIC;
  if (age < 0) age += ALM_SYNODIC;
  const theta = 2 * Math.PI * age / ALM_SYNODIC;
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous',
    'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  return {
    age, theta,
    illum: (1 - Math.cos(theta)) / 2,
    name: names[Math.floor((age / ALM_SYNODIC) * 8 + 0.5) % 8],
    waxing: age < ALM_SYNODIC / 2,
    toNew: (ALM_SYNODIC - age) % ALM_SYNODIC,
    toFull: (ALM_SYNODIC / 2 - age + ALM_SYNODIC) % ALM_SYNODIC
  };
}

function almMoonSvg(moon) {
  // The lit limb is a semicircle on the waxing (right) or waning (left)
  // side; the terminator is a half-ellipse r·|cos θ| wide whose bulge
  // flips at the quarters — crescent, quarter and gibbous all fall out
  // of the same two arcs.
  const r = 25, cx = 30, cy = 30;
  const rx = Math.max(0.01, r * Math.abs(Math.cos(moon.theta)));
  const limbSweep = moon.waxing ? 1 : 0;
  const termSweep = (moon.waxing !== (Math.cos(moon.theta) > 0)) ? 1 : 0;
  const d = 'M ' + cx + ' ' + (cy - r)
    + ' A ' + r + ' ' + r + ' 0 0 ' + limbSweep + ' ' + cx + ' ' + (cy + r)
    + ' A ' + rx.toFixed(2) + ' ' + r + ' 0 0 ' + termSweep + ' ' + cx + ' ' + (cy - r) + ' Z';
  return '<svg class="alm-moon" viewBox="0 0 60 60" width="52" height="52" role="img" aria-label="' + esc(moon.name) + '">'
    + '<circle cx="30" cy="30" r="25" class="alm-moon-dark"/><path d="' + d + '" class="alm-moon-lit"/></svg>';
}

function almArcSvg(day, tmrwDawn, ydayDusk, now) {
  // The sun's path: a solid arc above the horizon from first light to
  // last light, a dashed one below it for the night. The marker rides
  // whichever arc the sun is actually on.
  let mx, my, cls;
  if (now >= day.dawn && now <= day.dusk) {
    const a = Math.PI * ((now - day.dawn) / (day.dusk - day.dawn));
    mx = 170 - 148 * Math.cos(a); my = 102 - 86 * Math.sin(a); cls = 'alm-sun';
  } else {
    const start = now < day.dawn ? ydayDusk : day.dusk;
    const end = now < day.dawn ? day.dawn : tmrwDawn;
    const p = (end > start) ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 0;
    const a = Math.PI * p;
    mx = 170 + 148 * Math.cos(a); my = 102 + 32 * Math.sin(a); cls = 'alm-sun alm-sun-down';
  }
  return '<svg class="alm-arc" viewBox="0 0 340 146" role="img" aria-label="The sun\'s path across today\'s sky">'
    + '<path d="M 22 102 A 148 86 0 0 1 318 102" class="alm-arc-day"/>'
    + '<path d="M 22 102 A 148 32 0 0 0 318 102" class="alm-arc-night"/>'
    + '<line x1="8" y1="102" x2="332" y2="102" class="alm-horizon"/>'
    + '<circle cx="' + mx.toFixed(1) + '" cy="' + my.toFixed(1) + '" r="8" class="' + cls + '"/>'
    + '<text x="22" y="122" class="alm-arc-lab">↑ ' + almClock(day.rise) + '</text>'
    + '<text x="318" y="122" text-anchor="end" class="alm-arc-lab">' + almClock(day.set) + ' ↓</text>'
    + '<text x="170" y="140" text-anchor="middle" class="alm-arc-lab">the sun\'s path today</text>'
    + '</svg>';
}

function renderAlmanac() {
  const body = $('almanac-body');
  if (!body) return;
  const town = homeTown || TOWNS[0];
  const now = new Date();
  const today = almDay(almPtDate(0), town);
  if (!today.rise || !today.set || !today.dawn || !today.dusk) {
    body.innerHTML = '<p class="fallback">⚠️ The almanac could not compute today\'s light — the rest of the page is unaffected.</p>';
    return;
  }
  const yest = almDay(almPtDate(-1), town);
  const tmrw = almDay(almPtDate(1), town);
  const moon = almMoon(now);
  const stamp = $('almanac-updated');
  if (stamp) stamp.textContent = 'Computed ' + fmtTime(now);
  FRESH['almanac-updated'] = Date.now();

  let head, sub;
  if (now < today.dawn) {
    head = '🌌 Night over ' + esc(town.name);
    sub = 'First light ' + almClock(today.dawn) + ' · sunrise <strong>' + almClock(today.rise) + '</strong> (' + almDur(today.rise - now) + ' away)';
  } else if (now < today.rise) {
    head = '🌅 First light — sunrise ' + almClock(today.rise);
    sub = 'The sun clears the horizon in <strong>' + almDur(today.rise - now) + '</strong> over ' + esc(town.name) + '.';
  } else if (now < today.set) {
    head = '☀️ Sun sets ' + almClock(today.set) + ' — <span class="alm-away">' + almDur(today.set - now) + ' of light left</span>';
    sub = 'Fully dark by <strong>' + almClock(today.dusk) + '</strong> over ' + esc(town.name) + '.';
    if ((now - today.rise) <= 3600000) sub += ' It\'s <strong>morning golden hour</strong> — the best light of the day is on now.';
    else if ((today.set - now) <= 3600000) sub += ' It\'s <strong>golden hour</strong> — the best light of the day is on now.';
  } else if (now < today.dusk) {
    head = '🌇 The sun is down over ' + esc(town.name);
    sub = 'Last light is fading — fully dark by <strong>' + almClock(today.dusk) + '</strong> (' + almDur(today.dusk - now) + ').';
  } else {
    head = '🌌 Dark over ' + esc(town.name);
    sub = 'Sunrise tomorrow <strong>' + almClock(tmrw.rise) + '</strong> (' + almDur(tmrw.rise - now) + ' away) · first light ' + almClock(tmrw.dawn) + '.';
  }

  const deltaMin = (today.lenMs != null && yest.lenMs != null) ? Math.round((today.lenMs - yest.lenMs) / 60000) : 0;
  const deltaTxt = deltaMin === 0 ? 'about the same as yesterday'
    : Math.abs(deltaMin) + ' min ' + (deltaMin > 0 ? 'longer' : 'shorter') + ' than yesterday';
  const moonNext = moon.toFull < moon.toNew
    ? 'full moon in ' + Math.round(moon.toFull) + ' days (' + fmtDay(new Date(now.getTime() + moon.toFull * 86400000)) + ')'
    : 'new moon in ' + Math.round(moon.toNew) + ' days (' + fmtDay(new Date(now.getTime() + moon.toNew * 86400000)) + ')';
  const noon = new Date((today.rise.getTime() + today.set.getTime()) / 2);

  body.innerHTML = '<div class="alm-verdict"><div class="alm-head">' + head + '</div><div class="alm-sub">' + sub + '</div></div>'
    + almArcSvg(today, tmrw.dawn, yest.dusk, now)
    + '<div class="alm-facts">'
    + '<div class="alm-fact"><div class="alm-k">🌅 Sunrise</div><div class="alm-v">' + almClock(today.rise) + '</div><div class="alm-s">first light ' + almClock(today.dawn) + '</div></div>'
    + '<div class="alm-fact"><div class="alm-k">🌇 Sunset</div><div class="alm-v">' + almClock(today.set) + '</div><div class="alm-s">fully dark by ' + almClock(today.dusk) + '</div></div>'
    + '<div class="alm-fact"><div class="alm-k">📏 Day length</div><div class="alm-v">' + almDur(today.lenMs) + '</div><div class="alm-s">' + deltaTxt + '</div></div>'
    + '<div class="alm-fact"><div class="alm-k">✨ Golden hour</div><div class="alm-v">' + almClock(new Date(today.set.getTime() - 3600000)) + ' – ' + almClock(today.set) + '</div><div class="alm-s">the hour before sunset</div></div>'
    + '<div class="alm-fact alm-moon-fact">' + almMoonSvg(moon) + '<div><div class="alm-k">🌙 The moon</div><div class="alm-v">' + esc(moon.name) + '</div><div class="alm-s">' + Math.round(moon.illum * 100) + '% lit · ' + moonNext + '</div></div></div>'
    + '<div class="alm-fact"><div class="alm-k">🏘️ Computed for</div><div class="alm-v">' + esc(town.name) + '</div><div class="alm-s">the sun tops out at ' + almClock(noon) + '</div></div>'
    + '</div>';
}

function initAlmanac() {
  if (!$('almanac-body')) return;
  renderAlmanac();
  setInterval(renderAlmanac, 60 * 1000);
}
initAlmanac();

/* ---------- the county wall: the page becomes the screen that's already on ----------
   Twenty-one changes in, every one still assumed a person holding a phone
   and scrolling. But county information also lives ambiently — the tablet
   propped in the kitchen, the spare monitor at the shop counter, the TV at
   the senior center. Wall display turns this page into that screen: one tap
   and the county's answers go big and rotate on their own — clock and
   forecast, the drive, the river and tide, the next boat, daylight, the
   next event — each scene rebuilt at show time from the same rendered panel
   state the County Briefing reads, so the wall never claims anything the
   page isn't showing. Alert gravity: while a weather *warning* is active
   the alert leads the rotation and comes back after every other scene —
   an ambient screen must never bury a warning between the ferry and the
   moon. Fullscreen and a screen wake lock are requested where the browser
   offers them and skipped silently where it doesn't. */
let wallOpen = false, wallIdx = 0, wallTimer = null;
let wallShownAt = 0, wallRenderedAt = 0, wallWake = null;
const WALL_ROTATE_MS = 14000, WALL_REFRESH_MS = 9000;

function wallTxt(el) { return el ? briefingClean(el.textContent) : ''; }

function wallAlertScenes() {
  const ab = $('alerts-body');
  if (!ab || ab.querySelector('.no-alerts')) return { scenes: [], severe: false };
  const out = [];
  let severe = false;
  ab.querySelectorAll('.alert-item').forEach(it => {
    const h = it.querySelector('h3');
    const name = wallTxt(h);
    if (!name) return;
    const isSev = ((it.className || '').indexOf('severe') >= 0) || /warning/i.test(name);
    if (isSev) severe = true;
    out.push({ kind: 'alert', severe: isSev, kicker: '⚠️ Weather alert — in effect for Columbia County',
      head: name, sub: 'The full details are on this page’s weather panel — and on the radio. Take it seriously before you travel.',
      src: 'National Weather Service' });
  });
  return { scenes: out, severe };
}

function wallNowScene() {
  const now = new Date();
  const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(now);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long', month: 'long', day: 'numeric' }).format(now);
  let sub = day;
  const fb = $('forecast-body');
  if (fb) {
    const per = fb.querySelector('.period');
    if (per) {
      const temp = wallTxt(per.querySelector('.temp'));
      const paras = per.querySelectorAll('p');
      const short = paras.length ? wallTxt(paras[0]) : '';
      if (temp || short) sub += ' · ' + currentTown.name + (temp ? ' ' + temp : '') + (short ? ' — ' + short : '');
    }
  }
  return { kind: 'now', kicker: '🌲 Columbia County Live', head: time, sub: sub, src: 'National Weather Service forecast' };
}

function wallDriveScene() {
  const cv = $('commute-verdict');
  const head = cv ? wallTxt(cv.querySelector('.cv-head')) : '';
  if (!head || briefingPending(head)) return null;
  const bv = wallTxt($('glance-bridge-val'));
  return { kind: 'drive', kicker: '🚗 The drive — US-30 & the bridge', head: head,
    sub: (bv && !briefingPending(bv)) ? 'Lewis & Clark Bridge: ' + bv : '', src: 'ODOT / WSDOT snapshots, as labeled on the page' };
}

function wallRiverScene() {
  const rv = wallTxt($('glance-river-val'));
  if (!rv || briefingPending(rv)) return null;
  let sub = '';
  const tb = $('tides-body');
  if (tb) {
    const st = tb.querySelector('.tide-station');
    const line = st ? wallTxt(st.querySelector('.tide-line')) : '';
    if (line && !briefingPending(line)) sub = 'The tide at St. Helens: ' + line;
  }
  return { kind: 'river', kicker: '🌊 The Columbia at Port Westward', head: rv, sub: sub, src: 'USGS gauges · NOAA tide predictions' };
}

function wallFerryScene() {
  const fn = $('ferry-next');
  const head = fn ? wallTxt(fn.querySelector('.ferry-next-head')) : '';
  if (!head || briefingPending(head)) return null;
  return { kind: 'ferry', kicker: '⛴️ The Oscar B ferry', head: head,
    sub: 'Westport, Oregon ↔ Puget Island, Washington — the last ferry on the Lower Columbia', src: 'Wahkiakum County ferry schedule' };
}

function wallLightScene() {
  const ab = $('almanac-body');
  if (!ab) return null;
  const head = wallTxt(ab.querySelector('.alm-head'));
  if (!head) return null;
  return { kind: 'light', kicker: '🌅 Daylight — the county almanac', head: head,
    sub: wallTxt(ab.querySelector('.alm-sub')), src: 'Computed on this page — no feed, never stale' };
}

function wallEventScene() {
  if (!eventsCache || !(eventsCache.events || []).length) return null;
  const today = todayStrPT();
  const up = eventsCache.events.filter(ev => ev.date >= today).slice()
    .sort((a, b) => (a.date === b.date)
      ? parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time)
      : (a.date < b.date ? -1 : 1));
  if (!up.length) return null;
  const ev = up[0];
  const when = (ev.date === today ? 'Today' : fmtDay(new Date(ev.date + 'T12:00:00'))) + (ev.time ? ' · ' + ev.time : '');
  return { kind: 'event', kicker: '📅 Next up around the county', head: ev.title,
    sub: when + (ev.source ? ' · ' + ev.source : ''), src: 'City & county calendars' };
}

function wallBuildScenes() {
  const a = wallAlertScenes();
  const base = [];
  [wallNowScene(), wallDriveScene(), wallRiverScene(), wallFerryScene(), wallLightScene(), wallEventScene()]
    .forEach(s => { if (s) base.push(s); });
  if (!a.scenes.length) return base;
  if (!a.severe) {
    // Alerts but no warning: the alerts ride right behind the clock.
    return [base[0]].concat(a.scenes, base.slice(1));
  }
  // A warning is active: it leads, and returns after every other scene.
  const out = [];
  let ai = 0;
  base.forEach((s, i) => {
    if (i % 2 === 0) { out.push(a.scenes[ai % a.scenes.length]); ai++; }
    out.push(s);
  });
  return out;
}

function renderWall() {
  const sc = $('wall-scene');
  if (!sc) return;
  const scenes = wallBuildScenes();
  wallRenderedAt = Date.now();
  if (!scenes.length) {
    sc.className = 'wall-scene';
    sc.innerHTML = '<div class="wall-kicker">🌲 Columbia County Live</div>'
      + '<div class="wall-head">Gathering the county’s answers…</div>';
    return;
  }
  if (wallIdx >= scenes.length) wallIdx = 0;
  const s = scenes[wallIdx];
  sc.className = 'wall-scene wall-kind-' + s.kind + (s.kind === 'alert' ? (s.severe ? ' wall-severe' : ' wall-warn') : '');
  sc.innerHTML = '<div class="wall-kicker">' + esc(s.kicker) + '</div>'
    + '<div class="wall-head">' + esc(s.head) + '</div>'
    + (s.sub ? '<div class="wall-sub">' + esc(s.sub) + '</div>' : '');
  sc.classList.remove('wall-in');
  void sc.offsetWidth; // restart the fade on the new scene
  sc.classList.add('wall-in');
  const dots = $('wall-dots');
  if (dots) dots.innerHTML = scenes.map((x, i) => '<i class="wall-dot' + (i === wallIdx ? ' on' : '') + '"></i>').join('');
  const src = $('wall-src');
  if (src) src.textContent = s.src || '';
}

function wallAdvance() {
  wallIdx++;
  wallShownAt = Date.now();
  renderWall();
}

function wallTick() {
  if (!wallOpen) return;
  if (typeof document !== 'undefined' && document.hidden) { wallShownAt = Date.now(); return; }
  const now = Date.now();
  if (now - wallShownAt >= WALL_ROTATE_MS) { wallIdx++; wallShownAt = now; renderWall(); }
  else if (now - wallRenderedAt >= WALL_REFRESH_MS) { renderWall(); }
}

function openWall() {
  const ov = $('wall-overlay');
  if (!ov || wallOpen) return;
  wallOpen = true;
  wallIdx = 0;
  wallShownAt = Date.now();
  ov.hidden = false;
  renderWall();
  wallTimer = setInterval(wallTick, 1000);
  try {
    const de = document.documentElement;
    if (de && de.requestFullscreen) { const p = de.requestFullscreen(); if (p && p.catch) p.catch(() => {}); }
  } catch (e) { /* fullscreen is a nicety, never a requirement */ }
  try {
    if (navigator.wakeLock && navigator.wakeLock.request) {
      navigator.wakeLock.request('screen').then(w => {
        // The request resolves when it resolves — if the wall has already
        // closed, hand the lock straight back instead of holding it.
        if (wallOpen) { wallWake = w; }
        else if (w && w.release) w.release();
      }).catch(() => {});
    }
  } catch (e) { /* same — the wall works without it */ }
}

function closeWall() {
  if (!wallOpen) return;
  wallOpen = false;
  if (wallTimer) { clearInterval(wallTimer); wallTimer = null; }
  const ov = $('wall-overlay');
  if (ov) ov.hidden = true;
  try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); } catch (e) {}
  try { if (wallWake && wallWake.release) wallWake.release(); } catch (e) {}
  wallWake = null;
}

function initWall() {
  const btn = $('wall-btn'), ov = $('wall-overlay');
  if (!btn || !ov) return;
  btn.addEventListener('click', openWall);
  const exit = $('wall-exit');
  if (exit) exit.addEventListener('click', e => {
    if (e && e.stopPropagation) e.stopPropagation();
    closeWall();
  });
  ov.addEventListener('click', () => { if (wallOpen) wallAdvance(); });
  if (document.addEventListener) document.addEventListener('keydown', e => {
    if (!wallOpen) return;
    if (e.key === 'Escape') closeWall();
    else if (e.key === 'ArrowRight' || e.key === ' ') {
      if (e.preventDefault) e.preventDefault();
      wallAdvance();
    }
  });
}
initWall();

/* ---------- the county watch (within-visit alerting) ----------
   Every other feature on this page is pull: it answers when you visit.
   The watch is the page keeping an eye out between glances. While the
   page is open (tab, home-screen app, or wall), it polls the same three
   safety signals the panels use — NWS alerts, the bridge snapshot, the
   ferry snapshot — every two minutes, against a baseline taken when the
   watch started (so it never alarms for what was already posted). A
   genuinely new warning, a bridge status flip, or a ferry alert fires a
   device notification where the browser offers one, a spoken line if the
   visitor opted in, and a permanent line in the on-page log. Clearances
   are logged, never announced. Failed polls skip their signal and keep
   the older baseline — the R1 per-signal rule. The only state is the
   on/off + voice choice in localStorage. */
const WATCH_KEY = 'ccl-watch-v1';
const WATCH_POLL_MS = 2 * 60 * 1000;
let watchTimer = null;
let watchBase = null;      // { alerts: {id:name}, bStatus, bAlerts, ferry } — null field = signal not yet read
let watchStartedAt = 0;
let watchLastCheck = 0;

function watchLoadPref() {
  try { return JSON.parse(localStorage.getItem(WATCH_KEY)) || {}; } catch (e) { return {}; }
}
function watchSavePref(p) {
  try { localStorage.setItem(WATCH_KEY, JSON.stringify(p)); } catch (e) { /* private mode: session-only */ }
}
function watchVoiceOn() {
  const box = $('watch-voice');
  if (box) return !!box.checked;
  return !!watchLoadPref().voice;
}
function watchAlertMap(d) {
  const m = {};
  (d.features || []).forEach(f => {
    const p = f.properties || {};
    const id = f.id || p.id || ((p.event || 'Alert') + '|' + (p.headline || ''));
    m[id] = p.event || 'Weather alert';
  });
  return m;
}
const watchLines = [];
function watchLog(html, cls) {
  watchLines.unshift('<li' + (cls ? ' class="' + cls + '"' : '') + '><span class="watch-log-time">'
    + esc(fmtTime(new Date())) + '</span> ' + html + '</li>');
  if (watchLines.length > 6) watchLines.length = 6;
  const log = $('watch-log');
  if (log) log.innerHTML = watchLines.join('');
}
function watchNotify(title, text) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body: text, tag: 'ccl-watch' });
    }
  } catch (e) { /* notifications are a bonus channel, never a blocker */ }
}
function watchSpeak(text) {
  try {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 1.02;
    window.speechSynthesis.speak(u);
  } catch (e) { /* silent if the voice engine refuses */ }
}
function watchFire(title, text, speak) {
  watchLog('<strong>' + esc(title) + ':</strong> ' + esc(text), 'watch-hit');
  watchNotify(title, text);
  if (speak && watchVoiceOn()) watchSpeak(title + '. ' + text);
  const card = $('watch-card');
  if (card) { card.classList.remove('watch-flash'); card.classList.add('watch-flash'); }
}
function watchRenderState() {
  const state = $('watch-state'), status = $('watch-status'), btn = $('watch-btn');
  if (!state || !status || !btn) return;
  const watching = !!watchTimer;
  state.textContent = watching ? '🔔 Watching' : 'Not watching';
  btn.textContent = watching ? '⏹ Stop watching' : '🔔 Start watching';
  let notifLine;
  if (!('Notification' in window)) notifLine = 'This browser doesn\'t offer notifications to web pages, so the watch reports in the log' + (watchVoiceOn() ? ' and out loud' : '') + ' only.';
  else if (Notification.permission === 'granted') notifLine = 'Device notifications are on for this page.';
  else if (Notification.permission === 'denied') notifLine = 'Device notifications are blocked for this page in the browser — the log' + (watchVoiceOn() ? ' and the voice' : '') + ' still report everything.';
  else notifLine = 'Device notifications haven\'t been allowed yet — starting the watch will ask.';
  if (watching) {
    status.innerHTML = '<p class="watch-live-line"><span class="pulse-dot" aria-hidden="true"></span> Watching since '
      + esc(fmtTime(new Date(watchStartedAt))) + ' — checking every 2 minutes'
      + (watchLastCheck ? ', last check ' + esc(fmtTime(new Date(watchLastCheck))) : '') + '. '
      + esc(notifLine) + '</p>';
  } else {
    status.innerHTML = '<p>The watch is off. Start it and this page will keep an eye on warnings, the bridge, and the ferry while it stays open. ' + esc(notifLine) + '</p>';
  }
}
async function watchPoll(first) {
  if (!watchTimer && !first) return;             // stopped between ticks
  if (first && !watchTimer) return;              // start was cancelled before the poll landed
  const cur = { alerts: null, bStatus: null, bAlerts: null, ferry: null };
  try { cur.alerts = watchAlertMap(await getJSON(NWS_ALERTS_URL, { 'Accept': 'application/geo+json' })); } catch (e) { /* keep old baseline */ }
  try {
    const snap = await getSnapshot('roads.json');
    const b = (snap && snap.bridge) || {};
    cur.bStatus = b.status || '';
    cur.bAlerts = JSON.stringify(b.alerts || []);
  } catch (e) { /* keep old baseline */ }
  try {
    const snap = await getSnapshot('ferry.json');
    cur.ferry = snap && snap.alert ? String(snap.alert) : '';
  } catch (e) { /* keep old baseline */ }
  watchLastCheck = Date.now();
  if (first || !watchBase) {
    watchBase = { alerts: cur.alerts || {}, bStatus: cur.bStatus, bAlerts: cur.bAlerts, ferry: cur.ferry };
    const names = Object.keys(watchBase.alerts).map(id => watchBase.alerts[id]);
    if (names.length) {
      watchLog('Watch started. Already posted, so you won\'t be re-alerted for ' + (names.length === 1 ? 'it' : 'them') + ': ' + esc(names.join(', ')) + '.', 'watch-note');
    } else {
      watchLog('Watch started. No alerts posted right now — the next one that posts will be announced here.', 'watch-note');
    }
    watchRenderState();
    return;
  }
  if (cur.alerts) {
    Object.keys(cur.alerts).forEach(id => {
      if (!(id in watchBase.alerts)) {
        const name = cur.alerts[id];
        const isWarn = /warning/i.test(name);
        watchFire(isWarn ? 'New weather warning' : 'New weather alert',
          name + ' — see Weather Alerts on this page for the official wording.', isWarn);
      }
    });
    Object.keys(watchBase.alerts).forEach(id => {
      if (!(id in cur.alerts)) watchLog('✅ Cleared: ' + esc(watchBase.alerts[id]) + '.', 'watch-note');
    });
    watchBase.alerts = cur.alerts;
  }
  if (cur.bStatus !== null && watchBase.bStatus !== null
      && (cur.bStatus !== watchBase.bStatus || cur.bAlerts !== watchBase.bAlerts)) {
    const problem = cur.bStatus !== 'clear' || cur.bAlerts !== '[]';
    if (problem) watchFire('Lewis & Clark Bridge', 'The bridge status just changed — check Roads & the Bridge on this page before you head out.', true);
    else watchLog('✅ The bridge is clear again.', 'watch-note');
    watchBase.bStatus = cur.bStatus;
    watchBase.bAlerts = cur.bAlerts;
  }
  if (cur.ferry !== null && watchBase.ferry !== null && cur.ferry !== watchBase.ferry) {
    if (cur.ferry) watchFire('Oscar B ferry alert', cur.ferry, true);
    else watchLog('✅ The ferry alert has cleared.', 'watch-note');
    watchBase.ferry = cur.ferry;
  }
  watchRenderState();
}
function watchStart() {
  if (watchTimer) return;
  watchStartedAt = Date.now();
  watchBase = null;
  watchTimer = setInterval(() => watchPoll(false), WATCH_POLL_MS);
  watchRenderState();
  watchPoll(true);
}
function watchStop() {
  if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
  watchLog('Watch stopped. The page is back to answering only when you look.', 'watch-note');
  watchRenderState();
}
function initWatch() {
  const btn = $('watch-btn'), box = $('watch-voice');
  if (!btn || !$('watch-card')) return;
  const pref = watchLoadPref();
  if (box) {
    box.checked = !!pref.voice;
    const syncVoice = () => { const p = watchLoadPref(); p.voice = !!box.checked; watchSavePref(p); watchRenderState(); };
    box.addEventListener('change', syncVoice);
    box.addEventListener('click', syncVoice);
  }
  btn.addEventListener('click', () => {
    if (watchTimer) {
      const p = watchLoadPref(); p.on = false; watchSavePref(p);
      watchStop();
      return;
    }
    const p = watchLoadPref(); p.on = true; watchSavePref(p);
    if ('Notification' in window && Notification.permission === 'default') {
      try { const r = Notification.requestPermission(); if (r && r.then) r.then(() => watchRenderState()); } catch (e) { /* older callback form unsupported here */ }
    }
    watchStart();
  });
  watchRenderState();
  if (pref.on) watchStart();   // an installed app or kept-open tab resumes its watch, on a fresh baseline
}
initWatch();

/* ---------- finder (X20 R14): one search across the whole page ----------
   Twenty-three rounds made the page deep; this makes the depth findable.
   Indexes every card (plain-language keywords), all seven towns (jump +
   switch the forecast), and every event on the calendars (jump + flash the
   exact row). The index is built client-side. */
const FINDER_SECTIONS = [
  { id: 'map',           title: 'Live map',                  sub: 'Radar, planes, ships, fires, the ISS — on one map', keys: 'map radar layers explore' },
  { id: 'roads-card',    title: 'US-30, the Bridge & Roads', sub: 'Commute verdict, bridge status, incidents, cameras', keys: 'bridge road highway us-30 commute drive driving closure closed traffic longview cameras detour cornelius pass' },
  { id: 'drive-card',    title: 'Your Commute — drive times', sub: 'How long the drive takes, from your town to St. Johns, Portland or Longview', keys: 'commute drive time minutes how long portland st johns longview traffic trip' },
  { id: 'ships-card',    title: 'Columbia River Traffic',    sub: 'Ships under way on the river right now', keys: 'ship ships vessel ais river traffic boat freighter' },
  { id: 'ferry-card',    title: 'Oscar B Ferry',             sub: 'Next-boat countdown and the leave-by planner', keys: 'ferry boat oscar westport cathlamet puget island sailing crossing leave' },
  { id: 'events-card',   title: 'Events — Next Two Weeks',   sub: 'City and county calendars, with add-to-calendar', keys: 'events calendar meeting meetings library storytime tonight weekend happening' },
  { id: 'alerts-card',   title: 'Weather Alerts',            sub: 'National Weather Service warnings and watches', keys: 'alert alerts warning warnings watch storm flood weather severe' },
  { id: 'forecast-card', title: 'Forecast',                  sub: 'Town forecasts from the National Weather Service', keys: 'forecast weather rain snow temperature wind weekend' },
  { id: 'aircraft-card', title: 'Aircraft Overhead',         sub: 'Planes over the county right now, from community ADS-B receivers', keys: 'plane planes aircraft flight flights overhead adsb low local ground traffic' },
  { id: 'sky-card',      title: 'In the Sky Right Now',      sub: 'The ISS, and when to see the station pass', keys: 'iss station satellite sky look up passes pass' },
  { id: 'dark-card',     title: 'After Dark — Tonight\u2019s Sky', sub: 'Clouds, moonlight, aurora odds and meteor showers — is tonight worth looking up?', keys: 'stars stargazing night sky dark aurora northern lights meteor meteors shooting star telescope astronomy milky way bundle up tonight' },
  { id: 'rivers-card',   title: 'River Levels',              sub: 'USGS gauges on the Columbia and Nehalem', keys: 'river rivers level levels gauge gauges flood height columbia nehalem' },
  { id: 'tides-card',    title: 'River Tides',               sub: 'Next high and low tide at St. Helens and Wauna', keys: 'tide tides high low slack fishing dock ramp' },
  { id: 'steelhead-card', title: 'Steelhead — the Small Rivers', sub: 'Is today a good day? Wilson, Nehalem, Big Creek & more', keys: 'steelhead wilson nehalem big creek gnat klaskanine clatskanie scappoose winter fishing river conditions clarity good day' },
  { id: 'quakes-card',   title: 'Earthquakes — last 30 days', sub: 'USGS earthquakes near the county', keys: 'earthquake earthquakes quake quakes tremor seismic shook' },
  { id: 'fires-card',    title: 'Wildfires',                 sub: 'Interagency wildfire incidents', keys: 'fire fires wildfire wildfires smoke burn burning' },
  { id: 'air-card',      title: 'Air & Smoke',               sub: 'Air Quality Index, fine particles, and the day\u2019s smoke outlook', keys: 'air quality aqi smoke breathe breathing pm25 lungs asthma dust wood stove' },
  { id: 'almanac-card',  title: 'The County Almanac',        sub: 'Sunrise, sunset, daylight left, and the moon', keys: 'sunset sunrise dark daylight day length moon golden hour light' },
  { id: 'plan-card',     title: 'Tonight & tomorrow',        sub: 'The evening planning brief', keys: 'tonight tomorrow plan morning evening ahead first boat' },
  { id: 'go-card',       title: 'Before You Go — Trip Check', sub: 'A go / no-go verdict for the drive, the ferry, or the river', keys: 'trip check before you go leave leaving go no-go ready set out outing commute drive ferry boat ramp fishing launch departure verdict should i go' },
  { id: 'briefing-card', title: 'The County Briefing',       sub: 'Today in one copyable note — or hear it read aloud', keys: 'briefing summary copy share text listen hear read aloud voice' },
  { id: 'watch-card',    title: 'The County Watch',          sub: 'Get told when a warning posts or the bridge closes', keys: 'notify notification notifications alarm alert me tell me watch monitor' },
  { id: 'since-card',    title: 'Since you were away',       sub: 'What changed since your last visit', keys: 'changed new since missed away difference' },
  { id: 'home-card',     title: 'Make it yours',             sub: 'Pick your home town and the page tunes itself', keys: 'my town home town personalize personalise settings set town' },
  { id: 'freshness-card', title: 'How fresh is this page?',  sub: 'Every source, its age, in the open', keys: 'fresh freshness stale updated sources trust age old' },
  { id: 'share-card',    title: 'Keep it handy / Wall display', sub: 'Home-screen install, sharing, and the big-screen wall', keys: 'install home screen app share wall display tv screen handy keep' },
  { id: 'share-card',    title: 'Print the county sheet',    sub: 'One paper page with today\u2019s answers — fridge, bulletin board, shop counter', keys: 'print printed paper fridge bulletin board poster sheet hard copy post pin up' }
];
let finderHits = [];
let finderActive = -1;
let finderFlashTimer = null;

function finderNorm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function finderScore(hit, words) {
  const title = finderNorm(hit.title);
  const titleWords = title.split(/[^a-z0-9]+/);
  const hay = title + ' ' + finderNorm(hit.sub) + ' ' + finderNorm(hit.keys);
  let total = 0;
  for (const w of words) {
    let s = 0;
    if (titleWords.some(tw => tw === w)) s = 5;
    else if (titleWords.some(tw => tw.indexOf(w) === 0)) s = 4;
    else if (title.indexOf(w) !== -1) s = 3;
    else if (finderNorm(hit.keys).indexOf(w) !== -1) s = 2;
    else if (hay.indexOf(w) !== -1) s = 1;
    if (!s) return 0;
    total += s;
  }
  return total;
}
function finderSearch(q) {
  const words = finderNorm(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  FINDER_SECTIONS.forEach((s, i) => {
    const el = $(s.id);
    if (!el || el.hidden) return;               // can't jump to what isn't on the page
    const sc = finderScore({ title: s.title, sub: s.sub, keys: s.keys }, words);
    if (sc) hits.push({ kind: 'section', title: s.title, sub: s.sub, target: s.id, score: sc, ord: i });
  });
  TOWNS.forEach((t, i) => {
    const sc = finderScore({ title: t.name, sub: '', keys: 'town forecast weather' }, words);
    if (sc) hits.push({ kind: 'town', title: t.name, sub: 'Jump to the forecast — switched to ' + t.name, town: t, score: sc, ord: 100 + i });
  });
  if (eventsCache && (eventsCache.events || []).length) {
    eventsCache.events.forEach((ev, i) => {
      if (eventDayDiff(ev.date) < 0) return;     // past events aren't findable promises
      const sc = finderScore({ title: ev.title, sub: ev.source || '', keys: 'event' }, words);
      if (sc) hits.push({
        kind: 'event', title: ev.title,
        sub: fmtDay(new Date(ev.date + 'T12:00:00')) + (ev.time ? ' · ' + ev.time : '') + (ev.source ? ' · ' + ev.source : ''),
        eventTitle: ev.title, score: sc, ord: 200 + i
      });
    });
  }
  const rank = { section: 0, town: 1, event: 2 };
  hits.sort((a, b) => (b.score - a.score) || (rank[a.kind] - rank[b.kind]) || (a.ord - b.ord));
  return hits.slice(0, 8);
}
function finderFlashEl(el, rowClass) {
  if (!el) return;
  document.querySelectorAll('.finder-flash,.finder-flash-row').forEach(x => {
    x.classList.remove('finder-flash'); x.classList.remove('finder-flash-row');
  });
  if (finderFlashTimer) clearTimeout(finderFlashTimer);
  const cls = rowClass ? 'finder-flash-row' : 'finder-flash';
  el.classList.add(cls);
  finderFlashTimer = setTimeout(() => el.classList.remove(cls), 2700);
}
function finderJump(el) {
  if (!el) return;
  cclReveal(el); // Redesign 2026-11-04: switch to the view holding the target first
  try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  catch (e) { el.scrollIntoView(); }
  finderFlashEl(el, false);
}
function finderGo(hit) {
  const box = $('finder-results');
  box.hidden = true; box.innerHTML = ''; finderHits = []; finderActive = -1;
  if (hit.kind === 'section') {
    finderJump($(hit.target));
  } else if (hit.kind === 'town') {
    loadForecast(hit.town);
    finderJump($('forecast-card'));
  } else if (hit.kind === 'event') {
    if (typeof currentEventFilter !== 'undefined' && currentEventFilter !== 'all') {
      const allBtn = $('event-filters').querySelectorAll('.event-filter-btn')
        .find(b => b.dataset.filter === 'all');
      if (allBtn) allBtn.click();
    }
    finderJump($('events-card'));
    setTimeout(() => {
      const rows = $('events-body').querySelectorAll('.event-row');
      for (const r of rows) {
        const t = r.querySelector('.event-title');
        if (t && finderNorm(t.textContent) === finderNorm(hit.eventTitle)) { finderFlashEl(r, true); break; }
      }
    }, 500);
  }
}
function renderFinder(q) {
  const box = $('finder-results');
  finderHits = finderSearch(q);
  finderActive = finderHits.length ? 0 : -1;
  if (!finderNorm(q)) { box.hidden = true; box.innerHTML = ''; return; }
  if (!finderHits.length) {
    box.innerHTML = '<p class="finder-empty">Nothing on this page matches &ldquo;' + esc(q) + '&rdquo;. '
      + 'Try a shorter word — &ldquo;ferry&rdquo;, &ldquo;river&rdquo;, &ldquo;rain&rdquo; — or an event name from the calendars below.</p>';
    box.hidden = false;
    return;
  }
  box.innerHTML = finderHits.map((h, i) =>
    '<button type="button" class="finder-result' + (i === finderActive ? ' active' : '') + '" data-finder-idx="' + i + '">'
    + '<span class="finder-kind kind-' + h.kind + '">' + (h.kind === 'section' ? 'Section' : h.kind === 'town' ? 'Town' : 'Event') + '</span>'
    + '<span class="finder-result-main"><span class="finder-result-title">' + esc(h.title) + '</span>'
    + '<span class="finder-result-sub">' + esc(h.sub) + '</span></span></button>'
  ).join('');
  box.hidden = false;
}
function initFinder() {
  const input = $('finder-input');
  const box = $('finder-results');
  if (!input || !box) return;
  let deb = null;
  input.addEventListener('input', () => {
    clearTimeout(deb);
    deb = setTimeout(() => renderFinder(input.value), 120);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!finderHits.length) return;
      e.preventDefault();
      finderActive = (finderActive + (e.key === 'ArrowDown' ? 1 : -1) + finderHits.length) % finderHits.length;
      box.querySelectorAll('.finder-result').forEach((b, i) => b.classList.toggle('active', i === finderActive));
    } else if (e.key === 'Enter') {
      if (finderActive >= 0 && finderHits[finderActive]) { e.preventDefault(); finderGo(finderHits[finderActive]); }
    } else if (e.key === 'Escape') {
      input.value = ''; renderFinder(''); input.blur();
    }
  });
  box.addEventListener('click', e => {
    const b = e.target.closest('.finder-result');
    if (!b) return;
    const hit = finderHits[parseInt(b.dataset.finderIdx, 10)];
    if (hit) finderGo(hit);
  });
  /* Deliberately NO global key handler of our own: the wall display owns the
     document-level Esc key, and a second global listener is exactly the kind
     of collision that breaks another mode's exit. The finder lives at the
     top of the page; it does not need to ambush keystrokes to be found. */
}
initFinder();

/* ---------- X20 R15: air & smoke ----------
   Twenty-four shipped changes covered the roads, the river, the sky,
   the light, and the calendar — but never the medium everyone in the
   county breathes ~20,000 times a day. In a river valley that traps
   wood-stove smoke under winter inversions and collects wildfire
   smoke all summer, "how's the air?" is a daily health question —
   should the kids play outside, should grandpa walk, is that haze
   smoke or fog — and the page had no answer for it at all. The
   Wildfires card reports incidents; smoke is what arrives from fires
   a hundred miles away on a day the incident map reads zero.
   Open-Meteo's air-quality API (Copernicus CAMS atmosphere model)
   publishes a US AQI estimate for any point on Earth — free,
   keyless, CORS-open, verified live before building — so the card
   loads browser-direct like NWS and USGS. It follows the town on the
   Forecast card (the page's working town), re-checking every minute
   whether that town changed. The honesty rules are printed on the
   card itself: this is a modeled estimate, not a sensor — there is
   no official AQI monitor in the county — and the official word
   lives at AirNow, one tap away. Health lines are the EPA's
   standard category guidance in plain words; the card never guesses
   at a cause for the number. */
const AIR_CATS = [
  { max: 50,       name: 'Good',                           color: '#34d399',
    advice: 'The air is clean — get outside and enjoy it.' },
  { max: 100,      name: 'Moderate',                       color: '#ffd23f',
    advice: 'Fine for nearly everyone. If smoke or dust usually bothers you, ease off a little on long, hard outdoor work.' },
  { max: 150,      name: 'Unhealthy for Sensitive Groups', color: '#ff8c42',
    advice: 'Touchy for sensitive lungs — kids, grandparents, and anyone with asthma or heart or lung trouble should keep heavy outdoor effort short, or move it inside.' },
  { max: 200,      name: 'Unhealthy',                      color: '#f87171',
    advice: 'Not good for anyone, really. Keep outdoor exertion lighter and shorter; sensitive folks should stay in and keep the windows shut.' },
  { max: 300,      name: 'Very Unhealthy',                 color: '#c084fc',
    advice: 'Health-alert air. Stay inside if you can, run an air cleaner if you have one, and keep the windows closed.' },
  { max: Infinity, name: 'Hazardous',                      color: '#fb7185',
    advice: 'Stay indoors and seal the house up — and check on your neighbors. This is emergency-level air.' }
];
let airData = null;   // { town, cur: { aqi, pm25, pm10 }, hours: [{ t, aqi }] }
let airTownName = '';
function airCat(aqi) {
  for (const c of AIR_CATS) if (aqi <= c.max) return c;
  return AIR_CATS[AIR_CATS.length - 1];
}
function airUrl(town) {
  return 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + town.lat
    + '&longitude=' + town.lon + '&current=us_aqi,pm2_5,pm10'
    + '&hourly=us_aqi&forecast_days=2&timezone=America%2FLos_Angeles';
}
function airInstant(tstr) {
  // Open-Meteo's hourly stamps are Pacific wall-clock ("2026-11-03T21:00")
  // because the request names the timezone. Same two-pass offset
  // conversion the tides and calendar modules use.
  const m = String(tstr || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return NaN;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let utc = wall - evcalPtOffsetMs(wall + 8 * 3600e3);
  utc = wall - evcalPtOffsetMs(utc);
  return utc;
}
function airDayStr(ms) {
  const p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  return p.year + '-' + p.month + '-' + p.day;
}
async function loadAir() {
  const body = $('air-body');
  if (!body) return;
  const town = currentTown;
  try {
    const d = await getJSON(airUrl(town));
    const cur = d && d.current;
    if (!cur || cur.us_aqi == null) throw new Error('no current AQI in response');
    const times = (d.hourly && d.hourly.time) || [];
    const aqis = (d.hourly && d.hourly.us_aqi) || [];
    const hours = [];
    for (let i = 0; i < times.length; i++) {
      const t = airInstant(times[i]);
      if (!isNaN(t) && aqis[i] != null) hours.push({ t, aqi: Math.round(aqis[i]) });
    }
    airData = { town: town.name,
      cur: { aqi: Math.round(cur.us_aqi), pm25: cur.pm2_5, pm10: cur.pm10 }, hours };
    airTownName = town.name;
    setUpdated('air-updated');
  } catch (e) { /* keep the last good reading; if there is none, renderAir shows the honest fallback */ }
  renderAir();
}
function renderAir() {
  const body = $('air-body');
  if (!body) return;
  if (!airData) {
    body.innerHTML = '<p class="fallback">The air-quality model couldn\'t be reached just now — '
      + 'official readings and the smoke outlook live at '
      + '<a href="https://www.airnow.gov/" target="_blank" rel="noopener">AirNow</a>.</p>';
    return;
  }
  const aqi = airData.cur.aqi;
  const cat = airCat(aqi);
  const now = Date.now();
  const today = todayStrPT();
  const nowEdge = now + 30 * 60000; // the current hour counts as "now", not "later"
  const past = airData.hours.filter(h => airDayStr(h.t) === today && h.t <= nowEdge);
  const rest = airData.hours.filter(h => airDayStr(h.t) === today && h.t > nowEdge);
  const peakOf = list => list.reduce((m, h) => (m && m.aqi >= h.aqi ? m : h), null);
  const bits = [];
  const peakPast = peakOf(past);
  if (peakPast && peakPast.aqi > aqi + 5) {
    bits.push('Today\'s high so far was AQI ' + peakPast.aqi + ' around '
      + fmtTime(new Date(peakPast.t)) + '.');
  }
  const peakRest = peakOf(rest);
  if (peakRest && peakRest.aqi > aqi + 5) {
    bits.push('The model expects it to build to AQI ' + peakRest.aqi + ' around '
      + fmtTime(new Date(peakRest.t)) + ' before it eases.');
  } else if (rest.length) {
    const last = rest[rest.length - 1];
    if (last.aqi < aqi - 5) {
      bits.push('The model has it easing through the day, down to AQI ' + last.aqi
        + ' by ' + fmtTime(new Date(last.t)) + '.');
    } else {
      bits.push('The model has it holding about steady for the rest of today.');
    }
  }
  const bounds = [50, 100, 150, 200, 300];
  const segs = AIR_CATS.slice(0, 5).map((c, i) => {
    const w = ((bounds[i] - (i ? bounds[i - 1] : 0)) / 300) * 100;
    return '<span class="air-seg" style="width:' + w.toFixed(2) + '%;background:' + c.color + '"></span>';
  }).join('');
  const markerPct = Math.min(aqi, 300) / 300 * 100;
  const readings = [];
  if (airData.cur.pm25 != null) {
    readings.push('<span>PM2.5 — the fine particles in smoke: <strong>'
      + num(airData.cur.pm25, 1) + ' µg/m³</strong></span>');
  }
  if (airData.cur.pm10 != null) {
    readings.push('<span>PM10 — the coarser dust-sized particles: <strong>'
      + num(airData.cur.pm10, 1) + ' µg/m³</strong></span>');
  }
  body.innerHTML =
    '<div class="air-verdict" style="border-left-color:' + cat.color + '">'
    + '<div class="air-big" style="color:' + cat.color + '">' + aqi + '</div>'
    + '<div class="air-cat"><div class="air-cat-name">' + esc(cat.name) + '</div>'
    + '<div class="air-cat-sub">US Air Quality Index · modeled for ' + esc(airData.town) + '</div></div></div>'
    + '<p class="air-advice">' + esc(cat.advice) + '</p>'
    + '<div class="air-scale">' + segs
    + '<span class="air-marker" style="left:' + markerPct.toFixed(1) + '%"></span></div>'
    + '<div class="air-scale-labels"><span>0</span><span>50</span><span>100</span><span>150</span><span>200</span><span>300+</span></div>'
    + (bits.length ? '<p class="air-day">' + bits.join(' ') + '</p>' : '')
    + (readings.length ? '<div class="air-readings">' + readings.join('') + '</div>' : '');
}
function tickAir() {
  // The card follows the Forecast card's town: if the visitor (or the
  // home-town tuning, or the finder) switched towns, breathe for the
  // new one. Otherwise just re-render so the day lines stay honest
  // as the hours roll past.
  if (currentTown && currentTown.name !== airTownName) { loadAir(); return; }
  if (airData) renderAir();
}
function initAir() {
  loadAir();
  setInterval(loadAir, 30 * 60 * 1000);
  setInterval(tickAir, 60 * 1000);
}
initAir();

/* ================= X20 Round 16 — "En español": the page learns Spanish =====
   Twenty-five shipped changes, and every one of them spoke only English —
   yet a real share of this county reads its phone in Spanish, and for them
   the page's front door was closed: not the data (alerts and listings are
   English at their official sources, and the page has never pretended
   otherwise), but the page itself — its headings, buttons, and notes.
   This module translates the page's own chrome: a 🌎 pill beside the hero
   clock swaps every static heading, button, and note (each marked
   data-i18n in index.html) to Spanish and back, in place, from the
   dictionary below; the English originals are captured from the DOM on
   first use, so switching back restores them exactly. The tab title and
   the finder's placeholder follow; <html lang> follows too, so screen
   readers pronounce the page correctly. The choice lives only in the
   visitor's browser (ccl-lang-v1), beside the home-town pref, and a
   returning Spanish reader finds the page already speaking Spanish.
   Honest scope, printed on the page in both languages: live readings,
   alerts, forecasts, and event listings keep arriving in English from
   their official sources — what translates is everything this page itself
   says. Dynamic labels a module rewrites as state changes (the watch
   button, the listen button mid-speech) may land back in English; the
   static chrome never does. No feed, no key, no library. */
const LANG_KEY = 'ccl-lang-v1';
const LANG_ES = {
  __title: 'Columbia County Live — Carreteras, ríos, clima y ferry para el condado de Columbia, Oregón',
  tabtoday: 'Hoy',
  tabtravel: 'Viajes',
  taboutdoors: 'Aire libre',
  tabmore: 'Eventos y más',
  fseyebrow: 'Presentado por nuestros patrocinadores fundadores',
  fs1box: 'Lugar reservado',
  fs1eyebrow: 'Patrocinador fundador · Lugar 1 de 3 — Reservado',
  fs1h3: 'Este lugar está reservado',
  fs1p: 'Estamos apartando este lugar para un negocio local mientras decide. Su nombre se suma a este panel solo si confirma y aprueba su tarjeta — los otros dos lugares siguen disponibles.',
  fs1cta: 'Ver los dos lugares que quedan &rarr;',
  fslogohere: 'Tu logo aquí',
  fs2eyebrow: 'Patrocinador fundador · Lugar 2 de 3 — Disponible',
  fs2h3: 'Tu negocio aquí',
  fs2p: 'Uno de solo tres lugares fundadores, para siempre — tu nombre y logo en el panel que todo visitante ve primero. $49/mes, bloqueado mientras te quedes, y una prueba gratuita de 30 días antes de pagar algo.',
  fs2cta: 'Reclama el lugar 2 &rarr;',
  fs3eyebrow: 'Patrocinador fundador · Lugar 3 de 3 — Disponible',
  fs3h3: 'Tu negocio aquí',
  fs3p: 'Uno de solo tres lugares fundadores, para siempre — tu nombre y logo en el panel que todo visitante ve primero. $49/mes, bloqueado mientras te quedes, y una prueba gratuita de 30 días antes de pagar algo.',
  fs3cta: 'Reclama el lugar 3 &rarr;',
  fsfoot: 'Cada patrocinador fundador conserva una insignia permanente de «Patrocinador Fundador · 2026» y un lugar en el muro de Socios Comunitarios de abajo — aunque después cambie de nivel. El período fundador cierra el 31 de enero de 2027 — después de eso, nunca más habrá patrocinadores fundadores nuevos.',
  commuteh2: '🚗 El veredicto del viaje',
  commutenote: 'La respuesta en una línea para manejar ahora mismo. El panorama completo del corredor — puente, incidentes y cámaras — está en la pestaña Viajes.',
  driveh2: '🧭 Tu viaje — ¿cuánto dura el manejo?',
  drivefrom: 'Desde',
  driveto: 'Hasta',
  drivenote: 'Tiempo típico — sin tráfico en vivo. El tiempo viene del servicio gratuito de rutas OSRM, recorriendo la ruta a las velocidades señaladas en condiciones normales — un cierre, una apertura del puente o un choque en la US-30 cambiarán el viaje real.',
  aircrafth2: '✈️ Aviones sobre el condado',
  aircraftnote: 'Aviones: receptores ADS-B de la comunidad vía adsb.fi. Se actualiza automáticamente.',
  __finderPh: 'Busca lo que sea — prueba «ferry», «marea alta», «hora de cuentos», un pueblo…',
  tagline: 'Carreteras · Ríos · El clima · El ferry — Condado de Columbia, Oregón',
  clocklabel: 'Hora del Pacífico',
  herotitle: 'Todo lo que pasa en el condado, <em>en una sola mirada en vivo.</em>',
  heropromise: 'La US-30 y el puente Lewis &amp; Clark, los niveles del río Columbia, las alertas del clima, el ferry Oscar B y los eventos de esta semana — reunidos de fuentes públicas oficiales y actualizados todo el día.',
  striproads: '<span class="pulse-dot" aria-hidden="true"></span>Carreteras y puente',
  striprivers: '🌊 Niveles del río',
  stripalerts: '⚠️ Alertas del clima',
  stripsky: '✈️ El cielo y la estación espacial',
  stripferry: '⛴️ El ferry Oscar B',
  stripevents: '📅 Eventos',
  stickyriver: 'Río',
  stickyferry: 'Ferry',
  stickyevents: 'Eventos',
  stickybiz: 'Negocios',
  stickysky: 'Cielo',
  offlinenote: "📶 No tienes conexión — este teléfono muestra las últimas lecturas que recogió. Sus edades reales están en el <a href=\"#freshness-card\">tablero de frescura</a> más abajo; confirma con las fuentes oficiales antes de viajar.",
  glbridge: 'Puente',
  glbridgesub: 'Puente Lewis &amp; Clark',
  glalerts: 'Alertas del clima',
  glalertssub: 'Servicio Meteorológico Nacional',
  glriver: 'Río Columbia — Mareas',
  glriversub: 'Medidor de Port Westward · USGS',
  glevents: 'Próximo evento',
  finderhint: 'Una sola búsqueda en todas las tarjetas de esta página, los siete pueblos y los calendarios de eventos — toca un resultado y la página te lleva directo.',
  homeh2: '🏠 Hazlo tuyo',
  sinceh2: '🧭 Mientras no estabas',
  watchh2: '🔔 La Vigilancia del Condado',
  watchnote: 'Todo lo demás en esta página espera a que vengas a mirar. La vigilancia no. Deja esta página abierta — en una pestaña, instalada en tu pantalla de inicio o en la pared — y revisa el Servicio Meteorológico Nacional, el puente y el ferry cada dos minutos. Si se publica una alerta nueva, el puente cierra o el ferry anuncia algo mientras no estás mirando, te avisa: una notificación en este dispositivo donde el navegador las ofrece, una línea en el registro de abajo y — si marcas la casilla — dice las alertas nuevas en voz alta.',
  watchbtn: '🔔 Empezar a vigilar',
  watchlimits: 'Límites honestos: la vigilancia solo funciona mientras esta página está abierta en este dispositivo — cerrar la pestaña la detiene, y un teléfono puede pausar una pestaña en segundo plano. Es una ayuda, nunca un reemplazo del Servicio Meteorológico Nacional, la Radio Meteorológica de NOAA ni las alertas de emergencia del condado de Columbia.',
  briefh2: '📋 El Resumen del Condado',
  briefnote: 'Las respuestas de hoy en un solo lugar — armadas desde los paneles en vivo de esta página y marcadas con la hora en que se preparó. Cópialas como una nota para un mensaje familiar, el grupo del vecindario, donde se reúna el condado. ¿Vas a manejar? Toca <strong>🔊 Escuchar el resumen</strong> y tu teléfono te lo lee en voz alta — primero las alertas del clima.',
  briefcopy: '📋 Copiar el resumen',
  briefshare: '📤 Compartir como texto',
  brieflisten: '🔊 Escuchar el resumen',
  planh2: '🌙 Esta noche y mañana',
  plannote: 'La revisión de la noche — lo que hay que dejar listo antes de dormir: el clima de esta noche, el manejo de mañana por la mañana, las primeras salidas del Oscar B y lo que hay mañana. Armado de las mismas fuentes oficiales que el resto de esta página.',
  almanach2: '🌅 El Almanaque del Condado',
  almanacnote: 'La salida y la puesta del sol, el crepúsculo y la luna se calculan en esta página desde las posiciones del sol y la luna — no hay ninguna fuente detrás que pueda quedarse vieja, y como todo almanaque impreso son buenos con unos minutos de margen. Las horas son para el pueblo nombrado en el panel; elige un pueblo de residencia arriba y el almanaque lo sigue.',
  mapnear: '📍 Cerca de mí',
  mapfull: '⛶ Pantalla completa',
  legtown: '<i class="dot dot-town"></i> Pueblo',
  leggauge: '<i class="dot dot-gauge"></i> Medidor del río',
  legquake: '<i class="dot dot-quake"></i> Terremoto (30 días)',
  leglandmark: '<i class="dot dot-landmark"></i> Puente / ferry',
  legplane: '<i class="dot dot-plane"></i> Aviones',
  legship: '<i class="dot dot-ship"></i> Barco (AIS)',
  legfire: '<i class="dot dot-fire"></i> Incendio forestal',
  legnote: 'Usa el botón de capas (arriba a la derecha del mapa) para activar el radar, los aviones, los barcos, los incendios y la estación espacial.',
  roadsh2: '🚗 La US-30, el puente y las carreteras',
  incidentsh3: 'Incidentes en la carretera — ODOT TripCheck',
  myrouteh3: '📷 Mi ruta — las cámaras de tu viaje, en orden de manejo',
  routeaheadh2: '🧭 Ruta por delante — el pronóstico del corredor',
  routeaheadnote: 'Las próximas horas en el corredor de la US-30, pueblo por pueblo — para que el hielo, la niebla o la nieve del camino aparezcan aquí antes que en el parabrisas. Pronóstico por hora del Servicio Meteorológico Nacional.',
  bendh2: '🏔️ El viaje a Bend — condiciones en los pasos',
  bendnote: 'Fuera del condado, incluido porque el viaje empieza aquí: las dos rutas que usa este condado para ir a Bend — la US-26 sobre el monte Hood por Government Camp, y la US-20 por el paso Santiam. Cámaras e incidentes de ODOT TripCheck; pronósticos de los pasos del Servicio Meteorológico Nacional. La pregunta que responde esta tarjeta: ¿hay nieve en el paso?',
  camerash3: 'Cámaras de carretera',
  roadsnote: "Los datos de carreteras los recoge nuestro recolector de ODOT TripCheck y WSDOT cada pocos minutos y se muestran con su hora de captura — nunca fingen ser más frescos de lo que son. Detalle oficial completo: <a href=\"https://www.tripcheck.com/\" target=\"_blank\" rel=\"noopener\">TripCheck</a> · <a href=\"https://wsdot.com/traffic/\" target=\"_blank\" rel=\"noopener\">Tráfico de WSDOT</a>. ¿Viajas a Portland? Un cierre de la US-30 suele significar Cornelius Pass o el puente St. Johns — revisa antes de salir, no después.",
  shipsh2: '🚢 Tráfico del río Columbia',
  shipsnote: 'Barcos ordenados por cuándo pasarán por tu pueblo de residencia — St. Helens hasta que elijas uno en «Hazlo tuyo» en la pestaña Hoy. Los tiempos estimados usan la velocidad actual reportada por cada barco, así que un barco que reduce la velocidad llega más tarde. Posiciones en vivo de AISStream, actualizadas más o menos cada cinco minutos.',
  ferryh2: '⛴️ El ferry Oscar B — Westport, OR ↔ Cathlamet, WA',
  ferryplanh3: '🧭 No pierdas el barco — ¿a qué hora tienes que salir?',
  fpdiror: 'Hacia Washington',
  fpdirwa: 'De regreso a Oregón',
  fpnote: 'Los tiempos de manejo son típicos para la US-30 / OR-47 en condiciones normales — tu viaje variará, y el barco no espera. El plan añade 10 minutos de margen en el muelle para estacionar, pagar (solo efectivo o cheque) y cargar.',
  ferrynote: 'El último ferry del Bajo Columbia, operado por el condado de Wahkiakum. Navega con horario fijo — no hay rastreador en vivo, así que el horario de abajo <em>es</em> el estado, todos los días del año. La línea de alertas de arriba la lee nuestro recolector de la página oficial del ferry del condado.',
  ferrybox1h: 'Desde Puget Island (lado de WA)',
  ferrybox1p: 'Cada hora en punto, <strong>5:00 AM – 10:00 PM</strong>',
  ferrybox2h: 'Desde Westport (lado de OR)',
  ferrybox2p: 'Cada hora y cuarto, <strong>5:15 AM – 10:15 PM</strong>',
  ferrybox3h: 'Tarifas (solo efectivo / cheque)',
  ferrybox3p: 'Auto $6 · Motocicleta $4 · Bicicleta $3 · A pie $2',
  ferrybridge: '¿Puente cerrado? El ferry históricamente extiende su horario durante los cierres del puente Lewis &amp; Clark — confirma en la página del condado antes de contar con ello.',
  ferrylink: 'Página oficial del ferry — Condado de Wahkiakum →',
  eventsh2: 'Eventos — Próximas dos semanas',
  evall: 'Todos',
  evtoday: 'Hoy',
  evweekend: 'Este fin de semana',
  evweek: 'Próximos 7 días',
  evcalnote: '¿Vas a ir? Toca <strong>＋ Agregar</strong> en cualquier evento y llega a tu propio calendario — con la hora convertida y la página oficial adjunta — para que tu teléfono te lo recuerde el mismo día.',
  eventsnote: "Recogido por nuestro recolector de los calendarios oficiales de las ciudades. Fuentes oficiales: <a href=\"https://www.sthelensoregon.gov/calendar.aspx\" target=\"_blank\" rel=\"noopener\">St. Helens</a> · <a href=\"https://www.scappoose.gov/calendar.aspx\" target=\"_blank\" rel=\"noopener\">Scappoose</a> · <a href=\"https://www.columbiacountyor.gov/calendar\" target=\"_blank\" rel=\"noopener\">Condado de Columbia</a>",
  eventadd: '¿Tiene un negocio o grupo local? Agregue su evento →',
  alertsh2: '⚠️ Alertas del clima',
  alertslink: 'Servicio Meteorológico Nacional — oficina de Portland →',
  forecasth2: '🌦️ Pronóstico',
  skyh2: 'En el cielo ahora mismo',
  skyall: 'Todo el tráfico',
  skylow: 'Bajo y local',
  skyground: 'En tierra',
  skynote: 'Aviones: receptores ADS-B de la comunidad vía adsb.fi. Posición de la estación espacial: wheretheiss.at. Las horas de paso se calculan en esta página desde la órbita publicada de la estación. Todo se actualiza automáticamente.',
  riversh2: '🌊 Niveles del río',
  riversnote: 'Las alertas de inundación, cuando se emiten, aparecen en Alertas del clima, arriba. Las lecturas son datos provisionales del USGS.',
  tidesh2: '🌊 Mareas del río',
  tidesnote: 'El Columbia es un río de mareas en todo su paso por St. Helens — el océano sube por el canal dos veces al día. Para la rampa de botes, el muelle, la playa del río o una hora de pesca, aquí está el próximo cambio de marea en las dos estaciones de NOAA del condado.',
  tidesnote2: 'Las <em>predicciones</em> de marea de NOAA Tides &amp; Currents (estación 9439201 en St. Helens, estación 9439099 en Wauna), en pies sobre el nivel medio de la bajamar. El caudal del río empuja el agua real fuera de la predicción — un río alto corre más alto y más tarde — así que toma las horas como el plan, no como una promesa.',
  fishh2: 'Conteos de peces — las presas',
  fishnote: 'Cada salmón que va hacia el alto Columbia pasa por la presa Bonneville, donde el Cuerpo de Ingenieros los cuenta en las escalas de peces. El día publicado más reciente suele ir uno o dos días detrás del calendario — los conteos se registran en video y se revisan antes de publicarse.',
  fishnote2: 'Conteos: Cuerpo de Ingenieros del Ejército de EE. UU., publicados por el Fish Passage Center y Columbia Basin Research (DART). Un cero es una respuesta real, no un vacío — significa que los contadores no vieron ninguno ese día.',
  trackerh2: '🎣 Rastreador de salmones',
  methodh3: 'El plan del día — pesca con la corriente',
  methodnote: 'Con corriente fuerte es hora del plunking y del ancla; cuando la corriente muere, es hora del curricán (trolling). Elige tu método y el plan resalta tus horarios.',
  steelh2: '🎣 Steelhead — los ríos pequeños',
  steelnote: '¿Es hoy un buen día para pescar steelhead? No hay conteos para estos arroyos a mitad de temporada — las trampas de los criaderos se cuentan, pero los números se publican después — así que esto juzga el día, no los peces: temporada, caudal, claridad del agua, frío y clima. Toca un río para ver el desglose completo.',
  steelhours: 'Regla general de Oregón: la pesca de steelhead es legal desde una hora antes del amanecer hasta una hora después del atardecer — el reglamento de cada río puede añadir excepciones, así que revisa el tuyo.',
  quakesh2: '🫨 Terremotos — últimos 30 días',
  firesh2: '🔥 Incendios forestales',
  firesnote: 'Datos oficiales de incidentes del Centro Nacional Interagencial de Incendios (WFIGS). Para avisos de evacuación, sigue siempre a la Oficina de Manejo de Emergencias del Condado de Columbia e InciWeb.',
  airh2: '🌫️ Aire y humo',
  airnote: 'La otra cosa invisible sobre el condado — lo que lleva el aire que respiras. Humo de estufas de leña en las noches quietas de invierno, humo de incendios en verano. Aquí está el Índice de Calidad del Aire para el pueblo de la tarjeta de Pronóstico de arriba, y hacia dónde dice el modelo que va.',
  airnote2: "Una estimación modelada del modelo atmosférico de Open-Meteo (Copernicus CAMS) — no hay un monitor oficial de calidad del aire en el condado, así que léelo como una buena guía, no como un medidor en un poste. Lecturas y alertas oficiales: <a href=\"https://www.airnow.gov/\" target=\"_blank\" rel=\"noopener\">AirNow</a>.",
  schoolsh2: 'Escuelas — Cierres y retrasos',
  schoolsnote: 'En las mañanas de tormenta, los distritos deciden temprano — St. Helens procura decidir antes de las 6:00 AM — y publican primero en sus propios sitios y aplicaciones. Esta tarjeta es un tablero de tormenta actualizado a mano: con clima tranquilo está en espera y muestra dónde publica cada distrito; en una mañana de tormenta lleva el reporte de ese día para cada distrito, verificado contra la publicación del propio distrito antes de subirlo aquí.',
  schoolsnote2: 'No existe ninguna fuente automática de cierres para estos distritos, así que este tablero se actualiza a mano en las mañanas de tormenta — y el sitio del propio distrito es siempre la última palabra para tu familia.',
  abouth2: '🌲 Acerca de Columbia County Live',
  aboutp1: 'Columbia County Live es una sola mirada en vivo al condado de Columbia, Oregón — la US-30 y el puente Lewis &amp; Clark, los ríos Columbia y Nehalem, las alertas del clima, el ferry Oscar B y lo que hay en el condado — reunido de fuentes públicas oficiales y actualizado todo el día. Lo construye y lo opera <strong>Nomad Development Group</strong>, un pequeño estudio local, con datos públicos gratuitos y alojamiento gratuito — así es como una página como esta puede existir para un condado de 54,000 personas.',
  aboutp2: '<strong>Por qué es gratis — y qué se queda gratis.</strong> El centro de esta página son datos de seguridad pública: alertas del clima, niveles de los ríos, estado del puente y del ferry, condiciones de las carreteras. Ese centro es gratis, no lleva patrocinadores, y así se queda — nunca estará detrás de un muro de pago. Esa promesa es la razón de ser de esta página.',
  aboutsupporth: 'Apoya este servicio — patrocinadores fundadores',
  aboutp3: 'Más adelante, un pequeño número de negocios locales podrá apoyar el servicio como patrocinadores fundadores — un lugar con su nombre en esta página, a precios de pueblo pequeño, cuando haya una audiencia real que mostrarles. <strong>Hoy no hay nada en venta.</strong> Si tu negocio u organización quiere ser el primero en enterarse cuando abra el patrocinio fundador, cuéntanos — la lista de interesados que armemos ahora es quien se entera primero.',
  aboutbtn: '✉️ Escribe a Nomad sobre el patrocinio fundador',
  aboutnote: 'Ese botón abre un correo a nomadov3rland@gmail.com. Incluye el nombre de tu negocio u organización, un nombre de contacto, tu pueblo y lo que te interesa — patrocinador fundador, anunciar un negocio u otra cosa — y te responderemos. Solo interés: sin pago, sin compromiso, nada que comprar todavía.',
  freshh2: '🕐 ¿Qué tan fresca es esta página?',
  freshspan: 'las edades se actualizan cada 30 s',
  freshnote: 'Cada número aquí nombra su fuente y su edad. Verde es fresco, ámbar está envejeciendo, rojo significa tratar el panel como viejo y revisar la fuente oficial. Si una fuente se queda callada, este tablero lo muestra en vez de esconderlo.',
  shareh2: 'Ten Columbia County Live a la mano',
  sharep: 'Gratis, sin anuncios, sin registro. Ponla en tu pantalla de inicio como una app, envíasela a un vecino que maneja por la US-30 — o apoya una tableta en el mostrador y toca <strong>Pantalla en pared</strong>: las respuestas del condado, grandes y rotando, hechas para la pantalla que ya está encendida.',
  sharebtn: '📤 Compartir esta página',
  installbtn: '📱 Agregar a pantalla de inicio',
  wallbtn: '📺 Pantalla en pared',
  saverbtn: '🖥️ Protector de pantalla',
  saverh2: '📸 El protector de pantalla de la comunidad',
  saverp1: 'La pantalla en pared rota las respuestas del condado. El protector de pantalla es el cuarto más tranquilo: fotografías del condado, cambiando despacio, con el reloj y solo las respuestas que tú fijas — hecho para quedarse encendido en una tableta de cocina, un mostrador o el televisor de una sala de espera. Se actualiza solo desde las mismas fuentes en vivo que esta página, nunca pide nada, y se va con un solo toque.',
  saverstart: '🖥️ Iniciar el protector de pantalla',
  savertip: '¿Lo vas a poner en un televisor o en una pantalla de oficina? Abre esta página con <strong>?display=1</strong> al final de la dirección y el protector de pantalla inicia solo — guarda esa dirección en el navegador del televisor y aparecerá sin más.',
  saverpinsh: 'Tus respuestas en la pantalla',
  saverspinsp: 'Fija las respuestas que te importan con los botones de aquí abajo. El protector de pantalla muestra tus fijadas, lo bastante grandes para leerse desde el otro lado del cuarto. Las fijadas se guardan solo en este aparato, y puedes cambiarlas cuando quieras.',
  savershareh: 'Comparte tu foto del condado',
  saversharep: 'Las fotografías del protector de pantalla vienen del propio condado — y la tuya podría ser una de ellas. Envía una foto que hayas tomado en cualquier lugar del condado de Columbia y, una vez aprobada, se une al conjunto por el que pasan todos los protectores de pantalla, con tu nombre. Gratis, siempre.',
  saverways: 'Dos maneras fáciles, sin cuenta y sin iniciar sesión: envía tu foto por correo a nomadov3rland@gmail.com con tu nombre y dónde la tomaste, o responde 3 preguntas rápidas en el formulario de fotos y luego envía la foto por correo. Eso es todo.',
  saveremailbtn: '📧 Envía tu foto por correo',
  saverformbtn: 'Usa el formulario rápido de fotos &rarr;',
  saverreview: 'Una puerta honesta: cada foto la mira una persona antes de unirse al conjunto — el lugar, la imagen y el permiso. Nada aparece automáticamente, y una foto que no es tuya para compartir nunca se publica.',
  dirh2: 'Servicios locales — los pequeños',
  dirintro: 'Niñeras, limpieza, manitas, cuidadores de mascotas, tutores — los negocios de una sola persona que mueven este condado, en una lista sencilla. Los locales con tienda están arriba como patrocinadores y negocios destacados; este estante es para los operadores más pequeños. Toca una categoría para acotar la lista.',
  dirall: 'Todos los servicios',
  dirchildcare: 'Cuidado infantil',
  dircleaning: 'Limpieza',
  dirhandyman: 'Manitas y reparaciones del hogar',
  dirpets: 'Cuidado de mascotas',
  diryard: 'Patio y jardín',
  dirtutoring: 'Tutorías',
  dirmoving: 'Mudanzas y fletes',
  dirother: 'Otros servicios locales',
  dirfreehelp: 'Ayuda gratuita / apoyo comunitario',
  dirotldesc: 'Boliche, ligas y fiestas de cumpleaños sobre Columbia River Highway.',
  dirflcdesc: 'Cena comunitaria gratuita todos los martes en la iglesia First Lutheran — las puertas abren a las 5 y la cena se sirve a las 5:30. Todos son bienvenidos: solo tienes que venir, sin trámites ni preguntas. Organizado por Community Meals of Columbia County.',
  dirinviteh: 'Tu servicio aquí',
  dirinvitep: '¿Limpias casas, cuidas niños, paseas perros, arreglas lo que se rompe? Sé uno de los primeros nombres del directorio — los anuncios son gratis.',
  dirlistcta: 'Anuncia tu servicio &rarr;',
  dirhonest: '<strong>Los anuncios son publicidad, no recomendaciones.</strong> No hemos verificado estos servicios — en especial para servicios dentro del hogar, pide referencias antes de contratar.',
  dircta: 'Anuncia tu servicio — es gratis &rarr;',
  dirmaphint: 'Toca un pin para ver el negocio en la lista de abajo.',
  diradd: '¿Tienes un negocio de una sola persona? Agrégate — es gratis &rarr;',
  dirctanote: 'Un formulario corto hecho solo para este estante. Cada anuncio lo lee una persona y se revisa antes de aparecer — nada se publica automáticamente y no hay ningún pago.',
  displaybtn: 'Pantalla',
  displaylabel: 'Abrir el modo pantalla — el salvapantallas comunitario',
  footerbyline: '<strong>Columbia County Live</strong> — por <strong>Nomad Development Group</strong>',
  footerdata: 'Datos: Servicio Meteorológico Nacional · Servicio Geológico de EE. UU. (USGS) · NOAA Tides &amp; Currents (mareas del río) · NOAA nowCOAST (radar) · NIFC WFIGS (incendios forestales) · colaboradores de adsb.fi (aviones, ODbL) · wheretheiss.at (posición de la EEI) · CelesTrak / NORAD (órbita de la EEI, para predicciones de paso) · Open-Meteo / Copernicus CAMS (modelo de calidad del aire) · Fish Passage Center y Columbia Basin Research DART (conteos de peces en las presas — datos del Cuerpo de Ingenieros del Ejército de EE. UU.) · colaboradores de OpenStreetMap. Los datos de captura (carreteras, cámaras, puente, alertas del ferry, eventos, tráfico del río) los recoge un pequeño programa recolector de los operadores oficiales — ODOT TripCheck, WSDOT, el condado de Wahkiakum y los calendarios de las ciudades y el condado — y se etiquetan con la hora en que se recogieron. El modelo de capas de rastreo en vivo está inspirado en God&rsquo;s Eye View (código abierto, de Bilawal Sidhu), cuyo DATA_SOURCES.md nos señaló varias de estas fuentes públicas.',
  footerdisc: 'Esta página reúne datos públicos por conveniencia. Antes de viajar con clima severo o agua alta, confirma las condiciones con las fuentes oficiales enlazadas arriba.',
  pinsh2: '📌 Tus fijadas',
  pinsclear: 'Desfijar todo',
  pinsnote: 'Las tarjetas que fijaste, aquí arriba en el orden en que las fijaste — copias en vivo que se actualizan cuando cambian las lecturas, mientras las originales se quedan donde pertenecen. Toca una copia para saltar a la tarjeta real; toca su botón <strong>📌 Fijada</strong> para desfijarla.',
  installh2: 'Pon Columbia County Live en tu pantalla de inicio',
  installp: 'Instalada, se abre en pantalla completa como una app — sin barra de direcciones, con su propio ícono y el condado a un toque. Gratis, y se sigue actualizando todo el día.',
  installcardbtn: '📱 Instalar la app',
  getappbtn: 'Obtén la app',
  getapptitle: '📱 Pon Columbia County Live en tu pantalla de inicio',
  getappinstall: '📱 Instalar ahora — un toque',
  gastep0fb: '<strong>Primero — estás dentro del navegador de Facebook, y ese no puede agregar apps a la pantalla de inicio.</strong> Toca los <strong>tres puntos</strong> en la esquina superior y elige <strong>Abrir en el navegador externo</strong> o <strong>Abrir en Chrome</strong>. Luego sigue los pasos de abajo.',
  gastep0ios: '<strong>Primero — abre esta página en Safari.</strong> Estás dentro del navegador de otra app, y agregar desde ahí parece que funcionó, pero el ícono nunca aparece — es una regla de Apple, no un error tuyo. Toca el ícono de compartir y elige <strong>Abrir en Safari</strong>, luego sigue los pasos de abajo.',
  gaiosh: 'En iPhone y iPad (en Safari)',
  gaios1: 'Toca el botón <strong>Compartir</strong> — el cuadrado con una flecha hacia arriba, en la parte inferior de la pantalla.',
  gaios2: 'Desplázate por la lista que aparece y toca <strong>Agregar a pantalla de inicio</strong>.',
  gaios3: 'Toca <strong>Agregar</strong> en la esquina superior. Listo — el condado queda a un toque.',
  gaandh: 'En Android',
  gaandchrome: '<strong>En Chrome:</strong>',
  gaand1: 'Toca <strong>⋮</strong> en la esquina superior derecha.',
  gaand2: 'Toca <strong>Instalar app</strong> (algunos teléfonos dicen <strong>Agregar a pantalla de inicio</strong>).',
  gaand3: 'Toca <strong>Instalar</strong> o <strong>Agregar</strong> para confirmar.',
  gaandsam: '<strong>En Samsung Internet:</strong> toca el menú (☰), luego <strong>Agregar página a</strong> → <strong>Pantalla de inicio</strong>.',
  gaandff: '<strong>En Firefox:</strong> toca <strong>⋮</strong>, luego <strong>Agregar a pantalla de inicio</strong>.',
  gadeskh: 'En una computadora',
  gadesk1: 'En Chrome o Edge, haz clic en el ícono de instalar al final de la barra de direcciones — o simplemente guarda esta página en favoritos (Ctrl/Cmd + D). Se actualiza sola todo el día.',
  gaother: '¿Otro teléfono o navegador? Mira las demás instrucciones',
  ganosee: '<strong>¿No ves el ícono?</strong> Revisa tu última página de inicio — los íconos nuevos suelen caer ahí. En iPhone también puedes deslizar hasta la Biblioteca de apps y buscar «Columbia».',
  signpostline: 'Eso es todo por Hoy — el resto del condado está a un toque:',
  signposttravel: '🚢 Ferry y carreteras en Viajes',
  signpostoutdoors: '🎣 Aire libre',
  signpostmore: '📅 Eventos y más',
  dwcommute: 'El veredicto del viaje',
  dwdrive: 'Tu viaje — tiempos de manejo',
  dwgo: 'Antes de salir',
  dwplan: 'Esta noche y mañana',
  dwschools: 'Escuelas — cierres y retrasos',
  dwbriefing: 'El Resumen del Condado',
  dwhome: 'Hazlo tuyo',
  dwmap: 'El mapa en vivo',
  dwroads: 'Carreteras y el puente',
  dwrouteahead: 'Ruta por delante',
  dwferry: 'El ferry Oscar B',
  dwships: 'Tráfico del río',
  dwaircraft: 'Aviones sobre el condado',
  dwbend: 'El viaje a Bend',
  dwalerts: 'Alertas del clima',
  dwforecast: 'Pronóstico',
  dwsky: 'El cielo y la estación espacial',
  dwdark: 'Al anochecer',
  dwrivers: 'Niveles del río',
  dwtides: 'Mareas del río',
  dwfish: 'Conteos de peces',
  dwtracker: 'Rastreador de salmones',
  dwsteelhead: 'Steelhead',
  dwalmanac: 'El Almanaque',
  dwquakes: 'Terremotos',
  dwfires: 'Incendios forestales',
  dwair: 'Aire y humo',
  dwevents: 'Eventos',
  dwfeatured: 'Negocios destacados',
  dwservices: 'Negocios locales',
  dwwatch: 'La Vigilancia del Condado',
  dwsaver: 'Protector de pantalla de la comunidad',
  dwfresh: '¿Qué tan fresca es esta página?',
  dwabout: 'Acerca de',
  dwbecome: 'Hazte patrocinador',
  cascEyebrow: 'De Nomad Development Group — nuestro otro proyecto',
  cascTitle: 'Cascade Controls Jobs',
  cascCopy: '¿Contratas técnicos de controles — o buscas ese trabajo? Una bolsa de trabajo del Pacífico Noroeste para técnicos de controles y mantenimiento industrial.',
  cascCta: 'Ver los empleos y anuncios &rarr;',
  cascFooter: 'También de Nomad: Cascade Controls Jobs — ¿contratas técnicos de controles, o buscas ese trabajo? &rarr;',
  cascDrawerLink: 'También nuestro: Cascade Controls Jobs &rarr;',
  webPromoHead: '¿Necesita un sitio web?',
  webPromoLink: 'Vea otros sitios creados por Nomad Development Group &rarr;',
  dwphototitle: 'Comparte tu foto del condado',
  dwphotoline: '¿Tienes una foto del condado que te encanta? Envíala — las buenas se unen al protector de pantalla de la comunidad, con tu nombre firmado como en una pintura.',
  langnote: "🌎 This page is showing its headings, buttons and notes in Spanish — tap the courthouse logo up top to open the menu, then tap <strong>English</strong> to switch back. Live readings, alerts and event listings keep arriving in English from their official sources."
};
let langCur = 'en';
let langEls = null;
const langOrig = {};
let langTitleOrig = null;
let langPhOrig = null;

function langCollect() {
  const out = [];
  (function walk(node) {
    if (!node || node.tag === '#text') return;
    if (node.dataset && node.dataset.i18n) out.push(node);
    const kids = node.children || [];
    for (let i = 0; i < kids.length; i++) walk(kids[i]);
  })(document.body);
  return out;
}
function langApply(lang) {
  if (!langEls) langEls = langCollect();
  const btn = $('lang-btn');
  if (lang === 'es') {
    langEls.forEach(el => {
      const k = el.dataset.i18n;
      if (!(k in langOrig)) langOrig[k] = el.innerHTML;
      if (LANG_ES[k] != null) el.innerHTML = LANG_ES[k];
    });
    if (langTitleOrig == null) langTitleOrig = document.title;
    if (LANG_ES.__title) document.title = LANG_ES.__title;
    const fi = $('finder-input');
    if (fi) {
      if (langPhOrig == null) langPhOrig = fi.placeholder || (fi.attrs && fi.attrs.placeholder) || '';
      if (LANG_ES.__finderPh) fi.placeholder = LANG_ES.__finderPh;
    }
    document.documentElement.lang = 'es';
    if (btn) btn.textContent = '🌎 English';
    langCur = 'es';
  } else {
    langEls.forEach(el => {
      const k = el.dataset.i18n;
      if (k in langOrig) el.innerHTML = langOrig[k];
    });
    if (langTitleOrig != null) document.title = langTitleOrig;
    const fi = $('finder-input');
    if (fi && langPhOrig != null) fi.placeholder = langPhOrig;
    document.documentElement.lang = 'en';
    if (btn) btn.textContent = '🌎 En español';
    langCur = 'en';
  }
}
function langSet(lang) {
  langApply(lang);
  try { window.localStorage.setItem(LANG_KEY, lang); } catch (e) { /* private mode: choice is session-only */ }
}
function initLang() {
  let pref = null;
  try { pref = window.localStorage.getItem(LANG_KEY); } catch (e) { /* storage unavailable */ }
  if (pref === 'es') langApply('es');
  const btn = $('lang-btn');
  if (btn) btn.addEventListener('click', () => langSet(langCur === 'es' ? 'en' : 'es'));
}
initLang();

/* ---------- before you go: the trip check (X20 R17) ----------
   Twenty-six rounds answered questions; this one helps a visitor commit
   to leaving. Pick a trip (the drive / the ferry / the river) and a
   departure, and the card runs the page's own live sources — NWS alerts,
   the roads snapshot, the forecast for that hour, the ferry timetable
   math, the NOAA tide predictions, the USGS gauge, the computed daylight
   — as checks, then answers with ONE verdict and says why. The answer
   leaves the page two ways: copyable text, and a calendar file for the
   trip itself carrying the verdict. Every check can decline honestly
   ("couldn't check"), and an unchecked feed caps the verdict below
   "good to go" — the card never blesses a trip on data it didn't see.
   Choices persist in the visitor's browser only. */
const GO_KEY = "ccl-go-v1";
const GO_WHEN = [
  { key: "now", mins: 0 },
  { key: "m30", mins: 30 },
  { key: "h1", mins: 60 },
  { key: "h2", mins: 120 },
  { key: "tm7", mins: null }
];
const GO_TRIPS = {
  commute: "🚗 The drive",
  ferry: "⛴️ Catch the ferry",
  river: "🎣 On the river"
};
let goTrip = "commute";
let goWhenKey = "now";
let goTownName = null;
let goData = null, goDataAt = 0, goDataTown = "";
let goRenderSeq = 0;
let goLastText = "", goLastDep = 0;

function goTown() {
  return TOWNS.find(t => t.name === goTownName) || currentTown || TOWNS[0];
}
function goTripPlain() { return GO_TRIPS[goTrip].split(" ").slice(1).join(" "); }
function goLoadPref() {
  try {
    const v = JSON.parse(window.localStorage.getItem(GO_KEY) || "null");
    if (v) {
      if (GO_TRIPS[v.trip]) goTrip = v.trip;
      if (GO_WHEN.some(w => w.key === v.when)) goWhenKey = v.when;
      if (TOWNS.some(t => t.name === v.from)) goTownName = v.from;
    }
  } catch (e) { /* storage unavailable — defaults apply */ }
  if (!goTownName) goTownName = (currentTown || TOWNS[0]).name;
}
function goSavePref() {
  try {
    window.localStorage.setItem(GO_KEY, JSON.stringify({ trip: goTrip, when: goWhenKey, from: goTownName }));
  } catch (e) { /* private mode: session-only */ }
}
function goPtParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(date);
  const get = t => parseInt((parts.find(p => p.type === t) || {}).value, 10);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour") % 24, m: get("minute") };
}
function goDeparture() {
  const w = GO_WHEN.find(x => x.key === goWhenKey) || GO_WHEN[0];
  if (w.mins != null) return new Date(Date.now() + w.mins * 60000);
  // Tomorrow 7:00 AM Pacific: the PT calendar date 24h from now, at 07:00
  // wall clock, converted with the same two-pass offset as the tides.
  const tp = planPtDateStr(new Date(Date.now() + 864e5)).split("-").map(Number);
  const wall = Date.UTC(tp[0], tp[1] - 1, tp[2], 7, 0);
  let utc = wall - evcalPtOffsetMs(wall + 8 * 3600e3);
  utc = wall - evcalPtOffsetMs(utc);
  return new Date(utc);
}
function goWhenLabel(dep) {
  if (goWhenKey === "now") return "leaving now";
  if (goWhenKey === "tm7") return "leaving tomorrow · " + fmtDay(dep) + " · 7:00 AM";
  const w = GO_WHEN.find(x => x.key === goWhenKey) || GO_WHEN[0];
  return "leaving in " + (w.mins >= 60 ? (w.mins / 60) + " hr" : w.mins + " min") + " · " + fmtTime(dep);
}
async function goFetchSources() {
  const town = goTown();
  if (goData && goDataTown === town.name && Date.now() - goDataAt < 3 * 60000) return goData;
  const out = { alerts: null, roads: null, ferry: null, fc: null, river: null };
  const jobs = [
    getJSON(NWS_ALERTS_URL)
      .then(d => { out.alerts = (d.features || []).map(f => f.properties || {}); })
      .catch(() => { out.alerts = null; }),
    getSnapshot("roads.json").then(d => { out.roads = d; }).catch(() => { out.roads = null; }),
    getSnapshot("ferry.json").then(d => { out.ferry = d; }).catch(() => { out.ferry = null; }),
    (async () => {
      try {
        if (!forecastUrlCache[town.name]) {
          const pts = await getJSON("https://api.weather.gov/points/" + town.lat.toFixed(4) + "," + town.lon.toFixed(4));
          forecastUrlCache[town.name] = pts.properties.forecast;
        }
        const fc = await getJSON(forecastUrlCache[town.name]);
        out.fc = fc.properties.periods || [];
      } catch (e) { out.fc = null; }
    })(),
    getJSON("https://waterservices.usgs.gov/nwis/iv/?format=json&sites=14246900&parameterCd=00065&period=P1D")
      .then(d => { out.river = d; }).catch(() => { out.river = null; })
  ];
  await Promise.all(jobs);
  goData = out; goDataAt = Date.now(); goDataTown = town.name;
  return out;
}

/* ----- the checks: each returns { state: ok|warn|bad|na, icon, label, detail } ----- */
function goCheckAlerts(src) {
  if (!src.alerts) return { state: "na", icon: "❔", label: "Weather alerts — couldn't check",
    detail: "The alert feed didn't answer, so this card won't call the trip good. Check weather.gov before you go." };
  if (!src.alerts.length) return { state: "ok", icon: "✅", label: "No active weather alerts",
    detail: "Nothing posted for Columbia County right now." };
  const names = src.alerts.map(a => a.event || "Weather alert");
  const severe = src.alerts.some(a => /warning/i.test(a.event || "") && /severe|extreme/i.test(a.severity || ""));
  return { state: severe ? "bad" : "warn", icon: severe ? "⛔" : "⚠️",
    label: names.length + (names.length === 1 ? " weather alert" : " weather alerts") + " posted",
    detail: names.slice(0, 2).join(" · ") + (names.length > 2 ? " · +" + (names.length - 2) + " more" : "")
      + " — read the Weather Alerts card before you leave." };
}
function goCheckRoads(src, label) {
  const r = src.roads;
  if (!r) return { state: "na", icon: "❔", label: label + " — couldn't check",
    detail: "The road snapshot didn't load. Check TripCheck or WSDOT directly before you drive." };
  const b = r.bridge || {};
  const inc = (r.incidents || []).length, wz = (b.work_zones || []).length, al = (b.alerts || []).length;
  if (b.status === "alert" || al > 0) {
    const first = (b.alerts || [])[0] || {};
    return { state: "bad", icon: "⛔", label: label + " — bridge alert posted",
      detail: (first.title || b.note || "An alert is posted for the Lewis & Clark Bridge.")
        + " If US-30 is blocked: Cornelius Pass or the St. Johns Bridge are the usual detours." };
  }
  if (inc > 0 || wz > 0 || b.status === "work") {
    const bits = [];
    if (inc) bits.push(inc + " ODOT incident" + (inc === 1 ? "" : "s"));
    if (wz) bits.push(wz + " work zone" + (wz === 1 ? "" : "s"));
    if (b.status === "work") bits.push("bridge work scheduled");
    return { state: "warn", icon: "⚠️", label: label + " — mostly clear, with notes",
      detail: bits.join(" · ") + " — see the roads card for the details." };
  }
  if (b.status === "clear") {
    const snapNote = (r.fetched_at && !isNaN(new Date(r.fetched_at))) ? " (" + ago(new Date(r.fetched_at)) + ")" : "";
    return { state: "ok", icon: "✅", label: label + " — clear run",
      detail: "Bridge clear and no incidents on the latest snapshot" + snapNote + "." };
  }
  return { state: "na", icon: "❔", label: label + " — status unknown",
    detail: "The snapshot doesn't carry a bridge status this time. Check TripCheck before you drive." };
}
function goCheckForecast(src, dep) {
  if (!src.fc) return { state: "na", icon: "❔", label: "Forecast for that hour — couldn't check",
    detail: "The forecast didn't load. Glance at the Forecast card before you go." };
  const p = src.fc.find(x => new Date(x.startTime).getTime() <= dep.getTime()
    && new Date(x.endTime).getTime() > dep.getTime());
  if (!p) return { state: "na", icon: "❔", label: "Forecast for that hour — not published yet",
    detail: "The Weather Service hasn't published a period covering that departure yet." };
  const sf = p.shortForecast || "";
  const rain = (p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value != null)
    ? " · rain " + p.probabilityOfPrecipitation.value + "%" : "";
  const detail = p.name + ": " + sf + " · " + p.temperature + "°" + (p.temperatureUnit || "F") + rain + ".";
  if (/(snow|ice|icy|frost|freez|hail|sleet)/i.test(sf))
    return { state: "warn", icon: "⚠️", label: "The forecast itself mentions winter trouble", detail: detail + " Leave extra margin — bridges and shaded stretches freeze first." };
  if (/(thunderstorm|heavy rain|downpour)/i.test(sf))
    return { state: "warn", icon: "⚠️", label: "Rough weather in the forecast for that hour", detail: detail };
  return { state: "ok", icon: "✅", label: "Forecast for when you leave", detail: detail };
}
function goCheckLight(dep, town, windowHrs) {
  const pp = goPtParts(dep);
  const day = almDay({ y: pp.y, m: pp.mo - 1, d: pp.d }, town);
  if (!day || !day.rise || !day.set) return { state: "na", icon: "❔", label: "Daylight — couldn't compute",
    detail: "The on-page sun math didn't produce times for that day." };
  const back = dep.getTime() + windowHrs * 3600e3;
  if (dep.getTime() < day.rise.getTime())
    return { state: "warn", icon: "🌑", label: "Dark at that hour",
      detail: "Sunrise isn't until " + almClock(day.rise) + " — lights on, and expect the trip to feel later than the clock says." };
  if (back <= day.set.getTime())
    return { state: "ok", icon: "☀️", label: "Daylight for the trip",
      detail: "Sunset is " + almClock(day.set) + " — out and back in the light." };
  return { state: "warn", icon: "🌆", label: "Dark before you're back",
    detail: "Sunset is " + almClock(day.set) + " — plan the return in the dark." };
}
function goCheckBoat(src, dep) {
  const town = goTown();
  const drive = FP_DRIVE[town.name] != null ? FP_DRIVE[town.name] : 32;
  const side = FERRY_SIDES.find(s => s.key === "or");
  if (!src.ferry) return { state: "na", icon: "❔", label: "Ferry — couldn't check for alerts",
    detail: "The ferry snapshot didn't load, so the closure check couldn't run. Glance at the county ferry page before you count on a boat." };
  if (src.ferry.status === "ok" && src.ferry.alert)
    return { state: "bad", icon: "⛔", label: "A ferry closure alert is posted",
      detail: String(src.ferry.alert).slice(0, 200) + " — see the ferry card for the county's wording." };
  if (src.ferry.status !== "ok") return { state: "na", icon: "❔", label: "Ferry — alert check incomplete",
    detail: "The latest snapshot's ferry check didn't complete. The timetable math below still holds; confirm the alert line on the ferry card." };
  const pp = goPtParts(dep);
  const leaveMin = pp.h * 60 + pp.m;
  const arrival = leaveMin + drive + 10;
  let boat = null;
  for (let h = side.firstHour; h <= side.lastHour; h++) {
    if (h * 60 + side.minute >= arrival) { boat = { h: h, min: side.minute, isLast: h === side.lastHour }; break; }
  }
  if (!boat) return { state: "bad", icon: "⛔", label: "No boat that day after you could reach the dock",
    detail: "From " + town.name + " (" + drive + " min drive + 10 at the dock), the last Westport sailing — "
      + fmtClock(side.lastHour, side.minute) + " — is out of reach leaving at that time. First boat next morning is "
      + fmtClock(side.firstHour, side.minute) + "; leave by " + fpClock(side.firstHour * 60 + side.minute - drive - 10) + "." };
  const leaveBy = boat.h * 60 + boat.min - drive - 10;
  const slack = leaveBy - leaveMin;
  const boatStr = fmtClock(boat.h, boat.min);
  const detail = "Leave " + town.name + " by " + fpClock(leaveBy) + " — " + drive
    + " min drive plus 10 min at the dock for parking, fares (cash or check), and loading.";
  if (boat.isLast) return { state: "warn", icon: "⚠️", label: "Your boat is the last boat — " + boatStr + " from Westport",
    detail: detail + " Miss it and the next sailing is " + fmtClock(side.firstHour, side.minute) + " the next morning." };
  if (slack <= 10) return { state: "warn", icon: "⚠️", label: "Tight for the " + boatStr + " boat",
    detail: detail + " No stops on the way." };
  return { state: "ok", icon: "✅", label: "Your boat: the " + boatStr + " from Westport", detail: detail };
}
function goCheckTide(dep) {
  const town = goTown();
  const st = town.name === "Clatskanie" ? TIDE_STATIONS[1] : TIDE_STATIONS[0];
  const preds = (typeof tideData !== "undefined" && tideData[st.id]) || null;
  if (!preds || !preds.length) return { state: "na", icon: "❔", label: "Tide at " + st.label + " — not loaded yet",
    detail: "The NOAA predictions haven't arrived on the page yet. The River Tides card below has them when they land." };
  const start = dep.getTime(), end = start + 3 * 3600e3;
  const low = preds.find(p => p.type === "L" && p.t > start - 30 * 60000 && p.t < end);
  const next = preds.find(p => p.t > start);
  if (low) return { state: "warn", icon: "⚠️", label: "Low water inside your window — " + st.label,
    detail: "Low tide " + num(low.v, 1) + " ft at " + fmtTime(new Date(low.t))
      + ". Shallow at the ramp and the beach edges around then — time the launch either side of it." };
  if (next) return { state: "ok", icon: "✅",
    label: "Tide at " + st.label + " — " + (next.type === "H" ? "coming in" : "going out"),
    detail: (next.type === "H" ? "High tide " : "Low tide ") + num(next.v, 1) + " ft at " + fmtTime(new Date(next.t))
      + " (" + tideAway(next.t - start) + ") — no low water inside your three hours." };
  return { state: "na", icon: "❔", label: "Tide at " + st.label + " — prediction window ran out",
    detail: "The prediction window doesn't cover that departure. Check the River Tides card." };
}
function goCheckRiver(src) {
  const ts = src.river && src.river.value && (src.river.value.timeSeries || [])[0];
  const vals = ts && ts.values && ts.values[0] && ts.values[0].value;
  if (!vals || !vals.length) return { state: "na", icon: "❔", label: "River level — couldn't check",
    detail: "The USGS gauge didn't answer. The River Levels card shows the last readings it got." };
  const latest = vals[vals.length - 1];
  const v = parseFloat(latest.value);
  if (isNaN(v)) return { state: "na", icon: "❔", label: "River level — couldn't check",
    detail: "The USGS gauge answered without a usable reading." };
  const target = new Date(latest.dateTime).getTime() - 6 * 3600e3;
  let old = vals[0];
  for (const x of vals) { if (new Date(x.dateTime).getTime() <= target) old = x; }
  const dv = v - parseFloat(old.value);
  const when = fmtTime(new Date(latest.dateTime));
  if (!isNaN(dv) && dv >= 0.5) return { state: "warn", icon: "⚠️", label: "Columbia rising fast at Port Westward",
    detail: num(v, 2) + " ft at " + when + " — up " + num(dv, 1) + " ft in about six hours. Moving water: extra care at the ramp and the dock." };
  const trend = isNaN(dv) ? "" : (dv > 0.05 ? " · up a touch" : dv < -0.05 ? " · easing down" : " · holding steady") + " over the last six hours";
  return { state: "ok", icon: "✅", label: "Columbia at Port Westward — " + num(v, 2) + " ft",
    detail: "Read at " + when + trend + "." };
}

/* ----- assembly, verdict, render ----- */
function goChecksFor(src, dep) {
  const town = goTown();
  if (goTrip === "ferry") return [goCheckAlerts(src), goCheckBoat(src, dep), goCheckRoads(src, "The road to the dock")];
  if (goTrip === "river") return [goCheckAlerts(src), goCheckTide(dep), goCheckRiver(src), goCheckLight(dep, town, 3)];
  return [goCheckAlerts(src), goCheckRoads(src, "The corridor"), goCheckForecast(src, dep), goCheckLight(dep, town, 1)];
}
function goVerdict(rows) {
  const sev = { ok: 0, na: 1, warn: 1, bad: 2 };
  let worst = 0;
  rows.forEach(r => { worst = Math.max(worst, sev[r.state] || 0); });
  if (worst === 2) return { cls: "go-bad", head: "⛔ Not at that time" };
  if (worst === 1) return { cls: "go-warn", head: "⚠️ Go — but know this first" };
  return { cls: "go-ok", head: "✅ Good to go" };
}
function goComposeText(rows, v, dep) {
  const lines = [];
  lines.push("🛟 BEFORE YOU GO — " + goTripPlain() + " from " + goTown().name + ", " + goWhenLabel(dep));
  lines.push("Verdict: " + v.head.split(" ").slice(1).join(" "));
  rows.forEach(r => { lines.push(r.icon + " " + r.label + " — " + r.detail); });
  lines.push("Checked " + fmtDayTime(new Date()) + " · Columbia County Live — conditions change; re-check before you leave.");
  lines.push("https://travweber67.github.io/columbia-county-live/");
  return lines.join("\n");
}
async function renderGo(force) {
  const body = $("go-body");
  if (!body) return;
  if (force) goData = null;
  const seq = ++goRenderSeq;
  if (!body.querySelector(".go-verdict")) body.innerHTML = "<p class=\"loading\">Running the checks…</p>";
  const src = await goFetchSources();
  if (seq !== goRenderSeq) return;   // a newer render owns the card now
  const dep = goDeparture();
  const rows = goChecksFor(src, dep);
  const v = goVerdict(rows);
  const first = rows.find(r => r.state === "bad") || rows.find(r => r.state !== "ok");
  const sub = first ? first.label + "." : "Every check this page can run says go.";
  body.innerHTML = "<div class=\"go-verdict " + v.cls + "\"><div class=\"go-verdict-head\">" + v.head + "</div>"
    + "<div class=\"go-verdict-sub\">" + esc(GO_TRIPS[goTrip] + " from " + goTown().name + " · " + goWhenLabel(dep) + " — " + sub) + "</div></div>"
    + "<ul class=\"go-rows\">" + rows.map(r =>
        "<li class=\"go-row go-row-" + r.state + "\"><span class=\"go-row-ico\">" + r.icon + "</span>"
        + "<span class=\"go-row-main\"><strong>" + esc(r.label) + "</strong>"
        + "<span class=\"go-row-detail\">" + esc(r.detail) + "</span></span></li>"
      ).join("") + "</ul>";
  const stamp = $("go-updated");
  if (stamp) stamp.textContent = "Checked " + fmtTime(new Date());
  goLastDep = dep.getTime();
  goLastText = goComposeText(rows, v, dep);
}

/* ----- take it with you: copy + calendar ----- */
function goIcs() {
  if (!goLastDep || !goLastText) return null;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Columbia County Live//Trip Check//EN",
    "BEGIN:VEVENT",
    "UID:ccl-trip-" + goLastDep + "-" + goTrip + "@columbiacountylive",
    "DTSTAMP:" + evcalStamp(new Date()),
    "DTSTART:" + evcalStamp(new Date(goLastDep)),
    "DURATION:PT1H",
    "SUMMARY:" + evcalEscText("🛟 Before you go: " + goTripPlain() + " from " + goTown().name),
    "DESCRIPTION:" + evcalEscText(goLastText),
    "URL:https://travweber67.github.io/columbia-county-live/",
    "END:VEVENT", "END:VCALENDAR"];
  return lines.flatMap(evcalFold).join("\r\n") + "\r\n";
}
function goSay(msg) {
  const note = $("go-note");
  if (note) { note.textContent = msg; note.hidden = false; }
}
function goDownloadIcs() {
  const ics = goIcs();
  if (!ics) { goSay("The check hasn't finished yet — give it a second and try again."); return; }
  try {
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ccl-trip-check.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 4000);
    goSay("📅 Trip saved — open the file and it lands in your calendar with the verdict and every check attached. Re-check the live page before you actually leave.");
  } catch (e) {
    goSay("Calendar export didn't work in this browser — the Copy button still takes the check with you.");
  }
}
async function goCopy() {
  if (!goLastText) { goSay("The check hasn't finished yet — give it a second and try again."); return; }
  let ok = false;
  try { await navigator.clipboard.writeText(goLastText); ok = true; } catch (e) { /* clipboard API unavailable — fallback below */ }
  if (!ok) {
    try {
      const ta = document.createElement("textarea");
      ta.value = goLastText;
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ok = !!document.execCommand("copy");
      ta.remove();
    } catch (e) { ok = false; }
  }
  goSay(ok
    ? "✅ Copied — paste it into a text or a post. It is stamped with the time it was checked; the live page stays newer."
    : "Copy didn't work in this browser — the verdict and the checks above are the same words, ready to screenshot.");
}
function initGo() {
  if (!$("go-card")) return;
  goLoadPref();
  const fromSel = $("go-from");
  if (fromSel) {
    fromSel.value = goTownName;
    fromSel.addEventListener("change", () => { goTownName = fromSel.value; goSavePref(); renderGo(false); });
  }
  const whenSel = $("go-when");
  if (whenSel) {
    whenSel.value = goWhenKey;
    whenSel.addEventListener("change", () => { goWhenKey = whenSel.value; goSavePref(); renderGo(false); });
  }
  const tripsEl = $("go-trips");
  if (tripsEl) {
    const btns = tripsEl.querySelectorAll(".go-trip-btn");
    btns.forEach(b => {
      b.classList.toggle("active", b.dataset.goTrip === goTrip);
      if (b.setAttribute) b.setAttribute("aria-pressed", b.dataset.goTrip === goTrip ? "true" : "false");
    });
    btns.forEach(b => b.addEventListener("click", () => {
      goTrip = b.dataset.goTrip;
      btns.forEach(x => {
        x.classList.toggle("active", x === b);
        if (x.setAttribute) x.setAttribute("aria-pressed", x === b ? "true" : "false");
      });
      goSavePref();
      renderGo(false);
    }));
  }
  const copyBtn = $("go-copy-btn");
  if (copyBtn) copyBtn.addEventListener("click", goCopy);
  const calBtn = $("go-cal-btn");
  if (calBtn) calBtn.addEventListener("click", goDownloadIcs);
  setTimeout(() => renderGo(false), 1200);
  setInterval(() => renderGo(false), 60 * 1000);
}
initGo();

/* ---------- the GENERIC pin store (window.CCLPins) ----------
   One stored object for every kind of pin on the site:
     { cards:   [card ids, in pin order],
       answers: [screensaver answer ids, in pin order] }
   persisted at localStorage 'ccl-pins-v1' and exposed as
   window.CCLPins so every renderer — the pinned-cards zone at the
   top of Today and the community screensaver — reads and writes the
   SAME list. Changes broadcast a 'ccl-pins-changed' document event.
   Migration, one-way and read-only toward the older keys: a first
   load with no generic store seeds answers from the saver's
   prototype key (ccl-saver-pins-v1) if present, and seeds cards
   from the front-page system's original store (ccl-frontpage-v1).
   (Moved out of the screensaver module in the v5 pass: the pins
   zone at the top of Today loads earlier in this file than the
   saver does, and both must share the one store.) */
const CCL_PINS_KEY = 'ccl-pins-v1';
const CCL_ANSWER_IDS = ['bridge', 'tides', 'weather', 'events', 'ferry'];
const cclPinStore = { cards: [], answers: null };
function cclPinStoreSave() {
  try { window.localStorage.setItem(CCL_PINS_KEY, JSON.stringify(cclPinStore)); } catch (e) { /* session-only */ }
  try { document.dispatchEvent(new CustomEvent('ccl-pins-changed', { detail: { cards: cclPinStore.cards.slice(), answers: (cclPinStore.answers || []).slice() } })); } catch (e) { /* older browser — renderers poll instead */ }
}
(function cclPinStoreLoad() {
  let v = null;
  try { v = JSON.parse(window.localStorage.getItem(CCL_PINS_KEY) || 'null'); } catch (e) { /* unreadable */ }
  if (v && typeof v === 'object') {
    if (Array.isArray(v.cards)) cclPinStore.cards = v.cards.filter(x => typeof x === 'string');
    if (Array.isArray(v.answers)) cclPinStore.answers = v.answers.filter(id => CCL_ANSWER_IDS.indexOf(id) !== -1);
  }
  if (!cclPinStore.answers) {
    let legacy = null;
    try { legacy = JSON.parse(window.localStorage.getItem('ccl-saver-pins-v1') || 'null'); } catch (e) { /* none */ }
    cclPinStore.answers = Array.isArray(legacy)
      ? legacy.filter(id => CCL_ANSWER_IDS.indexOf(id) !== -1)
      : ['bridge', 'tides', 'weather', 'events'];
  }
  if (!cclPinStore.cards.length) {
    let fp = null;
    try { fp = JSON.parse(window.localStorage.getItem('ccl-frontpage-v1') || 'null'); } catch (e) { /* none */ }
    if (Array.isArray(fp)) cclPinStore.cards = fp.filter(x => typeof x === 'string');
  }
})();
window.CCLPins = {
  key: CCL_PINS_KEY,
  all: function () { return { cards: cclPinStore.cards.slice(), answers: cclPinStore.answers.slice() }; },
  has: function (kind, id) { const l = kind === 'cards' ? cclPinStore.cards : cclPinStore.answers; return l.indexOf(id) !== -1; },
  toggle: function (kind, id) {
    const l = kind === 'cards' ? cclPinStore.cards : cclPinStore.answers;
    const i = l.indexOf(id);
    if (i !== -1) l.splice(i, 1); else l.push(id);
    cclPinStoreSave();
    return l.slice();
  },
  _store: cclPinStore,
  _save: cclPinStoreSave
};

/* ---------- Your pins: pin any card to the top of Today (v5) ----------
   Travis's direction, unified in v5 onto the ONE generic store
   above (window.CCLPins, localStorage ccl-pins-v1 — the screensaver's
   answers live in the same object). Every content card in every view
   grows a 📌 Pin button in its head. A pinned card renders at the top
   of the Today view as a LIVE COPY — a mirror that re-renders as the
   original's readings change — in pin order, inside the "Your pins"
   zone (hidden while empty). The original NEVER moves: pins are
   shortcuts, not moves (this replaces the X20 front-page system,
   which physically moved the node and kept its own store;
   ccl-frontpage-v1 survives only as the store's one-way seed).
   Unpinning works from the original's button and from the copy's.
   Tapping a copy (anywhere but its unpin button) jumps to the real
   card in its home view. The map card is deliberately not pinnable:
   it is the page's anchor, and a Leaflet container does not need the
   adventure. */
const PIN_CARDS = ['since-card', 'home-card', 'commute-card', 'go-card', 'plan-card', 'schools-card', 'briefing-card',
  'roads-card', 'drive-card', 'routeahead-card', 'ferry-card', 'ships-card', 'aircraft-card', 'bend-card',
  'alerts-card', 'forecast-card', 'sky-card', 'dark-card', 'rivers-card', 'tides-card',
  'fish-card', 'tracker-card', 'steelhead-card', 'almanac-card',
  'quakes-card', 'fires-card', 'air-card',
  'events-card', 'freshness-card', 'watch-card', 'saver-card', 'about-card'];
const pinBtns = {};        // card id -> its pin button on the ORIGINAL card
const pinObservers = {};   // card id -> MutationObserver mirroring it into its copy
function pinLabel(on) {
  if (langCur === 'es') return on ? '📌 Fijada' : '📌 Fijar';
  return on ? '📌 Pinned' : '📌 Pin';
}
function pinPaint() {
  PIN_CARDS.forEach(id => {
    const b = pinBtns[id];
    if (!b) return;
    const on = window.CCLPins.has('cards', id);
    b.classList.toggle('active', on);
    b.textContent = pinLabel(on);
    b.title = on ? 'Unpin this card from the top of Today' : 'Pin this card to the top of Today';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
function pinMakeCopy(id) {
  const orig = $(id);
  if (!orig) return null;
  const copy = orig.cloneNode(true);
  copy.removeAttribute('id');
  copy.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
  copy.classList.add('pin-copy');
  copy.classList.remove('reveal');
  copy.classList.add('inview');
  copy.setAttribute('data-pin-copy', id);
  copy.setAttribute('aria-label', (orig.getAttribute('aria-label') || 'Card') + ' — pinned copy');
  const tag = document.createElement('div');
  tag.className = 'pin-copy-tag';
  tag.textContent = langCur === 'es' ? '📌 Copia fijada — toca para abrir la tarjeta en vivo' : '📌 Pinned copy — tap to open the live card';
  copy.insertBefore(tag, copy.firstChild);
  const head = copy.querySelector('.card-head');
  if (head) {
    const stale = head.querySelector('.pin-btn');
    if (stale) stale.remove();
    head.classList.add('has-pin');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pin-btn active';
    b.textContent = pinLabel(true);
    b.title = 'Unpin this card from the top of Today';
    b.setAttribute('aria-pressed', 'true');
    b.addEventListener('click', ev => {
      ev.preventDefault(); ev.stopPropagation();
      window.CCLPins.toggle('cards', id);
    });
    head.appendChild(b);
  }
  copy.addEventListener('click', ev => {
    if (ev.target && ev.target.closest && ev.target.closest('.pin-btn')) return; // the unpin button handles itself
    ev.preventDefault(); ev.stopPropagation();
    cclRouteAnchor({ getAttribute: () => '#' + id });
  }, true);
  return copy;
}
function pinRenderZone() {
  const wrap = $('frontpage'), list = $('frontpage-list');
  if (!wrap || !list) return;
  const ids = window.CCLPins.all().cards.filter(id => PIN_CARDS.indexOf(id) !== -1 && $(id));
  wrap.hidden = ids.length === 0;
  list.innerHTML = '';
  Object.keys(pinObservers).forEach(id => { pinObservers[id].disconnect(); delete pinObservers[id]; });
  ids.forEach(id => {
    const copy = pinMakeCopy(id);
    if (!copy) return;
    list.appendChild(copy);
    const orig = $(id);
    let t = null;
    const mo = new MutationObserver(() => {
      if (t) return;
      t = setTimeout(() => {
        t = null;
        const cur = list.querySelector('[data-pin-copy="' + id + '"]');
        if (!cur) return;
        const fresh = pinMakeCopy(id);
        if (fresh) cur.replaceWith(fresh);
      }, 400);
    });
    mo.observe(orig, { subtree: true, childList: true, characterData: true });
    pinObservers[id] = mo;
  });
}
function initPins() {
  PIN_CARDS.forEach(id => {
    const card = $(id);
    if (!card) return;
    const head = card.querySelector('.card-head');
    if (!head) return;
    head.classList.add('has-pin');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pin-btn';
    b.dataset.pinFor = id;
    b.addEventListener('click', () => window.CCLPins.toggle('cards', id));
    head.appendChild(b);
    pinBtns[id] = b;
  });
  const clear = $('frontpage-clear');
  if (clear) clear.addEventListener('click', () => {
    window.CCLPins.all().cards.slice().forEach(id => window.CCLPins.toggle('cards', id));
  });
  document.addEventListener('ccl-pins-changed', () => { pinPaint(); pinRenderZone(); });
  pinPaint();
  pinRenderZone();
}
initPins();

/* ---------- the county sheet: the page learns to print ----------
   X20 Round 19. Twenty-seven changes in, every way this page travels is
   a screen: the share bar, the Wall, the Watch, the spoken briefing, the
   briefing as paste-able text. But in a rural county a great deal of the
   day's information still moves on PAPER — the fridge door, the library
   and grange-hall bulletin boards, the shop counter, the senior center —
   and those are exactly the neighbors a phone-first page reaches worst.
   Printing the page itself was a multi-page mess of maps and photos.
   So the share bar grows a Print button, and the page carries a hidden,
   print-only County Sheet: a one-page document composed at print time
   from the same rendered panel state the County Briefing reads (alerts
   by name or an honest all-clear, the forecast, the commute verdict and
   bridge, the next boat, the river and its tides, daylight, the air,
   today's events), so the paper never claims anything the page isn't
   showing. Pending sources are omitted or stated plainly, and the sheet
   stamps its print time and says out loud that paper goes stale. Print
   CSS swaps the whole app for the sheet; a beforeprint listener means
   even Ctrl+P gets a freshly composed sheet, not the boot-time one. */
function psBlock(title, inner) {
  return '<div class="ps-block"><h3>' + title + '</h3>' + inner + '</div>';
}
function psRow(k, v) {
  return '<div class="ps-row"><span class="ps-k">' + k + '</span><span class="ps-v">' + v + '</span></div>';
}
function buildPrintSheet() {
  const now = new Date();
  let html = '<div class="ps-mast"><div class="ps-title">🌲 Columbia County Live</div>'
    + '<div class="ps-sub">Today&rsquo;s county sheet · ' + esc(fmtDay(now)) + ' · printed ' + esc(fmtTime(now)) + ' PT</div></div>';

  // Weather alerts — the same rendered state the text briefing reads
  const ab = $('alerts-body');
  if (ab) {
    if (ab.querySelector('.no-alerts')) {
      html += '<div class="ps-alert ok">✅ Weather: no active watches, warnings, or advisories for Columbia County.</div>';
    } else {
      const heads = ab.querySelectorAll('.alert-item h3');
      if (heads.length) {
        let items = '';
        heads.forEach(h => { items += '<div>• ' + esc(briefingClean(h.textContent)) + '</div>'; });
        html += '<div class="ps-alert warn">⚠️ WEATHER ALERTS IN EFFECT' + items + '</div>';
      } else if (ab.querySelector('.fallback')) {
        html += '<div class="ps-alert">⚠️ Weather alerts couldn&rsquo;t load just now — check weather.gov before heading out.</div>';
      }
    }
  }

  let blocks = '';
  // Forecast — the first two periods of the town the card is showing
  const fb = $('forecast-body');
  if (fb) {
    const pers = fb.querySelectorAll('.period');
    if (pers.length) {
      let rows = '';
      for (let i = 0; i < pers.length && i < 2; i++) {
        const per = pers[i];
        const name = briefingClean((per.querySelector('h4') || {}).textContent);
        const temp = briefingClean((per.querySelector('.temp') || {}).textContent);
        const paras = per.querySelectorAll('p');
        const short = paras.length ? briefingClean(paras[0].textContent) : '';
        if (name || temp) rows += psRow(esc(name), esc(temp + (short ? ' — ' + short : '')));
      }
      if (rows) blocks += psBlock('🌦️ Forecast — ' + esc(currentTown.name), rows);
    }
  }
  // The drive — commute verdict headline + the bridge glance tile
  {
    let rows = '';
    const cv = $('commute-verdict');
    if (cv) {
      const head = cv.querySelector('.cv-head');
      if (head && !briefingPending(head.textContent)) rows += psRow('Verdict', esc(briefingClean(head.textContent)));
    }
    const bv = briefingClean(($('glance-bridge-val') || {}).textContent);
    if (bv && !briefingPending(bv)) rows += psRow('Lewis &amp; Clark Bridge', esc(bv));
    if (rows) blocks += psBlock('🚗 The drive — US-30 &amp; the bridge', rows);
  }
  // The ferry — the next-boat headline (which itself defers to a closure alert)
  {
    const fn = $('ferry-next');
    if (fn) {
      const head = fn.querySelector('.ferry-next-head');
      if (head && !briefingPending(head.textContent)) {
        blocks += psBlock('⛴️ Oscar B ferry — Westport ⇄ Puget Island',
          '<div class="ps-big">' + esc(briefingClean(head.textContent)) + '</div>'
          + '<div class="ps-note">Boats leave Westport at :15 and Puget Island on the hour, 5 AM – 10 PM. Fares and the official word: the county ferry page, linked from the live site.</div>');
      }
    }
  }
  // The river — Port Westward glance line + each station's tide line
  {
    let rows = '';
    const rv = briefingClean(($('glance-river-val') || {}).textContent);
    if (rv && !briefingPending(rv)) rows += psRow('Columbia at Port Westward', esc(rv));
    const tb = $('tides-body');
    if (tb) {
      tb.querySelectorAll('.tide-station').forEach(st => {
        const nm = briefingClean((st.querySelector('.river-name') || {}).textContent);
        const ln = briefingClean((st.querySelector('.tide-line') || {}).textContent);
        if (nm && ln && !briefingPending(ln) && !/couldn|ran out/.test(ln)) rows += psRow(esc(nm) + ' tide', esc(ln));
      });
    }
    if (rows) blocks += psBlock('🌊 The river &amp; its tides', rows + '<div class="ps-note">Tides are NOAA predictions — river flow pushes real water off them.</div>');
  }
  // Daylight — the almanac's verdict, head + sub
  {
    const alb = $('almanac-body');
    if (alb) {
      const head = briefingClean((alb.querySelector('.alm-head') || {}).textContent);
      const sub = briefingClean((alb.querySelector('.alm-sub') || {}).textContent);
      if (head && !briefingPending(head)) {
        blocks += psBlock('🌅 Daylight', psRow(esc(head), esc(sub)));
      }
    }
  }
  // The air — only when the model reading is actually on the page
  if (typeof airData !== 'undefined' && airData && airData.cur && airData.cur.aqi != null) {
    const cat = airCat(airData.cur.aqi);
    blocks += psBlock('🌫️ Air &amp; smoke',
      psRow('Air Quality Index', '<strong>' + airData.cur.aqi + ' — ' + esc(cat.name) + '</strong>')
      + '<div class="ps-note">Modeled estimate for ' + esc(airData.town || currentTown.name) + ' (Open-Meteo / Copernicus CAMS) — there is no official AQI monitor in the county; AirNow has the official word.</div>');
  }
  if (blocks) html += '<div class="ps-grid">' + blocks + '</div>';

  // Today's events — the same snapshot the events card renders
  if (eventsCache && (eventsCache.events || []).length) {
    const todays = eventsCache.events.filter(ev => ev.date === todayStrPT())
      .slice().sort((a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time));
    let inner = '';
    if (todays.length) {
      todays.slice(0, 6).forEach(ev => {
        inner += psRow(esc(ev.time || 'All day'), esc(ev.title + (ev.source ? ' (' + ev.source + ')' : '')));
      });
      if (todays.length > 6) inner += '<div class="ps-note">…and ' + (todays.length - 6) + ' more — the full calendar is on the live page.</div>';
    } else {
      inner = '<div class="ps-note">Nothing on the city/county calendars today.</div>';
    }
    html += psBlock('📅 Today around the county (' + todays.length + (todays.length === 1 ? ' event' : ' events') + ')', inner);
  }

  html += '<div class="ps-foot">Paper doesn&rsquo;t update — this sheet is the county as the live page showed it at '
    + esc(fmtTime(now)) + ' PT. The live page updates all day: <strong>travweber67.github.io/columbia-county-live</strong><br>'
    + 'Sources: National Weather Service · USGS · NOAA Tides &amp; Currents · ODOT/WSDOT &amp; Wahkiakum County snapshots · city &amp; county calendars · Open-Meteo/CAMS air model. '
    + 'Columbia County Live is free, no ads, no sign-up — by Nomad Development Group. Post this sheet where neighbors will see it.</div>';
  return html;
}
function renderPrintSheet() {
  const b = $('print-body');
  if (b) b.innerHTML = buildPrintSheet();
}
function initPrint() {
  if (!$('print-sheet')) return;
  renderPrintSheet();
  setInterval(renderPrintSheet, 30 * 1000); // the briefing's cadence — the sheet is never the boot-time draft
  const btn = $('print-btn');
  if (btn) btn.addEventListener('click', () => {
    renderPrintSheet();
    if (typeof window.print === 'function') window.print();
  });
  if (window.addEventListener) window.addEventListener('beforeprint', renderPrintSheet);
}
initPrint();

/* ================= X20 Round 20 — "After Dark": is tonight worth looking up? =====
   Twenty-eight shipped changes, and the page's sky story still ended at
   sunset. The Sky card says what's overhead *now*; the Almanac says how
   much light is left; the passes block says when the station crosses.
   Nothing weighed them together into the one evening decision a clear
   night in this county actually turns on: bundle up and go out — or
   don't bother. This card runs that gauntlet for tonight's dark window
   (civil dusk to civil dawn, from the Almanac's own math, for the
   visitor's home town or St. Helens): the Open-Meteo forecast model's
   cloud cover across those hours (keyless, CORS-open, browser-direct
   like the air card), NOAA SWPC's Kp forecast for the aurora (at 46°N
   the lights are earned, not routine: Kp 5+ and a dark northern
   horizon), the moon's wash from the Almanac, any naked-eye station
   pass the passes module already computed for tonight, and the annual
   meteor-shower calendar (published peak dates and nominal rates —
   astronomy, not a feed). The verdict follows the trip checker's
   honesty rule: clouds are the deciding check, so if they couldn't be
   checked the verdict caps below its best band and the row says why;
   every bonus source declines in its own row rather than dressing up.
   Refreshes every 30 minutes, re-renders every minute, follows the
   home town like the passes do. No key, no images. */
const DARK_KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';
const DARK_SHOWERS = [
  { name: 'Quadrantids',    m: 1,  d: 3,  zhr: 60 },
  { name: 'Lyrids',         m: 4,  d: 22, zhr: 18 },
  { name: 'Eta Aquariids',  m: 5,  d: 5,  zhr: 50 },
  { name: 'Delta Aquariids', m: 7, d: 28, zhr: 20 },
  { name: 'Perseids',       m: 8,  d: 12, zhr: 100 },
  { name: 'Orionids',       m: 10, d: 21, zhr: 20 },
  { name: 'Leonids',        m: 11, d: 17, zhr: 15 },
  { name: 'Geminids',       m: 12, d: 13, zhr: 120 },
  { name: 'Ursids',         m: 12, d: 22, zhr: 10 }
];
let darkClouds = null;   // { town, hours: [{ t, cloud }] } — Open-Meteo forecast model
let darkKp = null;       // [{ t, kp, scale }] — NOAA SWPC 3-hour blocks, instants in UTC
let darkTownName = '';

function darkUrl(town) {
  return 'https://api.open-meteo.com/v1/forecast?latitude=' + town.lat
    + '&longitude=' + town.lon + '&hourly=cloud_cover'
    + '&past_days=1&forecast_days=2&timezone=America%2FLos_Angeles';
}
function darkKpInstant(tstr) {
  // SWPC stamps its blocks in UTC but leaves the Z off, and a bare ISO
  // stamp parses as *local* time — pin it to UTC or every block lands
  // a timezone away from the night it describes.
  let s = String(tstr || '').replace(' ', 'T');
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += 'Z';
  return new Date(s).getTime();
}
function darkWindow(town, nowMs) {
  // Tonight's dark window: civil dusk to civil dawn around the night
  // that contains — or follows — now. Before dawn, the night in
  // progress (it began at yesterday's dusk); after dawn, the coming
  // one. Dates go through the Almanac's own almPtDate parts objects —
  // almDay does not take a Date, and handing it one yields NaN days.
  const day = almDay(almPtDate(0), town);
  if (!day || !day.dawn || !day.dusk) return null;
  if (nowMs < day.dawn.getTime()) {
    const y = almDay(almPtDate(-1), town);
    return (y && y.dusk) ? { start: y.dusk.getTime(), end: day.dawn.getTime() } : null;
  }
  const t = almDay(almPtDate(1), town);
  return (t && t.dawn) ? { start: day.dusk.getTime(), end: t.dawn.getTime() } : null;
}
function darkMeteor(win) {
  // The shower whose published peak falls nearest tonight, with the
  // signed distance in whole Pacific days (0 = peaks tonight).
  const p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(win.start)).forEach(x => { p[x.type] = x.value; });
  const tonight = Date.UTC(+p.year, +p.month - 1, +p.day);
  let best = null;
  for (const s of DARK_SHOWERS) {
    for (const y of [+p.year - 1, +p.year, +p.year + 1]) {
      const diff = Math.round((Date.UTC(y, s.m - 1, s.d) - tonight) / 864e5);
      if (!best || Math.abs(diff) < Math.abs(best.diff)) {
        best = { name: s.name, zhr: s.zhr, diff, peakMs: Date.UTC(y, s.m - 1, s.d) };
      }
    }
  }
  return best;
}
async function loadDark() {
  const town = passObserver();
  try {
    const d = await getJSON(darkUrl(town));
    const times = (d && d.hourly && d.hourly.time) || [];
    const cov = (d && d.hourly && d.hourly.cloud_cover) || [];
    const hours = [];
    for (let i = 0; i < times.length; i++) {
      const t = airInstant(times[i]);
      if (!isNaN(t) && cov[i] != null) hours.push({ t, cloud: Math.round(cov[i]) });
    }
    if (!hours.length) throw new Error('no cloud hours in response');
    darkClouds = { town: town.name, hours };
    darkTownName = town.name;
    setUpdated('dark-updated');
  } catch (e) { /* keep the last good model run; if there is none, the cloud row declines */ }
  try {
    const d = await getJSON(DARK_KP_URL);
    if (!Array.isArray(d) || !d.length) throw new Error('no Kp blocks in response');
    const blocks = d.map(b => ({ t: darkKpInstant(b.time_tag), kp: +b.kp, scale: b.noaa_scale || null }))
      .filter(b => !isNaN(b.t) && !isNaN(b.kp));
    if (!blocks.length) throw new Error('no usable Kp blocks');
    darkKp = blocks;
  } catch (e) { /* the aurora row declines honestly; the verdict just loses a bonus */ }
  renderDark();
}
function renderDark() {
  const body = $('dark-body');
  if (!body) return;
  const town = passObserver();
  const now = Date.now();
  const win = darkWindow(town, now);
  const moon = almMoon(new Date(now));
  const moonPct = Math.round(moon.illum * 100);

  let cloudAvg = null, cloudPeak = null;
  if (darkClouds && win) {
    const inWin = darkClouds.hours.filter(h => h.t >= win.start - 1800e3 && h.t < win.end);
    if (inWin.length) {
      cloudAvg = Math.round(inWin.reduce((a, h) => a + h.cloud, 0) / inWin.length);
      cloudPeak = inWin.reduce((m, h) => Math.max(m, h.cloud), 0);
    }
  }
  let kpMax = null, kpScale = null;
  if (darkKp && win) {
    for (const b of darkKp) {
      if (b.t < win.end && b.t + 3 * 3600e3 > win.start && (kpMax == null || b.kp > kpMax)) {
        kpMax = b.kp; kpScale = b.scale;
      }
    }
  }
  let issVis = null, issKnown = false;
  try {
    if (typeof passPasses !== 'undefined' && passPasses) {
      issKnown = true;
      if (win) issVis = passPasses.find(p => p.kind === 'visible' && p.end > win.start && p.start < win.end) || null;
    }
  } catch (e) { issVis = null; issKnown = false; }
  const meteor = win ? darkMeteor(win) : null;
  const meteorHot = !!(meteor && Math.abs(meteor.diff) <= 2);
  const special = !!issVis || (kpMax != null && kpMax >= 5) || meteorHot;

  let lvl, head, sub;
  if (cloudAvg == null) {
    lvl = 'warn'; head = 'Can\u2019t call it yet';
    sub = 'The cloud forecast couldn\u2019t be checked just now, and clouds decide everything up there — '
      + 'so no verdict rather than a guess. What could be checked is itemized below.';
  } else if (cloudAvg <= 25 && (special || moon.illum <= 0.55)) {
    const draws = [];
    if (issVis) draws.push('a space-station pass you can actually see');
    if (kpMax != null && kpMax >= 5) draws.push('a real shot at the northern lights');
    if (meteorHot) draws.push('the ' + meteor.name + ' meteors at their peak');
    if (!draws.length) draws.push('a properly dark sky — the moon is only ' + moonPct + '% lit');
    lvl = 'ok'; head = 'Worth bundling up';
    sub = 'Clear dark hours over ' + esc(town.name) + ' tonight, with ' + draws.join(' and ') + '.';
  } else if (cloudAvg <= 55) {
    lvl = 'warn'; head = 'A maybe night';
    sub = cloudAvg <= 25
      ? 'Clear skies over ' + esc(town.name) + ', but the ' + esc(moon.name.toLowerCase()) + ' moon (' + moonPct
        + '% lit) washes out the faint stuff — bright planets, the big constellations, and a station pass if one crosses still show.'
      : 'About ' + cloudAvg + '% covered over ' + esc(town.name) + ' through the dark hours — the sky comes '
        + 'and goes. Worth a look out the window before you commit to a dark spot.';
  } else {
    lvl = 'bad'; head = 'Not tonight';
    sub = 'The model has ' + esc(town.name) + ' under about ' + cloudAvg + '% cloud through the dark hours.';
    if (issVis) sub += ' It\u2019s even hiding a visible station pass.';
    else if (kpMax != null && kpMax >= 5) sub += ' It\u2019s even hiding a Kp ' + kpMax.toFixed(1) + ' aurora chance.';
    else if (meteorHot) sub += ' It\u2019s even hiding the ' + meteor.name + ' meteors at their peak.';
  }

  const rows = [];
  if (win) {
    rows.push('<li><span class="dark-row-k">🌑 Dark hours</span><span class="dark-row-v">Fully dark from '
      + '<strong>' + almClock(new Date(win.start)) + '</strong> to <strong>' + almClock(new Date(win.end))
      + '</strong> — ' + almDur(win.end - win.start) + ' of it.</span></li>');
  }
  if (cloudAvg == null) {
    rows.push('<li><span class="dark-row-k">☁️ Clouds</span><span class="dark-row-v">Couldn\u2019t check — '
      + 'the cloud model didn\u2019t answer. There\u2019s no honest verdict without it.</span></li>');
  } else {
    rows.push('<li><span class="dark-row-k">☁️ Clouds</span><span class="dark-row-v">Cloud cover tonight: about '
      + '<strong>' + cloudAvg + '%</strong> on average across the dark hours'
      + (cloudPeak >= 90 && cloudAvg <= 55 ? ', with a fully covered stretch in there' : '') + '.</span></li>');
  }
  rows.push('<li><span class="dark-row-k">🌙 The moon</span><span class="dark-row-v">' + esc(moon.name) + ', '
    + '<strong>' + moonPct + '% lit</strong> — '
    + (moon.illum >= 0.75 ? 'bright enough to wash out faint stars and meteors.'
      : moon.illum <= 0.35 ? 'leaves the sky nice and dark for the faint stuff.'
      : 'some moonlight to contend with, but the sky still performs.') + '</span></li>');
  if (issVis) {
    rows.push('<li><span class="dark-row-k">🛰️ The station</span><span class="dark-row-v">A <strong>visible pass</strong> tonight: '
      + esc(fmtTime(new Date(issVis.start))) + ' – ' + esc(fmtTime(new Date(issVis.end))) + ', peaking '
      + Math.round(issVis.peakEl) + '° up in the ' + passCompass(issVis.peakAz) + ' — look up.</span></li>');
  } else if (issKnown) {
    rows.push('<li><span class="dark-row-k">🛰️ The station</span><span class="dark-row-v">No visible station pass '
      + 'tonight — the Sky card above keeps the next one you can catch.</span></li>');
  } else {
    rows.push('<li><span class="dark-row-k">🛰️ The station</span><span class="dark-row-v">Pass times couldn\u2019t be '
      + 'worked out just now — the live position is on the Sky card above.</span></li>');
  }
  if (kpMax == null) {
    rows.push('<li><span class="dark-row-k">🌌 Northern lights</span><span class="dark-row-v">Couldn\u2019t check — '
      + 'NOAA\u2019s Kp forecast didn\u2019t answer just now.</span></li>');
  } else {
    const band = kpMax >= 7 ? 'a real chance of seeing them, maybe well up in the northern sky'
      : kpMax >= 5 ? 'possible low on the northern horizon — find a dark spot with a clear view north'
      : 'not expected this far south tonight (our latitude usually needs about Kp 5)';
    rows.push('<li><span class="dark-row-k">🌌 Northern lights</span><span class="dark-row-v">Kp up to '
      + '<strong>' + kpMax.toFixed(1) + '</strong> tonight' + (kpScale ? ' (' + esc(kpScale) + ' storm level)' : '')
      + ' — ' + band + '.</span></li>');
  }
  if (meteor && (meteorHot || (meteor.diff > 2 && meteor.diff <= 10))) {
    const when = meteor.diff === 0 ? 'tonight' : meteor.diff === 1 ? 'tomorrow night'
      : meteor.diff === -1 ? 'last night — still strong tonight'
      : 'on ' + esc(fmtDay(new Date(meteor.peakMs + 12 * 3600e3)));
    rows.push('<li><span class="dark-row-k">☄️ Meteors</span><span class="dark-row-v">The <strong>' + esc(meteor.name)
      + '</strong> peak ' + when + ' — up to about ' + meteor.zhr + ' an hour at the peak under dark skies'
      + (moon.illum >= 0.8 ? '; a bright moon will thin them out' : '') + '.</span></li>');
  }

  body.innerHTML =
    '<div class="dark-verdict dark-' + lvl + '"><div class="dark-verdict-head">' + head + '</div>'
    + '<div class="dark-verdict-sub">' + sub + '</div></div>'
    + '<ul class="dark-rows">' + rows.join('') + '</ul>';
}
function tickDark() {
  // Follow the home town like the station passes do: if the visitor
  // picked a different town, re-read the sky for the new one; otherwise
  // just re-render so the window and countdowns stay honest.
  if (passObserver().name !== darkTownName && darkTownName !== '') { loadDark(); return; }
  if (darkClouds || darkKp) renderDark();
}
function initDark() {
  if (!$('dark-body')) return;
  loadDark();
  setInterval(loadDark, 30 * 60 * 1000);
  setInterval(tickDark, 60 * 1000);
}
initDark();

/* ---------- view navigation (Redesign 2026-11-04) ----------
   Twenty rounds of features made the page a mile long; this module gives
   it rooms. Every card now lives in exactly one of four views — Today,
   Travel, Outdoors, Events & More — switched by the tab bar (bottom bar
   on phones, top bar on desktop). Nothing was removed: every loader above
   still runs at boot, and hidden views keep updating on their timers; a
   view is a lens, not a shutdown. Cross-view jumps route through
   cclReveal: the finder, the glance tiles, the sticky bar and the hero
   chips all name cards, and the page first switches to the view that
   holds the card, then scrolls and flashes as it always did. The Leaflet
   gotcha is handled here too: the map is built while its view may be
   hidden, so every switch to Travel calls invalidateSize(). The last
   view is remembered (ccl-view-v1). */
const VIEW_KEY = 'ccl-view-v1';
const VIEW_IDS = ['today', 'travel', 'outdoors', 'more'];
let cclViewCur = 'today';

function cclParentOf(el) { return el ? (el.parentNode || el.parent || null) : null; }
function cclViewOf(el) {
  let n = el;
  while (n && n.tag !== '#document') {
    if (n.classList && n.classList.contains('view')) return n;
    n = cclParentOf(n);
  }
  return null;
}
function cclShowView(name) {
  if (VIEW_IDS.indexOf(name) === -1) name = 'today';
  cclViewCur = name;
  VIEW_IDS.forEach(v => {
    const sec = $('view-' + v);
    if (!sec) return;
    const on = v === name;
    sec.hidden = !on;
    sec.classList.toggle('view-active', on);
  });
  document.querySelectorAll('.tab-btn').forEach(b => {
    const on = !!(b.dataset && b.dataset.viewBtn === name);
    b.classList.toggle('active', on);
    if (b.setAttribute) b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  try { window.localStorage.setItem(VIEW_KEY, name); } catch (e) { /* storage unavailable — choice is session-only */ }
  if (name === 'travel' && typeof map !== 'undefined' && map && map.invalidateSize) {
    setTimeout(() => { try { map.invalidateSize(); } catch (e) { /* map still booting */ } }, 60);
  }
  if (name === 'outdoors') {
    /* The heat strip renders inside this (usually hidden) view, where
       its labels can't be measured — re-run the fit check now that
       the view has layout. */
    setTimeout(() => { try { fitHeatLabels(); } catch (e) { /* strip not rendered yet */ } }, 60);
  }
}
function cclReveal(el) {
  if (!el) return;
  const v = cclViewOf(el);
  if (v && v.id && v.id !== 'view-' + cclViewCur) cclShowView(v.id.replace('view-', ''));
}
function cclRouteAnchor(a) {
  const href = a && a.getAttribute ? a.getAttribute('href') : (a && a.attrs ? a.attrs.href : null);
  if (!href || href.charAt(0) !== '#' || href.length < 2) return;
  const target = $(href.slice(1));
  if (!target) return;
  cclReveal(target);
  setTimeout(() => {
    try { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    catch (e) { try { target.scrollIntoView(); } catch (e2) { /* older browser */ } }
    finderFlashEl(target, false);
  }, 30);
}
function initViews() {
  let start = 'today';
  try {
    const p = window.localStorage.getItem(VIEW_KEY);
    if (p && VIEW_IDS.indexOf(p) !== -1) start = p;
  } catch (e) { /* storage unavailable */ }
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.addEventListener('click', () => {
      cclShowView(b.dataset ? b.dataset.viewBtn : null);
      if (window.scrollTo) { try { window.scrollTo(0, 0); } catch (e) { /* noop */ } }
    });
  });
  // Route every in-page card anchor (glance tiles, sticky bar, hero chips,
  // the offline note) through the views, so a tap lands in the right room.
  try {
    document.querySelectorAll('a').forEach(a => {
      const href = a.getAttribute ? a.getAttribute('href') : null;
      if (href && href.charAt(0) === '#' && href.length > 1) {
        a.addEventListener('click', ev => { if (ev && ev.preventDefault) ev.preventDefault(); cclRouteAnchor(a); });
      }
    });
  } catch (e) { /* anchors keep their default jump as a fallback */ }
  cclShowView(start);
}
initViews();

/* ---------- the drawer (v5): the logo opens a slide-out menu ----------
   Travis's clean-hero trade: the hero's six quick-nav chips retired,
   and every jump they carried — plus every other section on the page —
   now lives here. The courthouse logo in the masthead is the button
   (hamburger badge on the mark). The drawer slides in from the RIGHT
   over a dimmed backdrop, frosted glass in both themes, and closes on
   the backdrop, on Esc, on its ✕, or on any selection. Section links
   are plain in-page anchors, so initViews' router already switches
   the view and scrolls them home; this module only adds the closing.
   The drawer's own chrome strings ride the same data-i18n / LANG_ES
   system as the rest of the page. */
function initDrawer() {
  const drawer = $('drawer'), backdrop = $('drawer-backdrop'),
        openBtn = $('menu-btn'), closeBtn = $('drawer-close');
  if (!drawer || !openBtn) return;
  let lastFocus = null;
  function openDrawer() {
    lastFocus = document.activeElement;
    drawer.hidden = false;
    if (backdrop) backdrop.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      drawer.classList.add('open');
      if (backdrop) backdrop.classList.add('open');
    }));
    document.body.classList.add('drawer-on');
    openBtn.setAttribute('aria-expanded', 'true');
    if (closeBtn) closeBtn.focus();
  }
  function closeDrawer() {
    if (drawer.hidden) return;
    drawer.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    document.body.classList.remove('drawer-on');
    openBtn.setAttribute('aria-expanded', 'false');
    setTimeout(() => { drawer.hidden = true; if (backdrop) backdrop.hidden = true; }, 320);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  openBtn.addEventListener('click', openDrawer);
  if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
  if (backdrop) backdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') closeDrawer();
  });
  drawer.querySelectorAll('.drawer-link, .drawer-action[href^="#"]').forEach(a =>
    a.addEventListener('click', () => closeDrawer()));
  drawer.querySelectorAll('[data-drawer-view]').forEach(b =>
    b.addEventListener('click', () => {
      closeDrawer();
      cclShowView(b.dataset ? b.dataset.drawerView : null);
      if (window.scrollTo) { try { window.scrollTo(0, 0); } catch (e) { /* noop */ } }
    }));
  const saverBtn = $('drawer-saver-btn');
  if (saverBtn) saverBtn.addEventListener('click', () => {
    closeDrawer();
    if (window.CCLOpenSaver) window.CCLOpenSaver();
    else { const sb = $('saver-start-btn'); if (sb) sb.click(); }
  });
  /* v6: the masthead Display button — display mode is one tap from
     first paint on every view, not buried in a card or the drawer.
     Same opener, same gesture chain (the click is what lets the
     saver ask for fullscreen). */
  const dispBtn = $('display-btn');
  if (dispBtn) dispBtn.addEventListener('click', () => {
    if (window.CCLOpenSaver) window.CCLOpenSaver();
    else { const sb = $('saver-start-btn'); if (sb) sb.click(); }
  });
}
initDrawer();

/* ---------- reveal-on-first-sight (Redesign 2026-11-04) ----------
   Cards rise and fade in the first time they scroll into view — motion
   that helps the eye land, nothing more. The hidden start state is added
   by this script only when IntersectionObserver exists, so with JS off
   or an old browser every card is simply visible: content is never gated
   on animation. Reduced-motion readers get no reveal at all. */
function initReveal() {
  let reduced = false;
  try { reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* assume motion ok */ }
  if (reduced) return;
  if (typeof IntersectionObserver === 'undefined') return;
  const els = [];
  document.querySelectorAll('.view .card').forEach(el => els.push(el));
  document.querySelectorAll('.glance').forEach(el => els.push(el));
  document.querySelectorAll('.finder').forEach(el => els.push(el));
  if (!els.length) return;
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) { en.target.classList.add('inview'); io.unobserve(en.target); }
    });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.04 });
  /* v4 load pass (Travis: first open "loaded in really slowly and
     looked kind of weird"): a card already on screen at setup never
     gets the hidden start state, so first paint reads finished
     instead of assembling itself. Only below-the-fold cards fade. */
  const vh = window.innerHeight || 0;
  els.forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.top < vh && r.bottom > 0) return;
    el.classList.add('reveal'); io.observe(el);
  });
}
initReveal();

/* Fish boot LAST on purpose: the counts read homeTown and the
   quadrant reads the tides module's helpers, both declared further
   down than the main go-section — calling them there hits TDZ errors. */
loadFish();
loadCurrents();
loadSteelhead();

/* ---------- WS-1 2026-11-04: schools board + founding-sponsor interest ----------
   Two Phase-1 additions from the 2026-11-04 audit (2.2 + 3.4):

   (a) SCHOOLS — closures & delays. There is no automated closure feed
   for the county's districts anywhere (the business plan named this the
   likeliest resident request), so the board is CURATED: the statuses
   live in data/schools.json, one entry per district serving the county
   (St. Helens, Scappoose, Rainier, Clatskanie, Vernonia, NWRESD), each
   open / closed / delayed / no_report with a free-text note, a report
   date and an updated_at stamp. In quiet weather every district reads
   "No report yet" and the card says plainly that it is standing by —
   dormant-ready, never dressed up as live data. On a storm morning the
   file is flipped by hand against each district's own posting and the
   code paths publish it in minutes; the full routine is written down in
   files/school-closures-routine.md in the goal workspace. The static
   list in index.html mirrors the dormant state, so the card is honest
   even before (or without) the fetch. Status labels are this page's own
   chrome, so they render in Spanish too — and langSet is wrapped below
   so the toggle re-renders them live.

   (b) ABOUT / SUPPORT — the Phase-2 interest surface. Nothing is for
   sale; the section states what CCL is, why it is free, and the promise
   that the public-safety core stays free and unsponsored, and captures
   founding-sponsor interest only. The capture target is ONE config
   value: paste a Google Form URL into SPONSOR_FORM_URL and the button
   becomes the form (new tab); while it is empty the button is a plainly
   labeled mailto to the studio inbox. Form creation is parked on
   Travis's Google sign-in — instructions in the goal docs. */
const SPONSOR_FORM_URL = 'https://forms.gle/D4poEqfu1ogoMr4r6'; // LIVE 2026-11-05: founding-sponsor Google Form (created in Travis's Google account; full URL https://docs.google.com/forms/d/e/1FAIpQLSe21yqkUMx6OAdoTdoj6_V9rwdYhIvnOFIygaiOD7ciuJCfbg/viewform); '' would fall back to the interim mailto capture
const SPONSOR_EMAIL = 'nomadov3rland@gmail.com';
function initSponsorLink() {
  const a = $('sponsor-interest-link');
  if (!a || !SPONSOR_FORM_URL) return; // mailto in the HTML is the interim capture
  a.href = SPONSOR_FORM_URL;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = '📋 Founding sponsor interest form';
}
initSponsorLink();

/* EVENT SUBMISSIONS — the "Submit an Event" Google Form (v47). Same
   swap pattern as SPONSOR_FORM_URL / PHOTO_FORM_URL: the constant is
   the single source of truth, the Events card link in index.html
   carries the same URL statically (honest without JS), and this init
   re-points it from the constant so the two can never drift apart.
   Submissions land in the form inbox and pass a human review before
   anything is added to the events list — the review gate is the
   feature's load-bearing wall, same as photo submissions. */
const EVENT_FORM_URL = 'https://forms.gle/dWzcBcnf79Qq5XQQA'; // LIVE 2026-11-09: Submit an Event Google Form (created in Travis's Google account; full URL https://docs.google.com/forms/d/e/1FAIpQLScsLe440Ew7k2h_56UG_cxh9ySmn6BfNYABc_A7ermx_F118Q/viewform)
function initEventLink() {
  const a = $('event-submit-link');
  if (!a || !EVENT_FORM_URL) return;
  a.href = EVENT_FORM_URL;
  a.target = '_blank';
  a.rel = 'noopener';
}
initEventLink();

/* LOCAL SERVICES INTAKE — the "Add Your Local Service" Google Form
   (v49, 2026-11-09; form live, wired and published).
   The little-guys shelf gets its OWN form — the founding/storefront
   form (SPONSOR_FORM_URL) stays separate so storefront prospecting
   records never mix with one-person services. Same swap pattern as
   EVENT_FORM_URL: SERVICE_FORM_URL is the single source of truth,
   every .svc-form-link anchor in the services card (the top
   "Add yourself" button, the invite row, the bottom CTA) carries the
   general form URL statically as the honest no-JS fallback, and this
   init re-points all of them from the constant once the dedicated
   form is live. The shelf is FREE — no payment step, no pricing in
   this flow (Travis delegated the call 2026-11-09: free community
   shelf). Submissions pass the same human review gate as everything
   else; nothing posts automatically. */
const SERVICE_FORM_URL = 'https://forms.gle/9XMavZPhuDhNAzKM9'; // LIVE 2026-11-09: "Columbia County Live — Add Your Local Service" (form 1Dutw3SwHmW4Nh2qo975PqEhMV_1mvtDi43zLVc73ErQ)
function initServiceLinks() {
  if (!SERVICE_FORM_URL) return; // static hrefs (general form) are the interim capture
  document.querySelectorAll('.svc-form-link').forEach(a => {
    a.href = SERVICE_FORM_URL;
    a.target = '_blank';
    a.rel = 'noopener';
  });
}
initServiceLinks();

const SCHOOL_STATUS = {
  open:      { en: 'Open',          es: 'Abierto',       cls: 'school-open' },
  closed:    { en: 'Closed',        es: 'Cerrado',       cls: 'school-closed' },
  delayed:   { en: 'Delayed',       es: 'Con retraso',   cls: 'school-delayed' },
  no_report: { en: 'No report yet', es: 'Sin reporte aún', cls: 'school-none' }
};
const SCHOOL_TXT = {
  en: {
    dormant: '✅ No closure or delay report is posted for today — this board is standing by for the next storm morning. Regular school days need no report.',
    reportFor: 'Storm report for ',
    updated: ' · checked against the districts’ own postings',
    standingBy: 'Standing by — no storm report posted',
    site: 'Official site →'
  },
  es: {
    dormant: '✅ Hoy no hay ningún reporte de cierre o retraso publicado — este tablero está en espera hasta la próxima mañana de tormenta. Los días normales de clases no necesitan reporte.',
    reportFor: 'Reporte de tormenta para el ',
    updated: ' · verificado contra las publicaciones de los propios distritos',
    standingBy: 'En espera — sin reporte de tormenta',
    site: 'Sitio oficial →'
  }
};
let schoolsSnapCache = null;
function renderSchools() {
  const body = $('schools-body');
  if (!body || !schoolsSnapCache) return;
  const L = SCHOOL_TXT[langCur === 'es' ? 'es' : 'en'];
  const districts = schoolsSnapCache.districts || [];
  const anyReport = districts.some(d => d && d.status && d.status !== 'no_report');
  let html = '';
  if (anyReport) {
    const when = schoolsSnapCache.report_date
      ? fmtDay(new Date(schoolsSnapCache.report_date + 'T12:00:00')) : '';
    html += '<p class="schools-report">🌨️ <strong>' + esc(L.reportFor + when) + '</strong>'
      + (schoolsSnapCache.updated_at
          ? ' · ' + esc(fmtDayTime(new Date(schoolsSnapCache.updated_at))) : '')
      + esc(L.updated) + '.</p>';
  } else {
    html += '<p class="schools-dormant">' + esc(L.dormant) + '</p>';
  }
  html += '<ul class="schools-list">' + districts.map(d => {
    const st = SCHOOL_STATUS[d.status] || SCHOOL_STATUS.no_report;
    return '<li class="school-row"><span class="school-main">'
      + '<span class="school-name">' + esc(d.name) + '</span>'
      + (d.sub ? '<span class="school-sub">' + esc(d.sub) + '</span>' : '')
      + '</span>'
      + '<span class="school-pill ' + st.cls + '">' + esc(langCur === 'es' ? st.es : st.en) + '</span>'
      + (d.url ? '<a class="school-link" href="' + esc(d.url) + '" target="_blank" rel="noopener">'
          + esc(d.link_label ? (langCur === 'es' ? L.site : d.link_label + ' →') : L.site) + '</a>' : '')
      + (d.note ? '<span class="school-note">' + esc(d.note) + '</span>' : '')
      + '</li>';
  }).join('') + '</ul>';
  body.innerHTML = html;
  const stamp = $('schools-updated');
  if (stamp) {
    stamp.textContent = anyReport && schoolsSnapCache.updated_at
      ? 'Storm report · updated ' + fmtDayTime(new Date(schoolsSnapCache.updated_at))
      : L.standingBy;
  }
}
async function loadSchools() {
  if (!$('schools-body')) return;
  try {
    schoolsSnapCache = await getSnapshot('schools.json');
    renderSchools();
  } catch (e) {
    // The static dormant list in the HTML stays on the page — it is the
    // honest fallback, and the district links on it are the final word.
    const stamp = $('schools-updated');
    if (stamp) stamp.textContent = SCHOOL_TXT[langCur === 'es' ? 'es' : 'en'].standingBy;
  }
}
loadSchools();
setInterval(loadSchools, 30 * 60 * 1000);

/* The language toggle re-renders this module's dynamic strings too —
   the schools board's statuses are rendered by JS, so the static-chrome
   dictionary alone would leave them in English. (Same pattern as the
   fish pick card's re-render inside langSet; appended as a wrap so the
   original toggle code is untouched.) */
const langSetSchoolsPrev = langSet;
langSet = function (lang) {
  langSetSchoolsPrev(lang);
  renderSchools();
};

/* The river glance tile composes its tide-first text in JS, so
   re-compose it when the language flips (same wrap pattern). */
const langSetGlancePrev = langSet;
langSet = function (lang) {
  langSetGlancePrev(lang);
  updateGlanceRiver();
};

/* ---------- Redesign prototype 2026-11-05: theme toggle wiring ----------
   The theme itself is set before paint by the inline script in
   index.html (saved choice > OS prefers-color-scheme). This wires the
   masthead button: since v4 it sits at the top-right beside the clock
   (in v3 it was the first pill in the hero chip row, where Travis had
   to hunt for it). Icon + label flip, aria-pressed, theme-color meta,
   and persisting the choice in localStorage. The label names the mode
   you switch TO ("Dark" while light, "Light" while dark), matching
   the aria-label. */
(function initThemeToggle() {
  var btn = document.getElementById('theme-btn'); if (!btn) return;
  var label = document.getElementById('theme-btn-label');
  var meta = document.querySelector('meta[name="theme-color"]');
  function paint() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (label) label.textContent = dark ? 'Light' : 'Dark';
    btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    if (meta) meta.setAttribute('content', dark ? '#0b120d' : '#1e4228');
  }
  btn.addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('ccl-theme', next); } catch (e) {}
    paint();
  });
  paint();
})();

/* ---------- v3 (2026-11-05): the glance strip ----------
   The four glance answers flow in ONE continuous full-width stream,
   right-to-left, seamlessly looped — the marquee technique from
   Travis's own portfolio sites (a flex track at width:max-content,
   content duplicated, animated to translateX(-50%)). The four items
   in the markup are canonical: the glance module still writes into
   the same .glance-val IDs on those same items (data wiring
   untouched). This script clones the set until the track holds two
   identical halves wide enough for any viewport, strips the clones'
   IDs, marks them aria-hidden + untabbable, routes their clicks
   through the same view router, and keeps every clone in sync with
   its canonical item via MutationObserver (values, subs and the
   ok/warn/bad status classes all copy over). Motion is pure CSS;
   hover / focus pauses it. prefers-reduced-motion: no clones, no
   animation — a static full-width strip, horizontally scrollable. */
(function initStrip() {
  var section = document.getElementById('glance-card'); if (!section) return;
  var track = document.getElementById('strip-track'); if (!track) return;
  var items = Array.prototype.slice.call(track.querySelectorAll('.strip-item'));
  if (!items.length) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    section.classList.add('reduced');
    return;
  }

  /* v4 smoothness: clone only as much loop as the screen needs — two
     identical halves, each at least one viewport wide (capped at 4
     sets). v3's fixed 3 sets per half built a ~10,000px-wide track on
     desktop; oversized composited layers are a classic phone-jank
     source. Measured before fonts settle this can only undershoot,
     and the ceil() rounds up, so the loop stays seamless. */
  var setW = 0;
  items.forEach(function (el) { setW += el.offsetWidth || 0; });
  var SETS_PER_HALF = 3;
  if (setW > 0) {
    SETS_PER_HALF = Math.min(4, Math.max(1,
      Math.ceil(Math.max(window.innerWidth || 0, setW) / setW)));
  }
  var clones = items.map(function () { return []; });
  function makeClone(src, j) {
    var c = src.cloneNode(true);
    c.removeAttribute('id');
    c.querySelectorAll('[id]').forEach(function (n) { n.removeAttribute('id'); });
    c.setAttribute('aria-hidden', 'true');
    c.setAttribute('tabindex', '-1');
    c.classList.add('strip-clone');
    c.addEventListener('click', function (ev) {
      if (typeof cclRouteAnchor === 'function') { ev.preventDefault(); cclRouteAnchor(c); }
    });
    clones[j].push(c);
    return c;
  }
  for (var half = 0; half < 2; half++) {
    for (var s = 0; s < SETS_PER_HALF; s++) {
      if (half === 0 && s === 0) continue; /* the canonical set is already in the track */
      items.forEach(function (src, j) { track.appendChild(makeClone(src, j)); });
    }
  }
  /* v10 smoothness — the diagnosis, acted on. Two defects in the
     v3/v4 mechanics made the stream glitch on a real desktop:
     (a) SYNC REBUILT THE CLONES: v4's sync replaced each clone's
     ENTIRE innerHTML on every change — re-creating the icon <img>
     and re-parsing the subtree inside the animating layer, forcing
     the browser to re-raster the multi-thousand-pixel track in the
     middle of the scroll. The sync below copies only what can
     actually change — the value's text + status class, the sub's
     text — into the clone's EXISTING nodes. A few text writes, no
     new nodes, no re-parse.
     (b) SLOT WIDTHS DRIFTED: whenever a value's text changed length
     (a tide string rolling over, a longer event title), its slot —
     and with it the whole track — resized mid-loop, shifting the
     velocity and the seam. So after the first real readings land,
     each slot's width is measured (with the value sized at its
     full text width, capped at the CSS 36ch ceiling — no future
     value can ever need more room than that) and pinned on the
     canonical item AND every clone: the two halves stay
     pixel-identical and later text changes truncate inside the
     slot instead of resizing it. A longer SUB can still ask for
     room at most once per slot: the grow path widens every copy of
     that slot by the same amount, halves still identical. Locks
     re-run on language flips (ES strings run longer) and on
     viewport resizes, and a grow never fires while the strip is
     hovered or focused — the animation is paused then, so nothing
     can jump under a reading user. */
  var slotW = items.map(function () { return 0; });
  var locked = false;
  function applyWidths() {
    items.forEach(function (src, j) {
      if (!slotW[j]) return;
      src.style.width = slotW[j] + 'px';
      clones[j].forEach(function (c) { c.style.width = slotW[j] + 'px'; });
    });
  }
  /* v35: slot widths are DERIVED FROM THE CONTENT, never read off
     the item box. Chromium's intrinsic-width pass over this flex
     strip is unreliable — a pristine item can measure at barely
     half its true width (label/sub row contributing zero) until a
     width has been applied and cleared once, so any box measurement
     can poison the lock with a too-narrow slot and crushed text.
     Text measured with a ruler span in the element's own computed
     font is stable in every layout state. */
  function rulerW(el, capCh) {
    if (!el) return 0;
    var cs = window.getComputedStyle(el);
    var ruler = document.createElement('span');
    ruler.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;' +
      'font-family:' + cs.fontFamily + ';font-size:' + cs.fontSize +
      ';font-weight:' + cs.fontWeight + ';letter-spacing:' + cs.letterSpacing +
      ';text-transform:' + cs.textTransform;
    ruler.textContent = '0000000000';
    document.body.appendChild(ruler);
    var chPx = ruler.offsetWidth / 10;
    ruler.textContent = el.textContent;
    var w = ruler.offsetWidth;
    document.body.removeChild(ruler);
    if (capCh) w = Math.min(w, chPx * capCh);
    return w;
  }
  function measureSlot(src) {
    var cs = window.getComputedStyle(src);
    var pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) +
              (parseFloat(cs.borderRightWidth) || 0);
    var ico = src.querySelector('.gl-ico');
    var icoW = ico ? (ico.offsetWidth ||
      parseFloat(window.getComputedStyle(ico).width) || 0) : 0;
    var gap = parseFloat(cs.columnGap) || 13;
    var top = src.querySelector('.strip-top');
    var topGap = top ? (parseFloat(window.getComputedStyle(top).columnGap) || 7) * 2 : 0;
    var topW = rulerW(src.querySelector('.glance-label')) +
               rulerW(src.querySelector('.strip-sep')) +
               rulerW(src.querySelector('.glance-sub')) + topGap;
    var valW = rulerW(src.querySelector('.glance-val'), 36);
    return Math.ceil(pad + icoW + gap + Math.max(topW, valW)) + 2;
  }
  function lockWidths() {
    if (document.fonts && document.fonts.status !== 'loaded') return;
    var ready = items.every(function (src) {
      var v = src.querySelector('.glance-val');
      return v && v.textContent.trim() && !/checking/i.test(v.textContent);
    });
    if (!ready) return;
    /* first pass locks; every later pass is a grow-only validation —
       slots can only ever widen toward the true content width,
       never shrink, and never while a reader is hovering/focused */
    var paused = locked && (section.matches(':hover') ||
      section.contains(document.activeElement));
    var grew = false;
    items.forEach(function (src, j) {
      var w = measureSlot(src);
      if (w > slotW[j]) {
        if (paused) return;
        slotW[j] = w; grew = true;
      }
    });
    if (grew) applyWidths();
    locked = true;
  }
  function lockLoop(maxMs) {
    var iv = setInterval(lockWidths, 800);
    setTimeout(function () { clearInterval(iv); }, maxMs || 30000);
    lockWidths();
  }
  function relock() {
    slotW = items.map(function () { return 0; });
    locked = false;
    items.forEach(function (src) { src.style.width = ''; });
    clones.forEach(function (list) {
      list.forEach(function (c) { c.style.width = ''; });
    });
    lockLoop(10000);
  }
  function maybeGrow(j) {
    if (!locked) return;
    if (section.matches(':hover') || section.contains(document.activeElement)) return;
    var need = measureSlot(items[j]);
    if (need > slotW[j]) { slotW[j] = need; applyWidths(); }
  }
  lockLoop(90000);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(lockWidths);
  window.addEventListener('ccl-lang-changed', relock);
  var rzT = null;
  window.addEventListener('resize', function () {
    if (rzT) clearTimeout(rzT);
    rzT = setTimeout(relock, 700);
  });

  items.forEach(function (src, j) {
    if (!window.MutationObserver || !clones[j].length) return;
    /* signature-coalesced like v4 (data polls rewrite nodes more
       often than readings change), but the write itself is now
       targeted — see (a) above. The signature re-queries the live
       nodes each time, so it stays correct even if a module
       rebuilds an item's children. */
    var lastSig = null, queued = false;
    function signature() {
      var v = src.querySelector('.glance-val');
      var s = src.querySelector('.glance-sub');
      return (v ? v.textContent + '\u0001' + v.className : '') + '|' +
             (s ? s.textContent : '');
    }
    function sync() {
      queued = false;
      var sig = signature();
      if (sig === lastSig) return;
      lastSig = sig;
      var v = src.querySelector('.glance-val');
      var s = src.querySelector('.glance-sub');
      var itemCls = src.className + ' strip-clone';
      clones[j].forEach(function (c) {
        var cv = c.querySelector('.glance-val');
        var cs2 = c.querySelector('.glance-sub');
        if (cv && v) {
          if (cv.textContent !== v.textContent) cv.textContent = v.textContent;
          if (cv.className !== v.className) cv.className = v.className;
        }
        if (cs2 && s && cs2.textContent !== s.textContent) cs2.textContent = s.textContent;
        if (c.className !== itemCls) c.className = itemCls;
      });
      maybeGrow(j);
    }
    new MutationObserver(function () {
      if (!queued) { queued = true; requestAnimationFrame(sync); }
    }).observe(src, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['class']
    });
  });
})();
/* ---------- Redesign prototype 2026-11-05: Featured Event slot ----------
   Research slot D: while unsold, the pinned Featured Event slot carries
   a real free community event from the site's own event snapshots (never
   a government meeting — the first community event in the Facebook
   snapshot, falling back to the city calendars). If nothing qualifies,
   the slot stays hidden rather than showing a placeholder. */
(function initFeaturedEvent() {
  var slot = document.getElementById('featured-event-slot'); if (!slot) return;
  var body = document.getElementById('featured-event-body');
  function pick(events) {
    if (!events || !events.length) return null;
    for (var i = 0; i < events.length; i++) {
      var t = (events[i].title || '');
      if (/meeting|session|commission|hearing|council/i.test(t)) continue;
      return events[i];
    }
    return null;
  }
  function render(ev) {
    if (!ev) return;
    var when = ev.date || '';
    try {
      var d = new Date(ev.date + 'T12:00:00');
      if (!isNaN(d)) when = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    } catch (e) {}
    var meta = [when, ev.time || '', ev.source ? 'via ' + ev.source : ''].filter(Boolean).join(' · ');
    body.innerHTML = '';
    var a = document.createElement('a');
    a.href = ev.url || '#events-card'; a.textContent = ev.title || 'Community event';
    if (ev.url) { a.target = '_blank'; a.rel = 'noopener'; }
    body.appendChild(a);
    body.appendChild(document.createTextNode(' — ' + meta + '. Free community pick while this slot is unsold.'));
    slot.hidden = false;
  }
  function load(url) {
    return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  load('data/fb-events.json').then(function (fb) {
    var ev = pick(fb && fb.events);
    if (ev) { render(ev); return; }
    load('data/events.json').then(function (cal) { render(pick(cal && cal.events)); });
  });
})();

/* ---------- v3 (2026-11-05): calm per-view photo background ----------
   No timers, no cycling (Travis: the constantly changing background
   was "too much"). Each view owns ONE strong photo per theme — the
   layer whose data-bg-view matches the visible view is "on"; the day
   and dusk stacks are still shown/hidden by the theme in CSS. The
   photo changes only when the visitor changes view or theme, with a
   single short crossfade (the portfolio pattern: imagery swaps on
   user action, e.g. the detailing demo's service figure). View
   switching toggles the sections' hidden attribute (cclShowView), so
   a MutationObserver on that attribute drives the swap; since v4 the
   non-Today layers' photos are attached lazily (see ensure() below)
   so first paint downloads one background per theme, not eight. */
(function () {
  var layers = Array.prototype.slice.call(document.querySelectorAll('.page-bg .bg-layer[data-bg-view]'));
  if (!layers.length) return;
  var views = Array.prototype.slice.call(document.querySelectorAll('.view[data-view]'));
  function current() {
    for (var i = 0; i < views.length; i++) {
      if (!views[i].hidden) return views[i].getAttribute('data-view');
    }
    return 'today';
  }
  /* v4 load pass: only Today's two layers carry an inline photo.
     Every other layer's URL waits in data-bg-src and is attached
     here — the moment its view opens, or at idle after first paint,
     whichever comes first — so the initial download is the hero plus
     ONE background per theme instead of eight photographs. */
  function ensure(l) {
    var s = l.getAttribute('data-bg-src');
    if (s && !l.style.backgroundImage) {
      l.style.backgroundImage = 'url("' + s + '")';
      l.removeAttribute('data-bg-src');
    }
  }
  function apply() {
    var name = current();
    layers.forEach(function (l) {
      var on = l.getAttribute('data-bg-view') === name;
      if (on) ensure(l);
      l.classList.toggle('on', on);
    });
  }
  apply();
  function warmRest() { layers.forEach(ensure); }
  if (window.requestIdleCallback) requestIdleCallback(warmRest, { timeout: 2500 });
  else window.addEventListener('load', function () { setTimeout(warmRest, 400); });
  if (window.MutationObserver) {
    var mo = new MutationObserver(apply);
    views.forEach(function (v) { mo.observe(v, { attributes: true, attributeFilter: ['hidden', 'class'] }); });
  }
})();

/* ---------- Community Screensaver (Redesign prototype, 2026-11-05) ----------
   Travis's direction: an ambient display people can leave running — a
   phone, a kitchen tablet, or a TV in a county office or waiting room.
   County photographs fill the screen and crossfade SLOWLY through the
   community pool (this mode is the one place photo cycling belongs;
   the main site's backgrounds stay calm, per v3/v4). Over the photo:
   a large clock + date, and the live answers the visitor PINNED, in
   across-the-room type over a directional scrim.

   Unattended by design: the overlay lives in this same page, so every
   data timer the page already runs keeps the answers fresh behind it;
   the mode itself never opens a dialog, never asks a permission,
   never pops anything. Exit is any tap / click / keypress.

   Pins: every answer (the four glance answers — bridge / tides /
   weather / next event — plus the ferry) has a pin chip in the
   Community Screensaver card on Events & More. (v8: the small 📌
   toggles that used to ride the scrolling strip are REMOVED —
   Travis found the amber pin discs on the marquee items ugly; the
   card's chips are the one answer-pin control now.) Pins live in the
   GENERIC pin store (window.CCLPins, localStorage ccl-pins-v1) —
   one stored object, { cards: [...], answers: [...] } — because
   pins are a site-wide concept, not a screensaver one: Travis has
   directed that pinned CARDS will also render at the top of the
   Today view (the base site's front-page system already moves
   pinned cards there; the next pass unifies its toggles onto this
   store and reads store.cards). This module owns the answers half.
   Card heads carry the unified card pins (v5) — never saver pins —
   and the saver card's chips carry the answer pins, so the two halves
   of the one store never collide on the same control.

   Photo pool: data/community-photos.json — { src, credit, location }
   per entry, each shown with its credit line. Seeded with verified
   site photographs marked "starter". COMMUNITY SUBMISSIONS NEVER
   WRITE TO THAT FILE: they go to the photo form (PHOTO_FORM_URL
   below — the live Google Form, swapped in on 2026-11-05,
   mirroring how SPONSOR_FORM_URL was swapped in at v20), land
   in the form inbox, pass a human review, and only then get added to
   the JSON by hand. The review gate is the feature's load-bearing
   wall, not a detail. */
const PHOTO_FORM_URL = 'https://forms.gle/e1GU1qnuBKCM9KBk9'; // LIVE 2026-11-05 — the real photo Google Form (name / where taken / photo upload / rights checkbox, mirroring the sponsor form)
(function initSaver() {
  var overlay = document.getElementById('saver-overlay');
  if (!overlay) return;
  var PHOTO_MS = 16000;      // dwell per photo — a slow ambient cycle
  var QUIET = [
    { en: 'Presented by — your business here · Founding Sponsor · $49/mo · 1 spot reserved, 2 open',
      es: 'Presentado por — su negocio aquí · Patrocinador Fundador · $49/mes · 1 lugar reservado, 2 disponibles' },
    { en: 'These photographs come from the county itself — share yours from the Events & More tab',
      es: 'Estas fotografías vienen del propio condado — comparte la tuya desde la pestaña Eventos y Más' },
    null /* a beat of nothing — the quiet line rests every third photo */
  ];
  /* v6: the quiet line is a rotation marched by the PHOTOS, not a
     lookup and not a timer — quietIdx advances exactly once per photo
     change (showPhoto's timed advance), so the sponsor line, the
     photo invitation and the blank beat take turns in step with the
     pictures. Future sponsors slot into QUIET and join the march. */
  var quietIdx = 0;
  var FALLBACK_POOL = [
    { src: 'img/bg/bg-day-1.jpg',  credit: 'Gary Halvorson, Oregon State Archives', location: 'Lewis & Clark Bridge — Rainier' },
    { src: 'img/bg/bg-day-6.jpg',  credit: 'Kingofthedead', location: 'The dock at Rainier, on the Columbia' },
    { src: 'img/bg/bg-day-4.jpg',  credit: 'SounderBruce', location: 'The Oscar B ferry, leaving Puget Island' },
    { src: 'img/bg/bg-day-3.jpg',  credit: 'Quintin Soloviev', location: 'River traffic passing under the Lewis & Clark Bridge' },
    { src: 'img/bg/bg-dusk-2.jpg', credit: 'Joe Mabel', location: 'Mouth of the Columbia, from Astoria Column' },
    { src: 'img/bg/bg-dusk-3.jpg', credit: 'Rennett Stowe', location: 'Fishing boat at sunset, lower Columbia' },
    { src: 'img/bg/bg-dusk-4.jpg', credit: 'Marshalllee84', location: 'Mt. St. Helens at sunset' },
    { src: 'img/bg/bg-dusk-5.jpg', credit: 'USFWS Pacific', location: 'Sunset on the Columbia at Kelley Point' }
  ];

  /* ----- the answers the screensaver can show ----- */
  function tileOf(valId) {
    var v = document.getElementById(valId);
    return v ? v.closest('.glance-tile') : null;
  }
  function tileLabel(valId, fallback) {
    var t = tileOf(valId);
    var l = t ? t.querySelector('.glance-label') : null;
    var s = l ? l.textContent.trim() : '';
    return s || fallback[langCur === 'es' ? 'es' : 'en'];
  }
  function tileSub(valId) {
    var t = tileOf(valId);
    var s = t ? t.querySelector('.glance-sub') : null;
    return s ? s.textContent.trim() : '';
  }
  function cleanVal(id) {
    var el = document.getElementById(id);
    var v = el ? el.textContent.trim() : '';
    if (!v || /checking|loading|gathering|cargando|buscando/i.test(v)) return '';
    return v;
  }
  var ANSWERS = [
    { id: 'bridge', icon: 'img/icons/icon-bridge.png',
      label: function () { return tileLabel('glance-bridge-val', { en: 'Bridge', es: 'Puente' }); },
      val: function () { return cleanVal('glance-bridge-val'); },
      sub: function () { return tileSub('glance-bridge-val'); } },
    { id: 'tides', icon: 'img/icons/icon-river.png',
      label: function () { return tileLabel('glance-river-val', { en: 'Columbia River — Tides', es: 'Río Columbia — Mareas' }); },
      val: function () { return cleanVal('glance-river-val'); },
      sub: function () { return tileSub('glance-river-val'); } },
    { id: 'weather', icon: 'img/icons/icon-alert.png',
      label: function () { return tileLabel('glance-alerts-val', { en: 'Weather alerts', es: 'Alertas del tiempo' }); },
      val: function () { return cleanVal('glance-alerts-val'); },
      sub: function () { return tileSub('glance-alerts-val'); } },
    { id: 'events', icon: 'img/icons/icon-event-pin.png',
      label: function () { return tileLabel('glance-events-val', { en: 'Next event', es: 'Próximo evento' }); },
      val: function () { return cleanVal('glance-events-val'); },
      sub: function () { return tileSub('glance-events-val'); } },
    { id: 'ferry', icon: 'img/icons/icon-ferry.png',
      label: function () { return langCur === 'es' ? 'Próximo ferry' : 'Next ferry'; },
      val: function () {
        var fn = document.getElementById('ferry-next');
        var h = fn ? fn.querySelector('.ferry-next-head') : null;
        var v = h ? h.textContent.trim() : '';
        if (!v || /loading|working out|cargando/i.test(v)) return '';
        return v;
      },
      sub: function () { return 'Westport, OR ↔ Puget Island, WA'; } }
  ];
  var ANSWER_IDS = ANSWERS.map(function (a) { return a.id; });

  /* ----- pins: the GENERIC pin store -----
     The store itself moved OUT of this module in the v5 pass (it now
     lives above the pins module, earlier in this file, as
     window.CCLPins over localStorage 'ccl-pins-v1' — one object,
     { cards, answers }, shared with the Your-pins zone at the top of
     Today). This saver owns only the answers half; the shim below
     keeps the module's original local names wired to the one store. */
  var pinStore = window.CCLPins._store;
  var pins = pinStore.answers;   // the saver's live view of the answers half
  function savePins() { pinStore.answers = pins; window.CCLPins._save(); }
  function isPinned(id) { return pins.indexOf(id) !== -1; }
  function togglePin(id) {
    if (isPinned(id)) pins = pins.filter(function (x) { return x !== id; });
    else pins.push(id);
    savePins();
    paintPins();
    if (saverOpen) renderSaverAnswers();
  }

  /* pin chips in the screensaver card */
  function paintPins() {
    var wrap = document.getElementById('saver-pins');
    if (wrap) {
      wrap.innerHTML = ANSWERS.map(function (a) {
        var on = isPinned(a.id);
        return '<button type="button" class="saver-chip' + (on ? ' on' : '')
          + '" data-saver-chip="' + a.id + '" aria-pressed="' + (on ? 'true' : 'false') + '">'
          + '<img src="' + a.icon + '" alt="" aria-hidden="true">'
          + '<span>' + esc(a.label()) + '</span>'
          + '<span class="saver-chip-state">' + (on
            ? (langCur === 'es' ? '📌 Fijada' : '📌 Pinned')
            : (langCur === 'es' ? 'Fijar' : 'Pin')) + '</span></button>';
      }).join('');
    }
  }
  var chipsWrap = document.getElementById('saver-pins');
  if (chipsWrap) chipsWrap.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-saver-chip]');
    if (b) togglePin(b.getAttribute('data-saver-chip'));
  });

  /* v8: NO pin toggles on the glance strip items. The strip used to
     grow a small 📌 button inside each canonical tile (its marquee
     clones hid their copies); Travis, reviewing the preview on his
     phone, called the amber pin disc riding each scrolling item
     ugly and unnecessary. The buttons are gone — originals and
     clones alike carry only icon + label + value — and answer
     pinning lives solely in the chips above (the screensaver card
     on Events & More), writing the same store, feeding the same
     saver stream. */

  /* ----- the photo pool ----- */
  var pool = FALLBACK_POOL, poolIdx = 0, frontIsA = true, fadeToken = 0;
  function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function setCaption(p) {
    var credit = document.getElementById('saver-credit');
    if (credit) credit.innerHTML = p.credit
      ? '<span class="saver-credit-name">' + escHtml(p.credit) + '</span>' +
        (p.location ? '<span class="saver-credit-loc">' + escHtml(p.location) + '</span>' : '')
      : '';
    var q = QUIET[quietIdx % QUIET.length];
    var qEl = document.getElementById('saver-quiet');
    if (qEl) qEl.textContent = q ? q[langCur === 'es' ? 'es' : 'en'] : '';
  }
  function showPhoto(idx, instant) {
    if (!pool.length) return;
    /* a real advance (the 16-second tick) — and ONLY that — moves the
       quiet sponsor rotation to its next entry; opens, language flips
       and pool repaints are instant and keep the current entry */
    if (!instant) quietIdx++;
    poolIdx = ((idx % pool.length) + pool.length) % pool.length;
    var p = pool[poolIdx];
    var front = document.getElementById(frontIsA ? 'saver-photo-a' : 'saver-photo-b');
    var back = document.getElementById(frontIsA ? 'saver-photo-b' : 'saver-photo-a');
    fadeToken++;
    if (instant || !back) {
      if (front) { front.style.backgroundImage = 'url("' + p.src + '")'; front.classList.add('is-on'); }
      setCaption(p);
    } else {
      back.style.backgroundImage = 'url("' + p.src + '")';
      back.classList.add('is-on');
      front.classList.remove('is-on');
      frontIsA = !frontIsA;
      /* the credit names the photo you can SEE — it swaps when the
         fade lands, not when it starts */
      var tk = fadeToken;
      setTimeout(function () { if (tk === fadeToken && saverOpen) setCaption(p); }, 2900);
    }
    var next = new Image();
    next.src = pool[(poolIdx + 1) % pool.length].src;
  }
  fetch('data/community-photos.json').then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (d && Array.isArray(d.photos) && d.photos.length) {
        pool = d.photos.filter(function (p) { return p && p.src; });
        if (saverOpen) showPhoto(poolIdx, true);
      }
    }).catch(function () { /* the fallback pool carries the mode */ });

  /* ----- rendering ----- */
  function renderSaverClock() {
    var c = document.getElementById('saver-clock');
    var d = document.getElementById('saver-date');
    var now = new Date();
    var loc = langCur === 'es' ? 'es-US' : 'en-US';
    if (c) c.textContent = new Intl.DateTimeFormat(loc, {
      timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(now);
    if (d) d.textContent = new Intl.DateTimeFormat(loc, {
      timeZone: 'America/Los_Angeles', weekday: 'long', month: 'long', day: 'numeric' }).format(now);
  }
  /* v6: the pinned answers SCROLL — a slow, continuous right-to-left
     stream across the bottom of the display, built with the main
     glance strip's own technique (a max-content track holding two
     identical sets, animated transform-only to -50%). Same glass
     tiles, same across-the-room type. Exactly one pin — or a visitor
     who asked for reduced motion — gets a static centered row
     instead. The 5-second refresh patches values in place when the
     pin set is unchanged, so the stream never restarts under the
     reader; a changed pin set or language rebuilds it. */
  function saverTile(a) {
    var v = a.val();
    return '<div class="saver-answer">'
      + '<div class="saver-answer-label"><img src="' + a.icon + '" alt="" aria-hidden="true"> ' + esc(a.label()) + '</div>'
      + '<div class="saver-answer-val' + (v && v.length > 56 ? ' xlong' : v && v.length > 24 ? ' long' : '') + '">' + esc(v || '—') + '</div>'
      + (a.sub() ? '<div class="saver-answer-sub">' + esc(a.sub()) + '</div>' : '')
      + '</div>';
  }
  function patchSaverTile(tile, a) {
    var v = a.val();
    var valEl = tile.querySelector('.saver-answer-val');
    if (valEl) {
      valEl.textContent = v || '—';
      valEl.className = 'saver-answer-val' + (v && v.length > 56 ? ' xlong' : v && v.length > 24 ? ' long' : '');
    }
    var s = a.sub();
    var subEl = tile.querySelector('.saver-answer-sub');
    if (subEl && s) subEl.textContent = s;
    else if (subEl && !s) subEl.remove();
    else if (!subEl && s) {
      var d = document.createElement('div');
      d.className = 'saver-answer-sub';
      d.textContent = s;
      tile.appendChild(d);
    }
  }
  function renderSaverAnswers() {
    var wrap = document.getElementById('saver-answers');
    if (!wrap) return;
    var shown = ANSWERS.filter(function (a) { return isPinned(a.id); });
    if (!shown.length) {
      wrap.dataset.sig = '';
      wrap.classList.remove('scrolling');
      wrap.classList.add('is-static');
      wrap.innerHTML = '<div class="saver-answer saver-answer-none"><div class="saver-answer-val">'
        + (langCur === 'es' ? 'Sin respuestas fijadas' : 'No answers pinned') + '</div>'
        + '<div class="saver-answer-sub">'
        + (langCur === 'es' ? 'Fija las tuyas desde la pestaña Eventos y Más' : 'Pin yours from the Events &amp; More tab') + '</div></div>';
      return;
    }
    var sig = shown.map(function (a) { return a.id; }).join(',') + '|' + langCur;
    var reduced = false;
    try { reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* assume motion ok */ }
    if (shown.length < 2 || reduced) {
      if (wrap.dataset.sig === sig && wrap.classList.contains('is-static')) {
        var tiles = wrap.querySelectorAll('.saver-answer');
        shown.forEach(function (a, i) { if (tiles[i]) patchSaverTile(tiles[i], a); });
        return;
      }
      wrap.dataset.sig = sig;
      wrap.classList.remove('scrolling');
      wrap.classList.add('is-static');
      wrap.innerHTML = shown.map(saverTile).join('');
      return;
    }
    if (wrap.dataset.sig === sig && wrap.classList.contains('scrolling')) {
      var all = wrap.querySelectorAll('.saver-answer');
      all.forEach(function (tile, i) { patchSaverTile(tile, shown[i % shown.length]); });
      return;
    }
    wrap.dataset.sig = sig;
    wrap.classList.remove('is-static');
    wrap.classList.add('scrolling');
    var set = shown.map(saverTile).join('');
    /* v7: the tiles are parade-scale now (~41vw wide, 82vw on phones),
       so the loop is timed by TRACK WIDTH, not answer count — a constant
       ~25px/s drift, the same stately pace v6 had, at any screen size.
       (v6's flat 13s-per-answer would drag the wide tiles past at
       ~60px/s on a TV.) One set passing = setW / 25 seconds. */
    var vwSaver = window.innerWidth || 1200;
    var tileWSaver = vwSaver <= 640 ? vwSaver * 0.82 : Math.min(820, vwSaver * 0.41);
    var dur = Math.max(30, Math.round(shown.length * (tileWSaver + 20) / 25));
    wrap.innerHTML = '<div class="saver-scroll-viewport"><div class="saver-scroll-track" style="animation-duration:' + dur + 's">'
      + '<div class="saver-scroll-set">' + set + '</div>'
      + '<div class="saver-scroll-set" aria-hidden="true">' + set + '</div>'
      + '</div></div>';
  }

  /* ----- open / close: unattended, gestureless-tolerant ----- */
  var saverOpen = false, saverTimer = null, saverWake = null;
  var shownAt = 0, tickCount = 0;
  function saverTick() {
    if (!saverOpen) return;
    renderSaverClock();
    tickCount++;
    if (typeof document !== 'undefined' && document.hidden) { shownAt = Date.now(); return; }
    if (tickCount % 5 === 0) renderSaverAnswers();          // answers re-read every 5s
    if (Date.now() - shownAt >= PHOTO_MS) { shownAt = Date.now(); showPhoto(poolIdx + 1, false); }
  }
  function openSaver() {
    if (saverOpen) return;
    saverOpen = true;
    overlay.hidden = false;
    document.body.classList.add('saver-on');
    shownAt = Date.now(); tickCount = 0;
    renderSaverClock();
    renderSaverAnswers();
    showPhoto(poolIdx, true);
    saverTimer = setInterval(saverTick, 1000);
    var hint = document.getElementById('saver-exit-hint');
    if (hint) {
      hint.classList.remove('dim');
      setTimeout(function () { if (saverOpen) hint.classList.add('dim'); }, 5000);
    }
    try {
      var de = document.documentElement;
      if (de && de.requestFullscreen) { var pr = de.requestFullscreen(); if (pr && pr.catch) pr.catch(function () {}); }
    } catch (e) { /* fullscreen is a nicety, never a requirement — and without a gesture (a ?display=1 TV bookmark) the browser may simply decline */ }
    try {
      if (navigator.wakeLock && navigator.wakeLock.request) {
        navigator.wakeLock.request('screen').then(function (w) {
          if (saverOpen) saverWake = w;
          else if (w && w.release) w.release();
        }).catch(function () {});
      }
    } catch (e) { /* the saver runs fine without a wake lock */ }
  }
  function closeSaver() {
    if (!saverOpen) return;
    saverOpen = false;
    if (saverTimer) { clearInterval(saverTimer); saverTimer = null; }
    overlay.hidden = true;
    document.body.classList.remove('saver-on');
    try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); } catch (e) {}
    try { if (saverWake && saverWake.release) saverWake.release(); } catch (e) {}
    saverWake = null;
  }
  ['saver-btn', 'saver-start-btn'].forEach(function (id) {
    var b = document.getElementById(id);
    if (b) b.addEventListener('click', openSaver);
  });
  var exitBtn = document.getElementById('saver-exit');
  if (exitBtn) exitBtn.addEventListener('click', function (ev) {
    if (ev && ev.stopPropagation) ev.stopPropagation();
    closeSaver();
  });
  overlay.addEventListener('click', function () { if (saverOpen) closeSaver(); });
  document.addEventListener('keydown', function (ev) {
    if (!saverOpen) return;
    var t = ev.target;
    if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName || '')) return;
    closeSaver();
  });

  /* v57: the photo block is two plain links now (the mailto button +
     the quick form) — the on-page gate that watched the old fake
     form's fields is gone with the form itself. Submissions still
     pass the human review gate before joining the pool. */

  /* another writer (the Your-pins zone) can change the shared store —
     keep this module's view of the answers half in sync, and expose
     the opener for the drawer's screensaver entry */
  document.addEventListener('ccl-pins-changed', function () {
    pins = pinStore.answers;
    paintPins();
    if (saverOpen) renderSaverAnswers();
  });
  window.CCLOpenSaver = openSaver;

  paintPins();

  /* language flips re-render the saver's own chrome (same wrap pattern
     as the schools board and the tide glance) */
  var langSetSaverPrev = langSet;
  langSet = function (lang) {
    langSetSaverPrev(lang);
    paintPins();
    if (saverOpen) { renderSaverClock(); renderSaverAnswers(); showPhoto(poolIdx, true); }
  };

  /* a TV / office screen can bookmark straight into the mode */
  try {
    if (new URLSearchParams(window.location.search).get('display') === '1') {
      setTimeout(openSaver, 350);
    }
  } catch (e) { /* no query string — the buttons still work */ }
})();

/* ============================================================
   LOCAL SERVICES DIRECTORY — category filter (micro-business
   tier, business plan §6 addendum, 2026-11-05). The rows are
   static HTML in Events & More; this only shows/hides them.
   Empty categories get a per-category honest empty state
   (EN/ES, re-rendered on the language toggle via the same
   langSet wrap the saver module uses). No data is fetched and
   no listing is ever created here — listings arrive by hand
   after the request-form review, like sponsors.
   ============================================================ */
(function () {
  var wrap = document.getElementById('dir-filters');
  var list = document.getElementById('dir-list');
  var emptyEl = document.getElementById('dir-empty');
  if (!wrap || !list || !emptyEl) return;

  var EMPTY = {
    childcare: {
      en: 'No child care listings yet — the first sitter, nanny or family daycare to join is listed free.',
      es: 'Aún no hay anuncios de cuidado infantil — la primera niñera o guardería familiar que se sume aparece gratis.'
    },
    cleaning: {
      en: 'No cleaners listed yet. Make houses shine anywhere in this county? This is your spot — free.',
      es: 'Aún no hay servicios de limpieza. ¿Dejas las casas brillando en este condado? Este es tu lugar — gratis.'
    },
    handyman: {
      en: 'No handymen or repair folks yet — the first listing here is free.',
      es: 'Aún no hay manitas ni reparadores — el primer anuncio aquí es gratis.'
    },
    pets: {
      en: 'No pet sitters or groomers yet. Walk dogs or board cats around here? Claim the first spot — free.',
      es: 'Aún no hay cuidadores de mascotas. ¿Paseas perros o cuidas gatos por aquí? Reclama el primer lugar — gratis.'
    },
    yard: {
      en: 'No yard & garden listings yet — mowing, pruning, brush hauling. First one in is free.',
      es: 'Aún no hay anuncios de patio y jardín — cortar el césped, podar, retirar ramas. El primero entra gratis.'
    },
    tutoring: {
      en: 'No tutors listed yet. Math help, reading help, test prep — the first listing is free.',
      es: 'Aún no hay tutores. Ayuda con matemáticas, lectura, preparación de exámenes — el primer anuncio es gratis.'
    },
    moving: {
      en: 'No movers or haulers yet. Got a truck and a strong back? Be the first — free.',
      es: 'Aún no hay mudanzas ni fletes. ¿Tienes una camioneta y una espalda fuerte? Sé el primero — gratis.'
    },
    other: {
      en: 'Nothing else here yet — listings are free.',
      es: 'Nada más por aquí todavía — los anuncios son gratis.'
    },
    freehelp: {
      en: 'No free-help listings yet — churches with free food nights, free support services, neighbours helping neighbours. Know one? Add it with the form above — it is free, like everything on this shelf.',
      es: 'Aún no hay anuncios de ayuda gratuita — iglesias con cenas gratuitas, servicios de apoyo sin costo, vecinos ayudando a vecinos. ¿Conoces uno? Agrégalo con el formulario de arriba — es gratis, como todo en este estante.'
    }
  };

  var cur = 'all';
  function renderDir() {
    var shown = 0;
    list.querySelectorAll('.dir-item').forEach(function (item) {
      var cat = item.getAttribute('data-dircat');
      var show = cur === 'all' || cat === cur;
      item.hidden = !show;
      if (show) shown++;
    });
    if (shown === 0 && EMPTY[cur]) {
      emptyEl.textContent = EMPTY[cur][langCur === 'es' ? 'es' : 'en'];
      emptyEl.hidden = false;
    } else {
      emptyEl.hidden = true;
    }
  }

  wrap.querySelectorAll('.dir-chip').forEach(function (btn) {
    btn.addEventListener('click', function () {
      wrap.querySelectorAll('.dir-chip').forEach(function (x) {
        x.classList.remove('active');
        x.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      cur = btn.getAttribute('data-dirfilter') || 'all';
      renderDir();
    });
  });

  renderDir();

  /* language flips re-render the JS-owned empty state (same wrap
     pattern as the schools board, the tide glance and the saver) */
  var langSetDirPrev = langSet;
  langSet = function (lang) {
    langSetDirPrev(lang);
    renderDir();
  };
})();

/* ---------- v55: founding house cells live in the flow ----------
   The v6 phone mover is retired: the founding panel is now the three
   sponsor spots themselves, and its two old house cells — County
   Watch and the nonprofit notice — are static residents of Today's
   flow at every width, sitting exactly where the mover used to carry
   them on phones (County Watch just before Tonight & Tomorrow, the
   nonprofit notice just before the County Briefing), carrying the
   .in-flow styling permanently. Moved in the HTML, never duplicated,
   ids and links unchanged. */

/* ---------- your commute: typical drive times (v9, 2026-11-05) ----------
   Travis's last pre-ship addition: one card at the top of Travel —
   right above the roads card and its My Route strip — answering
   "how long's the drive?" for a pickable county town → a pickable
   destination. St. Helens → St. Johns is the default pair, the one
   he named. Routing is the free OSRM public service, fetched live
   by the page itself (keyless, no fetcher involvement).
   HONESTY (binding): OSRM drives the route at posted speeds in
   free-flow conditions — the number is a TYPICAL drive, never a
   live-traffic reading, and the card says so in both languages
   ("Typical drive — no live traffic" / "Tiempo típico — sin
   tráfico en vivo") directly under the answer.
   Picks persist in localStorage ccl-commute-v1, and the last good
   result per town pair is cached in the same store: a failed fetch
   shows the cached reading with its own checked time instead of an
   error, and only a pair with no cache at all shows the plain
   couldn't-load line. Recomputed when the picks change, when the
   Travel view opens (skipping a fetch whose cache is under five
   minutes old), and once at load so a pinned copy on Today is
   never stuck on the loading line. */
(function () {
  var DRIVE_KEY = 'ccl-commute-v1';
  var FROM = [
    { name: 'St. Helens', lat: 45.8597, lon: -122.8390 },
    { name: 'Scappoose', lat: 45.7407, lon: -122.8776 },
    { name: 'Columbia City', lat: 45.8901, lon: -122.8110 },
    { name: 'Rainier', lat: 46.0896, lon: -122.9367 },
    { name: 'Clatskanie', lat: 46.1033, lon: -123.2043 },
    { name: 'Vernonia', lat: 45.8595, lon: -123.1901 }
  ];
  var TO = [
    { name: 'St. Johns', es: 'St. Johns', lat: 45.5899, lon: -122.7543 },
    { name: 'Downtown Portland', es: 'Centro de Portland', lat: 45.5152, lon: -122.6784 },
    { name: 'Longview', es: 'Longview', lat: 46.1386, lon: -122.9544 }
  ];
  var TXT = {
    en: { checking: 'Working out the drive…', checked: 'Checked', via: 'via', min: 'min', hr: 'hr', fail: "Couldn't load the drive time — try again in a bit" },
    es: { checking: 'Calculando el viaje…', checked: 'Consultado', via: 'por', min: 'min', hr: 'h', fail: 'No se pudo cargar el tiempo de manejo — inténtalo de nuevo en un rato' }
  };
  var store = { from: 'St. Helens', to: 'St. Johns', cache: {} };
  try {
    var saved = JSON.parse(window.localStorage.getItem(DRIVE_KEY) || 'null');
    if (saved) {
      if (FROM.some(function (t) { return t.name === saved.from; })) store.from = saved.from;
      if (TO.some(function (t) { return t.name === saved.to; })) store.to = saved.to;
      if (saved.cache && typeof saved.cache === 'object') store.cache = saved.cache;
    }
  } catch (e) { /* storage blocked — the defaults still apply */ }
  function save() { try { window.localStorage.setItem(DRIVE_KEY, JSON.stringify(store)); } catch (e) { /* non-fatal */ } }
  function pairKey() { return store.from + '>' + store.to; }
  function T() { return TXT[langCur === 'es' ? 'es' : 'en']; }
  function escTxt(s) { return (typeof esc === 'function') ? esc(s) : s; }

  var lastState = { kind: 'checking', entry: null };
  var fetching = false;

  function fmtDur(sec) {
    var mins = Math.max(1, Math.round(sec / 60));
    if (mins < 60) return '≈ ' + mins + ' ' + T().min;
    var h = Math.floor(mins / 60), r = mins % 60;
    return '≈ ' + h + ' ' + T().hr + (r ? ' ' + r + ' ' + T().min : '');
  }
  function fmtMi(m) {
    var mi = m / 1609.344;
    return (mi >= 10 ? String(Math.round(mi)) : mi.toFixed(1)) + ' mi';
  }
  function fmtAt(at) {
    try { return new Date(at).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return ''; }
  }
  function renderChips() {
    var fb = document.getElementById('drive-from-chips');
    var tb = document.getElementById('drive-to-chips');
    if (fb) {
      fb.innerHTML = FROM.map(function (t) {
        return '<button class="drive-chip' + (t.name === store.from ? ' active' : '') + '" type="button" data-drive-from="' + t.name + '" aria-pressed="' + (t.name === store.from) + '">' + t.name + '</button>';
      }).join('');
      fb.querySelectorAll('[data-drive-from]').forEach(function (b) {
        b.addEventListener('click', function () {
          var v = b.getAttribute('data-drive-from');
          if (store.from === v) return;
          store.from = v; save(); renderChips(); refresh(true);
        });
      });
    }
    if (tb) {
      tb.innerHTML = TO.map(function (t) {
        var label = langCur === 'es' ? t.es : t.name;
        return '<button class="drive-chip' + (t.name === store.to ? ' active' : '') + '" type="button" data-drive-to="' + t.name + '" aria-pressed="' + (t.name === store.to) + '">' + label + '</button>';
      }).join('');
      tb.querySelectorAll('[data-drive-to]').forEach(function (b) {
        b.addEventListener('click', function () {
          var v = b.getAttribute('data-drive-to');
          if (store.to === v) return;
          store.to = v; save(); renderChips(); refresh(true);
        });
      });
    }
  }
  function renderBody() {
    var body = document.getElementById('drive-body');
    if (!body) return;
    if (lastState.kind === 'ok' && lastState.entry) {
      var e = lastState.entry;
      var sub = fmtMi(e.m) + (e.via ? ' · ' + T().via + ' ' + escTxt(e.via) : '');
      body.innerHTML = '<div class="drive-big">' + fmtDur(e.sec) + '</div>'
        + '<div class="drive-sub">' + sub + '</div>'
        + '<div class="drive-checked">' + T().checked + ' ' + fmtAt(e.at) + '</div>';
    } else if (lastState.kind === 'fail') {
      body.innerHTML = '<p class="drive-fail">' + T().fail + '</p>';
    } else {
      body.innerHTML = '<p class="loading">' + T().checking + '</p>';
    }
  }
  function refresh(force) {
    var key = pairKey();
    var hit = store.cache[key];
    if (!force && hit && (Date.now() - hit.at) < 5 * 60 * 1000) {
      lastState = { kind: 'ok', entry: hit }; renderBody(); return;
    }
    if (hit) { lastState = { kind: 'ok', entry: hit }; renderBody(); }
    else if (lastState.kind !== 'ok') { lastState = { kind: 'checking', entry: null }; renderBody(); }
    if (fetching) return;
    var f = FROM.filter(function (t) { return t.name === store.from; })[0] || FROM[0];
    var t = TO.filter(function (x) { return x.name === store.to; })[0] || TO[0];
    fetching = true;
    var url = 'https://router.project-osrm.org/route/v1/driving/' + f.lon + ',' + f.lat + ';' + t.lon + ',' + t.lat + '?overview=false&steps=true';
    fetch(url).then(function (r) { return r.json(); }).then(function (d) {
      fetching = false;
      var rt = d && d.routes && d.routes[0];
      if (!rt || typeof rt.duration !== 'number') throw new Error('no route');
      var summary = (rt.legs && rt.legs[0] && rt.legs[0].summary) || '';
      var entry = { sec: rt.duration, m: rt.distance, via: summary.split(',')[0].trim(), at: Date.now() };
      store.cache[key] = entry; save();
      if (pairKey() === key) { lastState = { kind: 'ok', entry: entry }; renderBody(); }
      else refresh(true); // the picks moved mid-flight — chase the new pair
    }).catch(function () {
      fetching = false;
      if (pairKey() !== key) { refresh(true); return; }
      var c = store.cache[key];
      if (c) lastState = { kind: 'ok', entry: c };
      else lastState = { kind: 'fail', entry: null };
      renderBody();
    });
  }

  renderChips();
  refresh(false);
  /* Recompute when the Travel view opens (same wrap discipline as
     the langSet wraps: the original function runs first, untouched). */
  if (typeof cclShowView === 'function') {
    var prevShow = cclShowView;
    cclShowView = function (name) { prevShow(name); if (name === 'travel') refresh(false); };
  }
  if (typeof langSet === 'function') {
    var prevLang = langSet;
    langSet = function (lang) { prevLang(lang); renderChips(); renderBody(); };
  }
})();

/* ============================================================
   v45 — LOCAL SERVICES DIRECTORY MAP (2026-11-08).
   A small Leaflet map inside the services card: one pin per
   listed business, read from the dir-item articles themselves
   (data-lat / data-lng in the markup — no data file; listings
   are added by hand after review, like sponsors). Built lazily
   the first time the Events & More view opens (the card lives
   in a hidden view; Leaflet needs a sized container), kept in
   step with the category filter by watching the rows' hidden
   state. Tapping a pin names the business and flashes its row.
   ============================================================ */
(function () {
  var el = document.getElementById('dir-map');
  if (!el) return;
  var map = null;
  function rows() {
    return Array.prototype.slice.call(
      document.querySelectorAll('#dir-list .dir-item[data-lat][data-lng]'));
  }
  function pinIcon() {
    return L.divIcon({
      className: 'dir-pin',
      html: '<span class="dir-pin-dot"></span>',
      iconSize: [22, 22], iconAnchor: [11, 11]
    });
  }
  function bizName(item) {
    var h = item.querySelector('h3');
    if (!h) return 'Local business';
    var c = h.cloneNode(true);
    var badge = c.querySelector('.dir-badge');
    if (badge) badge.remove();
    return c.textContent.trim();
  }
  function syncPins() {
    if (!map) return;
    rows().forEach(function (item) {
      var m = item._dirMarker;
      if (!m) return;
      if (item.hidden) { if (map.hasLayer(m)) map.removeLayer(m); }
      else if (!map.hasLayer(m)) m.addTo(map);
    });
  }
  function build() {
    if (map || typeof L === 'undefined') return;
    map = L.map('dir-map', { scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 18
    }).addTo(map);
    var pts = [];
    rows().forEach(function (item) {
      var lat = parseFloat(item.getAttribute('data-lat'));
      var lng = parseFloat(item.getAttribute('data-lng'));
      if (!isFinite(lat) || !isFinite(lng)) return;
      var metaEl = item.querySelector('.dir-meta');
      var m = L.marker([lat, lng], { icon: pinIcon() }).addTo(map);
      m.bindPopup('<div class="dirpop"><div class="dirpop-name">' +
        bizName(item) + '</div>' +
        (metaEl ? '<div class="dirpop-meta">' + metaEl.textContent.trim() + '</div>' : '') +
        '</div>');
      m.on('click', function () {
        try { item.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* older browser */ }
        item.classList.remove('dir-flash');
        void item.offsetWidth;
        item.classList.add('dir-flash');
      });
      item._dirMarker = m;
      pts.push([lat, lng]);
    });
    if (pts.length === 1) map.setView(pts[0], 14);
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.15));
    else map.setView([46.02, -122.98], 10);
    syncPins();
    setTimeout(function () { try { map.invalidateSize(); } catch (e) {} }, 250);
  }
  if (window.MutationObserver) {
    var mo = new MutationObserver(syncPins);
    rows().forEach(function (item) {
      mo.observe(item, { attributes: true, attributeFilter: ['hidden'] });
    });
  }
  if (typeof cclShowView === 'function') {
    var prevShow = cclShowView;
    cclShowView = function (name) {
      prevShow(name);
      if (name === 'more') {
        setTimeout(function () {
          build();
          if (map) { try { map.invalidateSize(); } catch (e) {} }
        }, 60);
      }
    };
  }
  if (typeof cclViewCur !== 'undefined' && cclViewCur === 'more') {
    setTimeout(build, 400);
  }
})();
