import { describe, expect, it } from "vitest";
import { typeLabel } from "./JournalScreen";

/**
 * Every event type the server can write to `audit_log`, as of this test.
 *
 * Kept as a plain list rather than imported: the console and the Mini App each own
 * their label map, and the Mini App deliberately doesn't depend on `@planer/shared`
 * — so this list is mirrored in `miniapp/src/screens/admin/journal-labels.test.ts`.
 * Add a `recordAudit(...)` call on the server, add it here and in the mirror.
 *
 * Why it matters: `typeLabel` falls back to the raw type, so a missing entry doesn't
 * break anything visibly in code review — it just shows an admin `weekend_assigned`
 * in the middle of a Russian screen. Ten of these were live before this test.
 */
const EMITTED_TYPES = [
  "birthday_admin_notice",
  "birthday_schedule_notice",
  "birthday_sent",
  "distribution_applied",
  "employee_admin_changed",
  "employee_archived",
  "employee_reordered",
  "employee_restored",
  "employee_updated",
  "entry_created",
  "entry_deleted",
  "entry_updated",
  "roster_import",
  "swap_accepted",
  "swap_cancelled",
  "swap_declined",
  "swap_proposed",
  "template_roles_changed",
  "template_rotation_changed",
  "weekend_assigned",
  "weekend_slot_created",
] as const;

describe("typeLabel", () => {
  it("names every event the server records, in Russian", () => {
    const unlabelled = EMITTED_TYPES.filter((type) => typeLabel(type) === type);
    expect(unlabelled).toEqual([]);
  });

  it("keeps the raw type for an event it has never heard of, rather than hiding it", () => {
    expect(typeLabel("something_added_later")).toBe("something_added_later");
  });
});
