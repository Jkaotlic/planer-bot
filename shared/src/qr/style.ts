import { z } from "zod";

/**
 * Стиль QR-кода: форма модулей и цвет. Без `qrcode` — этот файл едет в основной
 * бандл мини-аппа (тип `Me`, схема ответа), а рисование живёт в `render.ts` и
 * подключается только там, где код правда рисуют (`@planer/shared/qr`).
 */

/** Ключи — латиницей и навсегда: они лежат в `employees.qr_style` у живых людей. */
export const QR_SHAPES = ["classic", "dots", "rounded", "soft"] as const;
export type QrShape = (typeof QR_SHAPES)[number];

export const QR_SHAPE_LABELS: Record<QrShape, string> = {
  classic: "Классика",
  dots: "Точки",
  rounded: "Скруглённый",
  soft: "Мягкий",
};

export const QR_COLOR_KEYS = ["black", "blue", "green", "purple", "burgundy", "graphite"] as const;
export type QrColor = (typeof QR_COLOR_KEYS)[number];

/**
 * Только тёмные цвета: контраст к белому не ниже 7 (сторож — тест). Камера
 * телефона читает код по разнице яркости, и светлый «красивый» цвет — это код,
 * который у части команды не откроется. Поэтому и пипетки нет.
 * Замер плана: 18.9 / 10.0 / 8.1 / 11.8 / 10.8 / 11.6.
 */
export const QR_COLORS: Record<QrColor, { label: string; hex: string }> = {
  black: { label: "Чёрный", hex: "#111111" },
  blue: { label: "Синий", hex: "#0B3D91" },
  green: { label: "Зелёный", hex: "#0B5D1E" },
  purple: { label: "Фиолетовый", hex: "#4B1D80" },
  burgundy: { label: "Бордовый", hex: "#7A1030" },
  graphite: { label: "Графит", hex: "#2F3A45" },
};

/** Тот же предел, что был у бота: длиннее — решётка, которую с экрана не прочесть. */
export const QR_MAX_TEXT_LENGTH = 1000;
/** Подпись под кодом — одна строка; длиннее она стала бы мельче модулей. */
export const QR_CAPTION_MAX = 40;
/**
 * Нижняя граница ширины картинки в пикселях — у бота и у «Скачать PNG».
 * Настоящая ширина — целое число пикселей на модуль (см. `renderQr`): на 768 и
 * на нецелом масштабе плотный код сканер уже не читал (замер плана).
 */
export const QR_RASTER_WIDTH = 1024;

/** Что запоминается за человеком. Подписи здесь нет: она про один код, а не про вкус. */
export const qrSavedStyleSchema = z
  .object({ shape: z.enum(QR_SHAPES), color: z.enum(QR_COLOR_KEYS) })
  .strict();
export type QrSavedStyle = z.infer<typeof qrSavedStyleSchema>;

/** Стиль одного кода: сохранённое плюс необязательная подпись. */
export const qrStyleSchema = qrSavedStyleSchema
  .extend({ caption: z.string().max(QR_CAPTION_MAX).optional() })
  .strict();
export type QrStyle = z.infer<typeof qrStyleSchema>;

/** Пока человек ничего не выбирал — как бот рисовал всегда. */
export const DEFAULT_QR_STYLE: QrSavedStyle = { shape: "classic", color: "black" };

/**
 * Колонка `employees.qr_style` → стиль. Пусто, битый JSON или ключ, которого
 * больше нет (цвет убрали из палитры), — умолчание, а не 500 на каждую ссылку.
 */
export function parseSavedQrStyle(raw: string | null | undefined): QrSavedStyle {
  if (!raw) return DEFAULT_QR_STYLE;
  try {
    const parsed = qrSavedStyleSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_QR_STYLE;
  } catch {
    return DEFAULT_QR_STYLE;
  }
}
