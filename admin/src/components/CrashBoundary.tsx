import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Что делать, когда в консоли падает экран — или не загружается его кусок.
 *
 * React 18 при необработанной ошибке рендера размонтирует всё дерево, и человек
 * видит белую страницу — неотличимую от «консоль не открылась». Здесь же
 * причина известна, и её можно назвать. Тот же приём, что у мини-аппа
 * (`miniapp/src/components/CrashBoundary.tsx`).
 *
 * Отдельный случай — кусок, загруженный лениво (`React.lazy`): после выкатки
 * сервер уже не отдаёт файл со старым хешем в имени, и вкладка, открытая до неё,
 * на первом заходе в такой экран получает отказ загрузки. Лечится одним —
 * обновить страницу, — и именно это сообщение должно стоять на месте белого
 * экрана, а не «экран сломался».
 */

interface Props {
  children: ReactNode;
}

interface State {
  message: string | null;
}

/** Браузеры называют отказ загрузки динамического импорта по-разному. */
export function isChunkLoadError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /dynamically imported module|importing a module script failed|ChunkLoadError|Loading chunk|Failed to fetch dynamically/i.test(text);
}

export class CrashBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Той же ручкой, что отчёты мини-аппа: снаружи это одна беда — «открыл и не увидел».
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: `консоль: ${isChunkLoadError(error) ? "кусок не загрузился" : "экран упал"}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        userAgent: navigator.userAgent,
        url: `${location.pathname}${location.search}`,
        componentStack: info.componentStack?.slice(0, 400),
      }),
    }).catch(() => {
      // Сеть могла отвалиться — молча: показать сообщение важнее, чем отчёт.
    });
  }

  render(): ReactNode {
    if (this.state.message === null) return this.props.children;

    const stale = isChunkLoadError(this.state.message);
    return (
      <div className="crash-notice" role="alert">
        <h2>{stale ? "Консоль обновилась" : "Экран сломался"}</h2>
        <p>
          {stale
            ? "Эта часть консоли подгружается отдельным файлом, а после обновления сервера старого файла уже нет. Обнови страницу — откроется свежая версия."
            : "Консоль открылась, но не смогла показать этот экран. Отчёт уже ушёл. Обнови страницу — часто помогает; если нет, напиши об этом в чат с ботом."}
        </p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Обновить страницу
        </button>
        {!stale && <p className="crash-notice-detail">Что случилось: {this.state.message}</p>}
      </div>
    );
  }
}
