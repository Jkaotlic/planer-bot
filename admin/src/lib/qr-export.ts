import { qrDataUrl } from "@planer/shared/qr";

/**
 * Картинка QR-кода из браузера: SVG → canvas → PNG, скачивание и буфер обмена.
 * Растеризация — в ту же ширину, что у бота (`renderQr` отдаёт её вместе с SVG):
 * на нецелом масштабе плотный код плывёт.
 */
export function svgToPngBlob(svg: string, width: number, height: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas недоступен"));
        return;
      }
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG не собрался"))), "image/png");
    };
    img.onerror = () => reject(new Error("SVG не загрузился"));
    img.src = qrDataUrl(svg);
  });
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Не сразу: Safari начинает скачивание асинхронно, и немедленный revoke его обрывает.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Имя файла по подписи: человек потом ищет его в «Загрузках» по смыслу, а не по дате. */
export function qrFileName(caption?: string): string {
  // Управляющие знаки файловые системы не принимают; режем по кодовым точкам, а не по
  // единицам UTF-16, чтобы эмодзи не распался на одинокий суррогат.
  const slug = Array.from(
    (caption ?? "")
      .replace(/[\u0000-\u001F\u007F]+/g, " ")
      .replace(/[\\/:*?"<>|]+/g, " ")
      .trim()
      .replace(/\s+/g, "-"),
  )
    .slice(0, 40)
    .join("");
  return slug ? `qr-${slug}.png` : "qr-code.png";
}

export const COPY_REFUSED = "Браузер не дал скопировать картинку. Нажми «Скачать PNG» — файл можно вставить вручную.";

export interface ClipboardEnv {
  clipboard?: { write?: (items: ClipboardItem[]) => Promise<void> };
  ClipboardItemCtor?: typeof ClipboardItem;
}

/**
 * Копирует PNG в буфер. Картинка приходит промисом и уходит в `ClipboardItem`
 * промисом же, синхронно в обработчике нажатия: Safari считает жест истёкшим,
 * если ждать растеризацию до вызова `write`. Любой отказ — одно понятное
 * сообщение, а не тишина.
 */
export async function copyPngToClipboard(
  png: Promise<Blob>,
  env: ClipboardEnv = {
    clipboard: typeof navigator === "undefined" ? undefined : navigator.clipboard,
    ClipboardItemCtor: (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem,
  },
): Promise<{ ok: true } | { ok: false; message: string }> {
  // Отказ картинки иначе всплыл бы необработанным, если до `write` дело не дойдёт.
  png.catch(() => {});
  if (!env.clipboard?.write || !env.ClipboardItemCtor) return { ok: false, message: COPY_REFUSED };
  try {
    await env.clipboard.write([new env.ClipboardItemCtor({ "image/png": png })]);
    return { ok: true };
  } catch {
    return { ok: false, message: COPY_REFUSED };
  }
}
