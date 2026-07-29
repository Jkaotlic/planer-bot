import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SwapRequest } from "../api/client";
import { formatDayLabel } from "../lib/week";
import { formatTimeRange } from "../lib/shift";
import { ArchivedSwapCard } from "./SwapRequestCard";

// Distinct shift summaries so a mixed-up direction shows up as the wrong text
// in the wrong line rather than passing by coincidence.
const yourShift = { date: "2026-07-10", start: "08:00", end: "16:00", title: "Точка А" };
const theirShift = { date: "2026-07-11", start: "09:00", end: "17:00", title: "Точка Б" };
const yourShiftText = `${formatDayLabel(yourShift.date)} · ${formatTimeRange(yourShift)} · ${yourShift.title}`;
const theirShiftText = `${formatDayLabel(theirShift.date)} · ${formatTimeRange(theirShift)} · ${theirShift.title}`;

function archivedRequest(direction: SwapRequest["direction"]): SwapRequest {
  return {
    id: 1,
    direction,
    status: "accepted",
    message: null,
    createdAt: "2026-07-12T10:00:00.000Z",
    counterpartyName: "Коллега Имя",
    yourShift,
    theirShift,
  };
}

describe("ArchivedSwapCard", () => {
  it("puts the outgoing side's own shift first and the counterparty's shift second", () => {
    const markup = renderToStaticMarkup(createElement(ArchivedSwapCard, { request: archivedRequest("outgoing") }));

    expect(markup).toContain("Ты отдавал →");
    expect(markup).toContain("Взамен просил →");
    expect(markup).not.toContain("Коллега отдавал →");
    expect(markup).not.toContain("Взамен просил твою →");

    // "Ты отдавал →" must be paired with yourShift, not theirShift.
    expect(markup.indexOf("Ты отдавал →")).toBeLessThan(markup.indexOf(yourShiftText));
    expect(markup.indexOf(yourShiftText)).toBeLessThan(markup.indexOf("Взамен просил →"));
    expect(markup.indexOf("Взамен просил →")).toBeLessThan(markup.indexOf(theirShiftText));
  });

  it("puts the counterparty's shift first and the current user's own shift second for an incoming request", () => {
    const markup = renderToStaticMarkup(createElement(ArchivedSwapCard, { request: archivedRequest("incoming") }));

    expect(markup).toContain("Коллега отдавал →");
    expect(markup).toContain("Взамен просил твою →");
    expect(markup).not.toContain("Ты отдавал →");
    expect(markup).not.toContain(">Взамен просил →<");

    // "Коллега отдавал →" must be paired with theirShift, "Взамен просил твою →" with yourShift.
    expect(markup.indexOf("Коллега отдавал →")).toBeLessThan(markup.indexOf(theirShiftText));
    expect(markup.indexOf(theirShiftText)).toBeLessThan(markup.indexOf("Взамен просил твою →"));
    expect(markup.indexOf("Взамен просил твою →")).toBeLessThan(markup.indexOf(yourShiftText));
  });

  it("renders no action buttons — a settled swap is read-only", () => {
    const markup = renderToStaticMarkup(createElement(ArchivedSwapCard, { request: archivedRequest("incoming") }));
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("Принять");
    expect(markup).not.toContain("Отклонить");
    expect(markup).not.toContain("Отменить");
  });

  it("shows the settled status and the counterparty's name", () => {
    const markup = renderToStaticMarkup(createElement(ArchivedSwapCard, { request: archivedRequest("outgoing") }));
    expect(markup).toContain("Коллега Имя");
    expect(markup).toContain("Принято");
  });
});
