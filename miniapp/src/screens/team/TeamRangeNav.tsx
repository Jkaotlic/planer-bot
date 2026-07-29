import { BackToTodayButton } from "../../components/BackToTodayButton";

export function TeamRangeNav({
  label,
  busy,
  backLabel,
  onBack,
  onPrevious,
  onNext,
}: {
  label: string;
  busy: boolean;
  /** «Сегодня» or «Эта неделя». */
  backLabel: string;
  /** Omit when the shown period already is the current one — the pill hides. */
  onBack?: () => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="team-range-nav">
      <button
        type="button"
        aria-label="Предыдущий период"
        disabled={busy}
        onClick={onPrevious}
      >
        ‹
      </button>
      <div className="team-range-nav__center">
        <strong aria-live="polite">{label}</strong>
        {onBack && <BackToTodayButton label={backLabel} disabled={busy} onClick={onBack} />}
      </div>
      <button
        type="button"
        aria-label="Следующий период"
        disabled={busy}
        onClick={onNext}
      >
        ›
      </button>
    </div>
  );
}
