/* Columbia County Live — service worker (X20 Round 4: "It works out there")
 *
 * Makes the page an offline-capable, instant-return app for a river corridor
 * with real dead zones. Strategy by request kind — live data is NEVER cached:
 *
 *  - Navigations, shell code (CSS/JS), the county GeoJSON, the manifest:
 *    network-first, cache fallback — freshest code wins when there's signal,
 *    the last good copy carries you when there isn't.
 *  - data/*.json snapshots: network-first, cache fallback. What you see
 *    offline is the last real collection, still stamped with its true
 *    collection time; the freshness board shows its real, growing age.
 *  - Images and icons: cache-first — they never change at a given URL.
 *  - Versioned library CDNs (Leaflet, Google Fonts): cache-first, refreshed
 *    in the background.
 *  - Everything else cross-origin (NWS, USGS, ADS-B, the ISS feed, map
 *    tiles, radar): NOT intercepted. Offline, those feeds simply fail and
 *    their panels say so — nothing is faked, nothing pretends to be live.
 */
'use strict';

var VERSION = 'ccl-v17'; // v17 = WS-1 2026-11-04 (school-closures board — curated data/schools.json, dormant-ready, EN+ES dynamic status labels; About / founding-sponsor interest section — SPONSOR_FORM_URL config in app.js, interim mailto capture, nothing for sale; accessibility pass from a live Lighthouse run (a11y 0.92): --accent-2 darkened #0d8a5f→#0b7a52 for contrast, role=tablist misuse fixed to role=group + aria-pressed sync on the five toggle groups, lang-btn label/name mismatch removed, chip/button tap targets raised to ≥36px; WS-1d same publish: map layers panel collapsed by default — Leaflet collapsed:true + tap-map / tap-toggle-again close wiring, mobile caps ≤70vw + max-height scroll + compact rows, 44px toggle); v16 = Fishing answer card 5-day pick 2026-11-04 (When row: Today..+4 with weekday+date chips in America/Los_Angeles; days +2..+4 are labeled outlooks — salmon: heatModel at the future date with a ×0.8/day-beyond-tomorrow confidence decay on the stretch score before the tracker's own thresholds, outlook why from today's counts; steelhead: the same index in forecast mode — NWS QPF through the rain-to-river mapping for flow/clarity on every river kind, that day's forecast for cold/weather — why led by "Early call from the forecast"; Forecast/Outlook tag beside the pill; NOAA current predictions fetched 6 days out so best windows quote for +2..+4; ES chip chrome; index card, tracker gate/maths for today, steelhead weights and day-plan segment logic unchanged); v15 = strip label fit stages 2026-11-04 (the anchor fit check is now staged and 2D: full labels → John Day drops to its own line (suffixes kept) → suffixes shed → ticks only; measured live at 360px: one-line labels collide ~55px, bare names ~11px, the split layout fits; the check also re-runs when the Outdoors view is shown, since the strip renders inside a hidden view where it cannot be measured); v14 = strip label fit fix 2026-11-04 (the anchor fit check sheds the river-mile suffixes before dropping labels; same build as v13 otherwise); v13 = Fishing answer card + Salmon Tracker declutter 2026-11-04 (intent-first answer card at the top of the fishing section: Salmon/Steelhead × stretch-or-river × Today/Tomorrow chips, one GOOD/FAIR/POOR glance composed only from the tracker surface, the steelhead index's own per-day verdicts, and the day plan's best segment; choices persist; tracker card decluttered — intro + basis moved into the Why expander, verdict face shortened to one sentence, heat strip labels cut to three anchors with a mechanical no-overlap fit check, towns as bare ticks, one county zone label, one-line legend, gray=no-signal caption kept; day-plan source notes shortened; EN+ES chrome); v12 = Steelhead Day Index 2026-11-04 (Outdoors fishing section: per-river Good/Fair/Poor day for the Wilson, Nehalem, NF Nehalem, Big Creek, Gnat Creek, Klaskanine, Clatskanie and Scappoose from run timing, USGS gauge flow + typical range, MRMS basin-rain clarity model, NWS freeze/weather factors, first light + general Oregon angling-hours window; fetcher steelhead.json full-run only; EN+ES chrome); v11 = Facebook public events merge 2026-11-04 (data/fb-events.json from the FB events checker merges client-side into the calendar events — calendar wins title+date collisions; FB-only rows wear a Facebook tag and link to the event page; Tonight & tomorrow + glance tile merge too; EN+ES source note); v10 = County Briefing visual front 2026-11-04 (briefing card renders designed rows from the same structured pass that builds the copied note; the raw text box is gone — copy/share/speech text byte-identical; EN+ES note wording adjusted); v9 = Day-plan copy polish 2026-11-04 (anchor-strong wording follows the actual sequence; tomorrow line merges same-method runs); v8 = Salmon Tracker UX build + GoatCounter beacon 2026-11-04 (verdict-first GOOD/FAIR/SLOW for the home stretch, single-hue heat strip + toggleable map heat layer, one-tap Why, method-switching day plan from NOAA CO-OPS current predictions at Walker Island with tide-curve fallback; invisible GoatCounter analytics beacon; EN+ES chrome); v6 = Fish counts + Salmon Tracker 2026-11-04 (Bonneville/The Dalles/John Day counts card + measured-window wave tracker, Outdoors view; EN+ES chrome); v5 = Build batch 2026-11-04 (My Route camera strip, incident honesty + verdict scope fix, route-ahead forecast, ships passing-soon ETAs, Bend run pass card; EN+ES); v4 = Copy sweep 2026-11-04 (privacy-reassurance boilerplate removed, EN+ES); v3 = Feature audit 2026-11-04 (Near-me popup fix); v2 = Redesign (view navigation + light modern theme)
var STATIC_CACHE = VERSION + '-static';
var DATA_CACHE = VERSION + '-data';
var LIB_CACHE = VERSION + '-lib';

var SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'county.geojson',
  'img/hero-bridge.jpg',
  'img/card-bridge-pano.jpg',
  'img/card-ship.jpg',
  'img/card-ferry.jpg',
  'img/card-courthouse.jpg',
  'img/card-dock.jpg',
  'img/icon-192.png',
  'img/icon-512.png',
  'img/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(function (cache) {
        // One missing file must never block the whole install.
        return Promise.all(SHELL.map(function (u) {
          return cache.add(u).catch(function () { /* shell fills in lazily too */ });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys
          .filter(function (k) {
            return k.indexOf('ccl-') === 0 &&
              [STATIC_CACHE, DATA_CACHE, LIB_CACHE].indexOf(k) === -1;
          })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

function networkFirst(request, cacheName, navFallback) {
  return caches.open(cacheName).then(function (cache) {
    return fetch(request).then(function (fresh) {
      if (fresh && fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    }).catch(function (err) {
      return cache.match(request).then(function (hit) {
        if (hit) return hit;
        if (navFallback) return cache.match('index.html');
        throw err;
      });
    });
  });
}

function cacheFirst(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (fresh) {
        if (fresh && fresh.ok) cache.put(request, fresh.clone());
        return fresh;
      });
    });
  });
}

function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (hit) {
      var network = fetch(request).then(function (fresh) {
        if (fresh && fresh.ok) cache.put(request, fresh.clone());
        return fresh;
      }).catch(function () { return hit; });
      return hit || network;
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url;
  try { url = new URL(request.url); } catch (e) { return; }

  if (url.origin === self.location.origin) {
    if (url.pathname.indexOf('/data/') !== -1 && /\.json$/.test(url.pathname)) {
      event.respondWith(networkFirst(request, DATA_CACHE, false));
    } else if (/\.(?:png|jpe?g|gif|svg|webp|ico)$/.test(url.pathname)) {
      event.respondWith(cacheFirst(request, STATIC_CACHE));
    } else {
      event.respondWith(networkFirst(request, STATIC_CACHE, request.mode === 'navigate'));
    }
  } else if (url.hostname === 'unpkg.com' ||
             url.hostname === 'fonts.googleapis.com' ||
             url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request, LIB_CACHE));
  }
  /* Every other cross-origin request — NWS, USGS, ADS-B, ISS, map tiles,
     radar — goes straight to the network, uncached and unfaked. */
});
