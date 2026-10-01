import type { ReactNode } from "react";

/** Серое пояснение. Одно на всё приложение: раньше пояснения были где серые,
 *  где синие, и синие читались как ссылки. */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="ui-hint">{children}</p>;
}
