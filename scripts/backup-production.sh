#!/usr/bin/env bash
set -euo pipefail

project_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
backup_dir="$project_dir/backups"
umask 077
mkdir -p "$backup_dir"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
temporary="$backup_dir/.solar-$stamp.dump.tmp"
final="$backup_dir/solar-$stamp.dump"
trap 'rm -f "$temporary"' EXIT

cd "$project_dir"
docker compose -f compose.production.yaml exec -T db \
  pg_dump -U solar -d solar -Fc > "$temporary"
test -s "$temporary"
mv "$temporary" "$final"
trap - EXIT
find "$backup_dir" -maxdepth 1 -type f -name 'solar-*.dump' -mtime +14 -delete
printf 'Created %s\n' "$final"
