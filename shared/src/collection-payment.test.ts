import { describe, it, expect } from "vitest";
import { paymentProgress } from "./collection-payment";

const TEAM = [
  { employeeId: 1, displayName: "Аня" },
  { employeeId: 2, displayName: "Игорь" },
  { employeeId: 3, displayName: "Марк" },
];

describe("paymentProgress", () => {
  it("без отметок ждём всех", () => {
    const progress = paymentProgress(TEAM, []);
    expect(progress.paidCount).toBe(0);
    expect(progress.total).toBe(3);
    expect(progress.unpaid.map((r) => r.displayName)).toEqual(["Аня", "Игорь", "Марк"]);
    expect(progress.rows.every((r) => !r.paid)).toBe(true);
  });

  it("отметившиеся уходят из «ждём» и попадают в счёт", () => {
    const progress = paymentProgress(TEAM, [{ employeeId: 2, markedBy: 2 }]);
    expect(progress.paidCount).toBe(1);
    expect(progress.unpaid.map((r) => r.displayName)).toEqual(["Аня", "Марк"]);
    expect(progress.rows.find((r) => r.employeeId === 2)!.paid).toBe(true);
  });

  it("отметка админом за другого видна отдельно от своей", () => {
    const progress = paymentProgress(TEAM, [
      { employeeId: 1, markedBy: 1 },
      { employeeId: 3, markedBy: 1 },
    ]);
    expect(progress.rows.find((r) => r.employeeId === 1)!.markedByAdmin).toBe(false);
    expect(progress.rows.find((r) => r.employeeId === 3)!.markedByAdmin).toBe(true);
  });

  // Человека отметили, а потом деактивировали: он выпал из получателей, и его
  // отметка не должна давать «4 из 3».
  it("отметка того, кого уже нет среди получателей, не считается", () => {
    const progress = paymentProgress(TEAM, [
      { employeeId: 2, markedBy: 2 },
      { employeeId: 99, markedBy: 99 },
    ]);
    expect(progress.paidCount).toBe(1);
    expect(progress.total).toBe(3);
    expect(progress.rows).toHaveLength(3);
  });

  it("порядок строк — тот же, что у получателей", () => {
    const progress = paymentProgress(TEAM, [{ employeeId: 3, markedBy: 3 }]);
    expect(progress.rows.map((r) => r.displayName)).toEqual(["Аня", "Игорь", "Марк"]);
  });
});
