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
   Every panel fails independently. No tracking, no backend. */
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
function setUpdated(id) {
  const el = $(id);
  if (el) el.textContent = 'Updated ' + fmtTime(new Date());
}
function setSnapUpdated(id, fetchedAtIso) {
  const el = $(id);
  if (!el) return;
  const d = new Date(fetchedAtIso);
  el.textContent = isNaN(d) ? '' : 'Snapshot · collected ' + fmtDayTime(d);
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
    fireLayer = null, issLayer = null, issMarker = null;
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
    '🔥 Wildfire perimeters': fireLayer,
    '🛰️ Space station (ISS)': issLayer,
    '🫨 Earthquakes': quakeLayer
  }, { collapsed: false }).addTo(map);
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
    } else {
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
      return '<div class="river-row"><div><div class="river-name">' + esc(g.label) + '</div>'
        + '<div class="river-sub">' + esc(g.sub) + ' · read ' + ago(s.time) + '</div>'
        + '<div class="river-sub">' + trend + '</div></div>'
        + '<div class="river-nums"><div class="big">' + num(s.height, 2) + ' ft</div>'
        + '<div class="river-sub">' + (s.flow != null ? num(s.flow, s.flow < 100 ? 1 : 0) + ' cfs flow' : '') + '</div></div></div>';
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
function renderAircraft(list, sourceLabel) {
  const body = $('sky-body');
  if (aircraftLayer) {
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
  if (!list.length) {
    body.innerHTML = '<p class="no-alerts">No aircraft inside the county box at the last reading — normal for a rural county; Portland traffic passes just south and east.</p>';
    return;
  }
  const sorted = list.slice().sort((x, y) => (Number(y.alt_ft) || 0) - (Number(x.alt_ft) || 0));
  body.innerHTML = '<p class="sky-count"><strong>' + list.length + '</strong> aircraft over the county <span class="river-sub">(' + esc(sourceLabel) + ')</span></p>'
    + sorted.slice(0, 8).map(a =>
      '<div class="sky-row"><span class="sky-cs">' + esc(a.callsign || a.hex || '—') + '</span>'
      + '<span class="sky-meta">' + esc(a.type || '') + '</span>'
      + '<span class="sky-alt">' + (a.alt_ft === 'ground' ? 'ground' : (a.alt_ft != null ? num(a.alt_ft, 0) + ' ft' : '')) + '</span></div>'
    ).join('');
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

/* ---------- snapshot: roads + bridge + cameras ---------- */
function renderRoads(roads, camerasSnap) {
  setSnapUpdated('roads-updated', roads.fetched_at);
  // Bridge block
  const b = roads.bridge || {};
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
      + (z.start ? '<p>' + esc(z.start) + (z.end ? ' → ' + esc(z.end) : '') + '</p>' : '') + '</div>';
  });
  bh += '</div>';
  bEl.innerHTML = bh;
  // ODOT incidents
  const iEl = $('incidents-body');
  const tc = (roads.sources || [])[0] || {};
  if ((roads.incidents || []).length) {
    iEl.innerHTML = roads.incidents.map(i =>
      '<div class="incident-row"><strong>' + esc(i.title) + '</strong>'
      + (i.route ? ' <span class="river-sub">' + esc(i.route) + '</span>' : '')
      + (i.desc ? '<p>' + esc(i.desc) + '</p>' : '') + '</div>').join('');
  } else if (tc.status === 'ok') {
    iEl.innerHTML = '<p class="no-alerts">✅ No ODOT incidents reported on county highways in the latest snapshot.</p>';
  } else {
    iEl.innerHTML = '<p class="status-note">🛠️ The bridge status above and event/ferry panels are live now. ODOT\'s incident feed itself needs ODOT\'s free developer key added to our fetcher — the plumbing is built and waiting on that one signup (it\'s free; it just has to be done by a person). Until then, the snapshot above is WSDOT + county sources only for roads.</p>';
  }
  // Cameras
  const cEl = $('cameras-body');
  const cams = (camerasSnap && camerasSnap.cameras) || [];
  if (cams.length) {
    cEl.innerHTML = '<div class="camera-grid">' + cams.map(c =>
      '<figure class="camera-fig">'
      + (c.image_url ? '<img loading="lazy" src="' + esc(c.image_url) + '" alt="Road camera: ' + esc(c.name) + '" onerror="this.parentNode.classList.add(\'cam-dead\');this.remove();">' : '')
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
}
async function loadRoads() {
  try {
    const [roads, cams] = await Promise.all([
      getSnapshot('roads.json'),
      getSnapshot('cameras.json').catch(() => null)
    ]);
    renderRoads(roads, cams);
  } catch (e) {
    $('bridge-body').innerHTML = '<p class="fallback">⚠️ Road snapshot unavailable right now — check <a href="https://www.tripcheck.com/" target="_blank" rel="noopener">TripCheck</a> and <a href="https://wsdot.com/traffic/" target="_blank" rel="noopener">WSDOT</a> directly before you drive.</p>';
    $('incidents-body').innerHTML = '';
    $('cameras-body').innerHTML = '';
  }
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
      body.innerHTML = ships.map(s =>
        '<div class="ship-row"><div><div class="river-name">🚢 ' + esc(s.name || ('MMSI ' + s.mmsi)) + '</div>'
        + '<div class="river-sub">' + (s.destination ? 'Bound for ' + esc(s.destination) : 'Destination not broadcast')
        + '</div></div><div class="river-nums"><div class="big">' + (s.sog_kn != null ? num(s.sog_kn, 1) + ' kt' : '—') + '</div>'
        + '<div class="river-sub">' + (s.cog != null ? 'course ' + num(s.cog, 0) + '°' : '') + '</div></div></div>').join('');
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

/* ---------- snapshot: events ---------- */
function parseTimeToMinutes(t) {
  const m = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i.exec(t || '');
  if (!m) return 0;
  let h = parseInt(m[1], 10) % 12;
  if (/PM/i.test(m[3])) h += 12;
  return h * 60 + parseInt(m[2] || '0', 10);
}
async function loadEvents() {
  const body = $('events-body');
  try {
    const snap = await getSnapshot('events.json');
    setSnapUpdated('events-updated', snap.fetched_at);
    const evs = (snap.events || []).slice().sort((a, b) =>
      a.date === b.date ? parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time)
                        : (a.date < b.date ? -1 : 1));
    let html = '';
    if (evs.length) {
      let lastDate = '';
      html = evs.slice(0, 16).map(ev => {
        const head = ev.date !== lastDate
          ? '<div class="event-date">' + esc(fmtDay(new Date(ev.date + 'T12:00:00'))) + '</div>' : '';
        lastDate = ev.date;
        return head + '<div class="event-row"><span class="event-time">' + esc(ev.time || '') + '</span>'
          + '<span class="event-title">' + (ev.url ? '<a href="' + esc(ev.url) + '" target="_blank" rel="noopener">' + esc(ev.title) + '</a>' : esc(ev.title)) + '</span>'
          + '<span class="event-src">' + esc(ev.source || '') + '</span></div>';
      }).join('');
    } else {
      html = '<p class="no-alerts">No upcoming events found on the city calendars for the next two weeks.</p>';
    }
    const county = (snap.sources || []).find(s => /Columbia County/.test(s.name));
    if (county && county.status === 'blocked_needs_browser') {
      html += '<p class="status-note">🏛️ Columbia County\'s own calendar is the one holdout: their website only reveals events inside a full web browser (no readable feed exists). Capturing it from Travis\'s computer is the next fetcher step — the city calendars above are already flowing.</p>';
    }
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = '<p class="fallback">⚠️ Events snapshot unavailable right now.</p>';
  }
}

/* ---------- go ---------- */
initMap();
initTownPicker();
loadAlerts();
loadForecast(currentTown);
loadRivers();
loadQuakes();
loadFires();
loadAircraft();
loadISS();
loadRoads();
loadShips();
loadFerry();
loadEvents();
setInterval(loadAlerts, 10 * 60 * 1000);
setInterval(loadRivers, 10 * 60 * 1000);
setInterval(loadQuakes, 30 * 60 * 1000);
setInterval(loadFires, 15 * 60 * 1000);
setInterval(loadAircraft, 45 * 1000);
setInterval(loadISS, 15 * 1000);
setInterval(loadRoads, 10 * 60 * 1000);
setInterval(loadShips, 10 * 60 * 1000);
setInterval(loadFerry, 10 * 60 * 1000);
setInterval(loadEvents, 30 * 60 * 1000);
