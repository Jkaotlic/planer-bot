import { describe, expect, it, vi } from "vitest";
import { COPY_REFUSED, copyPngToClipboard, qrFileName } from "./qr-export";

const png = () => Promise.resolve(new Blob(["x"], { type: "image/png" }));

class FakeItem {
  constructor(public readonly items: Record<string, Promise<Blob>>) {}
}

describe("копирование картинки", () => {
  it("кладёт PNG в буфер, когда браузер умеет", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const res = await copyPngToClipboard(png(), { clipboard: { write }, ClipboardItemCtor: FakeItem as never });
    expect(res).toEqual({ ok: true });
    expect(Object.keys((write.mock.calls[0]![0] as FakeItem[])[0]!.items)).toEqual(["image/png"]);
  });

  it("в буфер уходит тот же промис, write зовётся синхронно, до готовности картинки", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    let settle!: (b: Blob) => void;
    const pending = new Promise<Blob>((r) => (settle = r));
    const done = copyPngToClipboard(pending, { clipboard: { write }, ClipboardItemCtor: FakeItem as never });
    // Картинка ещё не готова, а write уже вызван — иначе Safari сочтёт жест истёкшим.
    expect(write).toHaveBeenCalledTimes(1);
    expect((write.mock.calls[0]![0] as FakeItem[])[0]!.items["image/png"]).toBe(pending);
    settle(new Blob(["x"]));
    expect(await done).toEqual({ ok: true });
  });

  it("нет clipboard.write (не https, старый браузер) — понятный отказ", async () => {
    expect(await copyPngToClipboard(png(), { clipboard: undefined, ClipboardItemCtor: FakeItem as never })).toEqual({ ok: false, message: COPY_REFUSED });
  });

  it("нет ClipboardItem (Firefox до 127) — понятный отказ", async () => {
    const write = vi.fn();
    expect(await copyPngToClipboard(png(), { clipboard: { write }, ClipboardItemCtor: undefined })).toEqual({ ok: false, message: COPY_REFUSED });
    expect(write).not.toHaveBeenCalled();
  });

  it("браузер отказал в разрешении — понятный отказ, а не исключение", async () => {
    const write = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    expect(await copyPngToClipboard(png(), { clipboard: { write }, ClipboardItemCtor: FakeItem as never })).toEqual({ ok: false, message: COPY_REFUSED });
  });

  it("сломанная картинка при недоступном буфере не всплывает необработанным отказом", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    await copyPngToClipboard(Promise.reject(new Error("canvas")), { clipboard: undefined, ClipboardItemCtor: undefined });
    await new Promise((r) => setTimeout(r, 0));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("сообщение отказа ведёт к «Скачать PNG»", () => {
    expect(COPY_REFUSED).toContain("«Скачать PNG»");
  });
});

describe("имя файла", () => {
  it("без подписи — qr-code.png; с подписью — по ней, без символов, запрещённых в именах файлов", () => {
    expect(qrFileName()).toBe("qr-code.png");
    expect(qrFileName("  ")).toBe("qr-code.png");
    expect(qrFileName('Сбор: "кофе"/чай?')).toBe("qr-Сбор-кофе-чай.png");
  });

  it("управляющие знаки вырезаются; одни они — имя по умолчанию", () => {
    expect(qrFileName("a\u0000b\u001Fc\u007Fd")).toBe("qr-a-b-c-d.png");
    expect(qrFileName("\u0007\u0000")).toBe("qr-code.png");
  });

  it("обрезка по кодовым точкам: эмодзи не распадается на одинокий суррогат", () => {
    const name = qrFileName("😀".repeat(41));
    expect(name).toBe(`qr-${"😀".repeat(40)}.png`);
    expect(name).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });
});
