import { describe, it, expect } from "vitest";
import { SWAP_REJECT_REASONS } from "@planer/shared";
import { SWAP_ERROR_MESSAGES } from "./ProposeSwapScreen";

describe("подписи причин отказа", () => {
  // Сырой код на экране — дефект, который в этом проекте уже ловили. Тест
  // перебирает рантайм-массив причин, поэтому новая причина без подписи
  // валит его, а не тихо доезжает до человека строкой «from-excluded».
  it("у каждой причины отказа есть русская фраза", () => {
    const missing = SWAP_REJECT_REASONS.filter((reason) => !SWAP_ERROR_MESSAGES[reason]);
    expect(missing).toEqual([]);
  });
});
