/* =========================================================
   main.js — configuración, carga de datos (API PHP o JSON
   estáticos), arranque de módulos y ciclo de simulación.
   ========================================================= */
(function (GHM) {
  'use strict';

  const CONFIG = {
    /** 'auto': intenta backend/api.php y si falla usa data/*.json · 'api' · 'static' */
    dataMode: 'auto',
    apiUrl: 'backend/api.php',
    staticDir: 'data/',
    /** Las unidades son de ejemplo: velocidad de simulación (1 = tiempo real). */
    simFactor: 12,
    tickMs: 2000
  };
  GHM.config = CONFIG;

  const RECURSOS = ['municipios', 'entidades', 'rutas', 'corralones', 'unidades_ejemplo'];

  async function fetchJson(url) {
    const r = await fetch(url, {headers: {Accept: 'application/json'}});
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('json')) throw new Error(`${url}: respuesta no es JSON`);
    return r.json();
  }

  async function loadAll() {
    const fromApi = () => Promise.all(RECURSOS.map((k) => fetchJson(`${CONFIG.apiUrl}?recurso=${k}`)));
    const fromStatic = () => Promise.all(RECURSOS.map((k) => fetchJson(`${CONFIG.staticDir}${k}.json`)));
    if (CONFIG.dataMode === 'static') return {src: 'static', raw: await fromStatic()};
    try {
      const raw = await fromApi();
      return {src: raw.every((x) => x.fuente === 'postgis' || x.fuente === 'archivo' && x.motivo === 'recurso de ejemplo') ? 'api' : 'api-archivo', raw};
    } catch (e) {
      if (CONFIG.dataMode === 'api') throw e;
      console.info('[GHM] API no disponible, se usan los archivos de data/:', e.message);
      return {src: 'static', raw: await fromStatic()};
    }
  }

  /** Normaliza las colecciones a objetos de trabajo con índices. */
  function build(raw) {
    const [munFC, entFC, rutFC, corFC, uniJs] = raw;
    const municipios = munFC.features.map((f) => {
      const p = f.properties;
      const bb = bbox(f.geometry);
      return {...p, tramos: p.tramos || [], geometry: f.geometry, bbox: bb};
    });
    const rutas = GHM.routes.prepare(rutFC, corFC).map((r) => ({...r, municipios: r.municipios || [], regiones: r.regiones || [], entidades: r.entidades || []}));
    const corralones = corFC.features.map((f) => ({...f.properties, coords: f.geometry.coordinates, geometry: f.geometry}));
    // municipio de cada muestra de 500 m (para medir bandas dentro del ámbito filtrado)
    for (const r of rutas) for (const s of r.muestras) s.cvegeo = cvegeoAt(municipios, s.p);
    return {
      municipios, rutas, corralones,
      entidades: entFC.features.map((f) => ({...f.properties, geometry: f.geometry})),
      unidades: (uniJs.unidades || uniJs).map((u) => ({...u})),
      municipioById: new Map(municipios.map((m) => [m.cvegeo, m])),
      rutaById: new Map(rutas.map((r) => [r.id, r])),
      corralonByName: new Map(corFC.features.map((f) => [f.properties.nombre, f]))
    };
  }

  function bbox(g) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const walk = (c) => { if (typeof c[0] === 'number') { x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]); } else c.forEach(walk); };
    walk(g.coordinates);
    return [x0, y0, x1, y1];
  }

  function cvegeoAt(muns, pt) {
    for (const m of muns) {
      const b = m.bbox;
      if (pt[0] < b[0] || pt[0] > b[2] || pt[1] < b[1] || pt[1] > b[3]) continue;
      if (GHM.routes.inPolygon(pt, m.geometry)) return m.cvegeo;
    }
    return null;
  }

  function municipioAt(pt) {
    for (const m of GHM.data.municipios) {
      const b = m.bbox;
      if (pt[0] < b[0] || pt[0] > b[2] || pt[1] < b[1] || pt[1] > b[3]) continue;
      if (GHM.routes.inPolygon(pt, m.geometry)) return m.nomgeo;
    }
    return null;
  }

  /* ---------- simulación de unidades (ejemplo) ---------- */
  const t0 = Date.now();
  function tick() {
    const d = GHM.data;
    const units = GHM.routes.simulate(d.unidades, d.rutaById, d.corralonByName, t0, Date.now(), CONFIG.simFactor)
      .map((u) => ({...u, municipio: u.pos ? municipioAt(u.pos) : null}));
    GHM.maps.updateUnits(units);
    GHM.dashboard.renderUnits(units);
    return units;
  }

  /* ---------- reloj y tema ---------- */
  function clock() {
    const now = new Date();
    document.getElementById('meta-fecha').textContent = now.toLocaleDateString('es-MX', {day: 'numeric', month: 'short', year: 'numeric'});
    document.getElementById('meta-hora').textContent = now.toLocaleTimeString('es-MX', {hour: '2-digit', minute: '2-digit'});
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('ghm-tema'); } catch (e) { /* almacenamiento no disponible */ }
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = saved || (prefersDark ? 'dark' : 'light');
    document.getElementById('btn-tema').addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('ghm-tema', next); } catch (e) { /* sin almacenamiento */ }
      GHM.charts.theme();
      GHM.maps.setBase(next === 'dark' ? 'oscuro' : 'claro');
      GHM.dashboard.render();
      GHM.maps.renderMinis();
    });
  }

  function setSource(src) {
    const chip = document.getElementById('meta-fuente');
    const txt = {api: 'PostGIS en línea', 'api-archivo': 'API · archivos locales', static: 'Archivos locales'};
    chip.classList.add(src === 'api' ? 'is-api' : 'is-static');
    document.getElementById('meta-fuente-txt').textContent = txt[src] || txt.static;
    chip.title = src === 'api' ? 'Datos servidos por backend/api.php desde PostGIS' : src === 'api-archivo' ? 'backend/api.php sin base configurada: sirve la carpeta data/' : 'Datos leídos de la carpeta data/';
  }

  async function start() {
    initTheme();
    clock(); setInterval(clock, 30000);
    try {
      const {src, raw} = await loadAll();
      GHM.data = build(raw);
      setSource(src);
    } catch (e) {
      console.error(e);
      document.getElementById('takeaway').textContent = 'No se pudieron cargar los datos. Abre el tablero desde un servidor web (por ejemplo: php -S localhost:8000) para que el navegador pueda leer la carpeta data/.';
      return;
    }
    GHM.charts.theme();
    GHM.filters.init();
    GHM.dashboard.init();
    GHM.maps.init();
    if (document.documentElement.dataset.theme === 'dark') GHM.maps.setBase('oscuro');

    const onFilter = () => {
      GHM.maps.restyle();
      GHM.maps.fitScope();
      GHM.dashboard.render();
      GHM.maps.renderMinis();
      tick();
    };
    GHM.filters.onChange(onFilter);
    tick();
    GHM.dashboard.render();
    GHM.maps.fitScope(true);
    GHM.maps.renderMinis();
    setInterval(tick, CONFIG.tickMs);
    window.addEventListener('resize', () => GHM.maps.invalidate());
  }

  document.addEventListener('DOMContentLoaded', start);
})(window.GHM = window.GHM || {});
