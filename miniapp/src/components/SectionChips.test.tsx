import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  handleSectionChipsKeyDown,
  sectionForArrowKey,
  sectionPanelId,
  sectionTabId,
  SectionChips,
  SectionPanel,
} from "./SectionChips";

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

  it("gives every chip an aria-controls pointing at its own panel id", () => {
    const markup = renderToStaticMarkup(
      createElement(SectionChips, { sections: SECTIONS, active: "employees", onChange: () => undefined }),
    );

    const buttons = markup.split("<button").slice(1);
    expect(buttons).toHaveLength(5);
    for (const { key, label } of SECTIONS) {
      const button = buttons.find((chunk) => chunk.includes(`>${label}<`));
      expect(button).toContain(`id="${sectionTabId(key)}"`);
      expect(button).toContain(`aria-controls="${sectionPanelId(key)}"`);
    }
  });

  it("keeps roving tabIndex 0 on exactly the active chip, -1 on the rest", () => {
    const markup = renderToStaticMarkup(
      createElement(SectionChips, { sections: SECTIONS, active: "journal", onChange: () => undefined }),
    );

    const buttons = markup.split("<button").slice(1);
    for (const button of buttons) {
      const isJournal = button.includes(">Журнал<");
      expect(button.includes('tabindex="0"')).toBe(isJournal);
      expect(button.includes('tabindex="-1"')).toBe(!isJournal);
    }
  });
});

describe("SectionPanel", () => {
  it("renders a single tabpanel wired to the active chip, not one per section", () => {
    const markup = renderToStaticMarkup(
      createElement(
        SectionPanel,
        { active: "weekend" as Section },
        createElement("span", null, "Содержимое раздела"),
      ),
    );

    expect(markup.match(/role="tabpanel"/g)).toHaveLength(1);
    expect(markup).toContain(`id="${sectionPanelId("weekend")}"`);
    expect(markup).toContain(`aria-labelledby="${sectionTabId("weekend")}"`);
    expect(markup).toContain("Содержимое раздела");
  });
});

describe("sectionForArrowKey", () => {
  it("steps to the next section on ArrowRight and the previous on ArrowLeft", () => {
    expect(sectionForArrowKey(SECTIONS, "weekend", "ArrowRight")).toBe("employees");
    expect(sectionForArrowKey(SECTIONS, "employees", "ArrowLeft")).toBe("weekend");
  });

  it("wraps past the last section back to the first on ArrowRight", () => {
    expect(sectionForArrowKey(SECTIONS, "journal", "ArrowRight")).toBe("schedule");
  });

  it("wraps past the first section back to the last on ArrowLeft", () => {
    expect(sectionForArrowKey(SECTIONS, "schedule", "ArrowLeft")).toBe("journal");
  });

  it("ignores every key besides the two arrows", () => {
    expect(sectionForArrowKey(SECTIONS, "schedule", "ArrowUp")).toBeNull();
    expect(sectionForArrowKey(SECTIONS, "schedule", "Enter")).toBeNull();
    expect(sectionForArrowKey(SECTIONS, "schedule", " ")).toBeNull();
  });
});

describe("handleSectionChipsKeyDown", () => {
  it("prevents default, changes the section and moves focus to it on an arrow key", () => {
    let prevented = 0;
    const changed: Section[] = [];
    const focused: Section[] = [];
    const event = {
      key: "ArrowRight",
      preventDefault: () => {
        prevented += 1;
      },
    };

    const handled = handleSectionChipsKeyDown<Section>(
      event,
      "schedule",
      SECTIONS,
      (key) => changed.push(key),
      (key) => focused.push(key),
    );

    expect(handled).toBe(true);
    expect(prevented).toBe(1);
    expect(changed).toEqual(["weekend"]);
    expect(focused).toEqual(["weekend"]);
  });

  it("does nothing on a non-arrow key — no preventDefault, no change, no focus move", () => {
    let prevented = 0;
    const changed: Section[] = [];
    const focused: Section[] = [];
    const event = {
      key: "Tab",
      preventDefault: () => {
        prevented += 1;
      },
    };

    const handled = handleSectionChipsKeyDown<Section>(
      event,
      "schedule",
      SECTIONS,
      (key) => changed.push(key),
      (key) => focused.push(key),
    );

    expect(handled).toBe(false);
    expect(prevented).toBe(0);
    expect(changed).toEqual([]);
    expect(focused).toEqual([]);
  });
});
