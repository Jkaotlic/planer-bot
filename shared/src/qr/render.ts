import QRCode from "qrcode";
import { QR_CAPTION_MAX, QR_COLORS, QR_MAX_TEXT_LENGTH, QR_RASTER_WIDTH, type QrShape, type QrStyle } from "./style";

/**
 * Ошибка с текстом для человека: экран показывает `message` под полем как есть,
 * бот — ответом. Отдельный класс, чтобы маршрут отличал «сам виноват» (400) от
 * настоящего сбоя рисования (500).
 */
export class QrTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QrTextError";
  }
}

/** Единица SVG на один модуль. Целая — чтобы координаты не копили дроби. */
const UNIT = 10;
/**
 * Тихая зона — 4 модуля, как требует стандарт. Без неё код на тёмной теме
 * Telegram сливается с фоном вокруг, и искатель углов не находит «глаза»
 * (сторож — тест на тёмной подложке в `server/src/render/qr-readability.test.ts`).
 */
export const QR_QUIET_ZONE = 4;

/**
 * Фигурные формы съедают часть площади модуля — им запас коррекции побольше.
 * «Классика» остаётся на `M`, как рисовал бот: при той же длине код мельче.
 */
function levelFor(shape: QrShape): "M" | "Q" {
  return shape === "classic" ? "M" : "Q";
}

/** Два знака после точки: длинные дроби раздували бы SVG кода в 1000 знаков вдвое. */
function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  if (r <= 0) return `M${num(x)} ${num(y)}h${num(w)}v${num(h)}h${num(-w)}z`;
  return (
    `M${num(x + r)} ${num(y)}h${num(w - 2 * r)}a${num(r)} ${num(r)} 0 0 1 ${num(r)} ${num(r)}` +
    `v${num(h - 2 * r)}a${num(r)} ${num(r)} 0 0 1 ${num(-r)} ${num(r)}` +
    `h${num(-(w - 2 * r))}a${num(r)} ${num(r)} 0 0 1 ${num(-r)} ${num(-r)}` +
    `v${num(-(h - 2 * r))}a${num(r)} ${num(r)} 0 0 1 ${num(r)} ${num(-r)}z`
  );
}

function dot(cx: number, cy: number, r: number): string {
  return `M${num(cx - r)} ${num(cy)}a${num(r)} ${num(r)} 0 1 0 ${num(2 * r)} 0a${num(r)} ${num(r)} 0 1 0 ${num(-2 * r)} 0z`;
}

/** Модуль данных в выбранной форме. */
function dataModule(shape: QrShape, x: number, y: number): string {
  if (shape === "rounded") return roundedRect(x + 0.3, y + 0.3, UNIT - 0.6, UNIT - 0.6, 2.5);
  if (shape === "dots" || shape === "soft") return dot(x + UNIT / 2, y + UNIT / 2, UNIT * 0.45);
  return `M${x} ${y}h${UNIT}v${UNIT}h${-UNIT}z`;
}

/**
 * «Глаз» — кольцо 7×7 и сердцевина 3×3, одним контуром с `evenodd`. У «Мягкого»
 * углы скруглены; у остальных квадратные — сканер ищет их по пропорции 1:1:3:1:1,
 * и чем ближе к квадрату, тем увереннее.
 */
function eye(x: number, y: number, soft: boolean): string {
  return (
    roundedRect(x, y, 7 * UNIT, 7 * UNIT, soft ? 2.2 * UNIT : 0) +
    roundedRect(x + UNIT, y + UNIT, 5 * UNIT, 5 * UNIT, soft ? 1.5 * UNIT : 0) +
    roundedRect(x + 2 * UNIT, y + 2 * UNIT, 3 * UNIT, 3 * UNIT, soft ? UNIT : 0)
  );
}

/** Подпись идёт в SVG текстом — всё, что XML понимает как разметку, экранируется. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Управляющие символы XML 1.0 не допускает даже экранированными: растеризатор
 * на таком SVG падает целиком. То же с одиночными суррогатами и U+FFFE/U+FFFF:
 * в XML они не допустимы, а в JS-строке пришедшей снаружи встречаются. Настоящая
 * пара (эмодзи) остаётся. Переводы строк — в пробел: подпись в одну строку.
 */
function cleanCaption(raw: string | undefined): string {
  return (raw ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uFFFE\uFFFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface QrPicture {
  svg: string;
  /** Ширина картинки в пикселях: целое число пикселей на модуль, не уже `QR_RASTER_WIDTH`. */
  width: number;
  height: number;
}

/**
 * QR-код — одна функция для мини-аппа, консоли и бота.
 *
 * Служебные узоры кода (выравнивание, синхрополосы, формат и версия —
 * `isReserved`) рисуются обычными квадратами в любом стиле, фигурными —
 * только модули данных. Замер плана: точки и скругления в узоре выравнивания
 * сканер (`jsqr`) не находил вовсе, даже на коротких ссылках.
 *
 * Размер в пикселях отдаётся вместе с SVG: на нецелом масштабе плотный код
 * плывёт при растеризации, и бот с консолью должны рисовать ровно в эту ширину.
 *
 * Бросает `QrTextError` с текстом для человека: пусто, длиннее
 * `QR_MAX_TEXT_LENGTH`, не влезло в код (кириллица весит вдвое — у фигурных
 * форм запас коррекции съедает место), подпись длиннее `QR_CAPTION_MAX`.
 */
export function renderQr(text: string, style: QrStyle): QrPicture {
  if (text.trim() === "") throw new QrTextError("Впиши ссылку или текст.");
  if (text.length > QR_MAX_TEXT_LENGTH) {
    throw new QrTextError(`Слишком длинно для QR-кода: ${text.length} знаков, а помещается ${QR_MAX_TEXT_LENGTH}.`);
  }
  const caption = cleanCaption(style.caption);
  if (caption.length > QR_CAPTION_MAX) {
    throw new QrTextError(`Подпись — не длиннее ${QR_CAPTION_MAX} знаков.`);
  }

  let modules: ReturnType<typeof QRCode.create>["modules"];
  try {
    modules = QRCode.create(text, { errorCorrectionLevel: levelFor(style.shape) }).modules;
  } catch {
    throw new QrTextError(
      style.shape === "classic"
        ? "Текст не помещается в QR-код — сократи его."
        : "Текст не помещается в QR-код этой формы — сократи его или выбери «Классику»: она вмещает больше.",
    );
  }

  const n = modules.size;
  const across = n + 2 * QR_QUIET_ZONE;
  const offset = QR_QUIET_ZONE * UNIT;
  const size = across * UNIT;
  const isEye = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

  let fixed = "";
  let data = "";
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (!modules.get(r, c) || isEye(r, c)) continue;
      const x = offset + c * UNIT;
      const y = offset + r * UNIT;
      if (style.shape === "classic" || modules.isReserved(r, c)) fixed += `M${x} ${y}h${UNIT}v${UNIT}h${-UNIT}z`;
      else data += dataModule(style.shape, x, y);
    }
  }
  const soft = style.shape === "soft";
  const eyes = eye(offset, offset, soft) + eye(offset + (n - 7) * UNIT, offset, soft) + eye(offset, offset + (n - 7) * UNIT, soft);

  const ink = QR_COLORS[style.color].hex;
  // Подпись ниже тихой зоны, а не в ней: текст у края кода сканер принимает за модули.
  // Кегль подгоняется под длину, чтобы 40 знаков влезли в ширину кода одной строкой.
  // Считаем по самой широкой букве (W, Ж, Ш — до ~1 em в DejaVu Sans), а не по средней
  // (~0.62): на средней сорок заглавных вылезали за края и обрезались.
  const fontSize = caption ? Math.min(size * 0.07, (size * 0.9) / caption.length) : 0;
  const heightUnits = caption ? size + Math.round(fontSize * 1.8) : size;
  const label = caption
    ? `<text x="${num(size / 2)}" y="${num(size + fontSize * 0.9)}" text-anchor="middle" font-family="DejaVu Sans, -apple-system, Segoe UI, Roboto, sans-serif" font-size="${num(fontSize)}" fill="${ink}">${escapeXml(caption)}</text>`
    : "";

  const perModule = Math.ceil(QR_RASTER_WIDTH / across);
  const width = across * perModule;
  const height = Math.round((heightUnits / UNIT) * perModule);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${heightUnits}" width="${width}" height="${height}">` +
    `<rect width="${size}" height="${heightUnits}" fill="#FFFFFF"/>` +
    `<path fill="${ink}" fill-rule="evenodd" d="${eyes}"/>` +
    `<path fill="${ink}" d="${fixed}${data}"/>` +
    label +
    "</svg>";
  return { svg, width, height };
}

/** Только разметка — для предпросмотра, где размер задаёт вёрстка. */
export function renderQrSvg(text: string, style: QrStyle): string {
  return renderQr(text, style).svg;
}

/**
 * SVG как адрес картинки. Предпросмотр — `<img>`, а не вставленная разметка:
 * у картинки нет DOM, и никакая подпись не станет элементом страницы.
 */
export function qrDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export type QrPreview = { kind: "empty" } | { kind: "ok"; src: string } | { kind: "error"; message: string };

/** Что показать под полем: подсказку, ошибку словами или картинку. Общая для мини-аппа и консоли. */
export function qrPreview(text: string, style: QrStyle): QrPreview {
  if (text.trim() === "") return { kind: "empty" };
  try {
    return { kind: "ok", src: qrDataUrl(renderQrSvg(text, style)) };
  } catch (err) {
    if (err instanceof QrTextError) return { kind: "error", message: err.message };
    throw err;
  }
}
