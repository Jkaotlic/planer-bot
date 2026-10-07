import type { Bot } from "grammy";
import { teamTimeAt } from "../util/team-time";

/**
 * Три минуты: опрос `getUpdates` возвращается не реже раза в ~30 с, даже когда
 * никто ничего не нажимает, так что столько тишины — это уже не пауза, а
 * потеря связи. Меньше брать незачем: один сорванный круг опроса и повтор
 * через 3 с — штатная жизнь, а не повод красить значок.
 */
export const TELEGRAM_STALE_MS = 3 * 60_000;

export type LivenessStatus = { reachable: true } | { reachable: false; since: Date };

export interface TelegramLiveness {
  /** Telegram ответил — неважно что, хоть 400: до него дошли. */
  recordOk(): void;
  /** Ответа нет: обрыв по сроку, DNS, сброс соединения. */
  recordFailure(): void;
  status(): LivenessStatus;
}

export interface LivenessDeps {
  now(): number;
  log(line: string): void;
  teamTz: string;
}

/**
 * Помнит, когда Telegram отвечал в последний раз.
 *
 * 07.10.2026 20:02–20:20 мак не достучался до api.telegram.org: процесс жил,
 * опрос числился запущенным, `/api/health` был зелёным — о провале узнали от
 * людей. `isRunning()` говорит, что цикл опроса существует, а не что он
 * приносит ответы; это отвечает на второй вопрос.
 *
 * В лог — по строке на переход, а не на отказ: за 18 минут провала лог и так
 * получил полсотни строк «aborted», и начало провала в них не было видно.
 */
export function createTelegramLiveness(deps: LivenessDeps): TelegramLiveness {
  let lastOkAt = deps.now();
  // Первый отказ после последнего ответа — отсюда «нет связи с 20:02», а не с
  // момента, когда сработал порог.
  let firstFailureAt: number | undefined;
  let announced = false;

  const status = (): LivenessStatus => {
    if (deps.now() - lastOkAt <= TELEGRAM_STALE_MS) return { reachable: true };
    const since = firstFailureAt ?? lastOkAt;
    if (!announced) {
      announced = true;
      deps.log(`telegram: нет связи с ${teamTimeAt(new Date(since), deps.teamTz)}`);
    }
    return { reachable: false, since: new Date(since) };
  };

  return {
    recordOk() {
      if (announced) {
        const minutes = Math.round((deps.now() - (firstFailureAt ?? lastOkAt)) / 60_000);
        deps.log(`telegram: связь вернулась, не было ${minutes} мин`);
      }
      lastOkAt = deps.now();
      firstFailureAt = undefined;
      announced = false;
    },
    recordFailure() {
      firstFailureAt ??= deps.now();
      status();
    },
    status,
  };
}

/**
 * Перехватчик ставится после `installApiTimeouts` — значит, снаружи него и
 * видит его обрывы по сроку как отказ. Ответ Telegram с ошибкой grammY отдаёт
 * значением, а не исключением, поэтому любое значение — это «дошли».
 */
export function installLivenessTracker(bot: Bot, liveness: TelegramLiveness): void {
  bot.api.config.use(async (prev, method, payload, signal) => {
    try {
      const res = await prev(method, payload, signal);
      liveness.recordOk();
      return res;
    } catch (error) {
      // `bot.stop()` тоже обрывает висящий опрос — это не потеря связи.
      if (!signal?.aborted) liveness.recordFailure();
      throw error;
    }
  });
}
