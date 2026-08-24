import { useEffect, useState } from "react";
import { Button, Input, Placeholder, Section, Spinner, Textarea } from "@telegram-apps/telegram-ui";
import { apiClient, type Checklist, type Template } from "../../api/client";
import { CardShell, CardStack } from "../../components/Card";
import { ScreenScroll } from "../../components/ScreenScroll";

/**
 * «Чек-листы» в мини-аппе — зеркало консольного экрана.
 *
 * Списков несколько: у дежурного с семи и у дежурного с восьми проверки разные,
 * и «скоп смен» задаётся тем, какие виды смен на список ссылаются. Ту же
 * привязку можно поставить и со стороны «Видов смен» — там на неё смотрят как на
 * свойство пресета, здесь как на ответ «кто это проходит».
 *
 * Файл прикладывается здесь же и уходит на диск сервера: браузер не умеет
 * положить документ в Telegram так, чтобы бот потом мог его переслать, поэтому
 * пересылку берёт на себя бот при первой рассылке. Второй путь — прислать файл
 * боту командой `/instruction`; он короче, когда файл уже в телефоне.
 */
export function AdminChecklists() {
  const [checklists, setChecklists] = useState<Checklist[] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const [lists, presets] = await Promise.all([apiClient.getChecklists(), apiClient.getTemplates()]);
      setChecklists(lists);
      setTemplates(presets);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить чек-листы");
    }
  }

  useEffect(() => {
    void reload();
    // Грузится один раз; каждая правка ниже перечитывает явно.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  if (!checklists) {
    return (
      <ScreenScroll>
        <Section header="Чек-листы">
          <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
            <Spinner size="m" />
          </div>
        </Section>
      </ScreenScroll>
    );
  }

  return (
    <ScreenScroll>
      <Section
        header="Чек-листы"
        footer="Проверки, которые дежурный проходит в свою смену. Списков может быть несколько — у выходящих в 07:00 и в 08:00 они разные."
      >
        <CardStack>
          {error && (
            <CardShell>
              <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13.5 }}>{error}</div>
            </CardShell>
          )}

          {checklists.length === 0 && (
            <Placeholder description="Чек-листов пока нет — заведи первый, и он начнёт приходить дежурным тех видов смен, которые ты ему укажешь." />
          )}

          {checklists.map((list) => (
            <ChecklistCard
              key={list.id}
              list={list}
              templates={templates}
              open={openId === list.id}
              busy={busy}
              onToggle={() => setOpenId(openId === list.id ? null : list.id)}
              run={run}
            />
          ))}

          <CardShell>
            <Input
              header="Новый чек-лист"
              placeholder="Например, дежурство с 07:00"
              value={draft}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button
              size="s"
              mode="filled"
              stretched
              disabled={busy || !draft.trim()}
              onClick={() => void run(() => apiClient.createChecklist(draft.trim())).then(() => setDraft(""))}
            >
              Завести
            </Button>
          </CardShell>
        </CardStack>
      </Section>
    </ScreenScroll>
  );
}

function ChecklistCard({
  list,
  templates,
  open,
  busy,
  onToggle,
  run,
}: {
  list: Checklist;
  templates: readonly Template[];
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [itemDraft, setItemDraft] = useState("");
  const [note, setNote] = useState(list.note ?? "");
  const [docUrl, setDocUrl] = useState(list.docUrl ?? "");
  const linked = templates.filter((t) => list.templateIds.includes(t.id));
  const dirty = note !== (list.note ?? "") || docUrl !== (list.docUrl ?? "");

  return (
    <CardShell>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%", padding: 0,
          border: 0, background: "none", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 15 }}>{list.name}</span>
        <span style={{ flex: 1, fontSize: 12.5, color: "var(--tgui--hint_color)" }}>
          {list.items.length === 0 ? "пунктов нет" : `${list.items.length} п.`}
          {" · "}
          {linked.length === 0 ? "никому не назначен" : linked.map((t) => t.name).join(", ")}
        </span>
        <span style={{ color: "var(--tgui--hint_color)" }}>{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
          {/* «Кому положен» первым: это и есть тот «скоп смен», ради которого
              списков стало несколько. */}
          <span style={{ fontSize: 12.5, color: "var(--tgui--hint_color)" }}>Кому положен</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {templates.map((template) => {
              const on = list.templateIds.includes(template.id);
              return (
                <Button
                  key={template.id}
                  size="s"
                  mode={on ? "filled" : "bezeled"}
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      apiClient.setChecklistTemplates(
                        list.id,
                        on ? list.templateIds.filter((id) => id !== template.id) : [...list.templateIds, template.id],
                      ),
                    )
                  }
                >
                  {template.name} · {template.start}
                </Button>
              );
            })}
          </div>

          <span style={{ fontSize: 12.5, color: "var(--tgui--hint_color)" }}>Пункты</span>
          {list.items.length === 0 ? (
            <span style={{ fontSize: 13.5, color: "var(--tgui--hint_color)" }}>Пунктов пока нет.</span>
          ) : (
            list.items.map((item, index) => (
              <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "var(--tgui--hint_color)", minWidth: 16 }}>{index + 1}</span>
                <span style={{ flex: 1, fontSize: 14, minWidth: 0 }}>
                  {item.title}
                  {item.note && (
                    <span style={{ display: "block", fontSize: 12.5, color: "var(--tgui--hint_color)" }}>{item.note}</span>
                  )}
                </span>
                <Button size="s" mode="plain" disabled={busy} onClick={() => void run(() => apiClient.removeChecklistItem(item.id))}>
                  Убрать
                </Button>
              </div>
            ))
          )}

          <Input
            header={`Новый пункт в «${list.name}»`}
            placeholder="Например, обойти этаж"
            value={itemDraft}
            disabled={busy}
            onChange={(e) => setItemDraft(e.target.value)}
          />
          <Button
            size="s"
            mode="bezeled"
            stretched
            disabled={busy || !itemDraft.trim()}
            onClick={() => void run(() => apiClient.addChecklistItem(list.id, itemDraft.trim())).then(() => setItemDraft(""))}
          >
            Добавить пункт
          </Button>

          <Textarea
            header="Пояснение — уходит дежурному в чат вместе со списком"
            placeholder="Например: обход начинаем от лифтов, по часовой."
            value={note}
            disabled={busy}
            onChange={(e) => setNote(e.target.value)}
          />
          <Input
            header="Ссылка на документ"
            placeholder="https://…"
            value={docUrl}
            disabled={busy}
            onChange={(e) => setDocUrl(e.target.value)}
          />
          <Button
            size="s"
            mode="filled"
            stretched
            disabled={busy || !dirty}
            onClick={() => void run(() => apiClient.patchChecklist(list.id, { note: note.trim() || null, docUrl: docUrl.trim() || null }))}
          >
            Сохранить инструкцию
          </Button>

          <span style={{ fontSize: 12.5, color: "var(--tgui--hint_color)", lineHeight: 1.45 }}>
            {list.hasDoc
              ? `📄 Приложен файл: ${list.docName} — уходит дежурному вместе с чек-листом.`
              : "Файл не приложен."}
          </span>
          {/* Файл выбирается прямо здесь; путь через бота остаётся вторым — он
              короче, когда файл уже лежит в телефоне. */}
          <label style={{ display: "inline-flex" }}>
            <input
              type="file"
              style={{ display: "none" }}
              disabled={busy}
              aria-label={`Приложить файл к «${list.name}»`}
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Значение поля сбрасывается: иначе повторный выбор ТОГО ЖЕ файла
                // (после неудачи) не даёт события change вовсе.
                e.target.value = "";
                if (file) void run(() => apiClient.uploadChecklistDoc(list.id, file));
              }}
            />
            <Button size="s" mode="bezeled" disabled={busy} Component="span">
              {list.hasDoc ? "📎 Заменить файл" : "📎 Приложить файл"}
            </Button>
          </label>
          <span style={{ fontSize: 12, color: "var(--tgui--hint_color)", lineHeight: 1.4 }}>
            До 5 МБ. Можно и прислать боту: /instruction, потом выбрать «{list.name}».
          </span>
          {list.hasDoc && (
            <Button size="s" mode="plain" disabled={busy} onClick={() => void run(() => apiClient.removeChecklistDoc(list.id))}>
              Убрать файл
            </Button>
          )}

          <Button
            size="s"
            mode="plain"
            disabled={busy}
            style={{ color: "var(--tgui--destructive_text_color)" }}
            onClick={() => void run(() => apiClient.deleteChecklist(list.id))}
          >
            Удалить чек-лист
          </Button>
        </div>
      )}
    </CardShell>
  );
}
