import { describe, expect, it } from "vitest";
import { decodeCsvBytes, readCsvFile } from "./csv-encoding";

/** Encodes Cyrillic + ASCII the way Excel on Windows writes a CSV. */
function toWindows1251(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i)!;
    if (code < 0x80) out[i] = code;                       // ASCII
    else if (code === 0x401) out[i] = 0xa8;               // Ё
    else if (code === 0x451) out[i] = 0xb8;               // ё
    else if (code >= 0x410 && code <= 0x44f) out[i] = code - 0x410 + 0xc0; // А..я
    else throw new Error(`no windows-1251 byte for U+${code.toString(16)}`);
  }
  return out;
}

const ROW = ";01.08.2026;02.08.2026\r\nИгорь Петров;k32;holiday";

describe("decodeCsvBytes", () => {
  it("reads a UTF-8 file as UTF-8", () => {
    const result = decodeCsvBytes(new TextEncoder().encode(ROW));
    expect(result).toEqual({ text: ROW, encoding: "utf-8" });
  });

  it("drops the UTF-8 BOM our own export writes", () => {
    // TextDecoder consumes a leading BOM, so the server never sees it — and
    // parseRosterCsv strips one anyway, so a re-uploaded export works either way.
    const result = decodeCsvBytes(new TextEncoder().encode(`﻿${ROW}`));
    expect(result).toEqual({ text: ROW, encoding: "utf-8" });
  });

  it("falls back to windows-1251 rather than producing mojibake", () => {
    const result = decodeCsvBytes(toWindows1251(ROW));
    expect(result).toEqual({ text: ROW, encoding: "windows-1251" });
    // The bug this exists to prevent: the name must come back intact, because a
    // mangled one matches no employee and the import would duplicate the team.
    expect(result.text).toContain("Игорь Петров");
    expect(result.text).not.toContain("�");
  });

  it("keeps Ё and ё, which sit outside the main Cyrillic block", () => {
    const text = ";01.08.2026\r\nЁлкин Пётр;k32";
    expect(decodeCsvBytes(toWindows1251(text)).text).toBe(text);
  });

  it("decodes a pure-ASCII file identically either way", () => {
    const ascii = ";01.08.2026\r\nPetrov;k32";
    expect(decodeCsvBytes(new TextEncoder().encode(ascii))).toEqual({ text: ascii, encoding: "utf-8" });
    expect(decodeCsvBytes(toWindows1251(ascii))).toEqual({ text: ascii, encoding: "utf-8" });
  });

  it("reads straight from a Blob, the way the file picker hands it over", async () => {
    const blob = new Blob([toWindows1251(ROW) as unknown as BlobPart]);
    await expect(readCsvFile(blob)).resolves.toEqual({ text: ROW, encoding: "windows-1251" });
  });
});
