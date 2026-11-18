/* =========================================================
   routes.js — geometría de rutas concesionadas y simulación
   de unidades de ejemplo que recorren cada ruta.
   Expone: GHM.routes
   ========================================================= */
(function (GHM) {
  'use strict';

  const R_EARTH = 6371.0088;
  const PALETTE = ['#2f7fe0', '#17924f', '#e8892b', '#6c4fd8', '#d23b3b', '#0f9c8e', '#d6489b', '#8a9a1e',
                   '#1f5fa8', '#b8651b', '#4a8f3a', '#7a3fb0', '#c2410c', '#0e7490', '#9f1239', '#57534e'];

  /** Distancia geodésica (km) entre dos puntos [lon, lat]. */
  function haversine(a, b) {
    const toRad = Math.PI / 180;
    const dLat = (b[1] - a[1]) * toRad, dLon = (b[0] - a[0]) * toRad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2;
    return 2 * R_EARTH * Math.asin(Math.sqrt(h));
  }

  /** Lista de líneas (arreglos de coordenadas) de un LineString o MultiLineString. */
  function lines(geom) {
    if (!geom) return [];
    return geom.type === 'LineString' ? [geom.coordinates] : geom.type === 'MultiLineString' ? geom.coordinates : [];
  }

  /** Une las partes de una MultiLineString en una sola secuencia de recorrido. */
  function path(geom) {
    const parts = lines(geom).map((l) => l.slice());
    if (!parts.length) return [];
    const out = parts.shift();
    while (parts.length) {
      const end = out[out.length - 1];
      let best = 0, rev = false, bestD = Infinity;
      parts.forEach((p, i) => {
        const d0 = haversine(end, p[0]), d1 = haversine(end, p[p.length - 1]);
        if (d0 < bestD) { bestD = d0; best = i; rev = false; }
        if (d1 < bestD) { bestD = d1; best = i; rev = true; }
      });
      const next = parts.splice(best, 1)[0];
      out.push(...(rev ? next.reverse() : next));
    }
    return out;
  }

  function lengthKm(coords) {
    let t = 0;
    for (let i = 1; i < coords.length; i++) t += haversine(coords[i - 1], coords[i]);
    return t;
  }

  /** Punto a una fracción (0–1) de la longitud de un recorrido. */
  function pointAt(coords, frac, totalKm) {
    const total = totalKm ?? lengthKm(coords);
    let target = Math.min(Math.max(frac, 0), 1) * total, acc = 0;
    for (let i = 1; i < coords.length; i++) {
      const d = haversine(coords[i - 1], coords[i]);
      if (acc + d >= target) {
        const t = d ? (target - acc) / d : 0;
        return [coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t];
      }
      acc += d;
    }
    return coords[coords.length - 1];
  }

  /** Muestras regulares a lo largo de la geometría: [{p:[lon,lat], km}] con el tramo que representa cada muestra. */
  function sample(geom, stepKm) {
    const out = [];
    for (const l of lines(geom)) {
      for (let i = 1; i < l.length; i++) {
        const d = haversine(l[i - 1], l[i]);
        const n = Math.max(1, Math.ceil(d / stepKm));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          out.push({p: [l[i - 1][0] + (l[i][0] - l[i - 1][0]) * t, l[i - 1][1] + (l[i][1] - l[i - 1][1]) * t], km: d / n});
        }
      }
    }
    return out;
  }

  /** Bandas de distancia al corralón más cercano. */
  const BANDS = [
    {id: 'b10', label: '0–10 km', max: 10},
    {id: 'b25', label: '10–25 km', max: 25},
    {id: 'b50', label: '25–50 km', max: 50},
    {id: 'b99', label: 'Más de 50 km', max: Infinity}
  ];

  /**
   * Prepara las rutas: recorrido continuo, longitud medida, color,
   * muestras cada 500 m y km por banda de distancia a los corralones.
   */
  function prepare(rutasFC, corralonesFC) {
    const corr = corralonesFC.features.map((f) => f.geometry.coordinates);
    const feats = rutasFC.features;
    const colorOf = new Map();
    let ci = 0;
    for (const f of feats) {
      const p = f.properties;
      if (!p.duplicado_de) colorOf.set(p.id, PALETTE[ci++ % PALETTE.length]);
    }
    return feats.map((f) => {
      const p = f.properties;
      const coords = path(f.geometry);
      const km = lengthKm(coords);
      const muestras = sample(f.geometry, 0.5);
      const bandas = Object.fromEntries(BANDS.map((b) => [b.id, 0]));
      for (const s of muestras) {
        const d = Math.min(...corr.map((c) => haversine(c, s.p)));
        s.dist = d;
        bandas[BANDS.find((b) => d < b.max).id] += s.km;
      }
      return {
        ...p,
        geometry: f.geometry,
        recorrido: coords,
        km_medidos: km,
        color: colorOf.get(p.duplicado_de || p.id) || PALETTE[0],
        muestras,
        bandas,
        nmun: (p.municipios || []).length,
        km_fuera: Math.max(0, km - (p.municipios || []).reduce((a, m) => a + m.km, 0)),
        es_unica: !p.duplicado_de
      };
    });
  }

  /* ---------------- simulación de unidades (ejemplo) ---------------- */

  /**
   * Calcula la posición de cada unidad en el instante `now`.
   * Las unidades en ruta avanzan a su velocidad (acelerada por simFactor)
   * y regresan al llegar al final del tramo (ida y vuelta).
   */
  function simulate(unidades, rutasById, corralonesByName, t0, now, simFactor) {
    const horas = ((now - t0) / 3600000) * simFactor;
    return unidades.map((u) => {
      if (!u.ruta_id) {
        const c = corralonesByName.get(u.corralon);
        return {...u, pos: c ? c.geometry.coordinates : null, avance: null};
      }
      const r = rutasById.get(u.ruta_id);
      const L = r.km_medidos || 1;
      const mueve = u.estado === 'En ruta';
      let s = u.progreso_inicial * L + (mueve ? u.velocidad_kmh * horas : 0);
      const ciclo = s % (2 * L);
      const pos = ciclo <= L ? ciclo : 2 * L - ciclo;
      const frac = u.sentido === -1 ? 1 - pos / L : pos / L;
      return {...u, pos: pointAt(r.recorrido, frac, L), avance: frac, ruta: r};
    });
  }

  /** Punto en polígono (GeoJSON Polygon/MultiPolygon), algoritmo de rayos. */
  function inPolygon(pt, geom) {
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    const [x, y] = pt;
    for (const poly of polys) {
      let inside = false;
      for (const ring of poly) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i], [xj, yj] = ring[j];
          if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
      }
      if (inside) return true;
    }
    return false;
  }

  GHM.routes = {haversine, lines, path, lengthKm, pointAt, sample, prepare, simulate, inPolygon, BANDS, PALETTE};
})(window.GHM = window.GHM || {});
