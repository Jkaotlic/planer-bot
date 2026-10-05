import type { SpecialDay } from "@planer/shared";

/**
 * Праздники и рабочие субботы недели одной строкой: «🎉 Ср 4 — День народного
 * единства · 💼 Сб 7 — рабочая суббота».
 *
 * Текстом, а не `title`: на телефоне подсказки по наведению нет, и название,
 * спрятанное в неё, не видит никто. Нет особых дней — нет и строки.
 */
export function SpecialDaysLine({ days }: { days: readonly SpecialDay[] }) {
  if (days.length === 0) return null;
  return (
    <div className="ui-special-days" data-special-days>
      {days.map((d) => d.label).join(" · ")}
    </div>
  );
}
