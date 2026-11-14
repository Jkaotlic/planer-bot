export interface GreetingHeroProps {
  name: string;
  summary: string;
  /** Открывает «Настройки». Опущен — шестерёнки нет. */
  onSettings?: () => void;
  /** Открывает «Сервисы» (заказы и опросы, QR-код). Опущен — кнопки нет. */
  onServices?: () => void;
}

/** Приветствие вверху «Смен». Шестерёнка — здесь, а не в шапке экрана: это
 *  первое, что человек видит, а настройки раньше лежали под списком смен, за
 *  двумя экранами прокрутки. */
export function GreetingHero({ name, summary, onSettings, onServices }: GreetingHeroProps) {
  return (
    <div className="greeting-hero">
      <div className="greeting-hero__copy">
        <div className="greeting-hero__title">Привет, {name} 👋</div>
        <div className="greeting-hero__summary">{summary}</div>
      </div>
      {(onServices || onSettings) && (
        <div className="greeting-hero__actions">
          {onServices && (
            <button type="button" className="greeting-hero__button" onClick={onServices}>
              <span aria-hidden="true">🧰</span>
              Сервисы
            </button>
          )}
          {onSettings && (
            <button
              type="button"
              className="greeting-hero__button greeting-hero__button--icon"
              aria-label="Настройки"
              onClick={onSettings}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
