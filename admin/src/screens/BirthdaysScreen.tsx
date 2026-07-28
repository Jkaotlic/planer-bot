import { useEffect, useState } from "react";
import { describeDaysUntil } from "@planer/shared";
import {
  apiClient,
  AuthRequiredError,
  type BirthdayPreview,
  type UpcomingBirthday,
} from "../api/client";
import { initialsOf, personPalette } from "../lib/people";

/**
 * «Дни рождения»: who is next, and the collection that goes with one.
 *
 * The rule the screen is built around — **the bot never mails the team on its
 * own.** A week ahead it nudges the admins; everything after that happens here,
 * by hand: paste the Сбербанк link, edit the wording if you like, look at the
 * exact text and the exact list of names, and only then send. The send button
 * asks once more before it fires, because it is the one action in this console
 * that writes to every colleague at once.
 */

/** How near counts as «ближайшие» — a month is roughly when a collection starts. */
const SOON_DAYS = 30;

export type StatusTone = "sent" | "ready" | "pending";

/** The chip on the right of a row: where this round has got to. */
export function statusOf(birthday: UpcomingBirthday): { label: string; tone: StatusTone } {
  const campaign = birthday.campaign;
  if (campaign?.status === "sent") {
    return { label: `Разослано · ${campaign.sentCount}`, tone: "sent" };
  }
  if (campaign?.collectUrl) return { label: "Готово к отправке", tone: "ready" };
  return { label: "Нет ссылки на сбор", tone: "pending" };
}

/** "5 августа · через 4 дня" — the date, and how far off it is. */
export function whenLabel(birthday: UpcomingBirthday): string {
  return `${birthday.birthDateLabel} · ${describeDaysUntil(birthday.daysUntil)}`;
}

/** "1 коллеге" / "5 коллегам" — the dative the send button is written in. */
export function recipientsPhrase(count: number): string {
  return `${count} ${count === 1 ? "коллеге" : "коллегам"}`;
}

/**
 * "1 коллега" / "3 коллеги" / "5 коллег" — the nominative, for the line that
 * reads «Получат 3 коллеги». The two cases are separate functions on purpose:
 * «Получат 3 коллегам» is the mistake this prevents.
 */
export function recipientsSubject(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} коллег`;
  if (mod10 === 1) return `${count} коллега`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} коллеги`;
  return `${count} коллег`;
}

export function BirthdaysScreen() {
  const [birthdays, setBirthdays] = useState<UpcomingBirthday[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function reload() {
    try {
      setBirthdays(await apiClient.getBirthdays());
    } catch (err) {
      if (err instanceof AuthRequiredError) return;
      setError(err instanceof Error ? err.message : "Не удалось загрузить дни рождения");
    }
  }

  useEffect(() => {
    void reload();
    // Loads once; every mutation below reloads explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error && !birthdays) return <div className="employees-error">{error}</div>;
  if (!birthdays) return <div className="employees-empty">Загрузка…</div>;

  const soon = birthdays.filter((b) => b.daysUntil <= SOON_DAYS);
  const later = birthdays.filter((b) => b.daysUntil > SOON_DAYS);

  function renderRow(birthday: UpcomingBirthday) {
    return (
      <BirthdayRow
        key={birthday.employeeId}
        birthday={birthday}
        open={openId === birthday.employeeId}
        onToggle={() => {
          setNotice(null);
          setOpenId(openId === birthday.employeeId ? null : birthday.employeeId);
        }}
        onChanged={reload}
        onSent={(delivered) => {
          setOpenId(null);
          setNotice(`Разослано ${recipientsPhrase(delivered)}. ${birthday.displayName} — не в списке.`);
          void reload();
        }}
      />
    );
  }

  return (
    <div className="employees-screen">
      <div className="employees-header">
        <h2 className="employees-title">Дни рождения</h2>
      </div>

      <p className="birthday-intro">
        За неделю до дня рождения бот напишет админам. Команде ничего не уходит, пока ты сам не нажмёшь
        «Разослать» — и не увидишь перед этим точный текст и поимённый список.
      </p>

      {error && <div className="employees-error">{error}</div>}
      {notice && <div className="birthday-notice">{notice}</div>}

      {birthdays.length === 0 ? (
        <div className="employees-empty">
          Ни у кого не указан день рождения — проставь даты на экране «Работники».
        </div>
      ) : (
        <>
          <h3 className="birthday-group">Ближайший месяц</h3>
          {soon.length === 0 ? (
            <div className="employees-empty">В ближайший месяц дней рождения нет.</div>
          ) : (
            <div className="employees-list">{soon.map(renderRow)}</div>
          )}

          {later.length > 0 && (
            <>
              <h3 className="birthday-group">Дальше по году</h3>
              <div className="employees-list">{later.map(renderRow)}</div>
            </>
          )}
        </>
      )}
    </div>
  );
}

interface RowProps {
  birthday: UpcomingBirthday;
  open: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
  onSent: (delivered: number) => void;
}

function BirthdayRow({ birthday, open, onToggle, onChanged, onSent }: RowProps) {
  const palette = personPalette(birthday.employeeId);
  const status = statusOf(birthday);

  return (
    <div className={`birthday-card${open ? " open" : ""}`}>
      <div className="birthday-card-head">
        <span className="avatar avatar-sm" style={{ background: palette.bg, color: palette.fg }}>
          {initialsOf(birthday.displayName)}
        </span>
        <span className="birthday-name">{birthday.displayName}</span>
        <span className="birthday-when">{whenLabel(birthday)}</span>
        <span className={`birthday-status ${status.tone}`}>{status.label}</span>
        <button type="button" className="btn btn-secondary" onClick={onToggle}>
          {open ? "Свернуть" : status.tone === "sent" ? "Посмотреть" : "Подготовить сбор"}
        </button>
      </div>

      {open && <CampaignEditor birthday={birthday} onChanged={onChanged} onSent={onSent} />}
    </div>
  );
}

function CampaignEditor({ birthday, onChanged, onSent }: Omit<RowProps, "open" | "onToggle">) {
  const [collectUrl, setCollectUrl] = useState(birthday.campaign?.collectUrl ?? "");
  const [messageText, setMessageText] = useState(birthday.campaign?.messageText ?? "");
  const [preview, setPreview] = useState<BirthdayPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  /** The send button arms itself first; the second press is the one that sends. */
  const [confirming, setConfirming] = useState(false);

  async function loadPreview() {
    try {
      setPreview(await apiClient.getBirthdayPreview(birthday.employeeId));
    } catch (err) {
      if (err instanceof AuthRequiredError) return;
      setError(err instanceof Error ? err.message : "Не удалось собрать предпросмотр");
    }
  }

  useEffect(() => {
    void loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [birthday.employeeId]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setConfirming(false);
    try {
      await apiClient.saveBirthdayCampaign(birthday.employeeId, {
        collectUrl: collectUrl.trim() || null,
        messageText: messageText.trim() || null,
      });
      await loadPreview();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      const result = await apiClient.sendBirthday(birthday.employeeId);
      setConfirming(false);
      onSent(result.delivered);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось разослать");
      setConfirming(false);
    } finally {
      setSending(false);
    }
  }

  const sent = birthday.campaign?.status === "sent";
  const busy = saving || sending;

  return (
    <div className="birthday-editor">
      {sent ? (
        <div className="birthday-sent-note">
          Уже разослано{birthday.campaign?.sentCount ? ` — ${recipientsPhrase(birthday.campaign.sentCount)}` : ""}.
          Повторная отправка отключена, чтобы никто не получил поздравление дважды.
        </div>
      ) : (
        <>
          <label className="birthday-label">
            Ссылка на сбор (Сбербанк Онлайн)
            <input
              type="url"
              placeholder="https://..."
              value={collectUrl}
              disabled={busy}
              onChange={(e) => {
                setCollectUrl(e.target.value);
                setConfirming(false);
              }}
            />
          </label>

          {/* The placeholder is a hint, not the default text: the default is shown
              in full right below, and printing it twice just made it look editable. */}
          <label className="birthday-label">
            Свой текст — необязательно
            <textarea
              rows={4}
              placeholder="Оставь пустым — уйдёт текст ниже"
              value={messageText}
              disabled={busy}
              onChange={(e) => {
                setMessageText(e.target.value);
                setConfirming(false);
              }}
            />
          </label>

          <div className="journal-controls">
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void handleSave()}>
              {saving ? "Сохраняю…" : "Сохранить"}
            </button>
          </div>
        </>
      )}

      {error && <div className="employees-error">{error}</div>}

      {preview && (
        <>
          <div className="birthday-preview-title">Уйдёт вот это:</div>
          <pre className="birthday-message">{preview.message}</pre>

          <div className="birthday-preview-title">
            Получат {recipientsSubject(preview.recipients.length)} — все, кроме именинника:
          </div>
          <div className="birthday-recipients">
            {preview.recipients.length === 0 ? (
              <span className="employees-empty">Некому: ни у кого не привязан Telegram.</span>
            ) : (
              preview.recipients.map((person) => (
                <span className="birthday-recipient" key={person.employeeId}>
                  {person.displayName}
                </span>
              ))
            )}
          </div>

          {preview.blocker ? (
            <div className="birthday-blocker">{preview.blocker}</div>
          ) : confirming ? (
            <div className="birthday-confirm">
              <span>
                Отправить {recipientsPhrase(preview.recipients.length)}? Отменить будет нельзя — сообщения уйдут сразу.
              </span>
              <button type="button" className="btn btn-primary" disabled={sending} onClick={() => void handleSend()}>
                {sending ? "Отправляю…" : "Да, разослать"}
              </button>
              <button type="button" className="btn btn-secondary" disabled={sending} onClick={() => setConfirming(false)}>
                Отмена
              </button>
            </div>
          ) : (
            <div className="journal-controls">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setConfirming(true)}>
                Разослать {recipientsPhrase(preview.recipients.length)}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
