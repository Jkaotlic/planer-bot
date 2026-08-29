import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Что делать, когда падает уже запущенное приложение.
 *
 * Спасательный круг в `index.html` ловит другое — случай, когда бандл не
 * выполнился ни на строку (старая система на телефоне). Здесь наоборот:
 * приложение поднялось, а потом экран упал на данных — у одного человека
 * упал, у соседа нет, потому что данные у них разные. React 18 в этом случае
 * размонтирует всё дерево, и человек видит ровно то же самое, что при
 * несовместимом бандле, — белый экран. Отличить одно от другого снаружи
 * нельзя, поэтому оба случая должны говорить.
 */

interface Props {
  children: ReactNode;
}

interface State {
  message: string | null;
}

export class CrashBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Отчёт уходит той же ручкой, что и отчёт спасательного круга: снаружи это
    // одна и та же беда — «человек открыл и ничего не увидел».
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: `экран упал: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        userAgent: navigator.userAgent,
        url: `${location.pathname}${location.search}`,
        componentStack: info.componentStack?.slice(0, 400),
      }),
    }).catch(() => {
      // Сеть уже могла отвалиться — молча: показать сообщение важнее, чем отчёт.
    });
  }

  render(): ReactNode {
    if (this.state.message === null) return this.props.children;

    return (
      <div style={{ padding: "24px 20px", maxWidth: 520, margin: "0 auto", lineHeight: 1.45 }}>
        <h1 style={{ fontSize: 19, margin: "0 0 12px" }}>Экран сломался</h1>
        <p style={{ margin: "0 0 12px" }}>
          Приложение открылось, но не смогло показать этот экран. Отчёт уже ушёл — напиши об этом в чат с ботом,
          чтобы его заметили.
        </p>
        <p style={{ margin: "0 0 12px" }}>Закрой мини-апп и открой заново: часто помогает.</p>
        <p style={{ margin: "16px 0 0", fontSize: 12, color: "#888", wordBreak: "break-word" }}>
          Что случилось: {this.state.message}
        </p>
      </div>
    );
  }
}
