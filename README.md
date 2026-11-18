# Grúas Hermanas Miranda · Sistema de Ruteo

GeoDashboard de control operativo y análisis territorial de las **rutas concesionadas** (carreteras), los **corralones HEMI** y las **unidades** de grúa.

## Qué datos son reales y cuáles de ejemplo

| Capa | Origen | Archivo |
|---|---|---|
| Entidades (CDMX y Edomex) | GeoJSON original | `data/entidades.json` |
| Municipios (141) | GeoJSON original + métricas calculadas | `data/municipios.json` |
| Rutas concesionadas (29 tramos) | GeoJSON `conseciones_cerreteras` + métricas | `data/rutas.json` |
| Corralones HEMI (2) | GeoJSON `ubicacion_gruas` | `data/corralones.json` |
| Unidades (10) | **Ejemplo**, hasta tener GPS | `data/unidades_ejemplo.json` |

Las **rutas son los tramos concesionados**. Cada unidad de ejemplo recorre un tramo (ida y vuelta) con una simulación acelerada (`simFactor` en `js/main.js`).

Las **regiones operativas** (Valle de Toluca, Norte, CDMX, Sur…) son una agrupación propuesta de municipios; ajústala en la columna `municipios.region`.

### Métricas calculadas sobre tus geometrías

- **Km medidos**: longitud geodésica de cada tramo (no la columna `longitud_km`, que se muestra como "declarada").
- **Traslapes**: 7 tramos repiten casi la misma geometría que otro (Hausdorff < ~300 m). No se suman en los km y se marcan punteados en el mapa.
- **Km por municipio**: intersección de la red sin traslapes con cada municipio.
- **Km fuera del área**: parte de algunos tramos (Palmillas, Maravatío, Arco Norte, Cd. Altamirano) sale de CDMX y Edomex. Para medirla por municipio hace falta cargar la cartografía de Querétaro, Michoacán, Hidalgo y Guerrero.
- **Cobertura a 25 km** y **distribución por distancia**: km de ruta, muestreados cada 500 m, según su distancia al corralón más cercano.

## Estructura

```
dashboard_ruteo/
├── index.html              Estructura de paneles
├── css/
│   ├── styles.css          Tokens (claro/oscuro), tipografía, controles
│   ├── dashboard.css       Tarjetas, KPIs, tablas, gráficas
│   ├── maps.css            Mapa, marcadores, Leaflet
│   └── responsive.css      Laptop, tableta, teléfono
├── js/
│   ├── main.js             Configuración, carga (API o JSON), arranque, simulación
│   ├── routes.js           Geometría: longitud, interpolación, muestreo, bandas, unidades
│   ├── filters.js          Filtros en cascada y ámbito
│   ├── maps.js             Mapa principal, mapas base, capas, minimapas
│   ├── charts.js           Gráficas (Chart.js)
│   └── dashboard.js        KPIs, tablas, alertas, regiones, catálogo
├── assets/                 logos/, icons/, images/
├── data/                   GeoJSON listos para el tablero
└── backend/
    ├── api.php             API GeoJSON desde PostGIS (con respaldo a data/)
    ├── database.php        Conexión PDO (variables de entorno o config.php)
    ├── config.example.php  Plantilla de credenciales
    └── sql/
        ├── esquema_ruteo.sql   Tablas, índices y vistas de métricas
        └── cargar_geojson.sh   Carga con ogr2ogr
```

## Ejecutar

El navegador no deja leer `data/` si abres `index.html` con doble clic, así que hay que servirlo:

```bash
cd dashboard_ruteo
php -S localhost:8000          # sirve el tablero y backend/api.php
# abre http://localhost:8000
```

Sin base de datos configurada, `api.php` responde con los archivos de `data/` y el encabezado muestra "API · archivos locales". Sin PHP, `python3 -m http.server 8000` también funciona y el tablero usa `data/` directamente.

Los mapas base (CARTO, Esri, OpenTopoMap) necesitan internet. Para producción revisa las condiciones de uso de cada proveedor o usa tu propio servidor de teselas.

## Conectar PostGIS (AWS RDS)

1. Cargar los GeoJSON: `PGHOST=… PGDATABASE=… PGUSER=… PGPASSWORD=… backend/sql/cargar_geojson.sh /ruta/geojson`
2. Asignar `municipios.region` con tu catálogo.
3. Credenciales: copia `backend/config.example.php` a `backend/config.php`, o define `GHM_DB_HOST`, `GHM_DB_NAME`, `GHM_DB_USER`, `GHM_DB_PASS`, `GHM_DB_SSLMODE=require`.
4. Verificar: `backend/api.php?recurso=salud` → `{"postgis": true, …}`. El encabezado del tablero cambia a "PostGIS en línea".

Recursos de la API: `municipios`, `entidades`, `rutas`, `corralones`, `unidades_ejemplo`, `salud`.

Cuando exista el GPS, llena `ruteo.unidades` y `ruteo.unidades_posicion`, agrega el recurso `unidades` en `api.php` (última posición por unidad) y en `js/main.js` sustituye la simulación por esa consulta.
