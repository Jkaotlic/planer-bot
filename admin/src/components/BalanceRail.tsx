import { allowedByPool, countsForBalance } from "@planer/shared";
import type { Employee, Shift, Template, TemplateRolesView } from "../api/client";
import { initialsOf, personPalette, pluralizeRu } from "../lib/people";

export interface BalanceRailProps {
  employees: readonly Employee[];
  /** The visible period's entries (already filtered to the current week by the caller). */
  shifts: readonly Shift[];
  /** Presets: an entry's kind is the name of the preset it came from, so the rail must resolve templateId. */
  templates: readonly Template[];
  /**
   * Who may take each preset and who asked for it, straight from
   * `/api/admin/templates/roles`. Without it the ★ can only guess, and a guess here
   * is worse than nothing — see `nextPickByKind`.
   */
  roles: readonly TemplateRolesView[];
}

/** Who may take a kind of shift, and who asked for it — the two things the server
 *  applies before fairness, keyed by kind rather than by preset id because that is
 *  how the rail's columns are identified. */
export interface KindRoles {
  /** Employee ids allowed to take this kind. Empty means everyone. */
  pool: readonly number[];
  /** employeeId -> weight, higher wins. Absent means they didn't ask. */
  preference: Readonly<Record<number, number>>;
}

export function rolesByKind(roles: readonly TemplateRolesView[]): Map<string, KindRoles> {
  return new Map(roles.map((r) => [r.name, { pool: r.pool, preference: r.preference }]));
}

/** One worker's tally, in the very terms `distributeFairly` ranks them by. */
interface Load {
  employeeId: number;
  byKind: Record<string, number>;
  total: number;
}

/**
 * A roster cell the import could not read. Real work of an unknown kind, so it
 * counts — but under its own name, never under a preset's and never inside the
 * custom-time bucket. Same string as the server's `seedWorkerLoad` and the report,
 * on purpose: one entry must not read as «День» here and «не распознано» there.
 */
const UNRECOGNISED_KIND = "Не распознано (?)";

/**
 * Which bucket an entry counts toward, or `null` when it counts toward none —
 * the reading half of the ★, mirroring the server's seeding.
 *
 * The unread mark is checked **before** the times, because the two are not
 * exclusive: the import writes such a cell with no times at all, but a cell edited
 * before «правка снимает пометку» kept its mark and gained hours, and the live
 * schedule holds one. Checking times first dropped the untimed ones from the count
 * entirely and filed the timed one under its title — two different disagreements
 * with the server, on the same column.
 */
export function balanceKindOf(
  s: Pick<Shift, "category" | "start" | "end" | "templateId" | "title" | "unrecognisedCode">,
  nameById: ReadonlyMap<number, string>,
): string | null {
  if (!countsForBalance(s.category)) return null;
  if (s.unrecognisedCode != null) return UNRECOGNISED_KIND;
  if (s.start == null || s.end == null) return null;
  return shiftKind(s, nameById);
}

/**
 * Which kind of shift an entry is — mirrors the server's `shiftKind`: prefer the
 * preset it came from, fall back to its title (rows that predate templateId being
 * stored), and lump one-off custom times into a single bucket.
 */
function shiftKind(s: Pick<Shift, "templateId" | "title">, nameById: ReadonlyMap<number, string>): string {
  if (s.templateId != null) {
    const name = nameById.get(s.templateId);
    if (name) return name;
  }
  return s.title ?? "Своё время";
}

/**
 * Who «Распределить честно» hands the next shift of each kind to, in the server's
 * own order (`distributeFairly`): the pool as a hard filter, then fewest of that
 * kind, then who asked for it, then fewest shifts overall, then lowest id.
 *
 * The pool and the preference used to be missing here, which was harmless only
 * while no preset had a pool: the rail would star whoever held fewest of a duty
 * across the whole team — including people who may not take that duty at all — and
 * the button would then hand it to somebody else. A hint the admin believes has to
 * rank by the real rule, so this mirrors all four keys and the filter.
 *
 * A kind with no eligible candidate gets no entry, and so no ★ at all: better a
 * blank than a name that cannot be picked. It still can't know who will be free on
 * the day, so it stays a hint.
 */
export function nextPickByKind(
  loads: readonly Load[],
  kinds: readonly string[],
  byKind: ReadonlyMap<string, KindRoles>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const kind of kinds) {
    // A kind with no preset behind it (a one-off time, an old row) has no roles, which
    // reads as "everyone" — the same as an unconfigured preset.
    const kindRoles = byKind.get(kind);
    const pool = kindRoles?.pool;
    const preferenceOf = (employeeId: number) => kindRoles?.preference[employeeId] ?? 0;
    const eligible = loads.filter((l) => allowedByPool(pool, l.employeeId));
    const ranked = [...eligible].sort(
      (a, b) =>
        (a.byKind[kind] ?? 0) - (b.byKind[kind] ?? 0) ||
        preferenceOf(b.employeeId) - preferenceOf(a.employeeId) ||
        a.total - b.total ||
        a.employeeId - b.employeeId,
    );
    const first = ranked[0];
    if (first) out.set(kind, first.employeeId);
  }
  return out;
}

/**
 * Right-hand rail on the Расписание screen: how many shifts of each kind
 * (Утро/День/Вечер/Ночь…) every worker holds in the visible period. It mirrors
 * what «Распределить честно» balances — each kind on its own, not hours — so the
 * rail explains the button instead of contradicting it.
 */
export function BalanceRail({ employees, shifts, templates, roles }: BalanceRailProps) {
  const active = employees.filter((e) => e.isActive);
  const nameById = new Map(templates.map((t) => [t.id, t.name]));

  const loads: Load[] = active.map((e) => ({ employeeId: e.id, byKind: {}, total: 0 }));
  const byId = new Map(loads.map((l) => [l.employeeId, l]));
  /** Kinds actually present this period — an all-zero column would be noise. */
  const kinds: string[] = [];
  for (const s of shifts) {
    if (s.employeeId == null) continue;
    const kind = balanceKindOf(s, nameById);
    if (kind == null) continue;
    const load = byId.get(s.employeeId);
    if (!load) continue; // entry left on an archived worker — not a candidate for new slots
    load.byKind[kind] = (load.byKind[kind] ?? 0) + 1;
    load.total += 1;
    if (!kinds.includes(kind)) kinds.push(kind);
  }
  // Presets first, in the order they're offered elsewhere; kinds that live only on
  // entries (old rows, one-off times) sort after them.
  const presetOrder = new Map(templates.map((t, i) => [t.name, i]));
  const rankOf = (kind: string) => presetOrder.get(kind) ?? templates.length;
  kinds.sort((a, b) => rankOf(a) - rankOf(b) || a.localeCompare(b, "ru"));

  const maxTotal = Math.max(1, ...loads.map((l) => l.total));
  const nextPick = nextPickByKind(loads, kinds, rolesByKind(roles));

  return (
    <section className="balance-rail" aria-label="Баланс по видам смен">
      <h3 className="rail-title">Баланс по видам смен</h3>
      <div className="balance-rows">
        {active.map((employee) => {
          const load = byId.get(employee.id);
          const palette = personPalette(employee.id);
          const total = load?.total ?? 0;
          return (
            <BalanceRow
              key={employee.id}
              name={employee.address}
              initials={initialsOf(employee.displayName)}
              avatarBg={palette.bg}
              avatarFg={palette.fg}
              total={total}
              fillPct={(total / maxTotal) * 100}
              tallies={kinds.map((kind) => ({
                kind,
                count: load?.byKind[kind] ?? 0,
                isNext: nextPick.get(kind) === employee.id,
              }))}
            />
          );
        })}
      </div>
      {kinds.length > 0 && (
        <div className="balance-legend">
          ★ — кому «Распределить честно» отдаст следующую смену такого вида, если он свободен в этот день.
        </div>
      )}
    </section>
  );
}

/** One "Утро 2" chip; `isNext` marks the worker first in line for that kind. */
interface KindTally {
  kind: string;
  count: number;
  isNext: boolean;
}

interface BalanceRowProps {
  name: string;
  initials: string;
  avatarBg: string;
  avatarFg: string;
  total: number;
  fillPct: number;
  tallies: readonly KindTally[];
}

function BalanceRow({ name, initials, avatarBg, avatarFg, total, fillPct, tallies }: BalanceRowProps) {
  return (
    <div className="balance-row">
      <span className="avatar avatar-sm" style={{ background: avatarBg, color: avatarFg }}>
        {initials}
      </span>
      <div className="balance-row-main">
        <div className="balance-row-top">
          <span className="balance-name">{name}</span>
          <span className="balance-total">
            {total} {pluralizeRu(total, "смена", "смены", "смен")}
          </span>
        </div>
        {/* Total shifts — the algorithm's tiebreak once the per-kind counts are level. */}
        <div className="load-bar">
          <div className="load-bar-fill" style={{ width: `${fillPct}%` }} />
        </div>
        <div className="balance-caption">
          {tallies.length === 0 ? (
            "смен на этой неделе нет"
          ) : (
            tallies.map((t) => (
              <span key={t.kind} className={t.isNext ? "kind-tally kind-tally-next" : "kind-tally"}>
                {t.isNext ? "★ " : ""}
                {t.kind} {t.count}
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
