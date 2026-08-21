import { describeAuditEvent } from "@planer/shared";
import type { FeedEvent } from "../api/client";

export interface EventsFeedProps {
  events: readonly FeedEvent[];
  /** Уводит на экран «Журнал». Необязателен — лента живёт и без него. */
  onOpenJournal?: () => void;
}

/**
 * «События» под балансом: тридцать последних действий, короткой строкой.
 *
 * Текст берётся у `describeAuditEvent` — того же описателя, которым нарисован
 * «Журнал». Своей форматилки у ленты больше нет: она умела ровно один тип
 * события, которого в `AUDIT_TYPES` не существует вовсе, а все настоящие
 * печатала сырым именем из базы («событие: employee_observer_changed»).
 *
 * Из подробностей показывается только первая строка: в журнале у события их до
 * пяти, а колонка справа шириной 300px — остальное там не читается, а
 * растягивает ленту так, что тридцать событий перестают быть беглым взглядом.
 * За полным текстом ведёт ссылка в «Журнал».
 */
export function EventsFeed({ events, onOpenJournal }: EventsFeedProps) {
  return (
    <section className="events-feed" aria-label="События">
      <h3 className="rail-title">События</h3>
      {events.length === 0 ? (
        // Не пустое место: пустая лента и не загрузившаяся выглядят одинаково,
        // а это разные новости.
        <div className="feed-empty">Пока ничего не происходило.</div>
      ) : (
        <ul className="feed-list">
          {events.map((event) => (
            <FeedRow key={event.id} event={event} />
          ))}
        </ul>
      )}
      {onOpenJournal && (
        <button type="button" className="feed-more" onClick={onOpenJournal}>
          Все события →
        </button>
      )}
    </section>
  );
}

function FeedRow({ event }: { event: FeedEvent }) {
  const view = describeAuditEvent(event);
  return (
    <li className="feed-item">
      <span className="feed-icon" aria-hidden="true">{view.icon}</span>
      <div className="feed-item-main">
        <div className="feed-text">{view.title}</div>
        {view.lines[0] && <div className="feed-detail">{view.lines[0]}</div>}
        {/* «система» — то же слово, что в журнале: у события бота актора нет, и
            выдумывать «Кто-то» значит показать человека там, где его не было. */}
        <div className="feed-time">
          {event.actorName ?? "система"} · {event.timeLabel}
        </div>
      </div>
    </li>
  );
}
