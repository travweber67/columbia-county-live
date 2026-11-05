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

var VERSION = 'ccl-v9'; // v9 = Day-plan copy polish 2026-11-04 (anchor-strong wording follows the actual sequence; tomorrow line merges same-method runs); v8 = Salmon Tracker UX build + GoatCounter beacon 2026-11-04 (verdict-first GOOD/FAIR/SLOW for the home stretch, single-hue heat strip + toggleable map heat layer, one-tap Why, method-switching day plan from NOAA CO-OPS current predictions at Walker Island with tide-curve fallback; invisible GoatCounter analytics beacon; EN+ES chrome); v6 = Fish counts + Salmon Tracker 2026-11-04 (Bonneville/The Dalles/John Day counts card + measured-window wave tracker, Outdoors view; EN+ES chrome); v5 = Build batch 2026-11-04 (My Route camera strip, incident honesty + verdict scope fix, route-ahead forecast, ships passing-soon ETAs, Bend run pass card; EN+ES); v4 = Copy sweep 2026-11-04 (privacy-reassurance boilerplate removed, EN+ES); v3 = Feature audit 2026-11-04 (Near-me popup fix); v2 = Redesign (view navigation + light modern theme)
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
