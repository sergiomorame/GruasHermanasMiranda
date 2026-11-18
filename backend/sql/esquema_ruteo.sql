-- =====================================================================
-- esquema_ruteo.sql — PostGIS para el Sistema de Ruteo GHM
-- Tablas base (cargadas desde los GeoJSON) + vistas con las métricas
-- que consume backend/api.php. EPSG:4326.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS ruteo;
SET search_path TO ruteo, public;

-- ---------- tablas base ----------
CREATE TABLE IF NOT EXISTS entidades (
  cve_ent  varchar(2) PRIMARY KEY,
  nomgeo   text NOT NULL,
  geom     geometry(MultiPolygon, 4326) NOT NULL
);

CREATE TABLE IF NOT EXISTS municipios (
  cvegeo   varchar(5) PRIMARY KEY,
  cve_ent  varchar(2) NOT NULL REFERENCES entidades (cve_ent),
  cve_mun  varchar(3) NOT NULL,
  nomgeo   text NOT NULL,
  entidad  text NOT NULL,
  region   text,                         -- región operativa (catálogo editable)
  geom     geometry(MultiPolygon, 4326) NOT NULL
);

CREATE TABLE IF NOT EXISTS rutas_concesionadas (
  id           integer PRIMARY KEY,
  nombre       text NOT NULL,
  descripcion  text,
  tipo_vial    text,
  longitud_km  numeric(10, 3),           -- longitud declarada en la capa original
  activo       boolean NOT NULL DEFAULT true,
  geom         geometry(MultiLineString, 4326) NOT NULL
);

CREATE TABLE IF NOT EXISTS corralones (
  id           integer PRIMARY KEY,
  nombre       text NOT NULL,
  razon_social text,
  coordenada   text,
  geom         geometry(Point, 4326) NOT NULL
);

-- Futuro: posiciones GPS reales de la flota (hoy el tablero usa unidades de ejemplo)
CREATE TABLE IF NOT EXISTS unidades (
  unidad      varchar(10) PRIMARY KEY,
  tipo_grua   text,
  ruta_id     integer REFERENCES rutas_concesionadas (id),
  corralon_id integer REFERENCES corralones (id),
  activo      boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS unidades_posicion (
  id          bigserial PRIMARY KEY,
  unidad      varchar(10) NOT NULL REFERENCES unidades (unidad),
  registrado  timestamptz NOT NULL DEFAULT now(),
  estado      text NOT NULL CHECK (estado IN ('En ruta', 'En servicio', 'Detenida', 'Disponible')),
  velocidad_kmh numeric(6, 1),
  geom        geometry(Point, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS municipios_gix ON municipios USING gist (geom);
CREATE INDEX IF NOT EXISTS entidades_gix ON entidades USING gist (geom);
CREATE INDEX IF NOT EXISTS rutas_gix ON rutas_concesionadas USING gist (geom);
CREATE INDEX IF NOT EXISTS corralones_gix ON corralones USING gist (geom);
CREATE INDEX IF NOT EXISTS unidades_posicion_ix ON unidades_posicion (unidad, registrado DESC);

-- ---------- vistas de métricas ----------

-- Rutas: longitud geodésica, traslapes, municipios cruzados y corralón más cercano
CREATE OR REPLACE VIEW v_rutas_metricas AS
WITH r AS (
  SELECT id, nombre, descripcion, tipo_vial, longitud_km, geom
  FROM rutas_concesionadas WHERE activo
),
dup AS (   -- tramos casi idénticos a uno anterior (Hausdorff < ~300 m)
  SELECT a.id, MIN(b.id) AS duplicado_de
  FROM r a JOIN r b ON b.id < a.id AND a.geom && ST_Expand(b.geom, 0.003)
   AND ST_HausdorffDistance(a.geom, b.geom) < 0.003
  GROUP BY a.id
),
cruce AS (
  SELECT r.id, m.cvegeo, m.nomgeo, m.entidad, m.region,
         ST_Length(ST_Intersection(r.geom, m.geom)::geography) / 1000.0 AS km
  FROM r JOIN municipios m ON ST_Intersects(r.geom, m.geom)
),
mun AS (
  SELECT id,
         json_agg(json_build_object('cvegeo', cvegeo, 'nomgeo', nomgeo, 'km', round(km::numeric, 3)) ORDER BY km DESC) AS municipios,
         array_agg(DISTINCT entidad ORDER BY entidad) AS entidades,
         array_agg(DISTINCT region ORDER BY region) AS regiones
  FROM cruce WHERE km > 0.05 GROUP BY id
),
reg AS (
  SELECT DISTINCT ON (id) id, region FROM (
    SELECT id, region, SUM(km) AS km FROM cruce WHERE km > 0.05 GROUP BY id, region
  ) t ORDER BY id, km DESC
),
cor AS (
  SELECT DISTINCT ON (r.id) r.id, c.nombre AS corralon_cercano,
         ST_Distance(r.geom::geography, c.geom::geography) / 1000.0 AS dist_km
  FROM r CROSS JOIN corralones c
  ORDER BY r.id, ST_Distance(r.geom::geography, c.geom::geography)
)
SELECT r.id, 'R-' || lpad(r.id::text, 2, '0') AS clave, r.nombre, r.descripcion, r.tipo_vial,
       r.longitud_km::float AS longitud_km,
       round((ST_Length(r.geom::geography) / 1000.0)::numeric, 3)::float AS longitud_geom_km,
       dup.duplicado_de,
       COALESCE(mun.entidades, '{}') AS entidades, reg.region, COALESCE(mun.regiones, '{}') AS regiones,
       COALESCE(mun.municipios, '[]'::json) AS municipios,
       cor.corralon_cercano, round(cor.dist_km::numeric, 2)::float AS dist_corralon_km,
       r.geom
FROM r
LEFT JOIN dup ON dup.id = r.id
LEFT JOIN mun ON mun.id = r.id
LEFT JOIN reg ON reg.id = r.id
LEFT JOIN cor ON cor.id = r.id;

-- Municipios: km de red concesionada (sin traslapes) y distancia al corralón más cercano
CREATE OR REPLACE VIEW v_municipios_metricas AS
WITH red AS (   -- red única: se descartan los tramos traslapados
  SELECT ST_Union(geom) AS geom FROM rutas_concesionadas r
  WHERE activo AND NOT EXISTS (
    SELECT 1 FROM rutas_concesionadas b
    WHERE b.activo AND b.id < r.id AND r.geom && ST_Expand(b.geom, 0.003) AND ST_HausdorffDistance(r.geom, b.geom) < 0.003)
),
tramos AS (
  SELECT m.cvegeo, array_agg(r.id ORDER BY r.id) AS tramos
  FROM municipios m JOIN rutas_concesionadas r ON r.activo AND ST_Intersects(m.geom, r.geom)
   AND ST_Length(ST_Intersection(m.geom, r.geom)::geography) > 50
  GROUP BY m.cvegeo
)
SELECT m.cvegeo, m.cve_ent, m.cve_mun, m.nomgeo, m.entidad, m.region,
       round((COALESCE(ST_Length(ST_Intersection(m.geom, red.geom)::geography), 0) / 1000.0)::numeric, 2)::float AS km_concesion,
       COALESCE(t.tramos, '{}') AS tramos,
       round((SELECT MIN(ST_Distance(ST_PointOnSurface(m.geom)::geography, c.geom::geography)) / 1000.0 FROM corralones c)::numeric, 1)::float AS dist_corralon_km,
       m.geom
FROM municipios m
CROSS JOIN red
LEFT JOIN tramos t ON t.cvegeo = m.cvegeo;

-- Si las vistas tardan con muchos tramos, conviértelas en vistas materializadas:
--   CREATE MATERIALIZED VIEW mv_rutas_metricas AS SELECT * FROM v_rutas_metricas;
--   REFRESH MATERIALIZED VIEW mv_rutas_metricas;   -- después de cada actualización anual

-- Usuario de solo lectura para la API
-- CREATE ROLE ghm_lectura LOGIN PASSWORD 'cambiar';
-- GRANT USAGE ON SCHEMA ruteo TO ghm_lectura;
-- GRANT SELECT ON ALL TABLES IN SCHEMA ruteo TO ghm_lectura;
