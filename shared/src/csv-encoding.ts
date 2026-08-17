export type CsvEncoding = "utf-8" | "windows-1251";

export interface DecodedCsv {
  text: string;
  encoding: CsvEncoding;
}

/**
 * Turns an uploaded roster file into text.
 *
 * Живёт в `@planer/shared`, а не по копии в каждой консоли: копии были помечены
 * «MIRROR … byte for byte» и совпадали, но обе морды от shared и так зависят —
 * переезд сюда убирает зеркало насовсем. Ни DOM, ни React здесь нет: `TextDecoder`
 * и `Blob` есть и в браузере, и в Node.
 *
 * `File.text()` always assumes UTF-8. Excel on Windows still saves CSV as
 * windows-1251, and decoding those bytes as UTF-8 turns every ФИО into mojibake —
 * which then matches nobody in the database, so a confirmed import would quietly
 * create a second copy of the entire team instead of updating it.
 *
 * Strict UTF-8 decoding is the detector: real windows-1251 Cyrillic (bytes C0–FF
 * followed by more of the same) is not valid UTF-8, so it throws and we fall back.
 * Pure-ASCII files decode identically either way, so the fallback can't misfire.
 */
export function decodeCsvBytes(bytes: ArrayBuffer | Uint8Array): DecodedCsv {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(view), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1251").decode(view), encoding: "windows-1251" };
  }
}

export async function readCsvFile(file: Blob): Promise<DecodedCsv> {
  return decodeCsvBytes(await file.arrayBuffer());
}
