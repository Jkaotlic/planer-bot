import type { ReactNode } from "react";
import type { FeedEvent } from "../api/client";
import { useIsDark } from "../lib/theme";

export interface EventsFeedProps {
  events: readonly FeedEvent[];
}

// Dot colors per event kind, tuned per theme like `categories.tsx`'s chip
// palette. success/pending/error reuse the same hues as the weekend_work /
// vacation / destructive tones elsewhere in the app, so the feed reads as
// part of the same system rather than introducing new colors.
const DOT_LIGHT: Record<FeedEvent["kind"], string> = {
  success: "#1F7A34",
  pending: "#8A5700",
  error: "#C0392B",
  info: "#1C6FC9",
};
const DOT_DARK: Record<FeedEvent["kind"], string> = {
  success: "#86E093",
  pending: "#F4C169",
  error: "#FF6B60",
  info: "#8EC9FF",
};

/** Renders `**bold**` spans (used to highlight actor names) as `<strong>`. */
function renderRichText(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

/** "События" list below the balance rail: recent swap/schedule activity. */
export function EventsFeed({ events }: EventsFeedProps) {
  const isDark = useIsDark();
  const dotColors = isDark ? DOT_DARK : DOT_LIGHT;

  return (
    <section className="events-feed" aria-label="События">
      <h3 className="rail-title">События</h3>
      <ul className="feed-list">
        {events.map((event) => (
          <li key={event.id} className="feed-item">
            <span className="feed-dot" style={{ background: dotColors[event.kind] }} aria-hidden="true" />
            <div className="feed-item-main">
              <div className="feed-text">{renderRichText(event.text)}</div>
              <div className="feed-time">{event.timeLabel}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
