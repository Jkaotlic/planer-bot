import { useState } from "react";
import { AdminScheduleScreen } from "./admin/AdminScheduleScreen";
import { AdminWeekendScreen } from "./admin/AdminWeekendScreen";
import { AdminEmployeesScreen } from "./admin/AdminEmployeesScreen";
import { AdminCollections } from "./admin/AdminCollections";
import { AdminAnnounce } from "./admin/AdminAnnounce";
import { AdminBugs } from "./admin/AdminBugs";
import { AdminJournal } from "./admin/AdminJournal";
import { AdminSettings } from "./admin/AdminSettings";
import { SectionChips, SectionPanel } from "../components/SectionChips";
import { toISODate } from "../lib/week";

export type AdminSection = "schedule" | "weekend" | "employees" | "collections" | "announce" | "bugs" | "journal" | "settings";

const SECTIONS: readonly { key: AdminSection; label: string }[] = [
  { key: "schedule", label: "Расписание" },
  { key: "weekend", label: "Выходные" },
  { key: "employees", label: "Работники" },
  { key: "collections", label: "Сборы" },
  { key: "announce", label: "Анонсы" },
  { key: "bugs", label: "Баги" },
  { key: "journal", label: "Журнал" },
  { key: "settings", label: "Настройки" },
];

/** Раздел, на котором открыться, если мини-апп запущен ссылкой из бота.
 *  Своя функция, а не `screenFromSearch`: та отвечает за формы-оверлеи
 *  (больничный, мероприятие), а это — про вкладку админа. Один параметр,
 *  но два разных вопроса к нему. */
export function adminSectionFromSearch(search: string): AdminSection | null {
  const value = new URLSearchParams(search).get("screen");
  return value === "announce" ? "announce" : null;
}

/**
 * The admin-only "Админ" tab: a scrolling chip row over the admin surfaces
 * (schedule / weekend marketplace / workers / collections / announcements /
 * journal / settings). Each sub-screen owns its own data-loading and
 * mutations — nothing is fetched until its section is first shown, so opening
 * the tab is cheap. Rendered only when `me.isAdmin` (see `App`), and every
 * call it makes is `requireAdmin`-guarded server-side.
 */
export function AdminScreen({ initialSection }: { initialSection?: AdminSection }) {
  const [section, setSection] = useState<AdminSection>(initialSection ?? "schedule");

  return (
    <div>
      <SectionChips sections={SECTIONS} active={section} onChange={setSection} />

      <SectionPanel active={section}>
        {section === "schedule" && <AdminScheduleScreen />}
        {section === "weekend" && <AdminWeekendScreen />}
        {section === "employees" && <AdminEmployeesScreen />}
        {section === "collections" && <AdminCollections />}
        {section === "announce" && <AdminAnnounce />}
        {section === "bugs" && <AdminBugs />}
        {section === "journal" && <AdminJournal today={toISODate(new Date())} />}
        {section === "settings" && <AdminSettings />}
      </SectionPanel>
    </div>
  );
}
