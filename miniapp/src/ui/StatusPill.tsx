import type { ReactNode } from "react";

/** need — ждёт ответа от читающего; wait — ждём кого-то ещё; ok — улажено. */
export function StatusPill({ tone, children }: { tone: "need" | "wait" | "ok"; children: ReactNode }) {
  return <span className={`ui-pill ui-pill--${tone}`}>{children}</span>;
}
