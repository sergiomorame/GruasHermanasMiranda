<?php
/**
 * database.php — conexión PDO a PostgreSQL/PostGIS.
 *
 * Las credenciales se leen, en este orden:
 *   1. Variables de entorno: GHM_DB_HOST, GHM_DB_PORT, GHM_DB_NAME, GHM_DB_USER, GHM_DB_PASS, GHM_DB_SSLMODE
 *   2. backend/config.php (copiar de config.example.php; no se versiona)
 *
 * Para AWS RDS se recomienda sslmode=require y un usuario de solo lectura.
 */

declare(strict_types=1);

final class Database
{
    private static ?PDO $pdo = null;

    /** Configuración efectiva (entorno > config.php > valores por defecto). */
    public static function config(): array
    {
        $file = __DIR__ . '/config.php';
        $cfg = is_file($file) ? (require $file) : [];
        $env = static fn(string $k, $def) => (getenv($k) !== false && getenv($k) !== '') ? getenv($k) : $def;

        return [
            'host'    => $env('GHM_DB_HOST', $cfg['host'] ?? ''),
            'port'    => (int) $env('GHM_DB_PORT', $cfg['port'] ?? 5432),
            'name'    => $env('GHM_DB_NAME', $cfg['name'] ?? ''),
            'user'    => $env('GHM_DB_USER', $cfg['user'] ?? ''),
            'pass'    => $env('GHM_DB_PASS', $cfg['pass'] ?? ''),
            'sslmode' => $env('GHM_DB_SSLMODE', $cfg['sslmode'] ?? 'prefer'),
            'schema'  => $env('GHM_DB_SCHEMA', $cfg['schema'] ?? 'ruteo'),
        ];
    }

    /** ¿Hay datos de conexión y driver disponible? */
    public static function isConfigured(): bool
    {
        $c = self::config();
        return $c['host'] !== '' && $c['name'] !== '' && $c['user'] !== '' && in_array('pgsql', PDO::getAvailableDrivers(), true);
    }

    /** Conexión única por petición. Lanza PDOException si no se puede conectar. */
    public static function pdo(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }
        $c = self::config();
        $dsn = sprintf('pgsql:host=%s;port=%d;dbname=%s;sslmode=%s', $c['host'], $c['port'], $c['name'], $c['sslmode']);
        self::$pdo = new PDO($dsn, $c['user'], $c['pass'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::ATTR_TIMEOUT            => 5,
        ]);
        $schema = preg_replace('/[^a-z0-9_]/i', '', $c['schema']);
        self::$pdo->exec("SET search_path TO {$schema}, public");
        self::$pdo->exec("SET statement_timeout TO '15s'");
        return self::$pdo;
    }

    /** Ejecuta una consulta preparada y devuelve la primera columna de la primera fila. */
    public static function scalar(string $sql, array $params = [])
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        return $st->fetchColumn();
    }
}
