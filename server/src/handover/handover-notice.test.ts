import { describe, it, expect } from "vitest";
import {
  handoverOfferText,
  handoverFanText,
  handoverTakenTextForTaker,
  handoverTakenTextForGiver,
  handoverTakenTextForAdmins,
  handoverEscalationText,
  handoverCancelledText,
} from "./handover-notice";

const LINE = "Ср 12 авг · 09:00–18:00 · День";

describe("what people read about a handover", () => {
  it("the offer names who fell out and what the shift is", () => {
    const text = handoverOfferText("Аня", LINE);
    expect(text).toContain("Аня");
    expect(text).toContain("09:00–18:00");
  });

  it("the fan-out asks the team without pretending it was addressed to one person", () => {
    const text = handoverFanText("Аня", LINE);
    expect(text).toContain(LINE);
    // «Тебе предложили» would be a lie in a broadcast — everybody got this.
    expect(text).not.toContain("тебе предложил");
  });

  it("the escalation letter names the refusals one by one", () => {
    const text = handoverEscalationText("Аня", LINE, ["Игорь", "Марк"], 5);
    expect(text).toContain("Игорь");
    expect(text).toContain("Марк");
    expect(text).toContain("5");
  });

  it("an escalation with nobody asked does not pretend there were refusals", () => {
    const text = handoverEscalationText("Аня", LINE, [], 0);
    expect(text).not.toContain("Отказались");
    expect(text).toContain("некому");
  });

  it("an escalation where everybody is silent does not print an empty refusal list", () => {
    const text = handoverEscalationText("Аня", LINE, [], 7);
    expect(text).not.toContain("Отказались");
    expect(text).toContain("7");
  });

  it("uses the genderless verb form the rest of the bot uses", () => {
    expect(handoverTakenTextForGiver("Игорь", LINE)).toContain("(а)");
    expect(handoverTakenTextForAdmins("Игорь", "Аня", LINE)).toContain("(а)");
  });

  it("tells the admins both names, not just the taker", () => {
    const text = handoverTakenTextForAdmins("Игорь", "Аня", LINE);
    expect(text).toContain("Игорь");
    expect(text).toContain("Аня");
  });

  it("confirms to the taker that the shift is theirs now", () => {
    expect(handoverTakenTextForTaker(LINE)).toContain(LINE);
  });

  it("the cancellation says the tap is no longer needed, not that something failed", () => {
    const text = handoverCancelledText("Аня", LINE);
    expect(text).toContain(LINE);
    expect(text).not.toContain("ошибк");
  });
});
