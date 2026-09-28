import { describe, it, expect } from "vitest";
import { markErrorText } from "./ChecklistCard";

/**
 * Сервер отвечает кодами (`not_your_day`, `unknown_item`, `invalid`) — их
 * нельзя показывать дежурному как есть, `markErrorText` переводит их в фразу.
 */
describe("markErrorText — код сервера в русскую фразу", () => {
  it("unknown_item — пункт убрали, а не код на экране", () => {
    expect(markErrorText(new Error("unknown_item"))).toBe("Этот пункт убрали — обнови экран.");
  });
});
