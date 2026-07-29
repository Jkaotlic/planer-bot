import { useEffect, useRef } from "react";

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
 */
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
            aria-selected={selected}
            onClick={() => onChange(key)}
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
