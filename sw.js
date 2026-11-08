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

var VERSION = 'ccl-v41-rally'; // v40 = install discovery + briefing bounce fix 2026-11-05 (Travis, from the 4C's comments: three neighbours could not find any 'add to home screen' button, and they were right — masthead 'Get the app' button + drawer entry now open a device-detected install sheet: step-0 escape for Facebook/Instagram webviews and non-Safari iOS browsers (where the add silently no-ops), numbered Android Chrome/Samsung/Firefox + iPhone Safari + desktop steps EN/ES, a real Install button when beforeinstallprompt has offered one, and a 'Don't see the icon?' closer; the Events & More install card's dismissal is a timestamp that expires after 30 days instead of a permanent flag; refreshBriefing caches its composed HTML and skips identical innerHTML rebuilds so the 30s tick can't yank scroll on browsers without scroll anchoring, and #briefing-view reserves close to its composed height so the first-minute loading flip stops moving the document; end-of-Today signpost under the County Briefing points onward to Travel / Outdoors / Events & More) // v39 = photo audit 2026-11-05 (Travis waived review: license/caption/quality/crop pass over every live image — full-viewport backgrounds upgraded 800->1920px from the SAME Commons-verified originals (ship, Oscar B, courthouse, Rainier dock); bg-dusk-2/4/7 re-rendered at 1920 from pool originals; bg-dusk-5 CORRECTED — the file was actually a second crop of the Rennett Stowe fishing-boat photo while its screensaver credit said USFWS/Kelley Point; it now IS the USFWS Mallard/Interstate Bridge sunset (public domain) its credit and the spec describe; orphaned images removed: cascade-controls-jobs-home.jpg (superseded by v38 thumbs), bg-day-2.jpg, icon-logo-pine.png) // v38 = phone thumb fix 2026-11-05 (Travis, from the v37 phone screenshot: the card's 112px side-sliver thumbnail sliced the title text — 'Cascade C…' — and looked broken; phone (≤640px) now swaps via <picture> to a dedicated mobile title-card banner, img/cascade-thumb-mobile.jpg 600x206, stacked from the desktop title card's two fully-readable bands — the real site's board band + the navy title block — shown as a full-width top strip over a slim eyebrow/title/CTA body row, copy line folded away on phone since the banner carries it; desktop ≥641px rendering pixel-unchanged) // v37 = cross-promo shrink 2026-11-05 (Travis, reviewing the v36 screenshots: the Events & More card was far too big — it read like an entire page, not one of the small cards sponsors pay for; the card is now a compact horizontal mini-card, cropped screenshot thumbnail 300x170 left + text right, ~172px tall on desktop, slim thumb on phone; the drawer's separate 'More from Nomad' section is also gone per his follow-up — Cascade is now one tiny muted text link under About in the drawer; footer link unchanged; the card is styled as Cascade's OWN ad unit (deep navy + orange, its type feel) with a purpose-built title-card thumbnail (fresh capture of the real Cascade site + navy title block) so it reads as another site's advertisement, not a piece of CCL; paid sponsor inventory untouched, marquee untouched) // v36 = cross-promo 2026-11-05 (Cascade Controls Jobs, Nomad's other project — three honest house placements: a screenshot card in Events & More below the services directory, a "More from Nomad" drawer entry, and a slim footer link; paid sponsor inventory untouched, marquee untouched) // v35 = V10 corrective 2026-11-05 (the strip slot-width lock, shipped in v34, could engage on a transient under-measurement and lock a slot narrower than its content; slot widths are now derived from the content itself (ruler-measured text in each element's own font + the item's chrome) because Chromium's intrinsic box measurement of the animated flex strip can return half the true width and poison the lock; validation passes only ever grow slots, and the engagement window stretches to 90s for slow data modules) // v34 = V10 2026-11-05 (saver bottom overlap fixed — quiet line + photo credit share one .saver-bottom container that stacks in normal flow at ≤760px and short landscape, so the two-line sponsor line can never cross the cursive credit again; tile stream lifted clear of the taller zone; glance marquee smoothness, diagnosed this time — clone sync no longer rebuilds innerHTML inside the animating layer, strip slot widths are measured at the value's 36ch ceiling and locked identically across both halves so text changes can never resize the track mid-loop, keyframes hold translate3d) // v33 = V9 2026-11-05 (the commute card — Travis's last pre-ship addition, top of Travel above the roads card: pickable county town (St. Helens default) → St. Johns / Downtown Portland / Longview, typical drive time fetched live from the free OSRM service, labelled "Typical drive — no live traffic" EN/ES and never presented as live conditions; picks + per-pair last-good cache in ccl-commute-v1, failed fetches fall back to the cached reading with its checked time; registered in CCLPins as drive-card, plus finder + drawer entries; DESKTOP scroll fix — Travis, from a mid-scroll photo: at ≥900px the tabbar and the green Live view bar no longer stick, they scroll away with the page; the sponsor rail cards stay sticky by his explicit approval, offset 112px → 20px now that the bars don't hold the top; phones untouched) — SHIPPED TO LIVE with the full redesign 2026-11-05 // v32 = V8 fixes 2026-11-05 (hero photo runs CONTINUOUS to the green sticky bar on desktop — the hero gains the tabbar's 57px as bottom padding and the tabbar pulls up over the picture with a transparent band, the four tab pills floating in dark glass; the bone "gray bar" is gone; phones untouched — bottom tab chrome, hero already meets the green bar; masthead pills slimmed ~25-30% above 560px — Display/Dark padding 10px 16px -> 7px 12px, type .92 -> .85rem, clock 1.18 -> 1.02rem, 40px min height kept, v7's 44px phone circles untouched; NO pin discs on the scrolling strip — the .saver-pin buttons the saver module used to grow inside the canonical strip tiles are deleted in app.js + CSS, strip items are icon + label + value only, and answer pinning lives solely in the Community Screensaver card's chips writing the same CCLPins store — verified end-to-end (chip click -> store -> saver stream tile); rails CONFIRMED sticky — .rail-zone already spans each view's full height with position:sticky cards at top:112px, proven this pass with a two-depth geometry probe (cards hold exactly 112px at scrollY 1500 while their container moves the full 1500; the headless pipeline still can't rasterize a scrolled frame — documented since v4); no rail change, no duplicated house cards) // v31 = V7 fixes 2026-11-05 (the Bend band is Mt. HOOD now — U.S. Forest Service public-domain Trillium Lake photo, pool-verified via the Commons API and visually confirmed, replacing the St. Helens shot Travis caught; saver stream tiles at parade scale — ~41vw wide, type x1.45, loop slowed to 150s so the drift stays stately and the tiles no longer all fit across a TV; phone masthead compacts — Display + Dark become matched 44px circular icon buttons at <=560px, labels return on wider screens; dark-mode background audit — More's St. Helens dusk (mud) replaced by the golden-hour Columbia shoreline (bg-dusk-6), every dark background now a river evening) // v30 = V6 refinements 2026-11-05 (masthead Display button — display mode one tap from first paint on every view, same CCLOpenSaver opener as the drawer + Events & More entries; screensaver answers SCROLL — the pinned answers stream right-to-left on the glance strip's duplicated-track technique, values patched in place so the 5s refresh never restarts the stream, one pin or reduced motion stays static; the saver's quiet sponsor line is now a rotation marched by the photos — quietIdx advances once per photo change, sponsor line → photo invitation → blank beat; mobile sponsor spacing — at ≤760px Today's founding panel keeps only the invitation up top, the County Watch + nonprofit house cells move down into the flow before Tonight & Tomorrow and before the County Briefing, moved never duplicated, desktop untouched; Bend run summit pair — the two Government Camp cameras nearest the PASS_POINTS.govcamp anchor by haversine over the snapshot's own lat/lon lead the Mt. Hood section large with their distance from the summit, the rest stay in the strip; photo-top spread, tastefully — the Events card's photo-header pattern reaches the Bend card (Cascade peak band), the fishing answer card (golden-hour boats + fishing-boat-sunset twin) and the services directory (Cannery Pier boardwalk), and photo-behind-text reaches the Community Screensaver card (river-mouth panorama under a bone scrim) and Featured Local (1973 Columbia-mouth sunset behind glass cards) — six treated cards total, utility cards stay clean; directory price $9/mo · $79/yr marked APPROVED in the business plan, UI still price-free for the founding launch) // v29 = micro-business directory 2026-11-05 (business plan §6 Phase 2 addendum: a "Local services" directory in Events & More, below Featured Local — plain hairline rows for one-person services (child care, cleaning, handyman, pet care, yard & garden, tutoring, moving & hauling, other), category chips filter the rows, seeded with the ONE real founding business Oregon Trail Lanes; empty categories carry varied honest "no listings yet — free during the founding launch" states, never invented businesses; the one invitation card + List-your-service CTA ride the sponsor request form (review → publish, no checkout); NO price shown for this tier — the proposed price is PROPOSED in the business plan pending Travis's approval; honesty line in-section: listings are advertisements, not endorsements, check references for in-home services; EN/ES chrome + per-category EN/ES empty states re-rendered on the language toggle) // v28 = photo form live 2026-11-05 (PHOTO_FORM_URL swapped from the placeholder to the real Google Form) // v27 = v5 revision 2026-11-05 (clean hero — photo + name + welcome line only, chips/tagline/promise retired; the courthouse logo is the menu button opening a frosted slide-out drawer with every view + section jump, screensaver/sponsor entries and the Share-your-county-photo invitation; pins unified onto the ONE generic store window.CCLPins / ccl-pins-v1 — pin any card in any view and a LIVE COPY renders at the top of Today, originals never move; PWA finish — completed manifest (bone/forest, maskable courthouse icon), favicon set + apple metas + per-theme theme-color, ONE dismissible install card in Events & More; courthouse logo replaces the pine as the brand mark everywhere; saver fix — long Next Event names step down in size and wrap whole instead of ellipsizing) // v26 = Community Screensaver 2026-11-05 (ambient display mode: community photo pool crossfading slowly full-screen — the one place photo cycling belongs — big clock/date, pinned live answers in across-the-room type, unattended-safe, ?display=1 TV bookmark; pins on the glance strip items + Events & More card chips, localStorage ccl-saver-pins-v1; photo submissions via PHOTO_FORM_URL placeholder + human review gate, pool in data/community-photos.json) // v25 = v4 tide-glance correction 2026-11-05 (the strip's river item leads with the tide in plain words — "Incoming tide · High 2:08 PM" from the same NOAA St. Helens predictions the tides card loads; the Port Westward gauge level drops to the sub-line; tile now links to the tides card; EN/ES both) // v24 = v4 revision 2026-11-05 (theme toggle moved beside the clock; strip smoothness — backdrop blur removed from the animated strip, right-sized clones, signature-batched sync; first-paint pass — reveal never hides on-screen cards, non-Today backgrounds lazy-attached; Today backgrounds de-bridged — Rainier dock day / river-mouth panorama dusk, hero keeps the bridge; sponsor rails on Today + Events & More + a top sponsor card on Events & More; green bar reads "Live view"; natural stagger — v2 offset margins deleted, pairs take natural heights, Travel/Outdoors balanced columns) // v23 = v3 revision 2026-11-05 (continuous full-width glance strip; calm per-view photo background per the portfolio pattern; glass cards unchanged) // v22 = v2 revision 2026-11-05 (full-page photo background + all-glass cards + staggered pairs) // v21 = Redesign prototype 2026-11-05 (fall palette, ticker, sponsor system, dark mode — sandbox preview only) // v20 = Sponsor form swap 2026-11-05 (SPONSOR_FORM_URL live in app.js — the founding-sponsor Google Form replaces the interim mailto button in About/support); v19 = WS-1d follow-up 2 2026-11-04 (map-tap close for the layers panel listens on the map container in the CAPTURE phase — the v18 bubble-phase listener was measured live still failing when the tap landed on a marker, because Leaflet stops marker clicks from bubbling; capture reaches the container first); v18 = WS-1d follow-up (DOM-level map-tap close, bubble phase — superseded by v19); v17 = WS-1 2026-11-04 (school-closures board — curated data/schools.json, dormant-ready, EN+ES dynamic status labels; About / founding-sponsor interest section — SPONSOR_FORM_URL config in app.js, interim mailto capture, nothing for sale; accessibility pass from a live Lighthouse run (a11y 0.92): --accent-2 darkened #0d8a5f→#0b7a52 for contrast, role=tablist misuse fixed to role=group + aria-pressed sync on the five toggle groups, lang-btn label/name mismatch removed, chip/button tap targets raised to ≥36px; WS-1d same publish: map layers panel collapsed by default — Leaflet collapsed:true + tap-map / tap-toggle-again close wiring, mobile caps ≤70vw + max-height scroll + compact rows, 44px toggle); v16 = Fishing answer card 5-day pick 2026-11-04 (When row: Today..+4 with weekday+date chips in America/Los_Angeles; days +2..+4 are labeled outlooks — salmon: heatModel at the future date with a ×0.8/day-beyond-tomorrow confidence decay on the stretch score before the tracker's own thresholds, outlook why from today's counts; steelhead: the same index in forecast mode — NWS QPF through the rain-to-river mapping for flow/clarity on every river kind, that day's forecast for cold/weather — why led by "Early call from the forecast"; Forecast/Outlook tag beside the pill; NOAA current predictions fetched 6 days out so best windows quote for +2..+4; ES chip chrome; index card, tracker gate/maths for today, steelhead weights and day-plan segment logic unchanged); v15 = strip label fit stages 2026-11-04 (the anchor fit check is now staged and 2D: full labels → John Day drops to its own line (suffixes kept) → suffixes shed → ticks only; measured live at 360px: one-line labels collide ~55px, bare names ~11px, the split layout fits; the check also re-runs when the Outdoors view is shown, since the strip renders inside a hidden view where it cannot be measured); v14 = strip label fit fix 2026-11-04 (the anchor fit check sheds the river-mile suffixes before dropping labels; same build as v13 otherwise); v13 = Fishing answer card + Salmon Tracker declutter 2026-11-04 (intent-first answer card at the top of the fishing section: Salmon/Steelhead × stretch-or-river × Today/Tomorrow chips, one GOOD/FAIR/POOR glance composed only from the tracker surface, the steelhead index's own per-day verdicts, and the day plan's best segment; choices persist; tracker card decluttered — intro + basis moved into the Why expander, verdict face shortened to one sentence, heat strip labels cut to three anchors with a mechanical no-overlap fit check, towns as bare ticks, one county zone label, one-line legend, gray=no-signal caption kept; day-plan source notes shortened; EN+ES chrome); v12 = Steelhead Day Index 2026-11-04 (Outdoors fishing section: per-river Good/Fair/Poor day for the Wilson, Nehalem, NF Nehalem, Big Creek, Gnat Creek, Klaskanine, Clatskanie and Scappoose from run timing, USGS gauge flow + typical range, MRMS basin-rain clarity model, NWS freeze/weather factors, first light + general Oregon angling-hours window; fetcher steelhead.json full-run only; EN+ES chrome); v11 = Facebook public events merge 2026-11-04 (data/fb-events.json from the FB events checker merges client-side into the calendar events — calendar wins title+date collisions; FB-only rows wear a Facebook tag and link to the event page; Tonight & tomorrow + glance tile merge too; EN+ES source note); v10 = County Briefing visual front 2026-11-04 (briefing card renders designed rows from the same structured pass that builds the copied note; the raw text box is gone — copy/share/speech text byte-identical; EN+ES note wording adjusted); v9 = Day-plan copy polish 2026-11-04 (anchor-strong wording follows the actual sequence; tomorrow line merges same-method runs); v8 = Salmon Tracker UX build + GoatCounter beacon 2026-11-04 (verdict-first GOOD/FAIR/SLOW for the home stretch, single-hue heat strip + toggleable map heat layer, one-tap Why, method-switching day plan from NOAA CO-OPS current predictions at Walker Island with tide-curve fallback; invisible GoatCounter analytics beacon; EN+ES chrome); v6 = Fish counts + Salmon Tracker 2026-11-04 (Bonneville/The Dalles/John Day counts card + measured-window wave tracker, Outdoors view; EN+ES chrome); v5 = Build batch 2026-11-04 (My Route camera strip, incident honesty + verdict scope fix, route-ahead forecast, ships passing-soon ETAs, Bend run pass card; EN+ES); v4 = Copy sweep 2026-11-04 (privacy-reassurance boilerplate removed, EN+ES); v3 = Feature audit 2026-11-04 (Near-me popup fix); v2 = Redesign (view navigation + light modern theme)
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
  'img/card-fish.jpg',
  'img/card-pier.jpg',
  'img/featured-vintage.jpg',
  'img/cascade-thumb.jpg',
  'img/cascade-thumb-mobile.jpg',
  'img/icon-192.png',
  'img/icon-512.png',
  'img/icon-maskable-512.png',
  'img/icons/icon-logo-courthouse.png',
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
