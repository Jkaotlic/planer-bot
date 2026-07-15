import { useState } from "react";
import { SegmentedControl } from "@telegram-apps/telegram-ui";
import { AdminScheduleScreen } from "./admin/AdminScheduleScreen";
import { AdminWeekendScreen } from "./admin/AdminWeekendScreen";
import { AdminEmployeesScreen } from "./admin/AdminEmployeesScreen";

type AdminSection = "schedule" | "weekend" | "employees";

const SECTIONS: readonly { key: AdminSection; label: string }[] = [
  { key: "schedule", label: "Расписание" },
  { key: "weekend", label: "Выходные" },
  { key: "employees", label: "Работники" },
];

/**
 * The admin-only "Админ" tab: a segmented sub-nav over the three admin
 * surfaces (schedule / weekend marketplace / workers). Each sub-screen owns
 * its own data-loading and mutations — nothing is fetched until its section is
 * first shown, so opening the tab is cheap. Rendered only when `me.isAdmin`
 * (see `App`), and every call it makes is `requireAdmin`-guarded server-side.
 */
export function AdminScreen() {
  const [section, setSection] = useState<AdminSection>("schedule");

  return (
    <div>
      <div style={{ padding: "12px 16px 0" }}>
        <SegmentedControl>
          {SECTIONS.map(({ key, label }) => (
            <SegmentedControl.Item key={key} selected={section === key} onClick={() => setSection(key)}>
              {label}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
      </div>

      {section === "schedule" && <AdminScheduleScreen />}
      {section === "weekend" && <AdminWeekendScreen />}
      {section === "employees" && <AdminEmployeesScreen />}
    </div>
  );
}
