import type { TodayGroup, TodayModel } from "../../lib/team-schedule";

export function TeamTodayView({ model }: { model: TodayModel }) {
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
            <TodayGroupCard key={group.key} group={group} />
          ))}
          {model.noTimeGroups.length > 0 && (
            <section className="team-no-time">
              <h3>Без времени</h3>
              {model.noTimeGroups.map((group) => (
                <TodayGroupCard key={group.key} group={group} />
              ))}
            </section>
          )}
        </div>
      )}
    </>
  );
}

function TodayGroupCard({ group }: { group: TodayGroup }) {
  const markerStyle = group.palette ? { background: group.palette.bg } : undefined;

  return (
    <section className="team-group">
      <span className="team-group__marker" style={markerStyle} aria-hidden="true" />
      <div className="team-group__body">
        <div className="team-group__heading">
          <strong>{group.title}</strong>
          <span>{group.start && group.end ? `${group.start}–${group.end}` : "Весь день"}</span>
        </div>
        <div className="team-group__people">
          {group.people.map((person) => (
            <span key={`${group.key}:${person.employeeId ?? "open"}`}>{person.displayName}</span>
          ))}
        </div>
      </div>
    </section>
  );
}
