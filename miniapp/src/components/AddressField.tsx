import { useState } from "react";
import { Button, Input } from "@telegram-apps/telegram-ui";
import { apiClient } from "../api/client";

/**
 * «Как ко мне обращаться» — the one thing a worker can tell the bot about
 * themselves besides the reminders switch.
 *
 * It exists because neither source we had is reliable: the roster is «Фамилия
 * Имя» and cannot be split without guessing, and a Telegram first name can be a
 * surname in Latin («Petrov») or missing entirely. So we ask.
 *
 * Saved by an explicit button, not on blur: this is the string the bot will use
 * in every message, and a half-typed name committed by a stray tap is worse than
 * one extra press.
 */
export function AddressField({
  preferredName,
  address,
  onSaved,
}: {
  preferredName: string | null;
  /** What the bot says today — shown as the placeholder when nothing is set. */
  address: string;
  onSaved: (next: { preferredName: string | null; address: string }) => void;
}) {
  const [draft, setDraft] = useState(preferredName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = draft.trim();
  const changed = trimmed !== (preferredName ?? "");

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onSaved(await apiClient.setPreferredName(trimmed || null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: "10px 20px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <Input
        header="Как ко мне обращаться"
        placeholder={address}
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div style={{ color: "var(--tgui--hint_color)", fontSize: 13, lineHeight: 1.4 }}>
        Так бот будет здороваться и подписывать напоминания. Оставь пустым — вернётся имя из Telegram.
      </div>
      {error && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13 }}>{error}</div>}
      <Button size="s" mode="filled" stretched loading={busy} disabled={busy || !changed} onClick={() => void save()}>
        Сохранить
      </Button>
    </div>
  );
}
