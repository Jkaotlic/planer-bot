/** Строка меню разделов: вся строка — кнопка, цель нажатия не меньше 44px.
 *  `badge` — сколько там ждёт решения: число видно в самой строке, чтобы к разделу
 *  не приходилось идти вслепую. */
export function MenuRow({ icon, title, hint, badge, onClick }: { icon: string; title: string; hint?: string; badge?: number; onClick: () => void }) {
  return (
    <button type="button" className="ui-menu-row" onClick={onClick}>
      <span className="ui-menu-row__icon" aria-hidden="true">{icon}</span>
      <span className="ui-menu-row__text">
        <span className="ui-menu-row__title">{title}</span>
        {hint && <span className="ui-menu-row__hint">{hint}</span>}
      </span>
      {badge ? <span className="ui-menu-row__badge" aria-label={`ждут: ${badge}`}>{badge > 9 ? "9+" : badge}</span> : null}
      <span className="ui-menu-row__chevron" aria-hidden="true">›</span>
    </button>
  );
}
