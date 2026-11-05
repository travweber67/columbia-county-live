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
const ADSBFI_URL = 'https://opendata.adsb.fi/api/v2/lat/46.0/lon/-123.06/dist/45';
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
  L.control.layers(null, {
    '🌧️ Weather radar (NOAA)': radarLayer,
    '✈️ Aircraft (ADS-B)': aircraftLayer,
    '🚢 Ships (AIS)': shipLayer,
    '🐟 Salmon heat (estimate)': salmonLayer,
    '🔥 Wildfire perimeters': fireLayer,
    '🛰️ Space station (ISS)': issLayer,
    '🫨 Earthquakes': quakeLayer
  }, { collapsed: false }).addTo(map);
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
  document.querySelectorAll('.town-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.town === town.name));
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

/* ---------- sky: aircraft (direct ADS-B, snapshot fallback) + ISS ---------- */
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
      wrap.querySelectorAll('.sky-filter-btn').forEach(x =>
        x.classList.toggle('active', x === b));
      renderSkyList();
    });
  });
}
async function loadAircraft() {
  // Preferred: straight from adsb.fi (works the day their CORS opens up).
  try {
    const d = await getJSON(ADSBFI_URL);
    const raw = d.aircraft || d.ac || [];
    const list = raw.filter(a => inBox(a.lat, a.lon)).map(a => ({
      hex: a.hex, callsign: String(a.flight || a.r || '').trim(), type: a.t || '',
      alt_ft: a.alt_baro, gs_kn: a.gs, track: a.track, lat: a.lat, lon: a.lon
    }));
    renderAircraft(list, 'live ADS-B');
    setUpdated('sky-updated');
    return;
  } catch (e) { /* CORS-blocked today — snapshot below is the normal path */ }
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
    const cams = (area.cameras || []).length
      ? '<div class="route-strip">' + area.cameras.map(c =>
          '<figure class="camera-fig">'
          + (c.image_url ? '<img loading="lazy" src="' + src(c.image_url) + '" alt="Pass camera: ' + esc(c.name) + '" onerror="this.parentNode.classList.add(\'cam-dead\');this.remove();">' : '')
          + '<figcaption>' + esc(c.name) + '</figcaption></figure>').join('') + '</div>'
      : '';
    return '<div class="bend-area"><h3 class="subhead">' + esc(area.name) + '</h3>' + wx
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
      + ', averaging about ' + num(Math.round(d.trend.avg3))
      + ' a day lately and ' + d.trend.word + '.';
    if (d.timing && d.timing.pct_past_typical >= 90) {
      clause += ' It is late in the run, though — in a typical year ~'
        + d.timing.pct_past_typical + '% has passed Bonneville by now.';
    }
  } else if (d) {
    clause = 'the counters are seeing very little now — the latest '
      + d.label + ' day was ' + num(d.trend.latest) + ' at Bonneville on '
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
  return '<details class="why-box"><summary>Why this call? — the counts'
    + ' behind it</summary><p>' + parts.join(' ') + '</p></details>';
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
  let ticks = '';
  FISH_TOWNS.forEach((t, i) => {
    ticks += '<div class="track-tick' + (i % 2 ? ' alt' : '')
      + '" style="left:' + pct(t.rm) + '"><span>' + esc(t.name) + ' · '
      + t.rm + '</span></div>';
  });
  [['Bonneville Dam', 146], ['The Dalles', 192], ['John Day', 216]]
    .forEach(([n, rm], i) => {
      ticks += '<div class="track-tick track-dam' + (i % 2 ? ' alt' : '')
        + (rm >= 216 ? ' edge-r' : '')
        + '" style="left:' + pct(rm) + '"><span>' + n + ' · ' + rm
        + '</span></div>';
    });
  ticks += '<div class="track-tick track-mouth edge-l" style="left:0">'
    + '<span>Ocean</span></div>';
  return '<div class="heat-wrap"><div class="heat-county" style="left:'
    + pct(44) + ';width:' + pct(100 - 44) + '"></div>'
    + '<div class="heat-row">' + bins + '</div>'
    + '<div class="heat-labels">' + ticks + '</div></div>'
    + '<p class="heat-legend"><span class="lg" style="background:#c2540a">'
    + '</span> hot — fish likely here now'
    + ' <span class="lg" style="background:#f5b74d"></span> some fish around'
    + ' <span class="lg" style="background:#fdeeda"></span> a few'
    + ' <span class="lg" style="background:#dde3ea"></span> no signal'
    + ' from the counts</p>'
    + '<p class="track-caption">Estimated fish likelihood today, by'
    + ' river mile — the dashed stretch is Columbia County (about RM'
    + ' 44–100). Deeper color = stronger signal from the dam counts;'
    + ' gray means the counts say nothing there, not that the water is'
    + ' empty.</p>';
}
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
function trackerBasis(fish) {
  const m = fish.model || {};
  if (!m.basis) return '';
  return '<p class="card-note small">How these estimates are made: a'
    + ' “wave” is a day whose Bonneville count is at least twice the'
    + ' median of the 14 days before it, and at least 100 fish. '
    + esc(m.basis) + ' Positions are bands, never points — a real'
    + ' school spreads over miles and days.</p>';
}

/* ----- the day plan: fish the current -----
   Travis's correction, treated as ground truth: there is no single
   "best tide." Strong current is plunking/anchor water — a Spin-N-Glo
   or wobbler only works when the river pushes it. When the current
   dies, the play switches to trolling. So the card reads one day as a
   sequence and lets the recommended method switch along it.
   Data route (researched 2026-11-04): NOAA CO-OPS publishes real tidal
   CURRENT predictions, but only two stations serve the county reach —
   PCT1251 Walker Island (~RM 64) and PCT1231 Cathlamet Channel
   (~RM 38). Nothing serves St. Helens or above, so Walker Island is
   the reference and the card says so. If CO-OPS doesn't answer, the
   plan falls back to an estimate synthesized from the St. Helens tide
   curve the tides card already loads — and says that instead. */
const CURRENT_STATION = { id: 'PCT1251',
  label: 'Walker Island, below Rainier (river mile ~64)' };
const METHOD_KEY = 'ccl-fish-method-v1';
let fishMethod = null;
try { fishMethod = window.localStorage.getItem(METHOD_KEY) || null; }
catch (e) { /* private mode: session-only */ }
if (['plunk', 'troll', 'anchor'].indexOf(fishMethod) < 0) fishMethod = null;
let currentEvents = null; // [{t: epoch ms, vel: knots, + flood / - ebb}]
let currentMode = null;   // 'noaa' | 'tidecurve'
const METHOD_META = {
  plunk: { name: 'Plunking', short: 'Plunk' },
  troll: { name: 'Trolling', short: 'Troll' },
  anchor: { name: 'On anchor', short: 'Anchor' }
};
function currentsUrl() {
  const parts = todayStrPT().split('-').map(Number);
  const base = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  return 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter'
    + '?begin_date=' + tideYmd(base - DAY_MS)
    + '&end_date=' + tideYmd(base + 3 * DAY_MS)
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
function dayPlanSegments(dayStr) {
  const blocks = [];
  for (let mins = 300; mins < 1200; mins += 30) {
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    const t = tideInstant(dayStr + ' ' + hh + ':' + mm);
    blocks.push({ start: t, end: t + 30 * 60000,
      v: interpVel(currentEvents, t + 15 * 60000) });
  }
  let strongSeen = 0;
  const segs = [];
  blocks.forEach(b => {
    const a = Math.abs(b.v);
    let method, cls;
    if (a >= 0.55) {
      cls = 'strong';
      if (b.v < 0) { method = strongSeen === 0 ? 'plunk' : 'anchor'; strongSeen++; }
      else method = 'anchor';
    } else if (a >= 0.28) {
      cls = 'moderate';
      method = b.v < 0 ? 'anchor' : 'troll';
    } else { cls = 'weak'; method = 'troll'; }
    const last = segs[segs.length - 1];
    if (last && last.method === method && last.cls === cls) {
      last.end = b.end;
      last.peak = Math.max(last.peak, a);
    } else {
      segs.push({ start: b.start, end: b.end, method, cls,
        peak: a, ebb: b.v < 0 });
    }
  });
  return segs;
}
function segWhy(seg, followsStrong) {
  const kn = seg.peak.toFixed(1);
  if (seg.method === 'plunk') {
    return 'The outgoing current is strong (about ' + kn
      + ' kn at Walker Island) — a Spin-N-Glo or bait on the bottom'
      + ' only works when the river pushes it.';
  }
  if (seg.method === 'anchor') {
    if (seg.cls !== 'strong') {
      return 'Steady current (about ' + kn + ' kn) — enough push to'
        + ' work a wobbler without fighting the river.';
    }
    return (followsStrong
        ? 'The current stays strong (about ' + kn + ' kn)'
        : 'The current is up again (about ' + kn + ' kn)')
      + ' — steady push for a wobbler or a wrapped plug.';
  }
  return seg.cls === 'weak'
    ? 'The current goes slack (under 0.3 kn) — plunking and wobblers'
      + ' die here; troll a herring or a 360 flasher through it.'
    : 'The incoming tide slows the river — classic trolling water for'
      + ' herring or a flasher and Super Bait.';
}
function fmtRange(a, b) {
  return fmtTime(new Date(a)) + '–' + fmtTime(new Date(b));
}
function renderDayPlan() {
  const body = $('dayplan-body');
  if (!body) return;
  if (!currentEvents) {
    body.innerHTML = '<p class="status-note">🌊 The current predictions'
      + ' didn\'t load — no day plan right now. The tide card above'
      + ' still shows the turns, and slack water is dead time for'
      + ' plunking and wobblers either way.</p>';
    return;
  }
  const chips = ['plunk', 'troll', 'anchor'].map(m =>
    '<button type="button" class="plan-chip'
    + (fishMethod === m ? ' active' : '') + '" data-method="' + m + '">'
    + METHOD_META[m].name + '</button>').join('');
  const segs = dayPlanSegments(ptDayStr(0));
  const strip = '<div class="plan-strip">' + segs.map(s =>
    '<div class="plan-seg seg-' + s.cls
    + (fishMethod && fishMethod !== s.method ? ' dim' : '')
    + (fishMethod === s.method ? ' mine' : '')
    + '" style="flex-grow:' + Math.round((s.end - s.start) / 60000)
    + '"><span>' + METHOD_META[s.method].short + '</span></div>'
  ).join('') + '</div>';
  const hours = '<div class="plan-hours"><span>5 AM</span><span>8 AM</span>'
    + '<span>11 AM</span><span>2 PM</span><span>5 PM</span>'
    + '<span>8 PM</span></div>';
  let callout;
  if (fishMethod) {
    const mine = segs.filter(s => s.method === fishMethod);
    callout = mine.length
      ? '<p class="plan-callout">🎣 Your method — <strong>'
        + METHOD_META[fishMethod].name + '</strong>: your windows today'
        + ' are ' + mine.map(s => fmtRange(s.start, s.end)).join(' and ')
        + '.</p>'
      : '<p class="plan-callout">🎣 Your method — <strong>'
        + METHOD_META[fishMethod].name + '</strong> has no prime window'
        + ' in today\'s plan; the strip shows what the current favors'
        + ' instead.</p>';
  } else {
    callout = '<p class="plan-callout">Tap your method and the plan'
      + ' calls out your windows — and remembers for next time.</p>';
  }
  const now = Date.now();
  const cur = segs.find(s => now >= s.start && now < s.end);
  const nowLine = cur
    ? '<p class="plan-now">Right now it\'s <strong>'
      + METHOD_META[cur.method].name.toLowerCase()
      + '</strong> water.</p>' : '';
  const list = '<ul class="plan-list">' + segs.map((s, i) =>
    '<li><strong>' + fmtRange(s.start, s.end) + ' — '
    + METHOD_META[s.method].name + '.</strong> '
    + segWhy(s, i > 0 && segs[i - 1].cls === 'strong') + '</li>'
  ).join('') + '</ul>';
  const tmRaw = dayPlanSegments(ptDayStr(1));
  const tm = [];
  tmRaw.forEach(s => {
    const last = tm[tm.length - 1];
    if (last && last.method === s.method) last.end = s.end;
    else tm.push({ method: s.method, start: s.start, end: s.end });
  });
  const tmLine = '<p class="plan-tomorrow"><strong>Tomorrow:</strong> '
    + tm.map(s => METHOD_META[s.method].short + ' '
      + fmtRange(s.start, s.end)).join(' · ') + '</p>';
  const src = currentMode === 'noaa'
    ? 'Current predictions: NOAA Tides &amp; Currents for '
      + CURRENT_STATION.label + ' — the county\'s lower-river'
      + ' reference; no current station serves St. Helens. Upriver the'
      + ' same pattern runs weaker and a bit later, so read this as'
      + ' the shape of the day, not a stopwatch.'
    : 'NOAA\'s current station didn\'t answer, so this plan is'
      + ' estimated from the St. Helens tide curve — strongest push'
      + ' mid-ebb, slack near the turns. Treat the times as'
      + ' approximate.';
  body.innerHTML = '<div class="plan-chips">' + chips + '</div>' + callout
    + strip + hours + nowLine + list + tmLine
    + '<p class="card-note small">' + src + '</p>';
  body.querySelectorAll('[data-method]').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = btn.dataset.method;
      fishMethod = fishMethod === m ? null : m;
      try {
        if (fishMethod) {
          window.localStorage.setItem(METHOD_KEY, fishMethod);
        } else window.localStorage.removeItem(METHOD_KEY);
      } catch (e) { /* private mode: session-only */ }
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
      + waveList(fish, slow, fast) + '</details>'
      + trackerBasis(fish);
    renderSalmonLayer(heat);
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
        + '<span class="event-src">' + esc(ev.source || '') + '</span></div>';
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
  body.innerHTML = html;
}
function initEventFilters() {
  const wrap = $('event-filters');
  if (!wrap) return;
  wrap.querySelectorAll('.event-filter-btn').forEach(b => {
    b.addEventListener('click', () => {
      currentEventFilter = b.dataset.filter;
      wrap.querySelectorAll('.event-filter-btn').forEach(x =>
        x.classList.toggle('active', x === b));
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
    renderEvents();
  } catch (e) {
    body.innerHTML = '<p class="fallback">⚠️ Events snapshot unavailable right now.</p>';
  }
}

/* ---------- at a glance (synthesis strip) ---------- */
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
      $('glance-river-val').textContent = num(h, 2) + ' ft' + arrow;
    }
  } catch (e) { /* keep placeholder */ }
  // Next event tile — from the events snapshot
  try {
    const snap = await getSnapshot('events.json');
    const today = todayStrPT();
    const evs = (snap.events || []).filter(ev => ev.date >= today).slice().sort((a, b) =>
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
  ['Fetcher — fish counts & salmon tracker (FPC / DART)', 'fish-updated', 'snapshot']
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
  let ready = 0;
  // Weather alerts — from the alerts panel's own rendered state
  const ab = $('alerts-body');
  if (ab) {
    if (ab.querySelector('.no-alerts')) {
      lines.push('⚠️ Weather: no active watches, warnings, or advisories for Columbia County.');
      ready++;
    } else {
      const heads = ab.querySelectorAll('.alert-item h3');
      if (heads.length) {
        lines.push('⚠️ WEATHER ALERTS IN EFFECT:');
        heads.forEach(h => lines.push('• ' + briefingClean(h.textContent)));
        ready++;
      } else if (ab.querySelector('.fallback')) {
        lines.push('⚠️ Weather alerts couldn\'t load just now — check weather.gov before heading out.');
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
      ready++;
    }
  }
  // Commute verdict — the headline sentence from the roads card
  const cv = $('commute-verdict');
  if (cv) {
    const head = cv.querySelector('.cv-head');
    if (head && !briefingPending(head.textContent)) {
      lines.push('🚗 Commute: ' + briefingClean(head.textContent));
      ready++;
    }
  }
  // Bridge + river — the same glance tiles at the top of the page
  const bv = briefingClean(($('glance-bridge-val') || {}).textContent);
  if (bv && !briefingPending(bv)) { lines.push('🌉 Lewis & Clark Bridge: ' + bv + '.'); ready++; }
  const rv = briefingClean(($('glance-river-val') || {}).textContent);
  if (rv && !briefingPending(rv)) { lines.push('🌊 Columbia River at Port Westward: ' + rv + '.'); ready++; }
  // Ferry — the next-boat headline the ferry card is showing
  const fn = $('ferry-next');
  if (fn) {
    const head = fn.querySelector('.ferry-next-head');
    if (head && !briefingPending(head.textContent)) {
      lines.push('⛴️ ' + briefingClean(head.textContent));
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
      todays.slice(0, 4).forEach(ev => lines.push('• ' + (ev.time ? ev.time + ' — ' : '') + ev.title + (ev.source ? ' (' + ev.source + ')' : '')));
      if (todays.length > 4) lines.push('• …and ' + (todays.length - 4) + ' more — the full list is on the page.');
    } else {
      lines.push('📅 Nothing on the city/county calendars today.');
    }
    ready++;
  }
  lines.push('');
  lines.push('Live page (updates all day): https://travweber67.github.io/columbia-county-live/');
  lines.push('Sources: National Weather Service · USGS · ODOT/WSDOT snapshots · city & county calendars. Assembled '
    + fmtTime(now) + ' PT — the live page always has the newest numbers.');
  return { text: lines.join('\n'), ready };
}
function refreshBriefing() {
  const prev = $('briefing-preview');
  if (!prev) return;
  const b = buildBriefing();
  prev.textContent = b.ready
    ? b.text
    : 'Still gathering today\'s answers — the panels on this page update first, and this note follows within the minute.';
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
      : 'Copy didn\'t work in this browser — you can still select the briefing text above and copy it by hand.');
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
  const tm = planTomorrowStr();
  const list = (snap.events || []).filter(ev => ev.date === tm)
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
    + list.length + (list.length === 1 ? ' event' : ' events') + ' on the calendars — ' + named + more + '.</span></li>';
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
function tickTides() { if (Object.keys(tideData).length) renderTides(); }
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
  document.querySelectorAll('.fp-dir-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.fpDir === fpDir));
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
  commuteh2: '🚗 El veredicto del viaje',
  commutenote: 'La respuesta en una línea para manejar ahora mismo. El panorama completo del corredor — puente, incidentes y cámaras — está en la pestaña Viajes.',
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
  stickysky: 'Cielo',
  offlinenote: "📶 No tienes conexión — este teléfono muestra las últimas lecturas que recogió. Sus edades reales están en el <a href=\"#freshness-card\">tablero de frescura</a> más abajo; confirma con las fuentes oficiales antes de viajar.",
  glbridge: '🌉 Puente',
  glbridgesub: 'Puente Lewis &amp; Clark',
  glalerts: '⚠️ Alertas del clima',
  glalertssub: 'Servicio Meteorológico Nacional',
  glriver: '🌊 Río Columbia',
  glriversub: 'Medidor de Port Westward · USGS',
  glevents: '📅 Próximo evento',
  finderhint: 'Una sola búsqueda en todas las tarjetas de esta página, los siete pueblos y los calendarios de eventos — toca un resultado y la página te lleva directo.',
  homeh2: '🏠 Hazlo tuyo',
  sinceh2: '🧭 Mientras no estabas',
  watchh2: '🔔 La Vigilancia del Condado',
  watchnote: 'Todo lo demás en esta página espera a que vengas a mirar. La vigilancia no. Deja esta página abierta — en una pestaña, instalada en tu pantalla de inicio o en la pared — y revisa el Servicio Meteorológico Nacional, el puente y el ferry cada dos minutos. Si se publica una alerta nueva, el puente cierra o el ferry anuncia algo mientras no estás mirando, te avisa: una notificación en este dispositivo donde el navegador las ofrece, una línea en el registro de abajo y — si marcas la casilla — dice las alertas nuevas en voz alta.',
  watchbtn: '🔔 Empezar a vigilar',
  watchlimits: 'Límites honestos: la vigilancia solo funciona mientras esta página está abierta en este dispositivo — cerrar la pestaña la detiene, y un teléfono puede pausar una pestaña en segundo plano. Es una ayuda, nunca un reemplazo del Servicio Meteorológico Nacional, la Radio Meteorológica de NOAA ni las alertas de emergencia del condado de Columbia.',
  briefh2: '📋 El Resumen del Condado',
  briefnote: 'Las respuestas de hoy en una sola nota lista para copiar — armada desde los paneles en vivo de esta página y marcada con la hora en que se preparó. Pégala en un mensaje familiar, en el grupo del vecindario, donde se reúna el condado. ¿Vas a manejar? Toca <strong>🔊 Escuchar el resumen</strong> y tu teléfono te lo lee en voz alta — primero las alertas del clima.',
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
  eventsh2: '📅 Eventos — Próximas dos semanas',
  evall: 'Todos',
  evtoday: 'Hoy',
  evweekend: 'Este fin de semana',
  evweek: 'Próximos 7 días',
  evcalnote: '¿Vas a ir? Toca <strong>＋ Agregar</strong> en cualquier evento y llega a tu propio calendario — con la hora convertida y la página oficial adjunta — para que tu teléfono te lo recuerde el mismo día.',
  eventsnote: "Recogido por nuestro recolector de los calendarios oficiales de las ciudades. Fuentes oficiales: <a href=\"https://www.sthelensoregon.gov/calendar.aspx\" target=\"_blank\" rel=\"noopener\">St. Helens</a> · <a href=\"https://www.scappoose.gov/calendar.aspx\" target=\"_blank\" rel=\"noopener\">Scappoose</a> · <a href=\"https://www.columbiacountyor.gov/calendar\" target=\"_blank\" rel=\"noopener\">Condado de Columbia</a>",
  alertsh2: '⚠️ Alertas del clima',
  alertslink: 'Servicio Meteorológico Nacional — oficina de Portland →',
  forecasth2: '🌦️ Pronóstico',
  skyh2: '✈️ En el cielo ahora mismo',
  skyall: 'Todo el tráfico',
  skylow: 'Bajo y local',
  skyground: 'En tierra',
  skynote: 'Aviones: receptores ADS-B de la comunidad vía adsb.fi. Posición de la estación espacial: wheretheiss.at. Las horas de paso se calculan en esta página desde la órbita publicada de la estación. Todo se actualiza automáticamente.',
  riversh2: '🌊 Niveles del río',
  riversnote: 'Las alertas de inundación, cuando se emiten, aparecen en Alertas del clima, arriba. Las lecturas son datos provisionales del USGS.',
  tidesh2: '🌊 Mareas del río',
  tidesnote: 'El Columbia es un río de mareas en todo su paso por St. Helens — el océano sube por el canal dos veces al día. Para la rampa de botes, el muelle, la playa del río o una hora de pesca, aquí está el próximo cambio de marea en las dos estaciones de NOAA del condado.',
  tidesnote2: 'Las <em>predicciones</em> de marea de NOAA Tides &amp; Currents (estación 9439201 en St. Helens, estación 9439099 en Wauna), en pies sobre el nivel medio de la bajamar. El caudal del río empuja el agua real fuera de la predicción — un río alto corre más alto y más tarde — así que toma las horas como el plan, no como una promesa.',
  fishh2: '🐟 Conteos de peces — las presas',
  fishnote: 'Cada salmón que va hacia el alto Columbia pasa por la presa Bonneville, donde el Cuerpo de Ingenieros los cuenta en las escalas de peces. El día publicado más reciente suele ir uno o dos días detrás del calendario — los conteos se registran en video y se revisan antes de publicarse.',
  fishnote2: 'Conteos: Cuerpo de Ingenieros del Ejército de EE. UU., publicados por el Fish Passage Center y Columbia Basin Research (DART). Un cero es una respuesta real, no un vacío — significa que los contadores no vieron ninguno ese día.',
  trackerh2: '🎣 Rastreador de salmones',
  trackernote: 'La valoración de abajo es una estimación construida con los conteos de la tarjeta anterior — dónde están las migraciones, al ritmo que los conteos de este año midieron de verdad. Los números contados son hechos; las posiciones y valoraciones son las matemáticas honestas entre ellos.',
  methodh3: 'El plan del día — pesca con la corriente',
  methodnote: 'Un día en este río, leído de la corriente. Con agua fuerte es hora del plunking y del ancla — una cucharilla o un wobbler solo trabaja cuando el río lo empuja. Cuando la corriente muere, es hora del curricán (trolling). Elige tu método y el plan resalta tus horarios.',
  quakesh2: '🫨 Terremotos — últimos 30 días',
  firesh2: '🔥 Incendios forestales',
  firesnote: 'Datos oficiales de incidentes del Centro Nacional Interagencial de Incendios (WFIGS). Para avisos de evacuación, sigue siempre a la Oficina de Manejo de Emergencias del Condado de Columbia e InciWeb.',
  airh2: '🌫️ Aire y humo',
  airnote: 'La otra cosa invisible sobre el condado — lo que lleva el aire que respiras. Humo de estufas de leña en las noches quietas de invierno, humo de incendios en verano. Aquí está el Índice de Calidad del Aire para el pueblo de la tarjeta de Pronóstico de arriba, y hacia dónde dice el modelo que va.',
  airnote2: "Una estimación modelada del modelo atmosférico de Open-Meteo (Copernicus CAMS) — no hay un monitor oficial de calidad del aire en el condado, así que léelo como una buena guía, no como un medidor en un poste. Lecturas y alertas oficiales: <a href=\"https://www.airnow.gov/\" target=\"_blank\" rel=\"noopener\">AirNow</a>.",
  freshh2: '🕐 ¿Qué tan fresca es esta página?',
  freshspan: 'las edades se actualizan cada 30 s',
  freshnote: 'Cada número aquí nombra su fuente y su edad. Verde es fresco, ámbar está envejeciendo, rojo significa tratar el panel como viejo y revisar la fuente oficial. Si una fuente se queda callada, este tablero lo muestra en vez de esconderlo.',
  shareh2: 'Ten Columbia County Live a la mano',
  sharep: 'Gratis, sin anuncios, sin registro. Ponla en tu pantalla de inicio como una app, envíasela a un vecino que maneja por la US-30 — o apoya una tableta en el mostrador y toca <strong>Pantalla en pared</strong>: las respuestas del condado, grandes y rotando, hechas para la pantalla que ya está encendida.',
  sharebtn: '📤 Compartir esta página',
  installbtn: '📱 Agregar a pantalla de inicio',
  wallbtn: '📺 Pantalla en pared',
  footerbyline: '<strong>Columbia County Live</strong> — por <strong>Nomad Development Group</strong>',
  footerdata: 'Datos: Servicio Meteorológico Nacional · Servicio Geológico de EE. UU. (USGS) · NOAA Tides &amp; Currents (mareas del río) · NOAA nowCOAST (radar) · NIFC WFIGS (incendios forestales) · colaboradores de adsb.fi (aviones, ODbL) · wheretheiss.at (posición de la EEI) · CelesTrak / NORAD (órbita de la EEI, para predicciones de paso) · Open-Meteo / Copernicus CAMS (modelo de calidad del aire) · Fish Passage Center y Columbia Basin Research DART (conteos de peces en las presas — datos del Cuerpo de Ingenieros del Ejército de EE. UU.) · colaboradores de OpenStreetMap. Los datos de captura (carreteras, cámaras, puente, alertas del ferry, eventos, tráfico del río) los recoge un pequeño programa recolector de los operadores oficiales — ODOT TripCheck, WSDOT, el condado de Wahkiakum y los calendarios de las ciudades y el condado — y se etiquetan con la hora en que se recogieron. El modelo de capas de rastreo en vivo está inspirado en God&rsquo;s Eye View (código abierto, de Bilawal Sidhu), cuyo DATA_SOURCES.md nos señaló varias de estas fuentes públicas.',
  footerdisc: 'Esta página reúne datos públicos por conveniencia. Antes de viajar con clima severo o agua alta, confirma las condiciones con las fuentes oficiales enlazadas arriba.',
  langnote: "🌎 This page is showing its headings, buttons and notes in Spanish — tap <strong>English</strong> up top, beside the clock, to switch back. Live readings, alerts and event listings keep arriving in English from their official sources."
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
    btns.forEach(b => b.classList.toggle("active", b.dataset.goTrip === goTrip));
    btns.forEach(b => b.addEventListener("click", () => {
      goTrip = b.dataset.goTrip;
      btns.forEach(x => x.classList.toggle("active", x === b));
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

/* ---------- Your front page: pin the cards you live by (X20 R18) ----------
   Twenty-six rounds deep, the page's order was the page's opinion: nine
   sections before the map, two columns after it, and every visitor read
   the same front page whether they came for the ferry, the river, or the
   sky. This module hands the order over. Every content card grows a
   📌 Pin button in its head; a pinned card's live node is *moved* (never
   cloned — the panels keep updating in place) into the front-page strip
   under the glance, in pin order; unpinning returns it to the exact slot
   it came from, recorded before anything moved. Pins persist only in the
   visitor's browser (ccl-frontpage-v1, beside the home-town and watch
   prefs). The map card is deliberately not pinnable: it is the page's
   anchor, and a Leaflet container does not need the adventure. */
const FPAGE_KEY = 'ccl-frontpage-v1';
const FPAGE_CARDS = ['since-card', 'watch-card', 'briefing-card', 'plan-card', 'go-card', 'almanac-card',
  'roads-card', 'ships-card', 'ferry-card', 'events-card',
  'alerts-card', 'forecast-card', 'sky-card', 'rivers-card', 'tides-card', 'quakes-card', 'fires-card', 'air-card'];
let fpagePins = [];        // pinned card ids, in the order they were pinned
const fpageHomes = {};     // id -> {parent, next} recorded at init, before any move
const fpageBtns = {};      // id -> its pin button
function fpageParent(el) { return el ? (el.parentNode || el.parent || null) : null; }
function fpageLoadPref() {
  try {
    const v = JSON.parse(window.localStorage.getItem(FPAGE_KEY) || '[]');
    if (Array.isArray(v)) fpagePins = v.filter(id => FPAGE_CARDS.indexOf(id) !== -1);
  } catch (e) { fpagePins = []; }
}
function fpageSavePref() {
  try {
    if (fpagePins.length) window.localStorage.setItem(FPAGE_KEY, JSON.stringify(fpagePins));
    else window.localStorage.removeItem(FPAGE_KEY);
  } catch (e) { /* storage unavailable — pins still work for this visit */ }
}
function fpagePaint() {
  const wrap = $('frontpage');
  if (wrap) wrap.hidden = fpagePins.length === 0;
  FPAGE_CARDS.forEach(id => {
    const b = fpageBtns[id];
    if (!b) return;
    const on = fpagePins.indexOf(id) !== -1;
    b.classList.toggle('active', on);
    b.textContent = on ? '📌 Pinned' : '📌 Pin';
    b.title = on ? 'Send this card back where it came from' : 'Pin this card to your front page, up top';
    if (b.setAttribute) b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
function fpagePin(id) {
  const card = $(id), list = $('frontpage-list');
  if (!card || !list) return;
  list.appendChild(card); // appendChild moves the live node — panels keep updating in their new home
  if (fpagePins.indexOf(id) === -1) fpagePins.push(id);
}
function fpageUnpin(id) {
  const card = $(id), home = fpageHomes[id];
  fpagePins = fpagePins.filter(x => x !== id);
  if (!card || !home || !home.parent) return;
  const anchor = home.next && fpageParent(home.next) === home.parent ? home.next : null;
  if (anchor) home.parent.insertBefore(card, anchor);
  else home.parent.appendChild(card);
}
function fpageToggle(id) {
  if (fpagePins.indexOf(id) !== -1) fpageUnpin(id); else fpagePin(id);
  fpageSavePref();
  fpagePaint();
}
function initFrontpage() {
  const list = $('frontpage-list');
  if (!list) return;
  FPAGE_CARDS.forEach(id => {
    const card = $(id);
    if (!card) return;
    fpageHomes[id] = { parent: fpageParent(card), next: card.nextElementSibling || null };
    const head = card.querySelector('.card-head');
    if (!head) return;
    head.classList.add('has-pin');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pin-btn';
    b.dataset.pinFor = id;
    b.addEventListener('click', () => fpageToggle(id));
    head.appendChild(b);
    fpageBtns[id] = b;
  });
  fpageLoadPref();
  fpagePins = fpagePins.filter(id => fpageHomes[id]); // forget pins whose cards are gone
  fpagePins.forEach(id => { const c = $(id); if (c) list.appendChild(c); });
  const clear = $('frontpage-clear');
  if (clear) clear.addEventListener('click', () => {
    fpagePins.slice().forEach(id => fpageUnpin(id));
    fpagePins = [];
    fpageSavePref();
    fpagePaint();
  });
  fpagePaint();
}
initFrontpage();

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
  els.forEach(el => { el.classList.add('reveal'); io.observe(el); });
}
initReveal();

/* Fish + day-plan boot LAST on purpose: the verdict reads homeTown and
   the day plan reads the tides module's helpers, both declared further
   down than the main go-section — calling them there hits TDZ errors. */
loadFish();
loadCurrents();
