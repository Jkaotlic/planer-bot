import { SICK_LEAVE_PENDING_OUTLINE } from "@planer/shared";
import type { TodayGroup, TodayModel } from "../../lib/team-schedule";
import { categoryPaletteForTheme } from "../../categories";
import { initialsOf, personPalette } from "../../lib/people";

export function TeamTodayView({
  model,
  isDark,
}: {
  model: TodayModel;
  isDark: boolean;
}) {
  const empty = model.groups.length === 0 && model.noTimeGroups.length === 0;

  return (
    <>
      <div className="team-summary" aria-label="Итоги дня">
        <span>
          <b>{model.workingCount}</b> На работе
        </span>
        <span>
          <b>{model.absentCount}</b> Отсутствует
        </span>
      </div>
      {empty ? (
        <div className="team-empty">
          <strong>На этот день записей нет</strong>
          <span>Выберите соседнюю дату стрелками.</span>
        </div>
      ) : (
        <div className="team-today">
          {model.groups.map((group) => (
            <TodayGroupCard key={group.key} group={group} isDark={isDark} />
          ))}
          {model.noTimeGroups.length > 0 && (
            <section className="team-no-time">
              <h3 className="ui-group__header">Без времени</h3>
              {model.noTimeGroups.map((group) => (
                <TodayGroupCard key={group.key} group={group} isDark={isDark} />
              ))}
            </section>
          )}
        </div>
      )}
    </>
  );
}

function TodayGroupCard({
  group,
  isDark,
}: {
  group: TodayGroup;
  isDark: boolean;
}) {
  const category = group.entries[0]?.shift.category;
  const palette = group.palette
    ?? (category ? categoryPaletteForTheme(category, isDark) : null);
  // Пунктир, как у клетки недели: «ждёт ОК» одинаково читается и там, и здесь.
  const markerStyle = palette
    ? { background: palette.bg, ...(group.pending ? { outline: SICK_LEAVE_PENDING_OUTLINE, outlineOffset: -2 } : {}) }
    : undefined;

  return (
    <section className="team-group">
      <span className="team-group__marker" style={markerStyle} aria-hidden="true" />
      <div className="team-group__body">
        <div className="team-group__heading">
          <strong>{group.title}</strong>
          <span>{group.start && group.end ? `${group.start}–${group.end}` : "Весь день"}</span>
        </div>
        {/* Люди — теми же кружками с инициалами, что в консоли и в «Работниках»:
            голым списком имён группа из шести человек читалась абзацем текста, а
            цвет опознаёт человека раньше, чем глаз дочитает фамилию. */}
        <ul className="team-group__people">
          {group.people.map((person) => {
            const palette = personPalette(person.employeeId);
            return (
              <li className="team-person" key={`${group.key}:${person.employeeId ?? "open"}`}>
                <span className="team-person__avatar" style={{ background: palette.bg, color: palette.fg }} aria-hidden="true">
                  {initialsOf(person.displayName)}
                </span>
                <span className="team-person__name">{person.displayName}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
