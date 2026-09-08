import type { CSSProperties } from "react";
import { Chip } from "@telegram-apps/telegram-ui";
import type { Shift, Template } from "../api/client";
import { categoryLabel, useEntryPalette } from "../categories";

export interface EntryChipProps {
  entry: Shift;
  templates: readonly Template[];
  style?: CSSProperties;
}

/**
 * Same `--tgui--plain_foreground` override as `CategoryChip` (see the comment in
 * `categories.tsx`): `Chip`'s inner `Subheadline` sets its own explicit `color`,
 * which wins over anything inherited, so recolouring the text means overriding
 * the variable it reads rather than setting `color` here.
 */
interface ChipStyle extends CSSProperties {
  "--tgui--plain_foreground"?: string;
}

/**
 * Colour-coded pill naming one schedule entry, in the colour of the preset it
 * came from (Утро/День/Вечер/Ночь/Дежурство) — falling back to its category's
 * colour when it has no preset. The worker-facing twin of the admin schedule's
 * entry badge, so both surfaces read the same week the same way.
 */
export function EntryChip({ entry, templates, style }: EntryChipProps) {
  const palette = useEntryPalette(entry, templates);
  // `title ?? имя пресета ?? категория` — та же цепочка, что на сервере
  // (`shiftLineOf`) и в `shiftKind` на обоих консолях. Средняя ступень нужна для
  // записей, которые своей подписи не несут: без неё дежурство из консоли
  // подписывалось «Дежурство» вместо «Дежурство · Поклонка», и человек, берущий
  // его в обмен, не видел, ЧТО именно берёт. `templates` тут уже есть — их
  // читает палитра.
  const label = entry.title ?? templates.find((t) => t.id === entry.templateId)?.name ?? categoryLabel(entry.category);
  const chipStyle: ChipStyle = {
    background: palette.bg,
    "--tgui--plain_foreground": palette.fg,
    fontWeight: 500,
    // Кольцо внутрь — ради тех цветов пресетов, что рассчитаны на клетку с
    // рамкой: «День» это #EAF0F0, и на белой карточке чип пропадал целиком.
    // Серое кольцо читается и на светлой, и на тёмной подложке, а насыщенным
    // цветам не мешает.
    boxShadow: "inset 0 0 0 1px rgb(128 128 128 / 30%)",
    ...style,
  };
  return (
    <Chip mode="mono" style={chipStyle}>
      {label}
    </Chip>
  );
}
