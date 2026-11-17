"use strict";
/* Offline Map module — Columbia County Live / Tillamook County Live (preview).
 *
 * One shared module, parameterized per site by window.OFFLINE_MAP_CONFIG:
 *   { countyEn, countyEs, packFile, packSize, lowroadsFile, lowroadsSize,
 *     bounds: [w, s, e, n], storageKey }
 *
 * Architecture (same proven pattern as the Oregon OHV Map app):
 *   - Vector basemap in ONE PMTiles archive per county (Protomaps daily
 *     build, OpenStreetMap data), rendered on-device by MapLibre GL.
 *   - "Download" streams the archive into the Origin Private File System
 *     (OPFS); afterwards the map reads tiles from the on-device file with
 *     byte-range reads and needs no network at all.
 *   - Before download (or after delete), the same map streams tiles from
 *     the server copy over HTTP range requests — so visitors can look
 *     first and decide whether to save it.
 *   - A small low-roads overlay archive (OSM via Geofabrik, z8-11) covers
 *     the Protomaps basemap's known gap: it carries no minor roads or
 *     forest tracks below zoom 12.
 * Vendor libs (MapLibre GL, PMTiles) load lazily on first open so the
 * host page pays nothing until a visitor actually taps the button.
 */
(function () {
  var CFG = window.OFFLINE_MAP_CONFIG;
  if (!CFG) return;
  var BASE = new URL("offline-map/", document.baseURI).href;

  var STR = {
    en: {
      btn: "⬇ Offline map",
      title: "Offline map",
      close: "Close",
      notDownloaded: "Not saved on this device yet",
      downloading: "Downloading…",
      saved: "✓ Saved on this device — works with no signal",
      stale: "⬆ An updated map is available",
      partial: "Partly downloaded",
      download: "Download map for offline",
      redownload: "Finish downloading",
      update: "Update map",
      remove: "Remove from device",
      sizeNote: "One download, about {MB}. Roads, towns, rivers and place names for the whole county, saved on your device.",
      scopeNote: "This map works with no signal. Live information (river levels, road cameras, weather, events) still needs a connection and stays on the main pages.",
      failed: "Download stopped — check your connection and try again.",
      savedToast: "Map saved — it now works with no signal",
      removedToast: "Offline map removed from this device",
      storage: "Offline map data on this device: {MB}.",
      attrib: "Map data © OpenStreetMap contributors",
      locating: "Find me"
    },
    es: {
      btn: "⬇ Mapa sin conexión",
      title: "Mapa sin conexión",
      close: "Cerrar",
      notDownloaded: "Aún no está guardado en este dispositivo",
      downloading: "Descargando…",
      saved: "✓ Guardado en este dispositivo — funciona sin señal",
      stale: "⬆ Hay una versión actualizada del mapa",
      partial: "Descarga parcial",
      download: "Descargar el mapa para usarlo sin conexión",
      redownload: "Terminar la descarga",
      update: "Actualizar el mapa",
      remove: "Quitar de este dispositivo",
      sizeNote: "Una sola descarga, unos {MB}. Carreteras, pueblos, ríos y nombres de lugares de todo el condado, guardados en su dispositivo.",
      scopeNote: "Este mapa funciona sin señal. La información en vivo (niveles de ríos, cámaras, clima, eventos) sigue necesitando conexión y permanece en las páginas principales.",
      failed: "La descarga se detuvo — revise su conexión e inténtelo de nuevo.",
      savedToast: "Mapa guardado — ahora funciona sin señal",
      removedToast: "Mapa sin conexión eliminado de este dispositivo",
      storage: "Datos del mapa sin conexión en este dispositivo: {MB}.",
      attrib: "Datos del mapa © colaboradores de OpenStreetMap",
      locating: "Mi ubicación"
    }
  };
  function lang() { return document.documentElement.lang === "es" ? "es" : "en"; }
  function t(k) { return STR[lang()][k]; }
  function fmtMB(bytes) { return (bytes / 1048576).toFixed(1) + " MB"; }
  function countyName() { return lang() === "es" ? CFG.countyEs : CFG.countyEn; }

  /* ---------------- local record + OPFS (OHV pattern) ---------------- */
  var localFiles = {};
  try { localFiles = JSON.parse(localStorage.getItem(CFG.storageKey) || "{}"); } catch (e) { localFiles = {}; }
  function saveLocal() { try { localStorage.setItem(CFG.storageKey, JSON.stringify(localFiles)); } catch (e) {} }
  var FILES = [
    { id: "basemap", file: CFG.packFile, size: CFG.packSize },
    { id: "lowroads", file: CFG.lowroadsFile, size: CFG.lowroadsSize }
  ];
  function fileState(f) {
    var rec = localFiles[f.id];
    if (!rec) return "missing";
    if (f.size && rec.size !== f.size) return "stale";
    return "current";
  }
  function isLocal(f) { return fileState(f) === "current"; }
  function packState() {
    var st = FILES.map(fileState);
    if (st.every(function (s) { return s === "current"; })) return "full";
    if (st.every(function (s) { return s === "missing"; })) return "none";
    if (st.some(function (s) { return s === "missing"; })) return "partial";
    return "stale";
  }
  async function packsDir() {
    var root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle("packs", { create: true });
  }
  async function opfsFile(name) {
    try {
      var dir = await packsDir();
      var fh = await dir.getFileHandle(name);
      return await fh.getFile();
    } catch (e) { return null; }
  }
  async function opfsDelete(name) {
    try {
      var dir = await packsDir();
      await dir.removeEntry(name);
    } catch (e) { /* already gone */ }
  }

  /* ---------------- lazy vendor loading ---------------- */
  var vendorReady = null;
  function loadVendor() {
    if (vendorReady) return vendorReady;
    vendorReady = new Promise(function (resolve, reject) {
      var css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = BASE + "vendor/maplibre-gl.css";
      document.head.appendChild(css);
      var s1 = document.createElement("script");
      s1.src = BASE + "vendor/pmtiles.js";
      s1.onload = function () {
        var s2 = document.createElement("script");
        s2.src = BASE + "vendor/maplibre-gl.js";
        s2.onload = function () { resolve(); };
        s2.onerror = reject;
        document.head.appendChild(s2);
      };
      s1.onerror = reject;
      document.head.appendChild(s1);
    });
    return vendorReady;
  }

  /* ---------------- style (adapted from the OHV app's basemap) ------- */
  var FONT_MED = ["Noto Sans Medium"];
  var FONT_REG = ["Noto Sans Regular"];
  function buildStyle(basemapUrl, lowroadsUrl) {
    var L = [];
    function push(o) { L.push(o); }
    push({ id: "background", type: "background", paint: { "background-color": "#f2efe9" } });
    push({ id: "earth", type: "fill", source: "basemap", "source-layer": "earth",
      paint: { "fill-color": "#f2efe9" } });
    push({ id: "landcover", type: "fill", source: "basemap", "source-layer": "landcover",
      paint: { "fill-color": ["match", ["get", "kind"],
          "forest", "#cfe0bd", "wood", "#cfe0bd", "grass", "#ddeac6", "meadow", "#ddeac6",
          "scrub", "#e2e6c8", "sand", "#f0e6c8", "glacier", "#ffffff", "wetland", "#cfe0d8",
          "#e6e2d5"],
        "fill-opacity": 0.55 } });
    push({ id: "landuse", type: "fill", source: "basemap", "source-layer": "landuse",
      paint: { "fill-color": ["match", ["get", "kind"],
          "park", "#c8e2b0", "forest", "#cfe0bd", "nature_reserve", "#c8e2b0",
          "cemetery", "#d4e4c0", "pitch", "#bfe3c0", "school", "#efe8d8",
          "hospital", "#f2dcd8", "industrial", "#e8dde4", "residential", "#efe9dd",
          "commercial", "#f2e3d5", "aerodrome", "#e3e3e3", "#e9e5da"],
        "fill-opacity": 0.5 } });
    push({ id: "water-fill", type: "fill", source: "basemap", "source-layer": "water",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": "#a9cde8" } });
    push({ id: "water-line", type: "line", source: "basemap", "source-layer": "water",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-color": "#8fb8dd",
        "line-width": ["match", ["get", "kind"], "river", 1.8, "canal", 1.1, 0.9] } });
    /* low-roads overlay (z8-11.99): minor roads + tracks the basemap
       tiles don't carry below zoom 12 */
    var lrOpt = { minzoom: 7.5, maxzoom: 11.99 };
    push({ id: "lr-case", type: "line", source: "lowroads", "source-layer": "lowroads", ...lrOpt,
      filter: ["in", ["get", "cls"], ["literal", ["minor", "track"]]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "rgba(110,100,85,0.5)",
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.5, 11, 2.4, 12, 3.2] } });
    push({ id: "lr-major", type: "line", source: "lowroads", "source-layer": "lowroads", ...lrOpt,
      filter: ["==", ["get", "cls"], "major"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#f2cd85",
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.2, 11, 2.2, 12, 3] } });
    push({ id: "lr-minor", type: "line", source: "lowroads", "source-layer": "lowroads", ...lrOpt,
      filter: ["==", ["get", "cls"], "minor"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.9, 11, 1.7, 12, 2.4] } });
    push({ id: "lr-track", type: "line", source: "lowroads", "source-layer": "lowroads", ...lrOpt,
      filter: ["==", ["get", "cls"], "track"],
      layout: { "line-join": "round" },
      paint: { "line-color": "#a98a68", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.9, 11, 1.5, 12, 2], "line-dasharray": [4, 2] } });
    /* roads from the basemap archive */
    var roadPaint = { motorway: "#e0822a", trunk: "#e8a34c", primary: "#f0bc66", secondary: "#f5d189" };
    push({ id: "rd-case", type: "line", source: "basemap", "source-layer": "roads",
      filter: ["in", ["get", "kind"], ["literal", ["highway", "major_road", "medium_road", "minor_road"]]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff",
        "line-width": ["interpolate", ["linear"], ["zoom"],
          6, ["match", ["get", "kind"], "highway", 1.6, "major_road", 1.2, 0.7],
          12, ["match", ["get", "kind"], "highway", 4.4, "major_road", 3.4, "medium_road", 2.6, 1.8],
          16, ["match", ["get", "kind"], "highway", 9, "major_road", 7, "medium_road", 5.5, 4]] } });
    [["hwy", ["motorway", "trunk"], null], ["pri", ["primary"], roadPaint.primary],
     ["sec", ["secondary", "tertiary"], roadPaint.secondary]].forEach(function (row) {
      push({ id: "rd-" + row[0], type: "line", source: "basemap", "source-layer": "roads",
        filter: ["in", ["get", "kind_detail"], ["literal", row[1]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": row[2] || ["match", ["get", "kind_detail"], "motorway", roadPaint.motorway, roadPaint.trunk],
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.8, 12, row[0] === "hwy" ? 3.2 : 2.2, 16, row[0] === "hwy" ? 7 : 4.5] } });
    });
    push({ id: "rd-minor", type: "line", source: "basemap", "source-layer": "roads",
      filter: ["==", ["get", "kind"], "minor_road"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 13, 1.8, 16, 3.6] } });
    push({ id: "rd-service", type: "line", source: "basemap", "source-layer": "roads", minzoom: 13,
      filter: ["==", ["get", "kind_detail"], "service"],
      paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.8, 16, 2.4] } });
    push({ id: "rd-track", type: "line", source: "basemap", "source-layer": "roads", minzoom: 10.5,
      filter: ["==", ["get", "kind_detail"], "track"],
      layout: { "line-join": "round" },
      paint: { "line-color": "#a98a68", "line-width": 1.4, "line-dasharray": [4, 2] } });
    push({ id: "rd-path", type: "line", source: "basemap", "source-layer": "roads", minzoom: 11.5,
      filter: ["==", ["get", "kind"], "path"],
      paint: { "line-color": "#9a8a76", "line-width": 1.1, "line-dasharray": [2.5, 2] } });
    push({ id: "bldg", type: "fill", source: "basemap", "source-layer": "buildings", minzoom: 14.5,
      paint: { "fill-color": "#ddd3c4", "fill-outline-color": "#c4b69e" } });
    push({ id: "bound-county", type: "line", source: "basemap", "source-layer": "boundaries", minzoom: 7.5,
      filter: ["==", ["get", "kind"], "county"],
      paint: { "line-color": "rgba(96,90,78,0.55)", "line-width": 0.9, "line-dasharray": [4, 3] } });
    push({ id: "bound-state", type: "line", source: "basemap", "source-layer": "boundaries",
      filter: ["==", ["get", "kind"], "state"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#40382c",
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1.9, 9, 2.8, 13, 3.6] } });
    /* labels */
    push({ id: "lr-label", type: "symbol", source: "lowroads", "source-layer": "lowroads",
      minzoom: 10.5, maxzoom: 11.99, filter: ["has", "name"],
      layout: { "symbol-placement": "line", "text-field": ["get", "name"], "text-font": FONT_REG,
        "text-size": 11.5, "text-max-angle": 30 },
      paint: { "text-color": "#4a4238", "text-halo-color": "rgba(255,255,255,0.95)", "text-halo-width": 1.8 } });
    push({ id: "rd-label", type: "symbol", source: "basemap", "source-layer": "roads", minzoom: 9,
      filter: ["any", ["has", "name"], ["has", "ref"]],
      layout: { "symbol-placement": "line", "text-field": ["coalesce", ["get", "name"], ["get", "ref"]],
        "text-font": FONT_REG, "text-size": ["interpolate", ["linear"], ["zoom"], 9, 11.5, 14, 14],
        "text-max-angle": 30 },
      paint: { "text-color": "#4a4238", "text-halo-color": "rgba(255,255,255,0.95)", "text-halo-width": 1.8 } });
    push({ id: "water-label", type: "symbol", source: "basemap", "source-layer": "water", minzoom: 9,
      filter: ["has", "name"],
      layout: { "symbol-placement": "line", "text-field": ["get", "name"], "text-font": FONT_REG,
        "text-size": 11.5, "text-max-angle": 30 },
      paint: { "text-color": "#3d6a94", "text-halo-color": "rgba(255,255,255,0.9)", "text-halo-width": 1.6 } });
    push({ id: "place-label", type: "symbol", source: "basemap", "source-layer": "places",
      filter: ["has", "name"],
      layout: { "text-field": ["get", "name"],
        "text-font": ["match", ["get", "kind"], "city", ["literal", FONT_MED], "town", ["literal", FONT_MED], ["literal", FONT_REG]],
        "text-size": ["match", ["get", "kind"], "city", 16, "town", 14, "village", 12.5, 11.5],
        "text-max-width": 9 },
      paint: { "text-color": "#33302a", "text-halo-color": "rgba(255,255,255,0.95)", "text-halo-width": 2 } });
    return {
      version: 8,
      glyphs: BASE + "glyphs/{fontstack}/{range}.pbf",
      sources: {
        basemap: { type: "vector", url: basemapUrl, attribution: "© OpenStreetMap contributors" },
        lowroads: { type: "vector", url: lowroadsUrl, attribution: "© OpenStreetMap contributors" }
      },
      layers: L
    };
  }

  /* ---------------- overlay UI ---------------- */
  var overlay = null, map = null, protocol = null, downloading = false;
  function el(html) { var d = document.createElement("div"); d.innerHTML = html; return d.firstElementChild; }
  function buildOverlay() {
    overlay = el(
      '<div class="om-overlay" role="dialog" aria-modal="true">' +
        '<div class="om-head">' +
          '<span class="om-title"></span>' +
          '<button class="om-close" type="button"></button>' +
        '</div>' +
        '<div class="om-mapwrap"><div class="om-map"></div></div>' +
        '<div class="om-card">' +
          '<div class="om-status"></div>' +
          '<div class="om-progress hidden"><div></div></div>' +
          '<button class="om-action" type="button"></button>' +
          '<p class="om-note"></p>' +
          '<p class="om-scope"></p>' +
          '<p class="om-storage"></p>' +
          '<p class="om-attrib"></p>' +
        '</div>' +
      '</div>');
    document.body.appendChild(overlay);
    overlay.querySelector(".om-close").addEventListener("click", closeOverlay);
    overlay.querySelector(".om-action").addEventListener("click", onAction);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay && !overlay.classList.contains("hidden")) closeOverlay();
    });
    applyStrings();
  }
  function applyStrings() {
    var btn = document.getElementById("offline-map-btn-label");
    if (btn) btn.textContent = t("btn");
    if (!overlay) return;
    overlay.querySelector(".om-title").textContent = t("title") + " — " + countyName();
    overlay.querySelector(".om-close").textContent = "✕ " + t("close");
    overlay.querySelector(".om-note").textContent =
      t("sizeNote").replace("{MB}", fmtMB(CFG.packSize + CFG.lowroadsSize));
    overlay.querySelector(".om-scope").textContent = t("scopeNote");
    overlay.querySelector(".om-attrib").textContent = t("attrib");
    refreshCard();
  }
  function refreshCard() {
    if (!overlay) return;
    var st = packState();
    var status = overlay.querySelector(".om-status");
    var action = overlay.querySelector(".om-action");
    var storage = overlay.querySelector(".om-storage");
    var used = FILES.reduce(function (s, f) { return s + (isLocal(f) ? f.size : 0); }, 0);
    storage.textContent = used ? t("storage").replace("{MB}", fmtMB(used)) : "";
    if (downloading) {
      status.textContent = t("downloading");
      action.disabled = true;
      return;
    }
    action.disabled = false;
    if (st === "full") {
      status.textContent = t("saved");
      action.textContent = t("remove");
      action.classList.add("secondary");
    } else if (st === "stale") {
      status.textContent = t("stale");
      action.textContent = t("update");
      action.classList.remove("secondary");
    } else if (st === "partial") {
      status.textContent = t("partial");
      action.textContent = t("redownload");
      action.classList.remove("secondary");
    } else {
      status.textContent = t("notDownloaded");
      action.textContent = t("download");
      action.classList.remove("secondary");
    }
  }
  function toast(msg) {
    var n = document.createElement("div");
    n.className = "om-toast";
    n.textContent = msg;
    document.body.appendChild(n);
    setTimeout(function () { n.classList.add("show"); }, 20);
    setTimeout(function () { n.classList.remove("show"); setTimeout(function () { n.remove(); }, 400); }, 3400);
  }

  async function sourceFor(f) {
    if (isLocal(f)) {
      var blob = await opfsFile(f.file);
      if (blob) {
        var p = new pmtiles.PMTiles(new pmtiles.FileSource(blob));
        protocol.add(p);
        return "pmtiles://" + f.file;
      }
    }
    var u = BASE + "packs/" + f.file;
    var p2 = new pmtiles.PMTiles(u);
    protocol.add(p2);
    return "pmtiles://" + u;
  }
  async function buildMap() {
    var bmUrl = await sourceFor(FILES[0]);
    var lrUrl = await sourceFor(FILES[1]);
    var style = buildStyle(bmUrl, lrUrl);
    if (map) { map.setStyle(style); return; }
    map = new maplibregl.Map({
      container: overlay.querySelector(".om-map"),
      style: style,
      bounds: [[CFG.bounds[0], CFG.bounds[1]], [CFG.bounds[2], CFG.bounds[3]]],
      fitBoundsOptions: { padding: 12 },
      maxBounds: [[CFG.bounds[0] - 0.35, CFG.bounds[1] - 0.35], [CFG.bounds[2] + 0.35, CFG.bounds[3] + 0.35]],
      minZoom: 6.5,
      maxZoom: 18,
      attributionControl: { compact: true }
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true, showUserHeading: true
    }), "top-right");
    window.__offlineMap = { map: map, state: function () { return packState(); } };
  }

  /* ---------------- download / remove (OHV pattern) ---------------- */
  async function downloadFile(f, onProgress) {
    var url = BASE + "packs/" + f.file;
    var res = await fetch(url);
    if (!res.ok) throw new Error("download failed (" + res.status + ")");
    var total = +res.headers.get("Content-Length") || f.size || 0;
    var dir = await packsDir();
    var fh = await dir.getFileHandle(f.file, { create: true });
    var writable = await fh.createWritable();
    var reader = res.body.getReader();
    var got = 0;
    for (;;) {
      var chunk = await reader.read();
      if (chunk.done) break;
      await writable.write(chunk.value);
      got += chunk.value.length;
      if (total) onProgress(got / total);
    }
    await writable.close();
    if (f.size && got !== f.size) { await opfsDelete(f.file); throw new Error("incomplete download"); }
    localFiles[f.id] = { size: got, at: Date.now() };
    saveLocal();
  }
  async function onAction() {
    if (downloading) return;
    if (packState() === "full") { await removePack(); return; }
    await downloadPack();
  }
  async function downloadPack() {
    downloading = true;
    var bar = overlay.querySelector(".om-progress");
    var fill = bar.querySelector("div");
    bar.classList.remove("hidden");
    refreshCard();
    var todo = FILES.filter(function (f) { return !isLocal(f); });
    var totalBytes = todo.reduce(function (s, f) { return s + (f.size || 0); }, 0) || 1;
    var doneBytes = 0;
    try {
      if (navigator.storage && navigator.storage.persist) {
        try { await navigator.storage.persist(); } catch (e) {}
      }
      for (var i = 0; i < todo.length; i++) {
        var f = todo[i];
        var lastErr = null;
        for (var attempt = 0; attempt < 4 && !isLocal(f); attempt++) {
          try {
            await downloadFile(f, function (frac) {
              fill.style.width = ((doneBytes + frac * (f.size || 0)) / totalBytes * 100).toFixed(1) + "%";
            });
            lastErr = null;
          } catch (err) {
            lastErr = err;
            await opfsDelete(f.file);
            await new Promise(function (r) { setTimeout(r, 2000); });
          }
        }
        if (lastErr) throw lastErr;
        doneBytes += f.size || 0;
      }
      toast(t("savedToast"));
    } catch (e) {
      toast(t("failed"));
    }
    downloading = false;
    bar.classList.add("hidden");
    fill.style.width = "0%";
    refreshCard();
    if (map) await buildMap(); // re-point the map at the on-device copies
  }
  async function removePack() {
    for (var i = 0; i < FILES.length; i++) {
      await opfsDelete(FILES[i].file);
      delete localFiles[FILES[i].id];
    }
    saveLocal();
    refreshCard();
    if (map) await buildMap(); // back to streaming from the server
    toast(t("removedToast"));
  }

  /* ---------------- open / close ---------------- */
  var opening = false;
  async function openOverlay() {
    if (opening) return;
    opening = true;
    try {
      await loadVendor();
      if (!overlay) buildOverlay();
      overlay.classList.remove("hidden");
      document.body.classList.add("om-open");
      if (!protocol) {
        protocol = new pmtiles.Protocol();
        maplibregl.addProtocol("pmtiles", protocol.tile);
      }
      await buildMap();
      if (map) setTimeout(function () { map.resize(); }, 60);
      applyStrings();
    } catch (e) {
      toast(t("failed"));
    }
    opening = false;
  }
  function closeOverlay() {
    if (!overlay) return;
    overlay.classList.add("hidden");
    document.body.classList.remove("om-open");
  }

  /* ---------------- wiring ---------------- */
  function init() {
    var btn = document.getElementById("offline-map-btn");
    if (!btn) return;
    btn.addEventListener("click", openOverlay);
    applyStrings();
    new MutationObserver(function () { applyStrings(); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
