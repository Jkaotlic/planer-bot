import { describe, expect, it } from "vitest";
import { csvCell, neutralizeCsvFormula, restoreCsvFormula } from "./csv-encoding";

describe("neutralizeCsvFormula", () => {
  it.each(["=HYPERLINK(1)", "+1", "-1", "@SUM(A1)", "\tx", "\rx"])("гасит %j апострофом", (value) => {
    expect(neutralizeCsvFormula(value)).toBe(`'${value}`);
  });

  it.each(["Аня Иванова", "", "к32-7", "a=b", "'с апострофом"])("не трогает %j", (value) => {
    expect(neutralizeCsvFormula(value)).toBe(value);
  });
});

describe("restoreCsvFormula", () => {
  it.each(["=HYPERLINK(1)", "+1", "-", "@x", "'=x", "Аня", "", "'обычный"])("обратна к гашению: %j", (value) => {
    expect(restoreCsvFormula(neutralizeCsvFormula(value))).toBe(value);
  });

  it("апостроф перед обычным текстом — часть имени", () => {
    expect(restoreCsvFormula("'Аня")).toBe("'Аня");
  });
});

describe("csvCell", () => {
  it.each(["a;=1+1", "a,=1+1", "x\r=1+1", "x\n=1+1"])("кавычит чужой разделитель и перевод строки: %j", (value) => {
    expect(csvCell(value)).toBe(`"${value}"`);
  });

  it("удваивает кавычку", () => {
    expect(csvCell('a"b')).toBe('"a""b"');
  });

  it("гасит формулу и оставляет обычное имя как есть", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("Аня")).toBe("Аня");
  });
});
