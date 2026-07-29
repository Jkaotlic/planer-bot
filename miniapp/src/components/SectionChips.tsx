import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

/**
 * The admin tab's sub-navigation.
 *
 * Replaces a `SegmentedControl`, which could not carry five items: at four,
 * «Расписание» already rendered as «Расписа…», which is what the `.admin-sections`
 * padding hack in `index.css` existed to fight. A scrolling row of chips fits
 * five, and the sixth whenever it turns up.
 *
 * Always scrollable — it does not try to detect overflow and switch behaviour,
 * because the width it would measure depends on the phone, the font and the
 * label, and guessing wrong means a section nobody can reach.
 *
 * Same `tablist`/`tab`/`tabpanel` contract as `TeamViewSwitcher` — one pattern
 * for every tab-like control in the app, rather than a second one invented
 * here. Pair with `SectionPanel` for the panel half of the contract.
 */

/** DOM id of a section's own tab button. */
export function sectionTabId(key: string): string {
  return `section-chip-tab-${key}`;
}

/** DOM id of the panel a section's tab button controls. */
export function sectionPanelId(key: string): string {
  return `section-chip-panel-${key}`;
}

/**
 * The neighbouring section for an arrow key, wrapping at both ends: past the
 * last chip, `ArrowRight` lands back on the first; before the first,
 * `ArrowLeft` lands on the last. Wrapping (rather than stopping dead at an
 * edge) is the WAI-ARIA tablist pattern's own choice, and it keeps both ends
 * of the row behaving the same way instead of one edge being a dead keypress
 * and the other wrapping.
 */
export function sectionForArrowKey<K extends string>(
  sections: readonly { key: K; label: string }[],
  current: K,
  key: string,
): K | null {
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  const index = sections.findIndex((section) => section.key === current);
  if (index === -1) return null;
  const step = key === "ArrowRight" ? 1 : -1;
  const next = (index + step + sections.length) % sections.length;
  return sections[next]!.key;
}

interface SectionChipsKeyEvent {
  key: string;
  preventDefault(): void;
}

export function handleSectionChipsKeyDown<K extends string>(
  event: SectionChipsKeyEvent,
  current: K,
  sections: readonly { key: K; label: string }[],
  onChange: (key: K) => void,
  focus: (key: K) => void,
): boolean {
  const next = sectionForArrowKey(sections, current, event.key);
  if (!next) return false;
  event.preventDefault();
  onChange(next);
  focus(next);
  return true;
}

export function SectionChips<K extends string>({
  sections,
  active,
  onChange,
}: {
  sections: readonly { key: K; label: string }[];
  active: K;
  onChange: (key: K) => void;
}) {
  const chips = useRef<Partial<Record<K, HTMLButtonElement>>>({});

  useEffect(() => {
    // Without this, picking a section whose chip sits off-screen leaves the
    // selection invisible — you tap and nothing appears to happen.
    chips.current[active]?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [active]);

  function focus(key: K) {
    chips.current[key]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="Разделы админки"
      style={{
        display: "flex",
        gap: 6,
        overflowX: "auto",
        scrollSnapType: "x proximity",
        scrollbarWidth: "none",
        padding: "12px 16px 2px",
        margin: 0,
      }}
    >
      {sections.map(({ key, label }) => {
        const selected = key === active;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            id={sectionTabId(key)}
            aria-selected={selected}
            // Points at the panel for *this* chip's section, which only exists
            // in the DOM while that section is the active one — `AdminScreen`
            // mounts one sub-screen at a time on purpose, and a real panel per
            // chip would defeat that. See `SectionPanel`.
            aria-controls={sectionPanelId(key)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(key)}
            onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
              handleSectionChipsKeyDown(event, key, sections, onChange, focus);
            }}
            ref={(element) => {
              if (element) chips.current[key] = element;
              else delete chips.current[key];
            }}
            style={{
              flex: "none",
              scrollSnapAlign: "center",
              minHeight: 34,
              border: 0,
              borderRadius: 999,
              padding: "0 14px",
              font: "inherit",
              fontSize: 13.5,
              fontWeight: selected ? 600 : 500,
              whiteSpace: "nowrap",
              cursor: "pointer",
              color: selected ? "var(--tgui--button_text_color)" : "var(--tgui--text_color)",
              background: selected ? "var(--tgui--button_color)" : "var(--tgui--secondary_bg_color)",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The `tabpanel` half of the `SectionChips` contract, wrapped around whichever
 * sub-screen is currently mounted. Deliberately takes only the active key, not
 * the whole section list: `AdminScreen` renders exactly one sub-screen at a
 * time (see its own docstring — that's what keeps opening the tab cheap), so
 * there is only ever one panel to wrap, never five.
 */
export function SectionPanel<K extends string>({
  active,
  children,
}: {
  active: K;
  children?: ReactNode;
}) {
  return (
    <div role="tabpanel" id={sectionPanelId(active)} aria-labelledby={sectionTabId(active)}>
      {children}
    </div>
  );
}
