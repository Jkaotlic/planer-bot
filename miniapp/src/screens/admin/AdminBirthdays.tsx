import { useEffect, useState } from "react";
import { describeDaysUntil } from "@planer/shared";
import { Button, Input, List, Placeholder, Section, Spinner, Textarea } from "@telegram-apps/telegram-ui";
import { apiClient, type BirthdayCampaign, type BirthdayPreview, type CampaignListRow, type UpcomingBirthday } from "../../api/client";
import { CardShell, CardStack } from "../../components/Card";
import { ScreenScroll } from "../../components/ScreenScroll";
import { initialsOf, personPalette } from "../../lib/people";
import { toISODate } from "../../lib/week";

/**
 * «Дни рождения» (admin, mobile): who is next, and the collection that goes
 * with one.
 *
 * The rule the screen is built around — **the bot never mails the team on its
 * own.** A week ahead it nudges the admins; everything after that happens here,
 * by hand: paste the Сбербанк link, edit the wording if you like, read the exact
 * text and the exact list of names, and only then send. The send button arms
 * itself first, because on a phone the one action that writes to every colleague
 * at once must not be one stray tap away.
 *
 * Same flow as the console's `BirthdaysScreen`, rebuilt as a single column.
 */

export type StatusTone = "sent" | "ready" | "pending";

/** Where this round has got to, in a word. */
export function statusOf(campaign: BirthdayCampaign | null): { label: string; tone: StatusTone } {
  // Shorter than the console's wording on purpose: on a 390-wide row the chip
  // shares its line with the name and the date, and «Готово к отправке» pushed
  // «5 августа · через 8 дней» onto a second line.
  if (campaign?.status === "sent") return { label: `Разослано · ${campaign.sentCount}`, tone: "sent" };
  if (campaign?.collectUrl) return { label: "Готово", tone: "ready" };
  return { label: "Нет ссылки", tone: "pending" };
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

const TONE_COLOR: Record<StatusTone, string> = {
  sent: "var(--tgui--link_color)",
  ready: "var(--tgui--link_color)",
  pending: "var(--tgui--hint_color)",
};

export function AdminBirthdays() {
  const [birthdays, setBirthdays] = useState<UpcomingBirthday[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function reload() {
    try {
      setBirthdays(await apiClient.getBirthdays());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить дни рождения");
    }
  }

  useEffect(() => {
    void reload();
    // Loads once; every mutation below reloads explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!birthdays) {
    return (
      <ScreenScroll>
        <List>
          <Section header="Дни рождения">
            <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
              <Spinner size="m" />
            </div>
          </Section>
        </List>
      </ScreenScroll>
    );
  }

  return (
    <ScreenScroll>
      <List>
        <Section header="Дни рождения">
          <CardStack>
            <CardShell>
              <div style={{ color: "var(--tgui--hint_color)", fontSize: 13, lineHeight: 1.45 }}>
                За неделю до дня рождения бот напишет админам. Команде ничего не уходит, пока ты сам не нажмёшь
                «Разослать» — и не увидишь перед этим точный текст и поимённый список.
              </div>
            </CardShell>

            {error && (
              <CardShell>
                <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13.5 }}>{error}</div>
              </CardShell>
            )}

            {notice && (
              <CardShell>
                <div style={{ fontSize: 13.5 }}>{notice}</div>
              </CardShell>
            )}

            {birthdays.length === 0 && (
              <Placeholder description="Ни у кого не указан день рождения — проставь даты в разделе «Работники»." />
            )}

            {birthdays.map((birthday) => (
              <BirthdayCard
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
            ))}
          </CardStack>
        </Section>

        <Section header="Сборы">
          <CardStack>
            <CampaignsSection onOpen={(employeeId) => { setNotice(null); setOpenId(employeeId); }} />
          </CardStack>
        </Section>
      </List>
    </ScreenScroll>
  );
}

/**
 * Every round ever prepared, the sent ones included.
 *
 * Read from its own endpoint rather than filtered out of the list above: that
 * one keys campaigns by the NEXT birthday, so a round drops out of it the day
 * after the party — exactly the round somebody wants to look back at.
 */
function CampaignsSection({ onOpen }: { onOpen: (employeeId: number) => void }) {
  const [rows, setRows] = useState<CampaignListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .getBirthdayCampaigns()
      .then(setRows)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Не удалось загрузить сборы"));
  }, []);

  if (error) return <CardShell><div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13.5 }}>{error}</div></CardShell>;
  if (!rows) return <CardShell><Spinner size="s" /></CardShell>;
  if (rows.length === 0) return <CardShell><div style={{ color: "var(--tgui--hint_color)", fontSize: 13.5 }}>Сборов пока не было.</div></CardShell>;

  return (
    <>
      {rows.map(({ campaign, displayName, birthDateLabel }) => {
        const status = statusOf(campaign);
        return (
          <CardShell key={campaign.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{displayName}</div>
                <div style={{ color: "var(--tgui--hint_color)", fontSize: 13 }}>
                  {birthDateLabel} · {campaign.year}
                  {campaign.scheduledSendOn && ` · напомнить ${campaign.scheduledSendOn}`}
                </div>
              </div>
              <span style={{ flex: "none", fontSize: 12, fontWeight: 600, color: TONE_COLOR[status.tone] }}>
                {status.label}
              </span>
            </div>
            {campaign.collectUrl && <CopyableLink url={campaign.collectUrl} />}
            <Button size="s" mode="bezeled" stretched onClick={() => onOpen(campaign.employeeId)}>
              {status.tone === "sent" ? "Посмотреть" : "Открыть"}
            </Button>
          </CardShell>
        );
      })}
    </>
  );
}

/** The link, readable and copyable — the reason this list exists. */
function CopyableLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12.5,
          fontFamily: "var(--tgui--font_family_mono, monospace)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "var(--tgui--hint_color)",
        }}
      >
        {url}
      </span>
      <Button
        size="s"
        mode="gray"
        onClick={() => {
          navigator.clipboard
            .writeText(url)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
            // Clipboard is unavailable in an insecure context; the text above is
            // still selectable, so there is nothing to report.
            .catch(() => {});
        }}
      >
        {copied ? "✓" : "Копировать"}
      </Button>
    </div>
  );
}

interface CardProps {
  birthday: UpcomingBirthday;
  open: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
  onSent: (delivered: number) => void;
}

function BirthdayCard({ birthday, open, onToggle, onChanged, onSent }: CardProps) {
  const palette = personPalette(birthday.employeeId);
  const status = statusOf(birthday.campaign);

  return (
    <CardShell>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            flex: "none", display: "grid", placeContent: "center", width: 34, height: 34,
            borderRadius: 999, fontSize: 12, fontWeight: 700, background: palette.bg, color: palette.fg,
          }}
        >
          {initialsOf(birthday.displayName)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{birthday.displayName}</div>
          <div style={{ color: "var(--tgui--hint_color)", fontSize: 13 }}>{whenLabel(birthday)}</div>
        </div>
        <span style={{ flex: "none", fontSize: 12, fontWeight: 600, color: TONE_COLOR[status.tone], textAlign: "right" }}>
          {status.label}
        </span>
      </div>

      <Button size="s" mode={open ? "gray" : "bezeled"} stretched onClick={onToggle}>
        {open ? "Свернуть" : status.tone === "sent" ? "Посмотреть" : "Подготовить сбор"}
      </Button>

      {open && <CampaignEditor birthday={birthday} onChanged={onChanged} onSent={onSent} />}
    </CardShell>
  );
}

function CampaignEditor({ birthday, onChanged, onSent }: Omit<CardProps, "open" | "onToggle">) {
  const todayIso = toISODate(new Date());
  const [collectUrl, setCollectUrl] = useState(birthday.campaign?.collectUrl ?? "");
  const [messageText, setMessageText] = useState(birthday.campaign?.messageText ?? "");
  const [scheduledSendOn, setScheduledSendOn] = useState(birthday.campaign?.scheduledSendOn ?? "");
  const [preview, setPreview] = useState<BirthdayPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  /** The send button arms itself first; the second tap is the one that sends. */
  const [confirming, setConfirming] = useState(false);

  async function loadPreview() {
    try {
      setPreview(await apiClient.getBirthdayPreview(birthday.employeeId));
    } catch (err) {
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
        scheduledSendOn: scheduledSendOn || null,
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
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
      {sent ? (
        <div style={{ color: "var(--tgui--hint_color)", fontSize: 13, lineHeight: 1.45 }}>
          Уже разослано{birthday.campaign?.sentCount ? ` — ${recipientsPhrase(birthday.campaign.sentCount)}` : ""}.
          Повторная отправка отключена, чтобы никто не получил поздравление дважды.
        </div>
      ) : (
        <>
          {/* Headers stay short — a phone-width `Input` ellipsises its own label,
              and «Ссылка на сбор (Сбербан…» tells you nothing the field doesn't. */}
          <Input
            header="Ссылка на сбор"
            type="url"
            inputMode="url"
            placeholder="https://..."
            value={collectUrl}
            disabled={busy}
            onChange={(e) => {
              setCollectUrl(e.target.value);
              setConfirming(false);
            }}
          />
          {/* A native date field: unlike the birthday itself this one has a real
              year, and the range is what the server enforces anyway. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--tgui--hint_color)" }}>Напомнить мне</span>
            <input
              type="date"
              value={scheduledSendOn}
              disabled={busy}
              min={todayIso}
              max={birthday.celebratedOn}
              aria-label="Дата напоминания о сборе"
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--tgui--outline)",
                background: "var(--tgui--secondary_bg_color)",
                color: "var(--tgui--text_color)",
                font: "inherit",
                fontSize: 13.5,
              }}
              onChange={(e) => { setScheduledSendOn(e.target.value); setConfirming(false); }}
            />
            <span style={{ fontSize: 12.5, color: "var(--tgui--hint_color)", lineHeight: 1.4 }}>
              В этот день бот напишет админам. Команде — по-прежнему только по твоему тапу.
            </span>
          </div>
          {/* The placeholder is a hint, not the default text: the default is shown
              in full right below, and putting it here too clipped mid-line. */}
          <Textarea
            header="Свой текст"
            rows={3}
            placeholder="Оставь пустым — уйдёт текст ниже"
            value={messageText}
            disabled={busy}
            onChange={(e) => {
              setMessageText(e.target.value);
              setConfirming(false);
            }}
          />
          <Button size="s" mode="filled" stretched loading={saving} disabled={busy} onClick={() => void handleSave()}>
            Сохранить
          </Button>
        </>
      )}

      {error && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13.5 }}>{error}</div>}

      {preview && (
        <>
          <div style={{ color: "var(--tgui--hint_color)", fontSize: 12.5, fontWeight: 600 }}>Уйдёт вот это:</div>
          {/* Shown as it will arrive — same line breaks, and a long link wraps
              instead of pushing the card off the screen. */}
          <div
            style={{
              padding: "10px 12px", borderRadius: 10, background: "var(--tgui--secondary_bg_color)",
              fontSize: 13.5, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}
          >
            {preview.message}
          </div>

          <div style={{ color: "var(--tgui--hint_color)", fontSize: 12.5, fontWeight: 600 }}>
            Получат {recipientsSubject(preview.recipients.length)} — все, кроме именинника:
          </div>
          <div style={{ color: "var(--tgui--hint_color)", fontSize: 13, lineHeight: 1.45 }}>
            {preview.recipients.length === 0
              ? "Некому: ни у кого не привязан Telegram."
              : preview.recipients.map((person) => person.displayName).join(", ")}
          </div>

          {preview.blocker ? (
            <div style={{ color: "var(--tgui--hint_color)", fontSize: 13, lineHeight: 1.45 }}>{preview.blocker}</div>
          ) : confirming ? (
            <>
              <div style={{ fontSize: 13, lineHeight: 1.45 }}>
                Отправить {recipientsPhrase(preview.recipients.length)}? Отменить будет нельзя — сообщения уйдут сразу.
              </div>
              <Button size="s" mode="filled" stretched loading={sending} disabled={sending} onClick={() => void handleSend()}>
                Да, разослать
              </Button>
              <Button size="s" mode="gray" stretched disabled={sending} onClick={() => setConfirming(false)}>
                Отмена
              </Button>
            </>
          ) : (
            <Button size="s" mode="bezeled" stretched disabled={busy} onClick={() => setConfirming(true)}>
              Разослать {recipientsPhrase(preview.recipients.length)}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
