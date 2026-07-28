import { useEffect, useState } from "react";
import { apiClient, AuthRequiredError, type Employee, type TemplateRolesView } from "../api/client";
import { exactSchedulePalette } from "@planer/shared";
import { useEntryPalette } from "../categories";
import { initialsOf, personPalette } from "../lib/people";

/**
 * "Кто допущен: все" or "Кто допущен: 5 из 26". An empty pool is not "nobody" —
 * it is an unconfigured preset, and it means everyone. Saying so on the card is
 * the whole difference between the screen reading as a whitelist and reading as
 * a blacklist.
 */
export function poolSummary(poolSize: number, total: number): string {
  return poolSize === 0 ? `все (${total})` : `${poolSize} из ${total}`;
}

/** Adds or removes an id, returning a new array — the editor never mutates state. */
export function toggleId(ids: readonly number[], id: number): number[] {
  return ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id];
}

/** A preference is stored as a weight; the screen only offers on (1) and off. */
export function togglePreference(
  preference: Readonly<Record<number, number>>,
  id: number,
): Record<number, number> {
  const next = { ...preference };
  if (next[id]) delete next[id];
  else next[id] = 1;
  return next;
}

/** «Кто что может» — the pool and the preferences for every kind of shift. */
export function ShiftKindsScreen({ employees }: { employees: Employee[] }) {
  const [kinds, setKinds] = useState<TemplateRolesView[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = employees.filter((employee) => employee.isActive);

  useEffect(() => {
    apiClient
      .getTemplateRoles()
      .then(setKinds)
      .catch((err: unknown) => {
        if (!(err instanceof AuthRequiredError)) {
          setError(err instanceof Error ? err.message : "Не удалось загрузить виды смен");
        }
      });
  }, []);

  async function save(kind: TemplateRolesView, patch: Partial<TemplateRolesView>) {
    const next = { ...kind, ...patch };
    setKinds((current) => current?.map((item) => (item.templateId === kind.templateId ? next : item)) ?? current);
    setBusyId(kind.templateId);
    setError(null);
    try {
      await apiClient.saveTemplateRoles(next.templateId, next.pool, next.preference);
    } catch (err) {
      // Put the server's version back rather than leaving a lie on screen.
      setKinds(await apiClient.getTemplateRoles().catch(() => null));
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusyId(null);
    }
  }

  if (error && !kinds) return <div className="centered-fill">{error}</div>;
  if (!kinds) return <div className="centered-fill">Загрузка…</div>;

  return (
    <div className="employees-screen">
      <div className="employees-header">
        <h2 className="employees-title">Виды смен</h2>
      </div>
      <p className="kinds-intro">
        Кто допущен к виду смены и кто её любит. Пустой список допущенных значит «все» — никого не нужно
        исключать, просто не вписывай. «Любит» не перебивает справедливость: оно решает только ничью,
        когда у двоих поровну смен этого вида.
      </p>
      {error && <div className="employees-error">{error}</div>}

      <div className="employees-list">
        {kinds.map((kind) => (
          <KindCard
            key={kind.templateId}
            kind={kind}
            employees={active}
            open={openId === kind.templateId}
            busy={busyId === kind.templateId}
            onToggleOpen={() => setOpenId(openId === kind.templateId ? null : kind.templateId)}
            onChange={(patch) => void save(kind, patch)}
          />
        ))}
      </div>
    </div>
  );
}

function KindCard({
  kind,
  employees,
  open,
  busy,
  onToggleOpen,
  onChange,
}: {
  kind: TemplateRolesView;
  employees: Employee[];
  open: boolean;
  busy: boolean;
  onToggleOpen: () => void;
  onChange: (patch: Partial<TemplateRolesView>) => void;
}) {
  const palette = useEntryPalette({ templateId: kind.templateId, category: kind.category }, [
    { id: kind.templateId, accent: kind.accent },
  ]);
  // The very letter the week grid draws for this kind, not the first letter of its
  // name — otherwise all four duties read «Д» here and «Т»/«П»/«ВА»/«07» there.
  const code = exactSchedulePalette(kind.accent, kind.category)?.code ?? kind.name.slice(0, 1);
  const preferred = Object.keys(kind.preference).length;

  return (
    <section className="kind-card">
      <button type="button" className="kind-card-head" onClick={onToggleOpen} aria-expanded={open}>
        <span className="kind-swatch" style={{ background: palette.bg, color: palette.fg }} aria-hidden="true">
          {code}
        </span>
        <span className="kind-name">{kind.name}</span>
        <span className="kind-meta">
          допущены: <b>{poolSummary(kind.pool.length, employees.length)}</b>
          {preferred > 0 && <> · любят: <b>{preferred}</b></>}
        </span>
        <span className="kind-chevron">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="kind-people">
          <div className="kind-people-head">
            <span>Работник</span>
            <span title="Может брать этот вид смены">Допущен</span>
            <span title="Мягкий приоритет при равном числе таких смен">Любит</span>
          </div>
          {employees.map((employee) => {
            const inPool = kind.pool.includes(employee.id);
            const likes = Boolean(kind.preference[employee.id]);
            const colours = personPalette(employee.id);
            return (
              <label className="kind-person" key={employee.id}>
                <span className="kind-person-name">
                  <span className="avatar avatar-sm" style={{ background: colours.bg, color: colours.fg }}>
                    {initialsOf(employee.displayName)}
                  </span>
                  {employee.displayName}
                </span>
                <input
                  type="checkbox"
                  checked={inPool}
                  disabled={busy}
                  aria-label={`${employee.displayName}: допущен к «${kind.name}»`}
                  onChange={() => onChange({ pool: toggleId(kind.pool, employee.id) })}
                />
                <input
                  type="checkbox"
                  checked={likes}
                  disabled={busy}
                  aria-label={`${employee.displayName}: любит «${kind.name}»`}
                  onChange={() => onChange({ preference: togglePreference(kind.preference, employee.id) })}
                />
              </label>
            );
          })}
          {kind.pool.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary kind-clear"
              disabled={busy}
              onClick={() => onChange({ pool: [] })}
            >
              Сбросить на «все»
            </button>
          )}
        </div>
      )}
    </section>
  );
}
