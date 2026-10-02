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
 *
 * `tabBar` вместе с `onBack` — раздел админки: «назад» нужна, но это не оверлей,
 * нижняя панель вкладок остаётся на месте, поэтому резерв под неё сохраняется.
 */
export function Screen({
  title,
  subtitle,
  onBack,
  backLabel = "Назад",
  tabBar,
  action,
  children,
}: {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  /** Подпись кнопки «назад»: раздел админки ведёт «назад» в меню, а не «никуда». */
  backLabel?: string;
  /** Нижняя панель вкладок остаётся видимой — экран не оверлей, даже с `onBack`. */
  tabBar?: boolean;
  /** Кнопка в правом углу шапки. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`ui-screen${onBack && !tabBar ? " ui-screen--overlay" : ""}`}>
      {onBack && <BackLink onBack={onBack} label={backLabel} />}
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
function BackLink({ onBack, label }: { onBack: () => void; label: string }) {
  useTelegramBack(onBack);
  return (
    <span className="ui-back">
      <ActionButton kind="quiet" aria-label={label} onClick={onBack}>
        ‹ {label}
      </ActionButton>
    </span>
  );
}
