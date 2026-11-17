/* Columbia County Live — preview module: Property lines + Hunting units.
 *
 * Adds two toggleable overlays to the Travel map's existing layer control:
 *  - "Property lines": Columbia County tax-lot boundaries (Assessor data).
 *    Tap a parcel -> frosted map card with owner of record, situs address,
 *    acreage and assessed value, straight from the county file.
 *  - "Hunting units": ODFW wildlife management units + travel management
 *    areas, with public/private land shading derived from parcel ownership.
 *    Access & Habitat areas get their own treatment when present.
 *
 * Data ships as PMTiles vector archives rendered by protomaps-leaflet.
 * Both layers are OFF by default; the map behaves exactly as before until
 * a visitor toggles one on. All strings are bilingual (EN/ES) following
 * the site's documentElement.lang pattern (same as offline-map.js).
 */
(function () {
  'use strict';

  var STR = {
    en: {
      parcels: '🏠 Property lines',
      hunting: '🦌 Hunting units',
      owner: 'Owner',
      address: 'Address',
      acres: 'Acres',
      av: 'Assessed value',
      taxlot: 'Tax lot',
      unit: 'Hunting unit',
      unitsize: 'Unit size',
      region: 'Region',
      publicLand: 'Public land',
      privateLand: 'Private land',
      ahName: 'Access & Habitat area',
      ahNote: 'Private land open to hunting by agreement through ODFW\u2019s Access & Habitat program. Check current ODFW rules before you go.',
      tmaNote: 'Travel Management Area \u2014 motor vehicle rules apply during hunting season. Check ODFW for the current rules.',
      parcelFoot: 'Tax map boundaries are approximate. Not a legal survey. County data is provided as-is and may not be accurate. Source: Columbia County Assessor, updated every two weeks.',
      unitFoot: 'Unit boundaries are for general knowledge and illustration only. The legal unit descriptions in the Oregon Big Game Regulations govern. Source: ODFW.'
    },
    es: {
      parcels: '🏠 Líneas de propiedad',
      hunting: '🦌 Unidades de caza',
      owner: 'Propietario',
      address: 'Dirección',
      acres: 'Acres',
      av: 'Valor tasado',
      taxlot: 'Lote fiscal',
      unit: 'Unidad de caza',
      unitsize: 'Tamaño de la unidad',
      region: 'Región',
      publicLand: 'Tierra pública',
      privateLand: 'Tierra privada',
      ahName: 'Área de Acceso y Hábitat',
      ahNote: 'Tierra privada abierta a la caza por acuerdo a través del programa Access & Habitat de ODFW. Verifique las reglas actuales de ODFW antes de ir.',
      tmaNote: 'Área de gestión de viajes: aplican reglas para vehículos motorizados durante la temporada de caza. Consulte a ODFW para conocer las reglas actuales.',
      parcelFoot: 'Los límites del mapa fiscal son aproximados. No es un levantamiento legal. Los datos del condado se ofrecen tal cual y pueden no ser exactos. Fuente: Tasador del Condado de Columbia, actualización cada dos semanas.',
      unitFoot: 'Los límites de las unidades son solo para conocimiento general e ilustración. Rigen las descripciones legales de las Regulaciones de Caza Mayor de Oregón. Fuente: ODFW.'
    }
  };

  function lang() { return document.documentElement.lang === 'es' ? 'es' : 'en'; }
  function t(k) { return STR[lang()][k]; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtAcres(a) {
    if (a == null || isNaN(a)) return '';
    a = Number(a);
    if (a >= 100) return Math.round(a).toLocaleString('en-US');
    if (a >= 10) return a.toFixed(1);
    return a.toFixed(2);
  }
  function fmtMoney(v) {
    if (v == null || isNaN(v)) return '';
    return '$' + Math.round(Number(v)).toLocaleString('en-US');
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

  var map = null, parcelsView = null, huntingParcelsView = null,
      huntingView = null, huntingGroup = null;
  var selectedId = null, myPopup = null;

  function isSel(f) { return selectedId != null && f.props && f.props.id === selectedId; }

  function buildLayers() {
    var PM = window.protomapsL;
    parcelsView = PM.leafletLayer({
      url: 'parcel-map/parcels.pmtiles',
      maxDataZoom: 16, minZoom: 13, zIndex: 262,
      paintRules: [{
        dataLayer: 'parcels',
        symbolizer: new PM.PolygonSymbolizer({
          fill: function (z, f) { return isSel(f) ? 'rgba(245,197,66,0.45)' : 'rgba(245,197,66,0.05)'; },
          stroke: function (z, f) { return isSel(f) ? '#b45309' : 'rgba(146,110,30,0.55)'; },
          width: function (z, f) { return isSel(f) ? 2.4 : 0.7; }
        })
      }]
    });
    // Same archive, second view: public/private shading for the hunting layer.
    huntingParcelsView = PM.leafletLayer({
      url: 'parcel-map/parcels.pmtiles',
      maxDataZoom: 16, minZoom: 13, zIndex: 258,
      paintRules: [{
        dataLayer: 'parcels',
        symbolizer: new PM.PolygonSymbolizer({
          fill: function (z, f) {
            return f.props.ownclass === 'public'
              ? 'rgba(34,150,80,0.32)' : 'rgba(168,140,90,0.10)';
          },
          stroke: 'rgba(100,90,70,0.30)',
          width: 0.5
        })
      }]
    });
    huntingView = PM.leafletLayer({
      url: 'parcel-map/hunting.pmtiles',
      maxDataZoom: 14, zIndex: 259,
      paintRules: [
        { dataLayer: 'wmu', symbolizer: new PM.PolygonSymbolizer({ fill: 'rgba(179,84,30,0.05)', stroke: '#b3541e', width: 1.8 }) },
        { dataLayer: 'tma', symbolizer: new PM.PolygonSymbolizer({ fill: 'rgba(220,38,38,0.07)', stroke: '#dc2626', width: 1.2 }) },
        { dataLayer: 'ah', symbolizer: new PM.PolygonSymbolizer({ fill: 'rgba(13,148,136,0.35)', stroke: '#0f766e', width: 1.5 }) }
      ]
    });
    huntingGroup = L.layerGroup([huntingParcelsView, huntingView]);

    var ctl = window.CCL_LAYERS_CTL;
    ctl.addOverlay(parcelsView, '<span id="pm-lab-parcels">' + t('parcels') + '</span>');
    ctl.addOverlay(huntingGroup, '<span id="pm-lab-hunting">' + t('hunting') + '</span>');
  }

  /* ------------------------------------------------------------- legend */
  function refreshLegend() {
    var el = document.getElementById('pm-legend');
    if (!el || !map) return;
    var hasP = map.hasLayer(parcelsView);
    var hasH = map.hasLayer(huntingGroup);
    var items = [];
    if (hasP) items.push('<span><i class="pm-sw pm-sw-parcel"></i>' + t('parcels').replace(/^🏠\s*/, '') + '</span>');
    if (hasH) {
      items.push('<span><i class="pm-sw pm-sw-public"></i>' + t('publicLand') + '</span>');
      items.push('<span><i class="pm-sw pm-sw-private"></i>' + t('privateLand') + '</span>');
      items.push('<span><i class="pm-sw pm-sw-unit"></i>' + t('hunting').replace(/^🦌\s*/, '') + '</span>');
    }
    el.innerHTML = items.join('');
    el.style.display = items.length ? '' : 'none';
  }
  function refreshLabels() {
    var a = document.getElementById('pm-lab-parcels');
    var b = document.getElementById('pm-lab-hunting');
    if (a) a.textContent = t('parcels');
    if (b) b.textContent = t('hunting');
    refreshLegend();
  }

  /* ---------------------------------------------------------------- tap */
  function pick(view, latlng, layerName) {
    try {
      var bySrc = view.queryTileFeaturesDebug(latlng.lng, latlng.lat, 2);
      var found = [];
      bySrc.forEach(function (arr) {
        (arr || []).forEach(function (pf) {
          if (pf.layerName === layerName) found.push(pf.feature.props);
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
    // Phone widths: the zoom control owns the map's top-left corner.
    // Give autopan a keep-out there so the card (and its title) is
    // panned clear of the +/- buttons instead of sliding under them.
    // Desktop layout is untouched.
    if (map && map.getSize().x <= 480) {
      opts.autoPanPaddingTopLeft = [58, 96];
    }
    myPopup = L.popup(opts).setLatLng(latlng).setContent(html);
    myPopup.openOn(map);
  }
  function parcelCard(p, unit, ah, tma, huntingOn) {
    var title = p.owner || p.situs || (t('taxlot') + ' ' + p.taxlot);
    var sub = (p.owner && p.situs) ? p.situs : '';
    var pairs = [
      [t('taxlot'), esc(p.taxlot)],
      [t('acres'), p.acres != null ? fmtAcres(p.acres) : ''],
      [t('av'), p.av != null ? fmtMoney(p.av) : '']
    ];
    if (p.owner && p.situs) pairs.unshift([t('owner'), esc(p.owner)]);
    if (huntingOn && unit) {
      pairs.push([t('unit'), esc(unit.name) + ' ' + esc(unit.num)]);
    }
    var notes = [];
    if (huntingOn && ah) notes.push('<strong>' + esc(ah.name) + '</strong> \u2014 ' + t('ahNote'));
    if (huntingOn && tma) notes.push('<strong>' + esc(tma.name) + '</strong> \u2014 ' + t('tmaNote'));
    return card(esc(title), esc(sub), pairs, notes, t('parcelFoot'));
  }
  function unitCard(u, ah, tma) {
    var pairs = [
      [t('unitsize'), u.acres != null ? fmtAcres(u.acres) + ' ac' : ''],
      [t('region'), esc(u.region)]
    ];
    var notes = [];
    if (ah) notes.push('<strong>' + esc(ah.name) + '</strong> \u2014 ' + t('ahNote'));
    if (tma) notes.push('<strong>' + esc(tma.name) + '</strong> \u2014 ' + t('tmaNote'));
    return card(esc(u.name) + ' ' + t('unit') + ' ' + esc(u.num), '', pairs, notes, t('unitFoot'));
  }
  function ahCard(a, unit) {
    var pairs = [[t('acres'), a.acres != null ? fmtAcres(a.acres) : '']];
    if (unit) pairs.push([t('unit'), esc(unit.name) + ' ' + esc(unit.num)]);
    return card(esc(a.name), t('ahName'), pairs, [t('ahNote')], t('unitFoot'));
  }
  function tmaCard(tm, unit) {
    var pairs = [];
    if (unit) pairs.push([t('unit'), esc(unit.name) + ' ' + esc(unit.num)]);
    return card(esc(tm.name), '', pairs, [t('tmaNote')], t('unitFoot'));
  }

  function onMapClick(e) {
    var hasP = map.hasLayer(parcelsView);
    var hasH = map.hasLayer(huntingGroup);
    if (!hasP && !hasH) return;
    var unit = null, ah = null, tma = null;
    if (hasH) {
      unit = pick(huntingView, e.latlng, 'wmu')[0] || null;
      ah = pick(huntingView, e.latlng, 'ah')[0] || null;
      tma = pick(huntingView, e.latlng, 'tma')[0] || null;
    }
    var parcel = null;
    if (hasP) parcel = pick(parcelsView, e.latlng, 'parcels')[0] || null;
    if (!parcel && hasH) parcel = pick(huntingParcelsView, e.latlng, 'parcels')[0] || null;

    if (parcel && hasP) {
      selectedId = parcel.id;
      try { parcelsView.rerenderTiles(); } catch (err) { /* older build */ }
      openCard(e.latlng, parcelCard(parcel, unit, ah, tma, hasH));
    } else if (hasH && ah) {
      openCard(e.latlng, ahCard(ah, unit));
    } else if (hasH && unit) {
      openCard(e.latlng, unitCard(unit, null, tma));
    } else if (hasH && tma) {
      openCard(e.latlng, tmaCard(tma, null));
    } else if (parcel && hasH) {
      // Hunting-only mode: parcel shading tap still answers "who owns this"
      selectedId = null;
      openCard(e.latlng, parcelCard(parcel, unit, ah, tma, true));
    }
  }

  /* ---------------------------------------------------------------- init */
  function init() {
    map = window.CCL_MAP;
    buildLayers();
    // Legend hook: our own span inside the site's map legend.
    var legend = document.querySelector('#map-card .map-legend');
    if (legend && !document.getElementById('pm-legend')) {
      var span = document.createElement('span');
      span.className = 'pm-legend';
      span.id = 'pm-legend';
      span.style.display = 'none';
      legend.appendChild(span);
    }
    map.on('click', onMapClick);
    map.on('layeradd layerremove', function () { refreshLegend(); });
    map.on('popupclose', function (ev) {
      if (myPopup && ev.popup === myPopup && selectedId != null) {
        selectedId = null;
        try { parcelsView.rerenderTiles(); } catch (err) { /* noop */ }
      }
    });
    new MutationObserver(refreshLabels).observe(document.documentElement, {
      attributes: true, attributeFilter: ['lang']
    });
    refreshLabels();
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (window.CCL_MAP && window.CCL_LAYERS_CTL && window.L && window.protomapsL) {
      clearInterval(timer);
      try { init(); } catch (err) { if (window.console) console.error('parcel-map init failed', err); }
    } else if (tries > 160) {
      clearInterval(timer);
    }
  }, 250);
})();
