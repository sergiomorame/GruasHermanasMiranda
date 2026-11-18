/* =========================================================
   filters.js — estado de filtros, ámbito (scope) y selectores
   en cascada: Entidad → Región → Municipio → Ruta.
   Expone: GHM.filters
   ========================================================= */
(function (GHM) {
  'use strict';

  const state = {entidad: '', region: '', municipio: '', ruta: ''};
  const listeners = [];
  const $ = (id) => document.getElementById(id);

  function get() { return {...state}; }

  /** Cambia uno o varios filtros, ajusta la cascada y notifica. */
  function set(patch) {
    Object.assign(state, patch);
    const d = GHM.data;
    if ('entidad' in patch && !('region' in patch)) { state.region = ''; }
    if (('entidad' in patch || 'region' in patch) && !('municipio' in patch)) state.municipio = '';
    if (('entidad' in patch || 'region' in patch || 'municipio' in patch) && !('ruta' in patch)) state.ruta = '';
    // coherencia: si se elige región sin entidad, se toma la entidad de la región
    if (state.region && !state.entidad) {
      const m = d.municipios.find((x) => x.region === state.region);
      if (m) state.entidad = m.entidad;
    }
    if (state.municipio) {
      const m = d.municipioById.get(state.municipio);
      if (m) { state.entidad = m.entidad; state.region = m.region; }
    }
    sync();
    listeners.forEach((fn) => fn(get()));
  }

  function reset() { set({entidad: '', region: '', municipio: '', ruta: ''}); }
  function onChange(fn) { listeners.push(fn); }

  /* ---------- ámbito ---------- */

  function municipioInScope(m, f = state) {
    if (f.ruta) {
      const r = GHM.data.rutaById.get(Number(f.ruta));
      return !!r && r.municipios.some((x) => x.cvegeo === m.cvegeo);
    }
    if (f.municipio) return m.cvegeo === f.municipio;
    return (!f.entidad || m.entidad === f.entidad) && (!f.region || m.region === f.region);
  }

  function rutaInScope(r, f = state) {
    if (f.ruta) return r.id === Number(f.ruta);
    if (f.municipio) return r.municipios.some((x) => x.cvegeo === f.municipio);
    if (f.region) return r.regiones.includes(f.region);
    if (f.entidad) return r.entidades.includes(f.entidad);
    return true;
  }

  function corralonInScope(c, f = state) {
    if (f.ruta || f.municipio || f.region || f.entidad) {
      // el corralón cuenta si atiende alguna ruta del ámbito o está dentro del ámbito
      const rutas = GHM.data.rutas.filter((r) => rutaInScope(r, f));
      const m = GHM.data.municipioById.get(c.cvegeo);
      return rutas.some((r) => r.corralon_cercano === c.nombre) || (!!m && municipioInScope(m, f));
    }
    return true;
  }

  function unidadInScope(u, f = state) {
    if (u.ruta_id) return rutaInScope(GHM.data.rutaById.get(u.ruta_id), f);
    const c = GHM.data.corralonByName.get(u.corralon);
    return !!c && corralonInScope(c.properties, f);
  }

  /** Etiqueta legible del ámbito actual. */
  function label(f = state) {
    if (f.ruta) { const r = GHM.data.rutaById.get(Number(f.ruta)); return r ? `${r.clave} · ${r.nombre}` : 'Ruta'; }
    if (f.municipio) { const m = GHM.data.municipioById.get(f.municipio); return m ? m.nomgeo : 'Municipio'; }
    if (f.region) return f.region;
    if (f.entidad) return f.entidad;
    return 'todo el territorio';
  }

  /* ---------- selectores ---------- */

  function fill(sel, items, value, allLabel) {
    sel.replaceChildren(new Option(allLabel, ''), ...items.map(([v, t]) => new Option(t, v)));
    sel.value = items.some(([v]) => String(v) === String(value)) ? value : '';
  }

  function sync() {
    const d = GHM.data; if (!d) return;
    const ent = [...new Set(d.municipios.map((m) => m.entidad))].sort();
    fill($('f-entidad'), ent.map((e) => [e, e]), state.entidad, 'Todas');

    const regs = [...new Set(d.municipios.filter((m) => !state.entidad || m.entidad === state.entidad).map((m) => m.region))]
      .map((r) => [r, r + (d.rutas.some((x) => x.regiones.includes(r)) ? '' : ' · sin rutas')]).sort((a, b) => a[0].localeCompare(b[0], 'es'));
    fill($('f-region'), regs, state.region, 'Todas');

    const muns = d.municipios.filter((m) => (!state.entidad || m.entidad === state.entidad) && (!state.region || m.region === state.region))
      .sort((a, b) => (b.con_concesion - a.con_concesion) || a.nomgeo.localeCompare(b.nomgeo, 'es'))
      .map((m) => [m.cvegeo, m.nomgeo + (m.con_concesion ? ` · ${GHM.fmt.km(m.km_concesion)} km` : '')]);
    fill($('f-municipio'), muns, state.municipio, 'Todos');

    const rutas = d.rutas.filter((r) => rutaInScope(r, {...state, ruta: ''}))
      .map((r) => [String(r.id), `${r.clave} · ${r.nombre}${r.duplicado_de ? ' (traslape)' : ''}`]);
    fill($('f-ruta'), rutas, state.ruta, 'Todas');
  }

  function init() {
    $('f-entidad').addEventListener('change', (e) => set({entidad: e.target.value}));
    $('f-region').addEventListener('change', (e) => set({region: e.target.value}));
    $('f-municipio').addEventListener('change', (e) => set({municipio: e.target.value}));
    $('f-ruta').addEventListener('change', (e) => set({ruta: e.target.value}));
    $('f-limpiar').addEventListener('click', reset);
    sync();
  }

  GHM.filters = {init, get, set, reset, onChange, sync, label, municipioInScope, rutaInScope, corralonInScope, unidadInScope};
})(window.GHM = window.GHM || {});
