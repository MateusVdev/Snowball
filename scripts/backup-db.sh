#!/usr/bin/env bash
# Backup completo do PostgreSQL (formato custom do pg_dump).
#   npm run db:backup                 → backups/bola-de-neve-AAAAMMDD-HHMMSS.dump
#   npm run db:backup -- caminho.dump
# Restauração (em banco vazio ou para substituir):  ver DOCUMENTATION/DEPLOYMENT.md
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -z "${DATABASE_URL:-}" && -f .env ]]; then
  set -a; source .env; set +a
fi
: "${DATABASE_URL:?DATABASE_URL não definida}"
URL="${DATABASE_URL%%\?*}"   # pg_dump não aceita o parâmetro ?schema= do Prisma
OUT="${1:-backups/bola-de-neve-$(date +%Y%m%d-%H%M%S).dump}"
mkdir -p "$(dirname "$OUT")"
umask 077                    # arquivo legível só pelo dono
pg_dump --format=custom --no-owner --no-privileges --dbname="$URL" --file="$OUT"
echo "Backup gravado em $OUT ($(du -h "$OUT" | cut -f1))"
