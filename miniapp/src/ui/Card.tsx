import type { ReactNode } from "react";

/** Скруглённая карточка на холсте. `flush` — для списка строк: без своих
 *  отступов, строки идут от края до края и делятся линией. */
export function Card({
  children,
  flush,
  "data-testid": testId,
  className,
}: {
  children: ReactNode;
  flush?: boolean;
  "data-testid"?: string;
  /** Зацепка для правила «этот вложенный `Card` — только обёртка», см. `ui.css`. */
  className?: string;
}) {
  return (
    <div className={`ui-card${flush ? " ui-card--flush" : ""}${className ? ` ${className}` : ""}`} data-testid={testId}>
      {children}
    </div>
  );
}
