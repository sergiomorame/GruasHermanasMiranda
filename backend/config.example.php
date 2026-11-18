<?php
/**
 * Copia este archivo como config.php y llena los datos de conexión.
 * config.php no debe subirse al repositorio. Las variables de entorno GHM_DB_* tienen prioridad.
 */
return [
    'host'    => 'tu-instancia.xxxxxxxx.us-east-1.rds.amazonaws.com',
    'port'    => 5432,
    'name'    => 'gis',
    'user'    => 'ghm_lectura',
    'pass'    => 'cambiar',
    'sslmode' => 'require',
    'schema'  => 'ruteo',
];
