import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SectionChips } from "./SectionChips";

type Section = "schedule" | "weekend" | "employees" | "birthdays" | "journal";

const SECTIONS: readonly { key: Section; label: string }[] = [
  { key: "schedule", label: "Расписание" },
  { key: "weekend", label: "Выходные" },
  { key: "employees", label: "Работники" },
  { key: "birthdays", label: "Дни рождения" },
  { key: "journal", label: "Журнал" },
];

describe("SectionChips", () => {
  it("renders all five sections, in order, as a tablist", () => {
    const markup = renderToStaticMarkup(
      createElement(SectionChips, { sections: SECTIONS, active: "schedule", onChange: () => undefined }),
    );

    expect(markup).toContain('role="tablist"');
    expect(markup.match(/role="tab"/g)).toHaveLength(5);
    for (const { label } of SECTIONS) {
      expect(markup).toContain(`>${label}<`);
    }
    // Order matters: the day-of a mis-ordered nav is exactly the kind of bug
    // this row exists to avoid — a tap that lands on the wrong section.
    const positions = SECTIONS.map(({ label }) => markup.indexOf(`>${label}<`));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("marks only the active section's chip as selected", () => {
    const markup = renderToStaticMarkup(
      createElement(SectionChips, { sections: SECTIONS, active: "birthdays", onChange: () => undefined }),
    );

    expect(markup.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(markup.match(/aria-selected="false"/g)).toHaveLength(4);
    // The selected chip is the birthdays one, not some other match: each
    // "<button …>label</button>" chunk is checked on its own.
    const buttons = markup.split("<button").slice(1);
    for (const button of buttons) {
      const isBirthdays = button.includes(">Дни рождения<");
      expect(button.includes('aria-selected="true"')).toBe(isBirthdays);
    }
  });
});
