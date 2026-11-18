<?php
/**
 * api.php — API de solo lectura del Sistema de Ruteo.
 *
 * Uso:  backend/api.php?recurso=municipios|entidades|rutas|corralones|unidades_ejemplo|salud
 *
 * Cada recurso se construye en PostGIS como GeoJSON (json_build_object + ST_AsGeoJSON).
 * Si la base no está configurada o no responde, se sirve el archivo equivalente de ../data/
 * para que el tablero siga funcionando. El campo "fuente" indica de dónde salió la respuesta.
 */

declare(strict_types=1);
require_once __DIR__ . '/database.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
// Habilitar si el frontend se sirve desde otro dominio:
// header('Access-Control-Allow-Origin: https://tu-dominio.com');

const DATA_DIR = __DIR__ . '/../data/';

/** Consultas por recurso. Todas devuelven un único valor JSON (FeatureCollection). */
const QUERIES = [
    'municipios' => <<<SQL
        SELECT json_build_object(
          'type', 'FeatureCollection', 'name', 'municipios',
          'features', COALESCE(json_agg(json_build_object(
             'type', 'Feature',
             'properties', json_build_object(
                'cvegeo', m.cvegeo, 'cve_ent', m.cve_ent, 'cve_mun', m.cve_mun, 'nomgeo', m.nomgeo,
                'entidad', m.entidad, 'region', m.region,
                'km_concesion', m.km_concesion, 'tramos', m.tramos,
                'con_concesion', m.km_concesion > 0.05, 'dist_corralon_km', m.dist_corralon_km),
             'geometry', ST_AsGeoJSON(ST_SimplifyPreserveTopology(m.geom, 0.0012), 5)::json
          ) ORDER BY m.cvegeo), '[]'::json))
        FROM v_municipios_metricas m
    SQL,

    'entidades' => <<<SQL
        SELECT json_build_object(
          'type', 'FeatureCollection', 'name', 'entidades',
          'features', COALESCE(json_agg(json_build_object(
             'type', 'Feature',
             'properties', json_build_object('cve_ent', e.cve_ent, 'nomgeo', e.nomgeo),
             'geometry', ST_AsGeoJSON(ST_SimplifyPreserveTopology(e.geom, 0.0015), 5)::json
          ) ORDER BY e.cve_ent), '[]'::json))
        FROM entidades e
    SQL,

    'rutas' => <<<SQL
        SELECT json_build_object(
          'type', 'FeatureCollection', 'name', 'rutas_concesionadas',
          'features', COALESCE(json_agg(json_build_object(
             'type', 'Feature',
             'properties', json_build_object(
                'id', r.id, 'clave', r.clave, 'nombre', r.nombre, 'descripcion', r.descripcion,
                'tipo_vial', r.tipo_vial, 'longitud_km', r.longitud_km, 'longitud_geom_km', r.longitud_geom_km,
                'duplicado_de', r.duplicado_de, 'entidades', r.entidades, 'region', r.region, 'regiones', r.regiones,
                'municipios', r.municipios, 'corralon_cercano', r.corralon_cercano, 'dist_corralon_km', r.dist_corralon_km),
             'geometry', ST_AsGeoJSON(ST_SimplifyPreserveTopology(r.geom, 0.00015), 6)::json
          ) ORDER BY r.id), '[]'::json))
        FROM v_rutas_metricas r
    SQL,

    'corralones' => <<<SQL
        SELECT json_build_object(
          'type', 'FeatureCollection', 'name', 'corralones',
          'features', COALESCE(json_agg(json_build_object(
             'type', 'Feature',
             'properties', json_build_object(
                'id', c.id, 'clave', 'HEMI-' || c.id, 'nombre', c.nombre, 'razon_social', c.razon_social,
                'coordenada', c.coordenada, 'cvegeo', m.cvegeo, 'municipio', m.nomgeo, 'entidad', m.entidad, 'region', m.region),
             'geometry', ST_AsGeoJSON(c.geom, 6)::json
          ) ORDER BY c.id), '[]'::json))
        FROM corralones c
        LEFT JOIN municipios m ON ST_Contains(m.geom, c.geom)
    SQL,
];

/** Recursos que todavía no existen en la base y se sirven siempre desde archivo. */
const SOLO_ARCHIVO = ['unidades_ejemplo'];

function responder(int $status, $payload, int $maxAge = 0): void
{
    http_response_code($status);
    if ($maxAge > 0) {
        header("Cache-Control: public, max-age={$maxAge}");
    } else {
        header('Cache-Control: no-store');
    }
    echo is_string($payload) ? $payload : json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/** Devuelve el archivo de ../data/ marcando la fuente. */
function desdeArchivo(string $recurso, string $motivo): void
{
    $file = DATA_DIR . $recurso . '.json';
    if (!is_file($file)) {
        responder(404, ['error' => "No existe data/{$recurso}.json"]);
    }
    $json = json_decode((string) file_get_contents($file), true);
    $json['fuente'] = 'archivo';
    $json['motivo'] = $motivo;
    responder(200, $json, 300);
}

$recurso = $_GET['recurso'] ?? '';
$validos = array_merge(array_keys(QUERIES), SOLO_ARCHIVO, ['salud']);
if (!in_array($recurso, $validos, true)) {
    responder(400, ['error' => 'Recurso no válido', 'recursos' => $validos]);
}

if ($recurso === 'salud') {
    $ok = false; $detalle = 'sin configurar';
    if (Database::isConfigured()) {
        try {
            $detalle = (string) Database::scalar('SELECT postgis_full_version()');
            $ok = true;
        } catch (Throwable $e) {
            $detalle = 'sin conexión';
            error_log('[GHM] salud: ' . $e->getMessage());
        }
    }
    responder(200, ['postgis' => $ok, 'detalle' => $detalle, 'hora' => date(DATE_ATOM)]);
}

if (in_array($recurso, SOLO_ARCHIVO, true)) {
    desdeArchivo($recurso, 'recurso de ejemplo');
}

if (!Database::isConfigured()) {
    desdeArchivo($recurso, 'base de datos sin configurar');
}

try {
    $json = Database::scalar(QUERIES[$recurso]);
    $data = json_decode((string) $json, true, 512, JSON_THROW_ON_ERROR);
    $data['fuente'] = 'postgis';
    responder(200, $data, 300);
} catch (Throwable $e) {
    error_log('[GHM] ' . $recurso . ': ' . $e->getMessage());
    desdeArchivo($recurso, 'error de base de datos');
}
