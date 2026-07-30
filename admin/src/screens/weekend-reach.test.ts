import { describe, it, expect } from "vitest";
import { reachNotice } from "./WeekendAdminScreen";

/**
 * Mirrored in miniapp/src/screens/admin/weekend-reach.test.ts — the two consoles
 * own their own copy of this sentence, as they do everywhere else.
 */
describe("reachNotice", () => {
  it("says the whole team was asked when everybody could be reached", () => {
    expect(reachNotice(28, 28)).toBe("Смена открыта — спросили всю команду (28).");
  });

  // The case the finding was about: nine linked out of twenty-eight, and the
  // admin had no way of knowing they'd asked a third of the team.
  it("names both numbers when the broadcast only reached part of the team", () => {
    expect(reachNotice(9, 28)).toBe(
      "Смена открыта, но уведомление дошло до 9 из 28: остальные ещё не подключили телеграм.",
    );
  });
});
