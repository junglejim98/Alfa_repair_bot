
set -e

if ! psql -U "postgres" -tAc "SELECT 1 FROM pg_roles WHERE rolname='repairbot'" | grep -q 1; then
    psql -U "postgres" -c "CREATE USER repairbot WITH PASSWORD 'Admin-pc1';"
fi

psql -U "postgres" -c "CREATE DATABASE repair OWNER repairbot;"
psql -U "postgres" -c "GRANT ALL PRIVILEGES ON DATABASE repair TO repairbot;"

pg_restore -U repairbot -d repair --no-owner --role=repairbot /docker-entrypoint-initdb.d/backup.dump || {
    echo "Ошибка восстановления дампа!"
    exit 1
}

echo "Данные успешно восстановлены!"