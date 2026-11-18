/* =========================================================
   maps.js — mapa principal (Leaflet) con mapas base reales,
   capas operativas y minimapas de cobertura y calor.
   Expone: GHM.maps
   ========================================================= */
(function (GHM) {
  'use strict';

  const BASEMAPS = {
    claro: {url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', opt: {maxZoom: 19, subdomains: 'abcd', attribution: '© OpenStreetMap contributors © CARTO'}},
    oscuro: {url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', opt: {maxZoom: 19, subdomains: 'abcd', attribution: '© OpenStreetMap contributors © CARTO'}},
    calles: {url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', opt: {maxZoom: 19, subdomains: 'abcd', attribution: '© OpenStreetMap contributors © CARTO'}},
    satelite: {url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', opt: {maxZoom: 19, attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics'}},
    terreno: {url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', opt: {maxZoom: 17, attribution: '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)'}},
    ninguno: null
  };
  const ESTADO_CLS = {'En ruta': 'ok', 'En servicio': 'acc', 'Detenida': 'bad', 'Disponible': 'mut'};
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  let map, baseLayer, currentBase = 'claro';
  const L_ = {};               // grupos de capas
  const visible = {rutas: true, unidades: true, corralones: true, municipios: true, calor: false};
  const unitMarkers = new Map();
  let lastFitKey = null;
  let mini = {};

  /* ---------------- mapa principal ---------------- */

  function init() {
    map = L.map('map', {zoomControl: true, minZoom: 6, preferCanvas: false, worldCopyJump: false}).setView([19.55, -99.65], 9);
    map.createPane('munis').style.zIndex = 350;
    map.createPane('routes').style.zIndex = 420;
    map.createPane('units').style.zIndex = 640;
    L.control.scale({metric: true, imperial: false, position: 'bottomright'}).addTo(map);

    L_.municipios = L.layerGroup().addTo(map);
    L_.entidades = L.layerGroup().addTo(map);
    L_.calor = L.layerGroup();
    L_.rutas = L.layerGroup().addTo(map);
    L_.corralones = L.layerGroup().addTo(map);
    L_.unidades = L.layerGroup().addTo(map);

    setBase('claro');
    buildStatic();

    document.querySelectorAll('[data-base]').forEach((b) => b.addEventListener('click', () => setBase(b.dataset.base)));
    document.querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.layer; visible[k] = !visible[k];
      b.setAttribute('aria-pressed', String(visible[k]));
      visible[k] ? L_[k].addTo(map) : map.removeLayer(L_[k]);
    }));
  }

  function setBase(key) {
    if (baseLayer) map.removeLayer(baseLayer);
    baseLayer = null;
    const def = BASEMAPS[key];
    if (def) baseLayer = L.tileLayer(def.url, def.opt).addTo(map);
    currentBase = key;
    document.getElementById('map').classList.toggle('is-nobase', !def);
    document.querySelectorAll('[data-base]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.base === key)));
    restyle();
  }

  const darkBase = () => currentBase === 'oscuro' || currentBase === 'satelite';

  /** Capas que no cambian con el tiempo: municipios, entidades, rutas, corralones. */
  function buildStatic() {
    const d = GHM.data;

    d.municipios.forEach((m) => {
      const lyr = L.geoJSON(m.geometry, {pane: 'munis', style: () => munStyle(m, true)});
      lyr.on('click', () => GHM.filters.set({municipio: GHM.filters.get().municipio === m.cvegeo ? '' : m.cvegeo}));
      lyr.bindTooltip(() => `<b>${esc(m.nomgeo)}</b><br>${esc(m.region)}<br>${m.con_concesion ? GHM.fmt.km(m.km_concesion) + ' km concesionados · ' + m.tramos.length + ' tramos' : 'Sin rutas concesionadas'}`, {sticky: true, className: 'tip'});
      m._layer = lyr; lyr.addTo(L_.municipios);
    });

    d.entidades.forEach((e) => {
      e._layer = L.geoJSON(e.geometry, {pane: 'munis', interactive: false, style: () => ({color: darkBase() ? '#e6edf5' : '#3b4a5a', weight: 2.2, fill: false, opacity: .85})}).addTo(L_.entidades);
    });

    // rutas: contorno + línea; los tramos traslapados van punteados encima
    d.rutas.slice().sort((a, b) => a.es_unica - b.es_unica).reverse().forEach((r) => {
      const casing = L.geoJSON(r.geometry, {pane: 'routes', interactive: false, style: () => ({color: darkBase() ? '#0c1622' : '#ffffff', weight: 8, opacity: .9, lineCap: 'round'})});
      const line = L.geoJSON(r.geometry, {pane: 'routes', style: () => routeStyle(r, true)});
      line.on('click', () => GHM.filters.set({ruta: GHM.filters.get().ruta === String(r.id) ? '' : String(r.id)}));
      line.bindTooltip(`<b>${esc(r.clave)} · ${esc(r.nombre)}</b><br>${GHM.fmt.km(r.km_medidos)} km medidos · ${r.nmun} municipios${r.km_fuera > 0.5 ? ' · ' + GHM.fmt.km(r.km_fuera) + ' km fuera del área' : ''}<br>Corralón cercano: ${esc(r.corralon_cercano)} (${GHM.fmt.km(r.dist_corralon_km)} km)${r.duplicado_de ? '<br><i>Se traslapa con R-' + String(r.duplicado_de).padStart(2, '0') + '</i>' : ''}`, {sticky: true, className: 'tip'});
      line.bindPopup(() => routePopup(r));
      r._casing = casing; r._line = line;
      if (r.es_unica) casing.addTo(L_.rutas);
      line.addTo(L_.rutas);
    });

    d.corralones.forEach((c) => {
      const [lon, lat] = c.coords;
      L.marker([lat, lon], {icon: L.divIcon({className: '', html: '<div class="mk-corr"></div>', iconSize: [20, 20], iconAnchor: [10, 10]}), zIndexOffset: 1000})
        .bindTooltip(c.nombre, {permanent: true, direction: 'top', offset: [0, -12], className: 'lbl lbl--corr'})
        .bindPopup(`<h4>${esc(c.nombre)}</h4><div>${esc(c.razon_social)}</div><div class="muted">${esc(c.municipio)}, ${esc(c.entidad)}<br>${esc(c.coordenada)}</div>`)
        .addTo(L_.corralones);
    });

    // calor: densidad de km concesionados (muestras cada 500 m de tramos únicos)
    buildHeat(L_.calor, d.rutas.filter((r) => r.es_unica), 22);
  }

  function buildHeat(group, rutas, radius) {
    group.clearLayers();
    const pts = rutas.flatMap((r) => r.muestras.map((s) => [s.p[1], s.p[0], 0.6]));
    if (pts.length && L.heatLayer) L.heatLayer(pts, {radius, blur: radius * 0.85, maxZoom: 11, minOpacity: 0.25,
      gradient: {0.2: '#2c7bb6', 0.4: '#abd9e9', 0.6: '#ffffbf', 0.8: '#fdae61', 1: '#d7191c'}}).addTo(group);
  }

  function munStyle(m, inScope) {
    const f = GHM.filters.get();
    const sel = f.municipio === m.cvegeo;
    const dark = darkBase();
    const fillC = m.con_concesion ? (dark ? '#4b97f2' : '#2f7fe0') : (dark ? '#000' : '#94a3b8');
    return {
      color: sel ? (dark ? '#ffffff' : '#16202b') : (dark ? 'rgba(230,237,245,.35)' : 'rgba(59,74,90,.45)'),
      weight: sel ? 2.6 : 0.7,
      fillColor: fillC,
      fillOpacity: !inScope ? 0.02 : m.con_concesion ? (currentBase === 'ninguno' ? 0.28 : 0.16) : (currentBase === 'ninguno' ? 0.06 : 0.0)
    };
  }

  function routeStyle(r, inScope) {
    const f = GHM.filters.get();
    const sel = f.ruta === String(r.id);
    return {
      color: r.color, weight: sel ? 6 : r.es_unica ? 4 : 3, opacity: inScope ? 1 : 0.18,
      dashArray: r.es_unica ? null : '2 7', lineCap: 'round', lineJoin: 'round'
    };
  }

  function routePopup(r) {
    const muni = r.municipios.slice(0, 6).map((m) => `${esc(m.nomgeo)} (${GHM.fmt.km(m.km)} km)`).join(', ');
    return `<h4>${esc(r.clave)} · ${esc(r.nombre)}</h4>
      <div class="muted">${esc(r.descripcion)}</div>
      <div style="margin-top:6px">Km declarados <b>${GHM.fmt.km(r.longitud_km)}</b> · medidos <b>${GHM.fmt.km(r.km_medidos)}</b></div>
      <div>Región <b>${esc(r.region || '—')}</b> · ${esc(r.entidades.join(', '))}</div>
      <div>Municipios: ${muni}${r.municipios.length > 6 ? '…' : ''}</div>
      <div>Corralón cercano <b>${esc(r.corralon_cercano)}</b> a ${GHM.fmt.km(r.dist_corralon_km)} km</div>`;
  }

  /** Re-estiliza según filtros y mapa base; ajusta la vista al ámbito. */
  function restyle() {
    const d = GHM.data; if (!d || !map) return;
    const F = GHM.filters;
    d.municipios.forEach((m) => m._layer && m._layer.setStyle(munStyle(m, F.municipioInScope(m))));
    d.entidades.forEach((e) => e._layer && e._layer.setStyle({color: darkBase() ? '#e6edf5' : '#3b4a5a'}));
    d.rutas.forEach((r) => {
      const ins = F.rutaInScope(r);
      r._line && r._line.setStyle(routeStyle(r, ins));
      r._casing && r._casing.setStyle({color: darkBase() ? '#0c1622' : '#ffffff', opacity: ins ? .9 : .15});
    });
    const sel = d.rutas.find((r) => F.get().ruta === String(r.id));
    if (sel && sel._line) sel._line.bringToFront();
  }

  function fitScope(force) {
    const d = GHM.data, F = GHM.filters, f = F.get();
    const key = [f.entidad, f.region, f.municipio, f.ruta].join('|');
    if (!force && key === lastFitKey) return;
    lastFitKey = key;
    let b = null;
    const add = (lyr) => { const bb = lyr.getBounds(); b = b ? b.extend(bb) : L.latLngBounds(bb.getSouthWest(), bb.getNorthEast()); };
    if (f.ruta) d.rutas.filter((r) => F.rutaInScope(r)).forEach((r) => add(r._line));
    else if (f.municipio || f.region || f.entidad) d.municipios.filter((m) => F.municipioInScope(m)).forEach((m) => add(m._layer));
    else {
      d.rutas.forEach((r) => add(r._line));
      d.corralones.forEach((c) => { const ll = L.latLng(c.coords[1], c.coords[0]); b = b ? b.extend(ll) : L.latLngBounds(ll, ll); });
    }
    if (b) map.flyToBounds(b.pad(0.06), {duration: 0.6, maxZoom: 13});
  }

  /* ---------------- unidades (ejemplo) ---------------- */

  function updateUnits(units) {
    const F = GHM.filters;
    const seen = new Set();
    for (const u of units) {
      if (!u.pos) continue;
      seen.add(u.unidad);
      const ll = [u.pos[1], u.pos[0]];
      const show = F.unidadInScope(u);
      let mk = unitMarkers.get(u.unidad);
      const cls = ESTADO_CLS[u.estado] || 'mut';
      if (!mk) {
        mk = L.marker(ll, {pane: 'units', icon: unitIcon(cls), zIndexOffset: 500, keyboard: false});
        mk.bindTooltip(u.unidad, {permanent: u.estado !== 'Disponible', direction: 'right', offset: [10, 0], className: 'lbl'});
        mk.bindPopup(() => unitPopup(mk._u));
        unitMarkers.set(u.unidad, mk);
      }
      mk._u = u;
      mk.setLatLng(ll);
      if (mk.isPopupOpen()) mk.getPopup().setContent(unitPopup(u));
      if (show && !L_.unidades.hasLayer(mk)) mk.addTo(L_.unidades);
      if (!show && L_.unidades.hasLayer(mk)) L_.unidades.removeLayer(mk);
    }
  }

  function unitPopup(u) {
    const cls = ESTADO_CLS[u.estado] || 'mut';
    return `<h4>${esc(u.unidad)} · ${esc(u.tipo_grua)}</h4>
      <div><span class="pill pill--${cls}">${esc(u.estado)}</span> <span class="muted">dato de ejemplo</span></div>
      <div style="margin-top:4px">${u.ruta ? 'Ruta ' + esc(u.ruta.clave) + ' · ' + esc(u.ruta.nombre) : 'En ' + esc(u.corralon)}</div>
      <div>Ubicación: ${esc(u.municipio || '—')}</div>
      ${u.avance != null ? `<div>Avance ${GHM.fmt.pct(u.avance)} · ${u.velocidad_kmh} km/h</div>` : ''}`;
  }

  function unitIcon(cls) {
    return L.divIcon({className: '', html: `<div class="mk-unit mk-unit--${cls}"><span class="mk-unit__dot"></span></div>`, iconSize: [18, 18], iconAnchor: [9, 9]});
  }

  function focusUnit(id) {
    const mk = unitMarkers.get(id); if (!mk) return;
    if (!visible.unidades) document.querySelector('[data-layer="unidades"]').click();
    map.flyTo(mk.getLatLng(), Math.max(map.getZoom(), 12), {duration: 0.6});
    setTimeout(() => mk.openPopup(), 650);
  }

  /* ---------------- minimapas ---------------- */

  function miniMap(id) {
    const m = L.map(id, {zoomControl: false, attributionControl: false, dragging: true, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, zoomSnap: 0.1}).setView([19.55, -99.65], 8);
    return {map: m, group: L.layerGroup().addTo(m)};
  }

  const COB_CLASSES = [
    {min: 40, color: '#08519c', label: '≥ 40 km'},
    {min: 20, color: '#3182bd', label: '20–40 km'},
    {min: 10, color: '#6baed6', label: '10–20 km'},
    {min: 0.05, color: '#bdd7e7', label: '< 10 km'}
  ];

  function renderMinis() {
    const d = GHM.data, F = GHM.filters;
    if (!mini.cob) { mini.cob = miniMap('mini-cobertura'); mini.heat = miniMap('mini-calor'); legendCob(); }
    const muns = d.municipios.filter((m) => F.municipioInScope(m));
    const conMun = muns.filter((m) => m.con_concesion);
    const fitSet = conMun.length ? conMun : muns;
    const near = (m, bb) => bb.intersects(m._layer.getBounds());
    let bb = null; fitSet.forEach((m) => { const x = m._layer.getBounds(); bb = bb ? bb.extend(x) : L.latLngBounds(x.getSouthWest(), x.getNorthEast()); });
    if (!bb) return;
    const ctx = d.municipios.filter((m) => near(m, bb.pad(0.15)));
    const outline = '#9aa8b6';

    mini.cob.group.clearLayers();
    ctx.forEach((m) => {
      const ins = F.municipioInScope(m);
      const c = COB_CLASSES.find((k) => m.km_concesion >= k.min);
      L.geoJSON(m.geometry, {style: {color: outline, weight: .6, fillColor: c && ins ? c.color : css('--panel'), fillOpacity: c && ins ? .9 : .6}})
        .bindTooltip(`<b>${esc(m.nomgeo)}</b><br>${m.con_concesion ? GHM.fmt.km(m.km_concesion) + ' km concesionados' : 'Sin rutas'}`, {sticky: true, className: 'tip'})
        .addTo(mini.cob.group);
    });
    d.corralones.forEach((c) => L.circleMarker([c.coords[1], c.coords[0]], {radius: 4, color: '#fff', weight: 1.5, fillColor: '#16202b', fillOpacity: 1}).addTo(mini.cob.group));
    mini.cob.map.invalidateSize(); mini.cob.map.fitBounds(bb.pad(0.04));

    mini.heat.group.clearLayers();
    ctx.forEach((m) => L.geoJSON(m.geometry, {interactive: false, style: {color: outline, weight: .5, fillColor: css('--panel'), fillOpacity: .7}}).addTo(mini.heat.group));
    const hl = L.layerGroup().addTo(mini.heat.group);
    buildHeat(hl, d.rutas.filter((r) => r.es_unica && F.rutaInScope(r)), 14);
    mini.heat.map.invalidateSize(); mini.heat.map.fitBounds(bb.pad(0.04));
  }

  function legendCob() {
    const el = document.getElementById('leg-cobertura');
    el.replaceChildren(...COB_CLASSES.map((c) => { const s = document.createElement('span'); const i = document.createElement('i'); i.className = 'sq'; i.style.background = c.color; s.append(i, c.label); return s; }));
  }

  function invalidate() { map && map.invalidateSize(); Object.values(mini).forEach((m) => m.map.invalidateSize()); }

  GHM.maps = {init, restyle, fitScope, updateUnits, focusUnit, renderMinis, invalidate, setBase};
})(window.GHM = window.GHM || {});
