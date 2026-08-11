/** Бросается, когда у клиента нет годной сессии — экран показывает приглашение войти. */
export class AuthRequiredError extends Error {}

/**
 * Сетевой сбой — это не ответ сервера, а его отсутствие: `fetch` бросает
 * `TypeError: Failed to fetch` (в Chrome) или «NetworkError…» (в Firefox), и
 * именно эта английская строка доезжала до человека — она кладётся в
 * `Error.message`, а экраны показывают его как есть. Повод дёрнуть эту ветку
 * будничный: рестарт сервера при выкладке или лифт с плохим интернетом.
 *
 * То же правило, что у `refusalText`: то, что читает человек, пишется
 * по-русски. Ответ сервера с кодом мы не трогаем — у него свои переводы.
 */
export const OFFLINE_MESSAGE = "Нет связи с сервером — проверь интернет и попробуй ещё раз.";

/** Откуда брать токен. Мини-апп берёт его из Telegram initData, консоль — из ссылки бота. */
export interface TokenSource {
  get(): Promise<string>;
  clear(): void;
}

export interface TransportOptions {
  baseUrl: string;
  tokenSource: TokenSource;
  /** Инъекция ради тестов; в приложении — глобальный fetch. */
  fetchImpl?: typeof fetch;
}

export interface Transport {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, payload?: unknown): Promise<T>;
  put<T>(path: string, payload?: unknown): Promise<T>;
  patch<T>(path: string, payload?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
}

export function createTransport(opts: TransportOptions): Transport {
  const { baseUrl, tokenSource, fetchImpl = fetch } = opts;

  async function send(path: string, init: RequestInit): Promise<unknown> {
    const token = await tokenSource.get();
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
      });
    } catch {
      throw new Error(OFFLINE_MESSAGE);
    }
    if (!res.ok) throw await toError(path, res, tokenSource);
    return await res.json();
  }

  const withJson =
    (method: string) =>
    <T>(path: string, payload?: unknown): Promise<T> =>
      send(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }) as Promise<T>;

  return {
    get: <T>(path: string) => send(path, {}) as Promise<T>,
    post: withJson("POST"),
    put: withJson("PUT"),
    patch: withJson("PATCH"),
    del: <T>(path: string) => send(path, { method: "DELETE" }) as Promise<T>,
  };
}

/** Маппит неуспешный ответ в ошибку; 401/403 гасит сессию и просит войти заново. */
async function toError(path: string, res: Response, tokenSource: TokenSource): Promise<Error> {
  if (res.status === 401 || res.status === 403) {
    tokenSource.clear();
    return new AuthRequiredError("Сессия истекла — войди заново");
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error ?? `Request to ${path} failed with status ${res.status}`);
}
