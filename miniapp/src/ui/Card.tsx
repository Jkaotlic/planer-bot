import type { ReactNode } from "react";

/** Скруглённая карточка на холсте. `flush` — для списка строк: без своих
 *  отступов, строки идут от края до края и делятся линией. */
export function Card({
  children,
  flush,
  "data-testid": testId,
}: {
  children: ReactNode;
  flush?: boolean;
  "data-testid"?: string;
}) {
  return (
    <div className={`ui-card${flush ? " ui-card--flush" : ""}`} data-testid={testId}>
      {children}
    </div>
  );
}
