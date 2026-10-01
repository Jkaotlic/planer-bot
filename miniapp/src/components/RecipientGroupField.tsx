import { useEffect, useState } from "react";
import { apiClient, type RecipientGroupView } from "../api/client";
import { SelectField } from "../ui";

/**
 * «Рассылаем»: кому уйдёт первая рассылка сбора — всей команде или одной группе.
 *
 * Зеркало консольного `RecipientGroupField`. После первой рассылки список
 * адресатов зафиксирован, и сервер отказывает в правке, — поэтому вместо выбора
 * текст «Рассылали: …», а не погашенное поле, которое выглядело бы как «можно,
 * но не сейчас».
 *
 * Удалённая группа (на сервере — архив) остаётся выбранной и подписана
 * «(удалена)»: тихий откат на «Вся команда» скрыл бы причину блокера рассылки и
 * заодно расширил бы адресатов до всей команды, чего админ не выбирал.
 */
export function RecipientGroupField({
  value,
  onChange,
  sent,
  knownName,
  disabled,
}: {
  /** null — вся команда. */
  value: number | null;
  onChange: (next: number | null) => void;
  /** Уже была хоть одна рассылка: выбор заменяется текстом. */
  sent: boolean;
  /** Имя текущей группы от сервера (превью) — единственное, что знает про удалённую. */
  knownName?: string | null;
  disabled?: boolean;
}) {
  const [groups, setGroups] = useState<RecipientGroupView[] | null>(null);

  // Сбой загрузки не ломает форму: без списка остаётся «Вся команда» и текущая группа.
  useEffect(() => {
    let cancelled = false;
    apiClient.getRecipientGroups()
      .then((list) => { if (!cancelled) setGroups(list); })
      .catch(() => { if (!cancelled) setGroups([]); });
    return () => { cancelled = true; };
  }, []);

  const live = groups?.find((g) => g.id === value) ?? null;
  const currentName = live?.name ?? knownName ?? null;

  if (sent) {
    return (
      <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)", lineHeight: 1.45 }}>
        Рассылали: {value == null ? "вся команда" : (currentName ?? "группа")}
      </div>
    );
  }

  // Пока список не пришёл, текущую группу не объявляем удалённой.
  const removed = groups != null && value != null && !live;

  return (
    // Видимая подпись — `label`, а `aria-label` оставлен тем же словом: по нему
    // поле находят тесты и внешние проверки, и расходиться с подписью ему незачем.
    <SelectField
      stretched
      label="Рассылаем"
      aria-label="Рассылаем"
      value={value == null ? "" : String(value)}
      disabled={disabled}
      onChange={(next) => onChange(next === "" ? null : Number(next))}
    >
      <option value="">Вся команда</option>
      {(groups ?? []).map((g) => (
        <option key={g.id} value={String(g.id)}>{g.name}</option>
      ))}
      {value != null && !live && (
        <option value={String(value)}>{`${currentName ?? "Группа"}${removed ? " (удалена)" : ""}`}</option>
      )}
    </SelectField>
  );
}
