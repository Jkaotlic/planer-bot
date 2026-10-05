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
    <div
      style={{
        background:
          "linear-gradient(135deg, var(--tgui--accent_text_color), color-mix(in srgb, var(--tgui--accent_text_color) 70%, #7B4DE0))",
        color: "#fff",
        borderRadius: "var(--app-radius-card)",
        padding: "14px 8px 14px 16px",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 18, fontWeight: 700, overflowWrap: "anywhere" }}>Привет, {name} 👋</div>
        <div style={{ fontSize: "var(--app-text-meta)", opacity: 0.92, marginTop: 3 }}>{summary}</div>
      </div>
      {/* «Сервисы» — подписью, а не одной иконкой: владелец выбрал так 05.10.2026,
          иконку без подписи никто не нажимает. Рядом с шестерёнкой, в той же строке,
          чтобы не занимать на экране новое место. */}
      {onServices && (
        <button
          type="button"
          onClick={onServices}
          style={{
            flex: "none",
            height: 44,
            padding: "0 12px",
            border: 0,
            borderRadius: 12,
            background: "rgb(255 255 255 / 16%)",
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 15,
            fontWeight: 600,
            whiteSpace: "nowrap",
            cursor: "pointer",
          }}
        >
          <span aria-hidden="true">🧰</span>
          Сервисы
        </button>
      )}
      {onSettings && (
        <button
          type="button"
          aria-label="Настройки"
          onClick={onSettings}
          style={{
            flex: "none",
            width: 44,
            height: 44,
            border: 0,
            borderRadius: 12,
            background: "rgb(255 255 255 / 16%)",
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </button>
      )}
    </div>
  );
}
