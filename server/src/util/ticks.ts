import { safeErrorMessage } from "./safe-error";

export interface NamedTick {
  /** Short, log-friendly label — shows up in the error line if this tick fails. */
  name: string;
  run: () => Promise<unknown>;
}

/**
 * Runs several polling ticks independently, so a failure in one can never
 * suppress another.
 *
 * A naive `.then()` chain (`tickA().then(() => tickB()).catch(...)`) looks
 * like it separates two ticks but doesn't: if `tickA` rejects, `.then` is
 * skipped entirely and `tickB` never runs that cycle. This runs every tick and
 * catches each one's rejection on its own, so `tickB` still executes even when
 * `tickA` throws.
 *
 * The returned promise itself never rejects — a failed tick must not crash the
 * process — and each failure is logged with its own tick's name so the two
 * are distinguishable in the log. Callers that need to prevent a slow batch
 * from overlapping the next scheduled one (e.g. a `setInterval` re-entrancy
 * guard) do that around the call to this function, not inside it.
 */
export async function runTicksIndependently(ticks: readonly NamedTick[]): Promise<void> {
  await Promise.all(
    ticks.map((tick) =>
      Promise.resolve()
        .then(() => tick.run())
        .catch((err) => {
          console.error(`${tick.name} tick failed:`, safeErrorMessage(err));
        }),
    ),
  );
}

/**
 * Круг тиков, где у каждого свой флаг «идёт».
 *
 * Раньше один общий флаг держал весь круг, пока не кончится самый медленный:
 * напоминание с таймаутами Telegram по двадцать секунд на человека задерживало
 * эскалацию «смену никто не взял» и заявки, которым пора погаснуть. Теперь
 * медленный пропускает свои круги сам, а соседи идут по расписанию. Наложиться
 * на самого себя тик по-прежнему не может — это и защищает флаг.
 *
 * Возвращает функцию одного круга — её зовёт `setInterval`. Круг не ждёт тиков:
 * каждый живёт своим промисом, ошибки ловятся и пишутся с именем тика.
 */
export function createTickScheduler(ticks: readonly NamedTick[]): () => void {
  const running = new Set<string>();
  return () => {
    for (const tick of ticks) {
      if (running.has(tick.name)) continue;
      running.add(tick.name);
      void runTicksIndependently([tick]).finally(() => running.delete(tick.name));
    }
  };
}
