import { useEffect, useState } from "react";
import { exactSchedulePalette } from "@planer/shared";
import { Button, Placeholder, Section, Spinner } from "@telegram-apps/telegram-ui";
import { apiClient, type Checklist, type TemplateQueue, type TemplateRolesView } from "../../api/client";
import { CardShell, CardStack } from "../../components/Card";
import { useEntryPalette } from "../../categories";
import { withError, withoutError } from "../../lib/error-map";

/**
 * «Виды смен» (admin, mobile): свойства самого вида — чек-лист и очередь.
 *
 * Отдельно от «Кто что может» с тех пор, как тот экран стал списком ЛЮДЕЙ:
 * чек-лист и очередь принадлежат виду смены, а не человеку, и в карточке
 * каждого из двадцати восьми повторялись бы двадцать восемь раз.
 */
export function AdminKindSettings({ onClose }: { onClose: () => void }) {
  const [kinds, setKinds] = useState<TemplateRolesView[] | null>(null);
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  /** Отказ по id вида смены, а не один на экран: экран выше окна, и сообщение,
   *  нарисованное сверху, для нажавшего в нижней карточке невидимо. */
  const [errors, setErrors] = useState<ReadonlyMap<number, string>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    // Чек-листы рядом с видами: без их имён выпадающий список показывать нечем.
    // Молча при отказе — экран про виды смен, и его беда важнее.
    apiClient.getChecklists().then((next) => { if (!cancelled) setChecklists(next); }).catch(() => {});
    apiClient
      .getTemplateRoles()
      .then((next) => {
        if (!cancelled) setKinds(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Не удалось загрузить виды смен");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  async function saveChecklist(kind: TemplateRolesView, checklistId: number | null) {
    // Оптимистично: выбор обязан отзываться сразу, иначе на медленной сети его
    // делают второй раз.
    setKinds((current) =>
      current?.map((item) => (item.templateId === kind.templateId ? { ...item, checklistId } : item)) ?? current,
    );
    setBusyId(kind.templateId);
    setErrors((prev) => withoutError(prev, kind.templateId));
    try {
      await apiClient.setTemplateChecklist(kind.templateId, checklistId);
    } catch (err) {
      // Вернуть версию сервера, а не оставить на экране неправду.
      setKinds(await apiClient.getTemplateRoles().catch(() => null));
      setErrors((prev) => withError(prev, kind.templateId, err instanceof Error ? err.message : "Не удалось сохранить чек-лист"));
    } finally {
      setBusyId(null);
    }
  }

  async function saveRotation(kind: TemplateRolesView, unit: "day" | "week") {
    setBusyId(kind.templateId);
    setErrors((prev) => withoutError(prev, kind.templateId));
    try {
      await apiClient.setRotationUnit(kind.templateId, unit);
    } catch (err) {
      setErrors((prev) => withError(prev, kind.templateId, err instanceof Error ? err.message : "Не удалось сохранить очередь"));
    } finally {
      setBusyId(null);
    }
  }

  if (loadError) {
    return (
      <Section header="Виды смен">
        <CardStack>
          <CardShell>
            <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 14 }}>{loadError}</div>
            <Button size="s" mode="gray" stretched style={{ marginTop: 8 }} onClick={() => setAttempt((n) => n + 1)}>
              Повторить
            </Button>
          </CardShell>
        </CardStack>
      </Section>
    );
  }

  if (!kinds) {
    return (
      <Section header="Виды смен">
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
          <Spinner size="m" />
        </div>
      </Section>
    );
  }

  return (
    <Section header="Виды смен">
      <CardStack>
        <CardShell>
          <div style={{ color: "var(--tgui--hint_color)", fontSize: 13, lineHeight: 1.45 }}>
            Здесь свойства самого вида смены. Кого к нему допускать — на «Кто что может».
          </div>
        </CardShell>

        {kinds.map((kind) => (
          <KindCard
            key={kind.templateId}
            kind={kind}
            open={openId === kind.templateId}
            busy={busyId === kind.templateId}
            error={errors.get(kind.templateId)}
            onToggleOpen={() => setOpenId((current) => (current === kind.templateId ? null : kind.templateId))}
            checklists={checklists}
            onChecklist={(checklistId) => saveChecklist(kind, checklistId)}
            onRotationUnit={(unit) => saveRotation(kind, unit)}
          />
        ))}

        {kinds.length === 0 && <Placeholder description="Видов смен пока нет." />}

        <CardShell>
          <Button size="s" mode="gray" stretched onClick={onClose}>
            ← Назад к расписанию
          </Button>
        </CardShell>
      </CardStack>
    </Section>
  );
}

function KindCard({
  kind,
  open,
  busy,
  error,
  onToggleOpen,
  checklists,
  onChecklist,
  onRotationUnit,
}: {
  kind: TemplateRolesView;
  open: boolean;
  busy: boolean;
  /** Отказ на последнее действие именно в этой карточке. */
  error?: string;
  onToggleOpen: () => void;
  checklists: readonly Checklist[];
  onChecklist: (checklistId: number | null) => Promise<void>;
  onRotationUnit: (unit: "day" | "week") => Promise<void>;
}) {
  const palette = useEntryPalette({ templateId: kind.templateId, category: kind.category }, [
    { id: kind.templateId, accent: kind.accent },
  ]);
  // The very letter the week grid draws for this kind, not the first letter of its
  // name — otherwise all four duties read «Д» here and «Т»/«П»/«ВА»/«07» there.
  const code = exactSchedulePalette(kind.accent, kind.category)?.code ?? kind.name.slice(0, 1);
  const [queue, setQueue] = useState<TemplateQueue | null>(null);

  // История, а не настройка — читается при раскрытии карточки.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiClient
      .getTemplateQueue(kind.templateId)
      .then((next) => {
        if (!cancelled) setQueue(next);
      })
      .catch(() => {
        if (!cancelled) setQueue(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, kind.templateId]);

  /**
   * Select управляется из `queue`, а `queue` перечитывается только при раскрытии —
   * поэтому одного сохранения мало: React возвращал в контрол прежнее значение, и
   * настройка выглядела не применившейся, хотя сервер её уже записал. Сначала
   * показываем выбор, потом перечитываем очередь: подписи «Следующие: …» сервер
   * складывает словами по этой самой единице и до перечитывания они устарели.
   */
  async function changeUnit(unit: "day" | "week") {
    setQueue((prev) => (prev ? { ...prev, rotationUnit: unit } : prev));
    await onRotationUnit(unit);
    const fresh = await apiClient.getTemplateQueue(kind.templateId).catch(() => null);
    if (fresh) setQueue(fresh);
  }

  const checklistName = checklists.find((list) => list.id === kind.checklistId)?.name;

  return (
    <CardShell>
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: 10, width: "100%",
          background: "transparent", border: "none", padding: 0, font: "inherit",
          color: "var(--tgui--text_color)", textAlign: "left", cursor: "pointer",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            flex: "none", display: "grid", placeContent: "center", width: 30, height: 30,
            borderRadius: 8, fontSize: 13, fontWeight: 700, background: palette.bg, color: palette.fg,
          }}
        >
          {code}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontWeight: 600, fontSize: 15 }}>{kind.name}</span>
          <span style={{ display: "block", color: "var(--tgui--hint_color)", fontSize: 12.5 }}>
            {checklistName ? `чек-лист: ${checklistName}` : "чек-лист не нужен"}
          </span>
        </span>
        <span style={{ flex: "none", color: "var(--tgui--hint_color)" }}>{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div style={{ marginTop: 10, borderTop: "1px solid var(--tgui--outline)" }}>
          <div style={{ padding: "10px 0 2px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--tgui--hint_color)" }}>
              Очередь идёт
              <select
                value={queue?.rotationUnit ?? "day"}
                disabled={busy || !queue}
                onChange={(e) => void changeUnit(e.target.value as "day" | "week")}
                style={{
                  padding: "5px 8px", borderRadius: 8, border: "1px solid var(--tgui--outline)",
                  background: "var(--tgui--secondary_bg_color)", color: "var(--tgui--text_color)", font: "inherit",
                }}
              >
                <option value="day">по дням</option>
                <option value="week">по неделям</option>
              </select>
            </label>
            {/* Привязка живёт здесь, а не на экране чек-листа: «кому он положен» —
                свойство вида смены, как очередь рядом. Зеркало консольного
                `ShiftKindsScreen`. */}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 10 }}>
              Чек-лист
              <select
                value={kind.checklistId ?? ""}
                disabled={busy || checklists.length === 0}
                onChange={(e) => void onChecklist(e.target.value ? Number(e.target.value) : null)}
                style={{
                  padding: "5px 8px", borderRadius: 8, border: "1px solid var(--tgui--outline)",
                  background: "var(--tgui--secondary_bg_color)", color: "var(--tgui--text_color)", font: "inherit",
                }}
              >
                <option value="">— не нужен —</option>
                {checklists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
            </label>

            {queue && queue.queue.length > 0 ? (
              <p style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.45 }}>
                Следующие: {queue.queue.slice(0, 3).map((turn) => turn.label).join(" → ")}
                <br />
                <span style={{ color: "var(--tgui--hint_color)", fontSize: 12 }}>
                  Бот только подсказывает — ставишь смену ты сам.
                </span>
              </p>
            ) : (
              <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--tgui--hint_color)" }}>
                Очередь появится, когда в допущенных кто-нибудь будет.
              </p>
            )}
          </div>
        </div>
      )}
      {/* Свёрнутую карточку отказ тоже касается: сохранение могло не дойти уже
          после того, как её закрыли. */}
      {error && (
        <div style={{ marginTop: 8, color: "var(--tgui--destructive_text_color)", fontSize: 13.5, lineHeight: 1.35 }}>
          {error}
        </div>
      )}
    </CardShell>
  );
}
