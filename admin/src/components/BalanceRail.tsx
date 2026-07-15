import { countsForBalance } from "@planer/shared";
import type { Employee, Shift, Template } from "../api/client";
import { initialsOf, personPalette, pluralizeRu } from "../lib/people";
import { firstName } from "../lib/week";

export interface BalanceRailProps {
  employees: readonly Employee[];
  /** The visible period's entries (already filtered to the current week by the caller). */
  shifts: readonly Shift[];
  /** Presets: an entry's kind is the name of the preset it came from, so the rail must resolve templateId. */
  templates: readonly Template[];
}

/** One worker's tally, in the very terms `distributeFairly` ranks them by. */
interface Load {
  employeeId: number;
  byKind: Record<string, number>;
  total: number;
}

/** Only timed work entries count toward fairness — absences don't (mirrors the server's seeding). */
function isBalanceable(s: Shift): s is Shift & { employeeId: number; start: string; end: string } {
  return s.employeeId != null && s.start != null && s.end != null && countsForBalance(s.category);
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
 * Who «Распределить честно» hands the next shift of each kind to, ranked exactly
 * as `distributeFairly` does: fewest of that kind, then fewest shifts overall,
 * then lowest id. It can't know who'll be free on a given day, so this is a hint.
 */
function nextPickByKind(loads: readonly Load[], kinds: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const kind of kinds) {
    const ranked = [...loads].sort(
      (a, b) => (a.byKind[kind] ?? 0) - (b.byKind[kind] ?? 0) || a.total - b.total || a.employeeId - b.employeeId,
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
export function BalanceRail({ employees, shifts, templates }: BalanceRailProps) {
  const active = employees.filter((e) => e.isActive);
  const nameById = new Map(templates.map((t) => [t.id, t.name]));

  const loads: Load[] = active.map((e) => ({ employeeId: e.id, byKind: {}, total: 0 }));
  const byId = new Map(loads.map((l) => [l.employeeId, l]));
  /** Kinds actually present this period — an all-zero column would be noise. */
  const kinds: string[] = [];
  for (const s of shifts) {
    if (!isBalanceable(s)) continue;
    const load = byId.get(s.employeeId);
    if (!load) continue; // entry left on an archived worker — not a candidate for new slots
    const kind = shiftKind(s, nameById);
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
  const nextPick = nextPickByKind(loads, kinds);

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
              name={firstName(employee.displayName)}
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
