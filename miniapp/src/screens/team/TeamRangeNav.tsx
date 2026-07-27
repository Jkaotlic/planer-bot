export function TeamRangeNav({
  label,
  busy,
  onPrevious,
  onNext,
}: {
  label: string;
  busy: boolean;
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
      <strong aria-live="polite">{label}</strong>
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
