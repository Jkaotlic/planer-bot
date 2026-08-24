#!/bin/bash
#
# Online backup of the live SQLite database, with verification and rotation.
#
# Run by the com.planerbot.backup LaunchDaemon (see ops/com.planerbot.backup.plist),
# and safe to run by hand at any time — the server may keep serving throughout.
#
#   ops/backup-db.sh
#
# NEVER copy the database file with cp/rsync. The live file is small and most of the
# data sits in the -wal sidecar, so a plain copy taken mid-write opens with missing
# tables. `.backup` is the only correct way: it takes a consistent snapshot of a
# database that is being written to.
#
# Environment overrides (all optional):
#   PLANER_DB          path to the live database   (default: <repo>/data/planer.db)
#   PLANER_DOCS_DIR    файлы инструкций            (default: <repo>/data/checklist-docs)
#   PLANER_BACKUP_DIR  where snapshots go          (default: ~/planer-bot-backups)
#   PLANER_BACKUP_KEEP how many to keep            (default: 30)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${PLANER_DB:-${REPO_ROOT}/data/planer.db}"
DEST="${PLANER_BACKUP_DIR:-${HOME}/planer-bot-backups}"
KEEP="${PLANER_BACKUP_KEEP:-30}"

# launchd gives a job a minimal PATH, so never assume sqlite3 is on it.
SQLITE="$(command -v sqlite3 || echo /usr/bin/sqlite3)"

# Messages are Russian and macOS ships bash 3.2, which has no multibyte support: in
# "«${KEEP}»" it reads the bytes of » as part of the variable NAME, so the expansion
# becomes an unset variable and `set -u` kills the script. Always brace expansions
# here — ${KEEP} — or a message string can take the whole backup job down.
log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { log "ОШИБКА: $*"; exit 1; }

[ -x "${SQLITE}" ] || fail "не найден sqlite3 (искал ${SQLITE})"
[ -f "${DB}" ] || fail "нет базы: ${DB}"
case "${KEEP}" in ''|*[!0-9]*) fail "PLANER_BACKUP_KEEP должно быть числом, а не «${KEEP}»";; esac
[ "${KEEP}" -ge 1 ] || fail "PLANER_BACKUP_KEEP должно быть не меньше 1"

mkdir -p "${DEST}"
STAMP="$(date '+%Y%m%d-%H%M%S')"
OUT="${DEST}/planer-${STAMP}.db"

log "снимок ${DB} -> ${OUT}"
"${SQLITE}" "${DB}" ".backup '${OUT}'" || fail "sqlite3 .backup не отработал"
[ -s "${OUT}" ] || fail "снимок пустой: ${OUT}"

# A backup nobody checked is not a backup. Verify before it is allowed to count
# towards retention — otherwise a run of corrupt snapshots would quietly evict the
# last good one.
#
# `immutable=1`, not `mode=ro`: a .backup snapshot inherits WAL journal mode, and
# opening a WAL database read-only makes SQLite create a -shm file beside it. That
# needs a writable directory (it fails outright on a read-only volume) and litters
# the backup folder with sidecars that look like part of the snapshot. immutable=1
# promises the file won't change, so no sidecar is needed at all.
INTEGRITY="$("${SQLITE}" "file:${OUT}?immutable=1" 'PRAGMA integrity_check;' 2>&1 || true)"
if [ "${INTEGRITY}" != "ok" ]; then
  rm -f "${OUT}"
  fail "снимок не прошёл integrity_check: ${INTEGRITY}"
fi

EMPLOYEES="$("${SQLITE}" "file:${OUT}?immutable=1" 'select count(*) from employees;')"
SHIFTS="$("${SQLITE}" "file:${OUT}?immutable=1" 'select count(*) from shifts;')"
log "ок: $(du -h "${OUT}" | cut -f1), сотрудников ${EMPLOYEES}, записей ${SHIFTS}"

# Файлы инструкций к чек-листам лежат НЕ в базе, и снимок .backup про них ничего
# не знает: восстановление из одной базы дало бы чек-листы с именами файлов,
# которых нет на диске. Архив кладётся рядом со снимком и с тем же штампом,
# чтобы пара «база + файлы» читалась одним взглядом.
DOCS="${PLANER_DOCS_DIR:-${REPO_ROOT}/data/checklist-docs}"
if [ -d "${DOCS}" ]; then
  DOCS_OUT="${DEST}/planer-docs-${STAMP}.tar.gz"
  tar -czf "${DOCS_OUT}" -C "$(dirname "${DOCS}")" "$(basename "${DOCS}")" || fail "не удалось упаковать ${DOCS}"
  log "файлы инструкций: $(du -h "${DOCS_OUT}" | cut -f1) -> ${DOCS_OUT}"
else
  log "каталог файлов инструкций пуст или не создан (${DOCS}) — архивировать нечего"
fi

# Rotation. Sorted newest-first by name, which is the same as by time because the
# stamp is fixed-width — no dependence on mtime, which a restore would rewrite.
REMOVED=0
while IFS= read -r old; do
  [ -n "$old" ] || continue
  rm -f "${DEST}/$old"
  REMOVED=$((REMOVED + 1))
done <<EOF
$(ls -1 "${DEST}" | grep -E '^planer-[0-9]{8}-[0-9]{6}\.db$' | sort -r | tail -n +$((KEEP + 1)))
EOF

KEPT="$(ls -1 "${DEST}" | grep -cE '^planer-[0-9]{8}-[0-9]{6}\.db$' || true)"
log "хранится снимков: ${KEPT} (лимит ${KEEP}), удалено в этот раз: ${REMOVED}"

# Та же ротация для архивов файлов — своим проходом, а не общим: имена разные, и
# один список смешал бы базы с архивами, отчего лимит считался бы вдвое.
DOCS_REMOVED=0
while IFS= read -r old; do
  [ -n "$old" ] || continue
  rm -f "${DEST}/$old"
  DOCS_REMOVED=$((DOCS_REMOVED + 1))
done <<EOF
$(ls -1 "${DEST}" | grep -E '^planer-docs-[0-9]{8}-[0-9]{6}\.tar\.gz$' | sort -r | tail -n +$((KEEP + 1)))
EOF

DOCS_KEPT="$(ls -1 "${DEST}" | grep -cE '^planer-docs-[0-9]{8}-[0-9]{6}\.tar\.gz$' || true)"
log "хранится архивов файлов: ${DOCS_KEPT} (лимит ${KEEP}), удалено в этот раз: ${DOCS_REMOVED}"
