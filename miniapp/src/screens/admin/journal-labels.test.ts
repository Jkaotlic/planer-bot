import { describe, expect, it } from "vitest";
import { typeLabel } from "./AdminJournal";

/**
 * Every event type the server can write to `audit_log`, as of this test.
 *
 * MIRRORS `admin/src/screens/journal-labels.test.ts`. Duplicated rather than
 * imported because this is a list of what the *server* writes, and `@planer/shared`
 * — which both consoles do depend on — doesn't carry it. Add a `recordAudit(...)`
 * call on the server, add it in both.
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
  "reminder_undeliverable",
  "roster_import",
  "swap_accepted",
  "swap_auto_cancelled",
  "swap_cancelled",
  "swap_declined",
  "swap_expired",
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
