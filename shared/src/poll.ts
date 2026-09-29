import { z } from "zod";
import { formatDayMonth } from "./collection";

/**
 * Опрос «За / Против / Воздержался».
 *
 * Только три ответа — так он решил (2026-09-29): свои варианты и мультивыбор
 * не просили, а каждый из них — ещё одна форма в мини-аппе и ещё одна строка
 * в итогах, которую надо уметь читать.
 */
export type PollChoice = "for" | "against" | "abstain";
export const POLL_CHOICES: readonly PollChoice[] = ["for", "against", "abstain"];
export const pollChoiceSchema = z.enum(["for", "against", "abstain"]);

export const POLL_CHOICE_LABEL: Record<PollChoice, string> = {
  for: "👍 За",
  against: "👎 Против",
  abstain: "🤷 Воздержался",
};

export const POLL_QUESTION_MAX = 200;

/** Всё, что нужно, чтобы решить «идёт или нет», — у опроса и у заказа одно и то же. */
export interface Closable {
  /** Командное время `YYYY-MM-DDTHH:MM`, а не момент UTC: сравнивается строкой с `teamNow`. */
  closesAt: string | null;
  closedAt: Date | string | null;
  cancelledAt: Date | string | null;
}

/**
 * Идёт ли приём прямо сейчас.
 *
 * Вычисляется, а не хранится флагом — по той же причине, что `isCollectionActive`:
 * тик можно пропустить, и тогда опрос, закрываемый только тиком, висел бы
 * открытым вечно. Тик здесь нужен лишь затем, чтобы разослать итог, — решать,
 * принимать ли голос, он не обязан.
 *
 * «До 12:00» значит, что в 12:00 уже поздно: сравнение строгое.
 */
export function isOpenAt(x: Closable, now: { date: string; time: string }): boolean {
  if (x.closedAt != null || x.cancelledAt != null) return false;
  if (x.closesAt == null) return true;
  return x.closesAt > `${now.date}T${now.time}`;
}

/** «12:30» сегодня → `2026-09-29T12:30`. Приём на завтра и дальше не просили. */
export function closesAtFromTime(time: string | null, today: string): string | null {
  return time ? `${today}T${time}` : null;
}

/** «до 12:30» сегодня, «до 30 сентября, 09:00» — если срок не сегодня. */
export function closesLabel(closesAt: string | null, today: string): string | null {
  if (!closesAt) return null;
  const [date, time] = closesAt.split("T");
  if (date === today) return `до ${time}`;
  return `до ${formatDayMonth(date ?? "")}, ${time}`;
}

export interface PollTally {
  for: string[];
  against: string[];
  abstain: string[];
  silent: string[];
}

/**
 * Итог поимённо.
 *
 * Знаменатель — адресаты, а не голоса: голос человека, которого в адресатах
 * нет (его архивировали после рассылки), молча не считается — та же защита от
 * «5 из 4», что в `paymentProgress`.
 */
export function pollTally(
  recipients: readonly { employeeId: number; displayName: string }[],
  votes: readonly { employeeId: number; choice: PollChoice }[],
): PollTally {
  const byEmployee = new Map(votes.map((v) => [v.employeeId, v.choice]));
  const tally: PollTally = { for: [], against: [], abstain: [], silent: [] };
  for (const r of recipients) {
    const choice = byEmployee.get(r.employeeId);
    if (choice) tally[choice].push(r.displayName);
    else tally.silent.push(r.displayName);
  }
  return tally;
}

/**
 * Письмо с опросом — и оно же после тапа, с отмеченным голосом.
 *
 * Голос пишется в текст, а не только галочкой на кнопке: кнопки гаснут после
 * закрытия, а человек должен видеть, что он ответил, и тогда.
 */
export function pollInviteText(input: {
  creatorName: string;
  question: string;
  closes: string | null;
  myChoice: PollChoice | null;
}): string {
  const lines = [`🗳 ${input.creatorName} спрашивает:`, "", input.question];
  if (input.closes) lines.push("", `Голосуем ${input.closes}.`);
  if (input.myChoice) lines.push("", `Твой голос: ${POLL_CHOICE_LABEL[input.myChoice]}`);
  return lines.join("\n");
}

const TALLY_ROWS: readonly [keyof PollTally, string][] = [
  ["for", "👍 За"],
  ["against", "👎 Против"],
  ["abstain", "🤷 Воздержались"],
  ["silent", "Не ответили"],
];

/** Итог, который уходит всем участникам при закрытии. Пустые группы не печатаются. */
export function pollResultText(question: string, tally: PollTally): string {
  const lines = [`📊 Итоги опроса: ${question}`, ""];
  for (const [key, label] of TALLY_ROWS) {
    const names = tally[key];
    if (names.length > 0) lines.push(`${label} — ${names.length}: ${names.join(", ")}`);
  }
  return lines.join("\n");
}
