import { computeBalance, countsForBalance } from "@planer/shared";
import type { Employee, Shift } from "../api/client";
import { useCategoryPalette } from "../categories";
import { initialsOf, personPalette, pluralizeRu } from "../lib/people";
import { firstName } from "../lib/week";

export interface BalanceRailProps {
  employees: readonly Employee[];
  /** The visible period's entries (already filtered to the current week by the caller). */
  shifts: readonly Shift[];
}

interface Balance {
  employeeId: number;
  hours: number;
  nights: number;
  weekends: number;
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

/** Only work entries with concrete clock times count toward the load balance (absences don't). */
function isBalanceable(s: Shift): s is Shift & { employeeId: number; start: string; end: string } {
  return s.employeeId != null && s.start != null && s.end != null && countsForBalance(s.category);
}

/**
 * Right-hand rail on the Расписание screen: per-worker load for the visible
 * period (hours worked, night shifts, weekend shifts), computed from the
 * schedule's work entries via `@planer/shared`'s `computeBalance`.
 */
export function BalanceRail({ employees, shifts }: BalanceRailProps) {
  const active = employees.filter((e) => e.isActive);
  const balanceInput = shifts
    .filter(isBalanceable)
    .map((s) => ({ employeeId: s.employeeId, date: s.date, start: s.start, end: s.end, isLate: false }));
  const balances: readonly Balance[] = computeBalance(
    balanceInput,
    active.map((e) => e.id),
  );

  const maxHours = Math.max(1, ...balances.map((b) => b.hours));
  const topBalance = balances.reduce<Balance | null>(
    (top, b) => (top === null || b.hours > top.hours ? b : top),
    null,
  );
  const note = buildNote(topBalance, balances, active);

  return (
    <section className="balance-rail" aria-label="Баланс нагрузки">
      <h3 className="rail-title">Баланс нагрузки</h3>
      <div className="balance-rows">
        {active.map((employee) => {
          const balance = balances.find((b) => b.employeeId === employee.id);
          const hours = balance?.hours ?? 0;
          const palette = personPalette(employee.id);
          const isTop = topBalance !== null && employee.id === topBalance.employeeId && hours > 0;
          return (
            <BalanceRow
              key={employee.id}
              name={firstName(employee.displayName)}
              initials={initialsOf(employee.displayName)}
              avatarBg={palette.bg}
              avatarFg={palette.fg}
              hours={hours}
              fillPct={Math.min(100, (hours / maxHours) * 100)}
              warning={isTop}
              nights={balance?.nights ?? 0}
              weekends={balance?.weekends ?? 0}
            />
          );
        })}
      </div>
      {note && <div className="balance-note">{note}</div>}
    </section>
  );
}

interface BalanceRowProps {
  name: string;
  initials: string;
  avatarBg: string;
  avatarFg: string;
  hours: number;
  fillPct: number;
  warning: boolean;
  nights: number;
  weekends: number;
}

function BalanceRow({ name, initials, avatarBg, avatarFg, hours, fillPct, warning, nights, weekends }: BalanceRowProps) {
  const warningPalette = useCategoryPalette("vacation");
  return (
    <div className="balance-row">
      <span className="avatar avatar-sm" style={{ background: avatarBg, color: avatarFg }}>
        {initials}
      </span>
      <div className="balance-row-main">
        <div className="balance-row-top">
          <span className="balance-name">{name}</span>
          <span className="balance-hours">{Math.round(hours)} ч</span>
        </div>
        <div className="hours-bar">
          <div
            className="hours-bar-fill"
            style={{ width: `${fillPct}%`, background: warning ? warningPalette.fg : "var(--button)" }}
          />
        </div>
        <div className="balance-caption">
          ночи {nights} · выходные {weekends}
        </div>
      </div>
    </div>
  );
}

function buildNote(top: Balance | null, balances: readonly Balance[], active: readonly Employee[]): string | null {
  if (!top || top.hours <= 0) return null;
  const avgHours = mean(balances.map((b) => b.hours));
  const avgNights = mean(balances.map((b) => b.nights));
  const hoursDiff = Math.round(top.hours - avgHours);
  const nightsDiff = Math.round(top.nights - avgNights);
  if (hoursDiff <= 0) return null;

  const employee = active.find((e) => e.id === top.employeeId);
  if (!employee) return null;
  const name = firstName(employee.displayName);
  const nightsPart = nightsDiff > 0 ? ` и ${nightsDiff} ${pluralizeRu(nightsDiff, "ночную", "ночные", "ночных")}` : "";
  return `⚠ У ${name} на ${hoursDiff} ч${nightsPart} больше среднего — «Распределить честно» разгрузит.`;
}
