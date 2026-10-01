/** Строка меню разделов: вся строка — кнопка, цель нажатия не меньше 44px. */
export function MenuRow({ icon, title, hint, onClick }: { icon: string; title: string; hint?: string; onClick: () => void }) {
  return (
    <button type="button" className="ui-menu-row" onClick={onClick}>
      <span className="ui-menu-row__icon" aria-hidden="true">{icon}</span>
      <span className="ui-menu-row__text">
        <span className="ui-menu-row__title">{title}</span>
        {hint && <span className="ui-menu-row__hint">{hint}</span>}
      </span>
      <span className="ui-menu-row__chevron" aria-hidden="true">›</span>
    </button>
  );
}
