// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadBlob, svgToPngBlob } from "./qr-export";

afterEach(() => vi.restoreAllMocks());

describe("растеризация SVG в PNG", () => {
  it("холст — ровно в размер рисунка, белая подложка до самого рисунка", async () => {
    const calls: string[] = [];
    const ctx = {
      fillStyle: "",
      fillRect: vi.fn(function (this: { fillStyle: string }) { calls.push(`fillRect:${this.fillStyle}`); }),
      drawImage: vi.fn(() => calls.push("drawImage")),
    };
    let canvas!: HTMLCanvasElement;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      canvas = this;
      return ctx as never;
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(new Blob(["p"], { type: "image/png" })));
    // jsdom не грузит картинки: «загрузку» играем сами, сразу после присвоения src.
    vi.stubGlobal("Image", class { onload: (() => void) | null = null; set src(_: string) { queueMicrotask(() => this.onload?.()); } });

    const blob = await svgToPngBlob("<svg/>", 1024, 1100);

    expect(blob.type).toBe("image/png");
    expect([canvas.width, canvas.height]).toEqual([1024, 1100]);
    expect(calls).toEqual(["fillRect:#FFFFFF", "drawImage"]);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1024, 1100);
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1024, 1100);
    vi.unstubAllGlobals();
  });
});

describe("скачивание", () => {
  it("ссылка получает имя файла и нажимается, адрес освобождается позже", () => {
    vi.useFakeTimers();
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: revoke });
    let name = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { name = this.download; });
    downloadBlob(new Blob(["p"]), "qr-кофе.png");
    expect(name).toBe("qr-кофе.png");
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(revoke).toHaveBeenCalledWith("blob:x");
    vi.useRealTimers();
  });
});
