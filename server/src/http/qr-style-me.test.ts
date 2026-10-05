import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setQrStyle } from "../repo/employees";
import { issueToken } from "../auth/jwt";
import { testConfig } from "../test-config";

const config = testConfig();

describe("GET /api/me — QR style", () => {
  it("gives the default until the person picks one, then what they picked", async () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня", inviteToken: "inv-333" });
    linkTelegramAccount(db, "inv-333", 333);
    const app = createApp({ db, config });
    const auth = { headers: { Authorization: `Bearer ${await issueToken({ employeeId: anya.id, isAdmin: false }, config.jwtSecret)}` } };

    expect((await (await app.request("/api/me", auth)).json()).qrStyle).toEqual({ shape: "classic", color: "black" });
    setQrStyle(db, anya.id, { shape: "rounded", color: "purple" });
    expect((await (await app.request("/api/me", auth)).json()).qrStyle).toEqual({ shape: "rounded", color: "purple" });
  });
});
