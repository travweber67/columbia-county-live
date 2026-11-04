/* Columbia County Live — v1
   All data comes from free, CORS-open public APIs (NWS + USGS), fetched
   directly from the visitor's browser. Every panel fails independently
   with an honest fallback. No tracking, no keys, no backend. */
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

const NWS_ALERTS_URL = 'https://api.weather.gov/alerts/active?zone=ORC009';
const USGS_IV_URL = 'https://waterservices.usgs.gov/nwis/iv/?format=json&sites='
  + GAUGES.map(g => g.site).join(',') + '&parameterCd=00065,00060&period=P2D';

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
const num = (v, dec) => Number(v).toLocaleString('en-US',
  { minimumFractionDigits: dec, maximumFractionDigits: dec });

async function getJSON(url, headers) {
  const r = await fetch(url, { headers: headers || {} });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
function setUpdated(id) {
  const el = $(id);
  if (el) el.textContent = 'Updated ' + fmtTime(new Date());
}
function ago(date) {
  const mins = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (mins < 60) return mins + ' min ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return hrs + ' hr ago';
  return Math.round(hrs / 24) + ' days ago';
}

/* ---------- clock ---------- */
function tickClock() {
  const el = $('clock');
  if (el) el.textContent = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit'
  }).format(new Date());
}
setInterval(tickClock, 1000); tickClock();

/* ---------- map ---------- */
let map = null, quakeLayer = null;
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

  quakeLayer = L.layerGroup().addTo(map);
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

/* ---------- go ---------- */
initMap();
initTownPicker();
loadAlerts();
loadForecast(currentTown);
loadRivers();
loadQuakes();
setInterval(loadAlerts, 10 * 60 * 1000);
setInterval(loadRivers, 10 * 60 * 1000);
setInterval(loadQuakes, 30 * 60 * 1000);
