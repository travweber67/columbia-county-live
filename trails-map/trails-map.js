/* Columbia County Live — Trails overlay for the Travel map.
 *
 * Adds one toggleable overlay to the Travel map's layer control:
 *  - "Trails": named Columbia County trails (OpenStreetMap: named route
 *    relations + named paths, clipped to the county line). Every line in
 *    the pack carries its real name. Tap a trail -> frosted map card with
 *    the name, type and total mapped length, and the trail's full named
 *    route highlights until the card closes or another trail is tapped
 *    (the standing trail tap rule).
 *
 * Data ships as one PMTiles archive rendered by protomaps-leaflet, OFF
 * by default. The archive is the same file the Offline map download
 * saves (served from offline-map/packs/columbia-trails.pmtiles): when
 * the visitor has downloaded the map, this layer reads the on-device
 * copy from OPFS and works with no signal; otherwise it streams from
 * the site by HTTP range requests.
 * All strings are bilingual (EN/ES) following the site's
 * documentElement.lang pattern (same as parcel-map.js / offline-map.js).
 */
(function () {
  'use strict';

  var STR = {
    en: {
      trails: '🥾 Trails',
      type: 'Type',
      length: 'Length',
      about: 'About {MI} mi',
      kindTrail: 'Trail',
      kindBike: 'Bike trail',
      kindMtb: 'Mountain bike trail',
      kindHorse: 'Horse trail',
      kindOhv: 'OHV trail',
      foot: 'Trail lines and names from OpenStreetMap. Trails change — check current access and closures before you go.'
    },
    es: {
      trails: '🥾 Senderos',
      type: 'Tipo',
      length: 'Longitud',
      about: 'Unas {MI} mi',
      kindTrail: 'Sendero',
      kindBike: 'Sendero para bicicletas',
      kindMtb: 'Sendero de bicicleta de montaña',
      kindHorse: 'Sendero para caballos',
      kindOhv: 'Sendero OHV (vehículos todoterreno)',
      foot: 'Líneas y nombres de senderos de OpenStreetMap. Los senderos cambian — verifique el acceso actual y los cierres antes de ir.'
    }
  };

  function lang() { return document.documentElement.lang === 'es' ? 'es' : 'en'; }
  function t(k) { return STR[lang()][k]; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Mirror app.js popRows/popCard markup so the site's .mapcard CSS applies.
  function rows(pairs) {
    var r = (pairs || []).filter(function (p) { return p && p[1] != null && p[1] !== ''; });
    if (!r.length) return '';
    return '<dl class="mapcard-rows">' + r.map(function (p) {
      return '<dt>' + p[0] + '</dt><dd>' + p[1] + '</dd>';
    }).join('') + '</dl>';
  }
  function card(title, sub, pairs, notes, foot) {
    return '<div class="mapcard"><div class="mapcard-title">' + title + '</div>'
      + (sub ? '<div class="mapcard-sub">' + sub + '</div>' : '')
      + rows(pairs)
      + (notes || []).map(function (n) {
        return '<div class="mapcard-foot">' + n + '</div>';
      }).join('')
      + (foot ? '<div class="mapcard-foot">' + foot + '</div>' : '')
      + '</div>';
  }

  /* -------- archive source: downloaded OPFS copy first, else stream --- */
  var pmtilesLibP = null;
  function loadPmtilesLib() {
    if (window.pmtiles) return Promise.resolve();
    if (pmtilesLibP) return pmtilesLibP;
    pmtilesLibP = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'offline-map/vendor/pmtiles.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return pmtilesLibP;
  }
  async function resolveSource(id, file, size, fallbackUrl) {
    try {
      var CFG = window.OFFLINE_MAP_CONFIG;
      if (!CFG || !file || !size) return fallbackUrl;
      var recs = {};
      try { recs = JSON.parse(localStorage.getItem(CFG.storageKey) || '{}'); } catch (e) { return fallbackUrl; }
      var rec = recs[id];
      if (!rec || rec.size !== size) return fallbackUrl;
      await loadPmtilesLib();
      var root = await navigator.storage.getDirectory();
      var dir = await root.getDirectoryHandle('packs');
      var fh = await dir.getFileHandle(file);
      var blob = await fh.getFile();
      if (!blob || blob.size !== size) return fallbackUrl;
      return new window.pmtiles.PMTiles(new window.pmtiles.FileSource(blob));
    } catch (e) { return fallbackUrl; }
  }
  function resolveSourceTimed(id, file, size, fallbackUrl) {
    var timeout = new Promise(function (res) { setTimeout(function () { res(fallbackUrl); }, 3000); });
    return Promise.race([resolveSource(id, file, size, fallbackUrl), timeout]);
  }

  var map = null, trailsView = null;
  var selectedName = null, myPopup = null;

  function isSel(f) { return selectedName != null && f.props && f.props.name === selectedName; }

  function buildLayer(src) {
    var PM = window.protomapsL;
    // No minZoom, deliberately: Leaflet 1.9's layers control disables
    // an overlay's checkbox outside the layer's zoom range (the v101
    // property-lines bug). The archive starts at z10; below that the
    // layer simply draws nothing and the toggle stays live.
    trailsView = PM.leafletLayer({
      url: src,
      maxDataZoom: 16, zIndex: 260,
      paintRules: [
        { dataLayer: 'trails', symbolizer: new PM.LineSymbolizer({
            color: function (z, f) { return f.props && f.props.kind === 'ohv' ? '#c2570c' : '#7a5a21'; },
            width: function (z, f) { return isSel(f) ? 0 : 2.4; },
            dash: [6, 4]
          }) },
        { dataLayer: 'trails', symbolizer: new PM.LineSymbolizer({
            color: '#0b1220',
            width: function (z, f) { return isSel(f) ? 8 : 0; }
          }) },
        { dataLayer: 'trails', symbolizer: new PM.LineSymbolizer({
            color: '#fde047',
            width: function (z, f) { return isSel(f) ? 4.5 : 0; }
          }) }
      ]
    });
    var ctl = window.CCL_LAYERS_CTL;
    ctl.addOverlay(trailsView, '<span id="tm-lab-trails">' + t('trails') + '</span>');
  }

  /* ------------------------------------------------------------- legend */
  function refreshLegend() {
    var el = document.getElementById('tm-legend');
    if (!el || !map || !trailsView) return;
    var on = map.hasLayer(trailsView);
    el.innerHTML = on
      ? '<span><i class="tm-sw tm-sw-trail"></i>' + t('trails').replace(/^🥾\s*/, '') + '</span>'
      : '';
    el.style.display = on ? '' : 'none';
  }
  function refreshLabels() {
    var a = document.getElementById('tm-lab-trails');
    if (a) a.textContent = t('trails');
    refreshLegend();
  }

  /* ---------------------------------------------------------------- tap */
  function pick(latlng) {
    try {
      var bySrc = trailsView.queryTileFeaturesDebug(latlng.lng, latlng.lat, 14);
      var found = [];
      bySrc.forEach(function (arr) {
        (arr || []).forEach(function (pf) {
          if (pf.layerName === 'trails') found.push(pf.feature.props);
        });
      });
      return found;
    } catch (err) { return []; }
  }
  function openCard(latlng, html) {
    var opts = {
      maxWidth: 284, minWidth: 230, autoPanPadding: [16, 16],
      className: 'mapcard-pop'
    };
    // Same phone keep-out as the parcel cards: never slide under the
    // zoom control at phone widths.
    if (map && map.getSize().x <= 480) {
      opts.autoPanPaddingTopLeft = [58, 96];
    }
    myPopup = L.popup(opts).setLatLng(latlng).setContent(html);
    myPopup.openOn(map);
  }
  function trailCard(p) {
    var kindKey = { trail: 'kindTrail', bike: 'kindBike', mtb: 'kindMtb', horse: 'kindHorse', ohv: 'kindOhv' }[p.kind] || 'kindTrail';
    var pairs = [[t('type'), t(kindKey)]];
    if (p.len_mi != null && p.len_mi !== '') {
      pairs.push([t('length'), t('about').replace('{MI}', p.len_mi)]);
    }
    return card(esc(p.name), '', pairs, [], t('foot'));
  }
  function onMapClick(e) {
    if (!trailsView || !map.hasLayer(trailsView)) return;
    var hit = pick(e.latlng)[0];
    if (!hit || !hit.name) return;
    selectedName = hit.name;
    try { trailsView.rerenderTiles(); } catch (err) { /* older build */ }
    openCard(e.latlng, trailCard(hit));
  }

  /* ---------------------------------------------------------------- init */
  function init() {
    map = window.CCL_MAP;
    var legend = document.querySelector('#map-card .map-legend');
    if (legend && !document.getElementById('tm-legend')) {
      var span = document.createElement('span');
      span.className = 'tm-legend';
      span.id = 'tm-legend';
      span.style.display = 'none';
      legend.appendChild(span);
    }
    new MutationObserver(refreshLabels).observe(document.documentElement, {
      attributes: true, attributeFilter: ['lang']
    });
    var CFG = window.OFFLINE_MAP_CONFIG || {};
    resolveSourceTimed('trails', CFG.trailsFile, CFG.trailsSize,
      'offline-map/packs/' + (CFG.trailsFile || 'columbia-trails.pmtiles')
    ).then(function (src) {
      try {
        buildLayer(src);
        map.on('click', onMapClick);
        map.on('layeradd layerremove', function () { refreshLegend(); });
        map.on('popupclose', function (ev) {
          if (myPopup && ev.popup === myPopup && selectedName != null) {
            selectedName = null;
            try { trailsView.rerenderTiles(); } catch (err) { /* noop */ }
          }
        });
        refreshLabels();
      } catch (err) { if (window.console) console.error('trails-map layer failed', err); }
    });
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (window.CCL_MAP && window.CCL_LAYERS_CTL && window.L && window.protomapsL) {
      clearInterval(timer);
      try { init(); } catch (err) { if (window.console) console.error('trails-map init failed', err); }
    } else if (tries > 160) {
      clearInterval(timer);
    }
  }, 250);
})();
