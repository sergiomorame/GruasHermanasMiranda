#!/usr/bin/env bash
# Carga los GeoJSON originales a PostGIS con ogr2ogr (GDAL) y llena las tablas del esquema ruteo.
# Uso:  PGHOST=... PGDATABASE=... PGUSER=... PGPASSWORD=... ./cargar_geojson.sh /ruta/a/geojson
set -euo pipefail
SRC="${1:-.}"
PG="PG:host=${PGHOST} dbname=${PGDATABASE} user=${PGUSER} sslmode=${PGSSLMODE:-require}"

psql -v ON_ERROR_STOP=1 -f "$(dirname "$0")/esquema_ruteo.sql"

# tablas de staging (se reemplazan en cada carga)
ogr2ogr -f PostgreSQL "$PG" "$SRC/entidades.geojson"               -nln ruteo.stg_entidades   -nlt PROMOTE_TO_MULTI -lco GEOMETRY_NAME=geom -overwrite
ogr2ogr -f PostgreSQL "$PG" "$SRC/municipios.geojson"              -nln ruteo.stg_municipios  -nlt PROMOTE_TO_MULTI -lco GEOMETRY_NAME=geom -overwrite
ogr2ogr -f PostgreSQL "$PG" "$SRC/conseciones_cerreteras.geojson"  -nln ruteo.stg_rutas       -nlt PROMOTE_TO_MULTI -lco GEOMETRY_NAME=geom -overwrite
ogr2ogr -f PostgreSQL "$PG" "$SRC/ubicacion_gruas.geojson"         -nln ruteo.stg_corralones  -lco GEOMETRY_NAME=geom -overwrite

psql -v ON_ERROR_STOP=1 <<'SQL'
SET search_path TO ruteo, public;
BEGIN;
TRUNCATE corralones, rutas_concesionadas, municipios, entidades CASCADE;

INSERT INTO entidades (cve_ent, nomgeo, geom)
SELECT cve_ent, CASE cve_ent WHEN '09' THEN 'Ciudad de México' WHEN '15' THEN 'Estado de México' ELSE nomgeo END, ST_Multi(geom)
FROM stg_entidades;

-- region: se asigna después con el catálogo de regiones operativas (UPDATE municipios SET region = ...)
INSERT INTO municipios (cvegeo, cve_ent, cve_mun, nomgeo, entidad, geom)
SELECT s.cvegeo, s.cve_ent, s.cve_mun, s.nomgeo, e.nomgeo, ST_Multi(s.geom)
FROM stg_municipios s JOIN entidades e USING (cve_ent);

INSERT INTO rutas_concesionadas (id, nombre, descripcion, tipo_vial, longitud_km, geom)
SELECT id, regexp_replace(nombre, '\s+', ' ', 'g'), regexp_replace(descripcio, '\s+', ' ', 'g'), tipo_vial, longitud_km::numeric, ST_Multi(geom)
FROM stg_rutas;

INSERT INTO corralones (id, nombre, razon_social, coordenada, geom)
SELECT no_, 'Corralón HEMI ' || no_, trim("Nombre"), "Coordenada", geom
FROM stg_corralones;
COMMIT;
SQL
echo "Carga terminada. Asigna la columna municipios.region y prueba: backend/api.php?recurso=salud"
