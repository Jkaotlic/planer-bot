import { z } from "zod";
import { formatDayMonth } from "./collection";
import { FOOD_CLOSE_HORIZON_DAYS } from "./food-order";
import { TELEGRAM_TEXT_SAFE_MAX } from "./text-limits";
import { addDaysIso } from "./week-dates";

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

/**
 * Срок ещё не прошёл — проверка при создании, а не только при голосовании.
 *
 * Без неё «08:00» в форме в полдень создаёт опрос, закрытый в момент рождения:
 * кнопки уйдут, тап откажет, а следующий тик разошлёт пустой итог, будто
 * никто не откликнулся, хотя откликаться было не на что. Сравнение то же
 * строгое, что у `isOpenAt` (Задача 12 переиспользует для заказов еды).
 */
export function isFutureClose(closesAt: string | null, now: { date: string; time: string }): boolean {
  if (closesAt == null) return true;
  return closesAt > `${now.date}T${now.time}`;
}

/** Срок не дальше `FOOD_CLOSE_HORIZON_DAYS` от сегодня; без срока — можно. Сравниваем даты: время в последний день не важно. */
export function isWithinCloseHorizon(closesAt: string | null, today: string): boolean {
  if (closesAt == null) return true;
  return closesAt.slice(0, 10) <= addDaysIso(today, FOOD_CLOSE_HORIZON_DAYS);
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

/**
 * Итог поимённо строками, пустые группы не печатаются.
 *
 * Одна функция на письмо бота, карточку мини-аппа и карточку консоли: подписи
 * групп раньше жили второй копией в `PollCard.tsx` (`TALLY_LABELS`), и правка
 * одной не доезжала бы до другой.
 *
 * `namesMax` — сколько имён показать в группе, остальные сворачиваются в «…и ещё N».
 * Нужен только письму (`pollResultText`); карточки зовут без него и печатают всех —
 * на это и ссылается свёрнутое письмо. Счёт группы всегда полный: прячутся имена,
 * а не голоса.
 */
export function pollTallyLines(tally: PollTally, namesMax = Number.POSITIVE_INFINITY): string[] {
  return TALLY_ROWS.filter(([key]) => tally[key].length > 0).map(([key, label]) => {
    const names = tally[key];
    const rest = names.length - namesMax;
    if (rest <= 0) return `${label} — ${names.length}: ${names.join(", ")}`;
    const shown = names.slice(0, namesMax);
    return `${label} — ${names.length}: ${[...shown, `…и ещё ${rest}`].join(", ")}`;
  });
}

/**
 * Итог, который уходит всем участникам при закрытии.
 *
 * Одно письмо и не длиннее `TELEGRAM_TEXT_SAFE_MAX`: 60 адресатов с именами в 100
 * знаков (`EMPLOYEE_NAME_MAX`) — уже больше 6000, а такое письмо Telegram отвергает
 * целиком, и итог не дошёл бы ни до кого. Резать на части не стали: итог читают
 * разом, а куски одного итога вперемешку с другими письмами читаются хуже. Поэтому
 * имён в группе показывается поровну столько, сколько влезает, остальные — «…и ещё N».
 * Ссылка честная: карточка опроса в мини-аппе («📋 Заказы и опросы», последние 20
 * опросов человека — только что закрытый среди них) печатает всех поимённо.
 */
export function pollResultText(question: string, tally: PollTally): string {
  const head = [`📊 Итоги опроса: ${question}`, ""];
  const full = [...head, ...pollTallyLines(tally)].join("\n");
  if (full.length <= TELEGRAM_TEXT_SAFE_MAX) return full;
  const biggest = Math.max(...TALLY_ROWS.map(([key]) => tally[key].length));
  // Перебор с большего: групп четыре, имён — сотни, а арифметика длин ошибалась бы
  // на разделителях. При нуле имён остаются вопрос (≤ 200) и счёт — это влезает всегда.
  for (let namesMax = biggest - 1; namesMax >= 0; namesMax -= 1) {
    const text = [...head, ...pollTallyLines(tally, namesMax), "", POLL_FULL_LIST_HINT].join("\n");
    if (text.length <= TELEGRAM_TEXT_SAFE_MAX) return text;
  }
  return [...head, ...pollTallyLines(tally, 0), "", POLL_FULL_LIST_HINT].join("\n");
}

const POLL_FULL_LIST_HINT = "Все имена — в мини-аппе: «📋 Заказы и опросы».";

/** Подсказка в форме опроса — из тех же подписей, что и кнопки голоса. */
export const POLL_CHOICES_HINT = `Ответы: ${POLL_CHOICES.map((c) => POLL_CHOICE_LABEL[c]).join(" · ")}`;
