import { describe, it, expect } from "vitest";
import { recipientGroupInputSchema, recipientGroupPatchSchema } from "./recipient-group";

describe("recipientGroupInputSchema", () => {
  it("обрезает имя, убирает повторы id", () => {
    expect(recipientGroupInputSchema.parse({ name: "  ЧИП 5-й этаж ", memberIds: [3, 1, 3] }))
      .toEqual({ name: "ЧИП 5-й этаж", memberIds: [3, 1] });
  });
  it("пустая группа допустима — людей добавят потом", () => {
    expect(recipientGroupInputSchema.safeParse({ name: "ЧИП 32 этаж", memberIds: [] }).success).toBe(true);
  });
  it("отвергает пустое и длинное имя, 201 человека, не-целые id", () => {
    expect(recipientGroupInputSchema.safeParse({ name: " ", memberIds: [] }).success).toBe(false);
    expect(recipientGroupInputSchema.safeParse({ name: "я".repeat(41), memberIds: [] }).success).toBe(false);
    expect(recipientGroupInputSchema.safeParse({ name: "X", memberIds: Array.from({ length: 201 }, (_, i) => i + 1) }).success).toBe(false);
    expect(recipientGroupInputSchema.safeParse({ name: "X", memberIds: [1.5] }).success).toBe(false);
  });
});

describe("recipientGroupPatchSchema", () => {
  it("хотя бы одно поле", () => {
    expect(recipientGroupPatchSchema.safeParse({}).success).toBe(false);
    expect(recipientGroupPatchSchema.parse({ name: " Новое " })).toEqual({ name: "Новое" });
    expect(recipientGroupPatchSchema.parse({ memberIds: [2, 2] })).toEqual({ memberIds: [2] });
  });
});
