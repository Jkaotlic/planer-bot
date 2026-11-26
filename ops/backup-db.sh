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
# Снимок содержит данные сотрудников, а архив — служебные инструкции.
umask 077

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
# Плановый запуск и ручной делят каталог и ротацию. Дескриптор остаётся у shell
# до выхода, а ядро снимает блокировку даже после аварийной остановки.
exec 9>>"${DEST}/.planer-backup.lock"
if command -v lockf >/dev/null 2>&1; then
  lockf -s 9 || fail "не удалось заблокировать папку бэкапов"
else
  flock 9 || fail "не удалось заблокировать папку бэкапов"
fi
STAMP="$(date '+%Y%m%d-%H%M%S')"
OUT="${DEST}/planer-${STAMP}.db"
DOCS_OUT="${DEST}/planer-docs-${STAMP}.tar.gz"
COMPLETE="${DEST}/planer-${STAMP}.complete"
PENDING="${DEST}/.planer-${STAMP}.pending"
STAGE="$(mktemp -d "${DEST}/.planer-backup.XXXXXX")"
DOCS_PUBLISHED=0
DB_PUBLISHED=0
PENDING_PUBLISHED=0
COMMITTED=0

cleanup() {
  # Удаляем только ссылки, которые успел создать этот запуск. Снимок другого
  # процесса с тем же штампом остаётся на месте.
  if [ "${COMMITTED}" -eq 0 ]; then
    [ "${DB_PUBLISHED}" -eq 0 ] || rm -f "${OUT}"
    [ "${DOCS_PUBLISHED}" -eq 0 ] || rm -f "${DOCS_OUT}"
  fi
  [ "${PENDING_PUBLISHED}" -eq 0 ] || rm -f "${PENDING}"
  rm -rf "${STAGE}"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

# Путь к боевой базе может быть относительным, а SQLite запускается в staging.
case "${DB}" in /*) ;; *) DB="${PWD}/${DB}" ;; esac
snapshot_sql() { (cd "${STAGE}" && "${SQLITE}" 'file:snapshot.db?immutable=1' "$@"); }

# Сравниваем идентификатор чек-листа и имя файла. Абсолютный путь внутри
# SQLite может указывать на другой каталог после восстановления.
archive_has_snapshot_docs() {
  local directory="$1" db_name="$2" listing="$3" count path suffix
  count="$(cd "${directory}" && "${SQLITE}" -readonly "file:${db_name}?immutable=1" \
    "SELECT count(*) FROM pragma_table_info('checklists') WHERE name='doc_path';")" || return 1
  [ "${count}" = 1 ] || return 0
  (cd "${directory}" && "${SQLITE}" -readonly "file:${db_name}?immutable=1" \
    "SELECT doc_path FROM checklists WHERE doc_path <> '';" ) > "${STAGE}/doc-paths" || return 1
  while IFS= read -r path; do
    suffix="/$(basename "$(dirname "${path}")")/$(basename "${path}")"
    awk -v suffix="${suffix}" 'substr($0, length($0) - length(suffix) + 1) == suffix { found = 1; exit } END { exit !found }' "${listing}" || return 1
  done < "${STAGE}/doc-paths"
}

log "снимок ${DB} -> ${OUT}"
(cd "${STAGE}" && "${SQLITE}" "${DB}" '.backup snapshot.db') || fail "sqlite3 .backup не отработал"
[ -s "${STAGE}/snapshot.db" ] || fail "снимок пустой: ${OUT}"

# A backup nobody checked is not a backup. Verify before it is allowed to count
# towards retention — otherwise a run of corrupt snapshots would quietly evict the
# last good one.
#
# `immutable=1`, not `mode=ro`: a .backup snapshot inherits WAL journal mode, and
# opening a WAL database read-only makes SQLite create a -shm file beside it. That
# needs a writable directory (it fails outright on a read-only volume) and litters
# the backup folder with sidecars that look like part of the snapshot. immutable=1
# promises the file won't change, so no sidecar is needed at all.
INTEGRITY="$(snapshot_sql 'PRAGMA integrity_check;' 2>&1 || true)"
if [ "${INTEGRITY}" != "ok" ]; then
  fail "снимок не прошёл integrity_check: ${INTEGRITY}"
fi

EMPLOYEES="$(snapshot_sql 'select count(*) from employees;')"
SHIFTS="$(snapshot_sql 'select count(*) from shifts;')"

# Файлы инструкций к чек-листам лежат НЕ в базе, и снимок .backup про них ничего
# не знает: восстановление из одной базы дало бы чек-листы с именами файлов,
# которых нет на диске. Архив кладётся рядом со снимком и с тем же штампом,
# чтобы пара «база + файлы» читалась одним взглядом.
DOCS="${PLANER_DOCS_DIR:-${REPO_ROOT}/data/checklist-docs}"
DOCS_NAME="$(basename "${DOCS}")"
DOCS_PARENT="$(dirname "${DOCS}")"
if [ ! -d "${DOCS}" ]; then
  # Даже без инструкций пустой архив делает комплект однозначным для меню.
  mkdir "${STAGE}/${DOCS_NAME}"
  DOCS_PARENT="${STAGE}"
fi
tar -czf "${STAGE}/docs.tar.gz" -C "${DOCS_PARENT}" "${DOCS_NAME}" || fail "не удалось упаковать ${DOCS}"
gzip -t "${STAGE}/docs.tar.gz" || fail "контрольная сумма архива не совпала"
tar -tzf "${STAGE}/docs.tar.gz" > "${STAGE}/archive.list" || fail "архив инструкций не читается"

# Файл могли заменить между снимком SQLite и упаковкой. Такой архив читается,
# но восстановленная инструкция будет ссылаться на отсутствующий файл.
archive_has_snapshot_docs "${STAGE}" snapshot.db "${STAGE}/archive.list" || fail "архив не содержит инструкцию из снимка"

# Жёсткие ссылки публикуют файлы на том же томе и не заменяют чужой комплект.
# Pending отличает публикацию нового комплекта от старой пары без маркера.
touch "${STAGE}/complete"
ln "${STAGE}/complete" "${PENDING}" || fail "комплект с этим штампом уже публиковался"
PENDING_PUBLISHED=1
ln "${STAGE}/docs.tar.gz" "${DOCS_OUT}" || fail "архив с этим штампом уже существует"
DOCS_PUBLISHED=1
ln "${STAGE}/snapshot.db" "${OUT}" || fail "снимок с этим штампом уже существует"
DB_PUBLISHED=1
ln "${STAGE}/complete" "${COMPLETE}" || fail "не удалось отметить завершение комплекта"
COMMITTED=1
log "ок: $(du -h "${OUT}" | cut -f1), сотрудников ${EMPLOYEES}, записей ${SHIFTS}"
log "файлы инструкций: $(du -h "${DOCS_OUT}" | cut -f1) -> ${DOCS_OUT}"

# Ротируем пары по штампу. Старые копии без маркера учитываются, если архив
# читается. Незавершённый комплект не вытесняет последний исправный.
REMOVED=0
KEPT=0
while IFS= read -r old; do
  [ -n "$old" ] || continue
  stamp="${old#planer-}"
  stamp="${stamp%.db}"
  archive="${DEST}/planer-docs-${stamp}.tar.gz"
  marker="${DEST}/planer-${stamp}.complete"
  [ -s "${DEST}/${old}" ] && [ -s "${archive}" ] || continue
  if [ ! -f "${marker}" ]; then
    [ ! -e "${DEST}/.planer-${stamp}.pending" ] || continue
    [ "$(cd "${DEST}" && "${SQLITE}" -readonly "file:${old}?immutable=1" 'PRAGMA quick_check;' 2>/dev/null)" = ok ] || continue
    gzip -t "${archive}" > /dev/null 2>&1 || continue
    tar -tzf "${archive}" > "${STAGE}/legacy.list" 2>/dev/null || continue
    archive_has_snapshot_docs "${DEST}" "${old}" "${STAGE}/legacy.list" || continue
  fi
  if [ "${KEPT}" -lt "${KEEP}" ]; then
    KEPT=$((KEPT + 1))
    continue
  fi
  rm -f "${DEST}/${old}" "${archive}" "${marker}"
  REMOVED=$((REMOVED + 1))
done <<EOF
$(ls -1 "${DEST}" | grep -E '^planer-[0-9]{8}-[0-9]{6}\.db$' | sort -r)
EOF

log "хранится комплектов: ${KEPT} (лимит ${KEEP}), удалено в этот раз: ${REMOVED}"
