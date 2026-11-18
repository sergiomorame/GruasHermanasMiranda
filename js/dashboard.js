/* =========================================================
   dashboard.js — indicadores, tablas, alertas, regiones y
   catálogo. Calcula todos los agregados del ámbito filtrado.
   Expone: GHM.dashboard, GHM.fmt
   ========================================================= */
(function (GHM) {
  'use strict';

  const nf1 = new Intl.NumberFormat('es-MX', {maximumFractionDigits: 1, minimumFractionDigits: 1});
  const nf0 = new Intl.NumberFormat('es-MX', {maximumFractionDigits: 0});
  GHM.fmt = {
    km: (v) => v == null || isNaN(v) ? '—' : (Math.abs(v) >= 100 ? nf0.format(v) : nf1.format(v)),
    int: (v) => v == null ? '—' : nf0.format(v),
    pct: (v) => v == null || isNaN(v) ? '—' : nf0.format(v * 100) + '%',
    pct1: (v) => v == null || isNaN(v) ? '—' : nf1.format(v * 100) + '%'
  };
  const F = () => GHM.filters;
  const $ = (id) => document.getElementById(id);
  const ESTADO_CLS = {'En ruta': 'ok', 'En servicio': 'acc', 'Detenida': 'bad', 'Disponible': 'mut'};
  const REGION_COLORS = ['#2f7fe0', '#e8892b', '#17924f', '#6c4fd8', '#0f9c8e', '#d23b3b'];

  let alertTab = 'calidad';
  let lastUnits = [];
  const cat = {sort: 'clave', dir: 1, q: ''};

  /* ---------- utilidades DOM (todo el texto de datos va por textContent) ---------- */
  function el(tag, props = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v != null) e.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) e.append(k.nodeType ? k : String(k));
    return e;
  }
  const plural = (n, uno, varios) => `${GHM.fmt.int(n)} ${n === 1 ? uno : varios}`;
  const pill = (txt, cls) => el('span', {class: `pill pill--${cls}`}, txt);
  const bar = (frac, color) => { const i = el('i'); i.style.width = Math.round((frac || 0) * 100) + '%'; if (color) i.style.background = color; return el('span', {class: 'bar'}, i); };

  /* ---------- agregados del ámbito ---------- */
  function scope() {
    const d = GHM.data, f = F().get(), Fs = F();
    const rutas = d.rutas.filter((r) => Fs.rutaInScope(r));
    const unicas = rutas.filter((r) => r.es_unica);
    const muns = d.municipios.filter((m) => Fs.municipioInScope(m));
    let kmPorMun;
    if (f.ruta) {
      const r = d.rutaById.get(Number(f.ruta));
      kmPorMun = new Map(r.municipios.map((x) => [x.cvegeo, x.km]));
    } else {
      kmPorMun = new Map(muns.filter((m) => m.con_concesion).map((m) => [m.cvegeo, m.km_concesion]));
    }
    const kmDentro = [...kmPorMun.values()].reduce((a, v) => a + v, 0);
    const sinFiltro = !f.ruta && !f.municipio && !f.region && !f.entidad;
    const B = GHM.routes.BANDS;
    const bandas = B.map((b) => ({...b, km: 0}));
    for (const r of (f.ruta ? rutas : unicas)) for (const sm of r.muestras) {
      if (!sinFiltro && !f.ruta && !kmPorMun.has(sm.cvegeo)) continue;
      bandas[B.findIndex((b) => sm.dist < b.max)].km += sm.km;
    }
    const km = f.ruta ? d.rutaById.get(Number(f.ruta)).km_medidos : sinFiltro ? unicas.reduce((a, r) => a + r.km_medidos, 0) : kmDentro;
    const kmB = bandas.reduce((a, b) => a + b.km, 0);
    const corr = d.corralones.filter((c) => Fs.corralonInScope(c));
    return {f, rutas, unicas, muns, kmPorMun, km, kmDentro, sinFiltro, bandas, cob25: kmB ? (bandas[0].km + bandas[1].km) / kmB : null, corr};
  }

  const d0 = (id) => GHM.data.rutaById.get(Number(id));

  /* ---------- render principal (al cambiar filtros) ---------- */
  function render() {
    const s = scope();
    renderKpis(s);
    renderTakeaway(s);
    renderMunInfo(s);
    renderEntidad(s);
    GHM.charts.bandas(s.bandas);
    $('bandas-nota').textContent = s.bandas[3].km > 0
      ? `${GHM.fmt.km(s.bandas[3].km)} km quedan a más de 50 km de un corralón: candidatos a base de apoyo.`
      : 'Todos los km del ámbito quedan a menos de 50 km de un corralón.';
    GHM.charts.longitud(s.unicas.length ? s.unicas.slice().sort((a, b) => b.km_medidos - a.km_medidos) : s.rutas);
    renderRegions(s);
    renderCatalog();
    renderAlerts();
    renderUnits(lastUnits);
  }

  function renderKpis(s) {
    $('k-rutas').textContent = GHM.fmt.int(s.rutas.length);
    const dup = s.rutas.length - s.unicas.length;
    $('k-rutas-n').textContent = `${plural(s.unicas.length, 'tramo único', 'tramos únicos')}${dup ? ` · ${plural(dup, 'traslapado', 'traslapados')}` : ''}`;
    $('k-km').textContent = GHM.fmt.km(s.km);
    const fuera = s.f.ruta ? d0(s.f.ruta).km_fuera : s.sinFiltro ? s.km - s.kmDentro : 0;
    $('k-km-n').textContent = fuera > 0.5 ? `${GHM.fmt.km(s.km - fuera)} km en CDMX y Edomex · ${GHM.fmt.km(fuera)} km fuera` : s.sinFiltro || s.f.ruta ? 'Medidos sobre la geometría, sin traslapes' : 'Dentro del ámbito seleccionado';
    $('k-mun').textContent = GHM.fmt.int(s.kmPorMun.size);
    const tot = s.f.ruta ? null : s.muns.length;
    $('k-mun-n').textContent = tot != null ? `de ${GHM.fmt.int(tot)} municipios del ámbito` : 'que cruza la ruta seleccionada';
    $('k-cob').textContent = GHM.fmt.pct(s.cob25);
    $('k-corr').textContent = GHM.fmt.int(s.corr.length);
    $('k-corr-n').textContent = s.corr.map((c) => `${c.nombre.replace('Corralón ', '')} · ${c.municipio}`).join('  ·  ') || 'Sin corralón en el ámbito';
  }

  function renderTakeaway(s) {
    const lejos = s.bandas[3].km;
    const parts = ['En ', el('b', {}, F().label()), ' hay ', el('b', {}, `${GHM.fmt.km(s.km)} km`), ' de carretera concesionada en ',
      el('b', {}, plural(s.unicas.length, 'tramo', 'tramos')), s.unicas.length === 1 ? ' que cruza ' : ' que cruzan ', el('b', {}, plural(s.kmPorMun.size, 'municipio', 'municipios')), '. ',
      el('b', {}, GHM.fmt.pct(s.cob25)), ' de esa red queda a menos de 25 km de un corralón HEMI'];
    if (lejos > 0) parts.push('; ', el('b', {}, `${GHM.fmt.km(lejos)} km`), ' están a más de 50 km.'); else parts.push('.');
    $('takeaway').replaceChildren(...parts);
  }

  function renderMunInfo(s) {
    const f = s.f, box = $('muninfo');
    box.hidden = !f.municipio;
    if (!f.municipio) return;
    const m = GHM.data.municipioById.get(f.municipio);
    $('mi-nombre').textContent = m.nomgeo;
    $('mi-region').textContent = m.region;
    $('mi-km').textContent = m.con_concesion ? GHM.fmt.km(m.km_concesion) + ' km' : 'Sin rutas';
    $('mi-tramos').textContent = m.tramos.length ? m.tramos.map((id) => GHM.data.rutaById.get(id).clave).join(', ') : '—';
    $('mi-dist').textContent = GHM.fmt.km(m.dist_corralon_km) + ' km';
  }

  function renderEntidad(s) {
    const d = GHM.data;
    const byEnt = new Map();
    for (const [cv, km] of s.kmPorMun) { const m = d.municipioById.get(cv); byEnt.set(m.entidad, (byEnt.get(m.entidad) || 0) + km); }
    const ents = [...byEnt].map(([entidad, km]) => ({entidad, km})).sort((a, b) => b.km - a.km);
    if (s.sinFiltro && s.km - s.kmDentro > 0.5) ents.push({entidad: 'Fuera del área (otros estados)', km: s.km - s.kmDentro});
    GHM.charts.entidad(ents);
    const top = [...s.kmPorMun].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const box = $('top-municipios');
    box.replaceChildren(el('div', {class: 'ranklist__head'}, 'Municipios con más km concesionados'),
      ...top.map(([cv, km]) => el('div', {class: 'ranklist__row'}, el('span', {}, d.municipioById.get(cv).nomgeo), el('span', {}, GHM.fmt.km(km) + ' km'))));
    if (!top.length) box.append(el('div', {class: 'empty'}, 'Sin rutas concesionadas en el ámbito.'));
  }

  function renderRegions(s) {
    const d = GHM.data, f = s.f;
    const regs = [...new Set(d.municipios.filter((m) => m.con_concesion).map((m) => m.region))];
    const rows = regs.map((reg) => {
      const muns = d.municipios.filter((m) => m.region === reg && m.con_concesion);
      return {
        reg,
        km: muns.reduce((a, m) => a + m.km_concesion, 0),
        tramos: d.rutas.filter((r) => r.es_unica && r.regiones.includes(reg)).length,
        muns: muns.length,
        unidades: lastUnits.filter((u) => u.ruta && u.ruta.region === reg).length,
        corr: d.corralones.filter((c) => c.region === reg).length
      };
    }).sort((a, b) => b.km - a.km);
    $('region-cards').replaceChildren(...rows.map((r, i) => {
      const row = (lbl, val) => el('span', {class: 'region__row'}, el('span', {}, lbl), el('b', {}, val));
      const b = el('button', {type: 'button', class: 'region' + (f.region === r.reg ? ' is-on' : ''), style: `--rc:${REGION_COLORS[i % REGION_COLORS.length]}`,
        onclick: () => F().set(f.region === r.reg ? {entidad: '', region: ''} : {region: r.reg, entidad: ''})},
        el('span', {class: 'region__name'}, r.reg),
        row('Km concesionados', GHM.fmt.km(r.km)),
        row('Tramos', GHM.fmt.int(r.tramos)),
        row('Municipios', GHM.fmt.int(r.muns)),
        row('Corralones', GHM.fmt.int(r.corr)),
        row('Unidades (ejemplo)', GHM.fmt.int(r.unidades)));
      return b;
    }));
  }

  /* ---------- catálogo ---------- */
  function renderCatalog() {
    const Fs = F(), q = cat.q.trim().toLowerCase();
    let rows = GHM.data.rutas.filter((r) => Fs.rutaInScope(r));
    if (q) rows = rows.filter((r) => [r.clave, r.nombre, r.descripcion, r.region, ...r.municipios.map((m) => m.nomgeo)].join(' ').toLowerCase().includes(q));
    rows.sort((a, b) => {
      const x = a[cat.sort], y = b[cat.sort];
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'es')) * cat.dir;
    });
    const sel = Fs.get().ruta;
    $('tbl-catalogo').querySelector('tbody').replaceChildren(...rows.map((r) => {
      const obs = [];
      if (r.duplicado_de) obs.push(pill(`Traslapa R-${String(r.duplicado_de).padStart(2, '0')}`, 'warn'));
      if (Math.abs(r.km_medidos - r.longitud_km) / r.longitud_km > 0.015) obs.push(pill('Longitud difiere', 'mut'));
      if (r.dist_corralon_km > 50) obs.push(pill('> 50 km de corralón', 'bad'));
      if (r.km_fuera > 0.5) obs.push(pill(`${GHM.fmt.km(r.km_fuera)} km fuera del área`, 'acc'));
      const tr = el('tr', {class: 'is-click' + (sel === String(r.id) ? ' is-sel' : ''), onclick: () => Fs.set({ruta: sel === String(r.id) ? '' : String(r.id)})},
        el('td', {class: 'mono'}, el('span', {class: 'ruta-dot', style: `background:${r.color}`}), r.clave),
        el('td', {}, r.nombre, el('div', {style: 'color:var(--fg-soft);font-size:11.5px'}, r.descripcion.length > 110 ? r.descripcion.slice(0, 110) + '…' : r.descripcion)),
        el('td', {class: 'num'}, GHM.fmt.km(r.longitud_km)),
        el('td', {class: 'num'}, GHM.fmt.km(r.km_medidos)),
        el('td', {}, r.region || '—'),
        el('td', {}, r.municipios.map((m) => m.nomgeo).join(', ')),
        el('td', {}, r.corralon_cercano),
        el('td', {class: 'num'}, GHM.fmt.km(r.dist_corralon_km)),
        el('td', {}, ...obs));
      return tr;
    }));
    $('tbl-catalogo').querySelectorAll('th').forEach((th) => {
      const k = th.querySelector('button')?.dataset.sort;
      th.setAttribute('aria-sort', k === cat.sort ? (cat.dir === 1 ? 'ascending' : 'descending') : 'none');
    });
  }

  /* ---------- alertas ---------- */
  function qualityAlerts() {
    const out = [];
    for (const r of GHM.data.rutas) {
      if (r.duplicado_de) out.push({ref: r.clave, ruta: r, tipo: 'Traslape', sev: 'warn', txt: `Repite la geometría de R-${String(r.duplicado_de).padStart(2, '0')} (${r.nombre}). Depurar antes de producción.`});
      const dif = (r.km_medidos - r.longitud_km) / r.longitud_km;
      if (Math.abs(dif) > 0.015) out.push({ref: r.clave, ruta: r, tipo: 'Longitud', sev: 'mut', txt: `longitud_km (${GHM.fmt.km(r.longitud_km)}) difiere ${GHM.fmt.pct1(Math.abs(dif))} de la geometría (${GHM.fmt.km(r.km_medidos)} km).`});
      if (r.es_unica && r.km_fuera > 0.5) out.push({ref: r.clave, ruta: r, tipo: 'Fuera del área', sev: 'warn', txt: `${GHM.fmt.km(r.km_fuera)} km del tramo salen de CDMX y Edomex; falta la cartografía municipal de ese estado.`});
      if (r.dist_corralon_km > 50 && r.es_unica) out.push({ref: r.clave, ruta: r, tipo: 'Cobertura', sev: 'bad', txt: `Queda a ${GHM.fmt.km(r.dist_corralon_km)} km del corralón más cercano (${r.corralon_cercano}).`});
    }
    return out;
  }

  function opAlerts(units) {
    const out = [];
    for (const u of units) {
      if (u.estado === 'Detenida') out.push({ref: u.unidad, ruta: u.ruta, tipo: 'Detenida', sev: 'bad', txt: `${u.unidad} detenida en ${u.municipio || 'ruta'} sobre ${u.ruta.clave} (${u.ruta.nombre}).`});
      else if (u.estado === 'En servicio') out.push({ref: u.unidad, ruta: u.ruta, tipo: 'Servicio', sev: 'acc', txt: `${u.unidad} atendiendo un servicio en ${u.municipio || 'ruta'} (${u.ruta.clave}).`});
      if (u.ruta && u.ruta.dist_corralon_km > 35) out.push({ref: u.unidad, ruta: u.ruta, tipo: 'Distancia', sev: 'warn', txt: `${u.unidad} opera a ${GHM.fmt.km(u.ruta.dist_corralon_km)} km de ${u.corralon}.`});
    }
    return out;
  }

  function renderAlerts() {
    const Fs = F();
    const inScope = (a) => !a.ruta || Fs.rutaInScope(a.ruta);
    const q = qualityAlerts().filter(inScope), o = opAlerts(lastUnits).filter(inScope);
    const nAl = q.filter((a) => a.sev !== 'mut').length + o.filter((a) => a.sev === 'bad').length;
    $('alertas-n').textContent = String(nAl);
    $('alertas-n').hidden = nAl === 0;
    const rows = alertTab === 'calidad' ? q : o;
    const tb = $('tbl-alertas').querySelector('tbody');
    tb.replaceChildren(...rows.map((a) => el('tr', {class: a.ruta ? 'is-click' : '', onclick: () => a.ref.startsWith('U-') ? GHM.maps.focusUnit(a.ref) : Fs.set({ruta: String(a.ruta.id)})},
      el('td', {class: 'mono'}, a.ref), el('td', {}, pill(a.tipo, a.sev)), el('td', {}, a.txt))));
    if (!rows.length) tb.append(el('tr', {}, el('td', {colspan: '3', class: 'empty'}, 'Sin alertas en el ámbito seleccionado.')));
  }

  /* ---------- unidades (ejemplo, se actualiza cada pocos segundos) ---------- */
  function renderUnits(units) {
    lastUnits = units;
    const Fs = F(), selRuta = Fs.get().ruta;
    const list = units.filter((u) => Fs.unidadInScope(u));
    $('tbl-unidades').querySelector('tbody').replaceChildren(...list.map((u) => el('tr', {class: 'is-click', onclick: () => GHM.maps.focusUnit(u.unidad)},
      el('td', {class: 'mono'}, u.unidad),
      el('td', {}, u.municipio || '—', el('div', {style: 'color:var(--fg-soft);font-size:11px'}, u.ruta ? u.ruta.clave + ' · ' + u.tipo_grua : u.corralon)),
      el('td', {}, u.avance == null ? '—' : el('span', {class: 'mini-progress'}, bar(u.avance, u.ruta && u.ruta.color), GHM.fmt.pct(u.avance))),
      el('td', {}, pill(u.estado, ESTADO_CLS[u.estado] || 'mut')))));
    if (!list.length) $('tbl-unidades').querySelector('tbody').append(el('tr', {}, el('td', {colspan: '4', class: 'empty'}, 'Sin unidades en el ámbito.')));
    const enRuta = list.filter((u) => u.avance != null);
    const prom = enRuta.length ? enRuta.reduce((a, u) => a + u.avance, 0) / enRuta.length : null;
    $('avance-prom').textContent = GHM.fmt.pct(prom);
    $('avance-prom-bar').style.width = Math.round((prom || 0) * 100) + '%';
    const op = list.filter((u) => u.estado === 'En ruta' || u.estado === 'En servicio').length;
    $('k-uni').textContent = `${op}/${list.length}`;
    $('k-uni-n').textContent = `${plural(list.filter((u) => u.estado === 'Detenida').length, 'detenida', 'detenidas')} · ${plural(list.filter((u) => u.estado === 'Disponible').length, 'disponible', 'disponibles')} (ejemplo)`;

    $('avance-list').replaceChildren(...enRuta.slice().sort((a, b) => b.avance - a.avance).map((u) => el('button', {
      type: 'button', class: 'hbar' + (selRuta && selRuta !== String(u.ruta_id) ? ' is-dim' : ''), title: u.ruta.nombre,
      onclick: () => Fs.set({ruta: selRuta === String(u.ruta_id) ? '' : String(u.ruta_id)})},
      el('span', {class: 'hbar__name mono'}, `${u.unidad} ${u.ruta.clave}`), bar(u.avance, u.ruta.color), el('span', {class: 'hbar__pct'}, GHM.fmt.pct(u.avance)))));
    if (!enRuta.length) $('avance-list').append(el('div', {class: 'empty'}, 'Sin unidades en ruta en el ámbito.'));
    if (alertTab === 'operacion') renderAlerts();
  }

  function init() {
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
      alertTab = t.dataset.tab;
      document.querySelectorAll('.tab').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
      renderAlerts();
    }));
    $('cat-buscar').addEventListener('input', (e) => { cat.q = e.target.value; renderCatalog(); });
    $('tbl-catalogo').querySelectorAll('th button').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.sort; cat.dir = cat.sort === k ? -cat.dir : 1; cat.sort = k; renderCatalog();
    }));
    $('mi-cerrar').addEventListener('click', () => F().set({municipio: ''}));
  }

  GHM.dashboard = {init, render, renderUnits, scope};
})(window.GHM = window.GHM || {});
