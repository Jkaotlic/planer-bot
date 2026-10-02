/**
 * Переключатель «один из нескольких». Раньше в консоли жили три самодельных
 * (кнопки primary/secondary в «Багах» и «Анонсах», свои вкладки в «Журнале»):
 * у каждого свой вид и своя высота. Нажатое состояние отдаём через aria-pressed —
 * экранный диктор читает «нажата» без отдельных ролей.
 */
export interface SegmentedProps<K extends string> {
  options: readonly { key: K; label: string }[];
  /** null — ни один вариант не выбран (в «Анонсах» выбрана группа, а не режим). */
  value: K | null;
  onChange: (key: K) => void;
  "aria-label": string;
  /** Отправка анонса идёт — выбор аудитории на это время заморожен. */
  disabled?: boolean;
  /**
   * Повторный клик по выбранному тоже зовёт onChange. Нужен «Анонсам» ради одного:
   * ожидающее подтверждение «Да, отправить» отменяется повторным нажатием на
   * аудиторию — передумал отправлять, нажал её заново. Ручные галочки он не трогает:
   * правка галочки и так сбрасывает пресет, и нажатой остаётся «Выбрать».
   */
  reselect?: boolean;
}

export function Segmented<K extends string>({ options, value, onChange, disabled, reselect = false, "aria-label": ariaLabel }: SegmentedProps<K>) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          className="segmented-item"
          aria-pressed={o.key === value}
          disabled={disabled}
          // По умолчанию клик по уже выбранному ничего не меняет — не будим обработчик зря.
          onClick={() => { if (reselect || o.key !== value) onChange(o.key); }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
