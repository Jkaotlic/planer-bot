import type { ReactNode } from "react";
import { useTelegramBack } from "../lib/telegram-back";
import { ActionButton } from "./ActionButton";

/**
 * Корень экрана. Заголовок, отступ от края и резерв под таб-бар — одни на все
 * вкладки: раньше у каждой был свой `<header>` со своими полями.
 *
 * `onBack` делает экран оверлеем: своя «‹ Назад» (вне Telegram системной кнопки
 * нет — dev, тесты), та же системная через `useTelegramBack`, и без резерва под
 * таб-бар — его на оверлее нет.
 */
export function Screen({
  title,
  subtitle,
  onBack,
  action,
  children,
}: {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  /** Кнопка в правом углу шапки. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`ui-screen${onBack ? " ui-screen--overlay" : ""}`}>
      {onBack && <BackLink onBack={onBack} />}
      {(title || subtitle || action) && (
        <header className="ui-screen__header">
          <div className="ui-screen__titles">
            {title && <h1 className="ui-screen__title">{title}</h1>}
            {subtitle && <p className="ui-screen__subtitle">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </div>
  );
}

/** Отдельным компонентом — ради хука: `useTelegramBack` нельзя звать по условию. */
function BackLink({ onBack }: { onBack: () => void }) {
  useTelegramBack(onBack);
  return (
    <span className="ui-back">
      <ActionButton kind="quiet" aria-label="Назад" onClick={onBack}>
        ‹ Назад
      </ActionButton>
    </span>
  );
}
