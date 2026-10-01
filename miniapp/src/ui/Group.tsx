import type { ReactNode } from "react";

/** Раздел экрана: серая подпись и то, что под ней. Замена `List`+`Section`
 *  из telegram-ui — тот рисовал прямоугольный блок с синим заголовком. */
export function Group({ header, footer, children }: { header?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="ui-group">
      {header && <h2 className="ui-group__header">{header}</h2>}
      <div className="ui-group__body">{children}</div>
      {footer && <div className="ui-group__footer">{footer}</div>}
    </section>
  );
}
