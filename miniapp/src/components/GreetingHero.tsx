export interface GreetingHeroProps {
  name: string;
  summary: string;
}

/** Gradient greeting card at the top of "Мои смены" — matches the approved mockup's hero. */
export function GreetingHero({ name, summary }: GreetingHeroProps) {
  return (
    <div
      style={{
        background:
          "linear-gradient(135deg, var(--tgui--accent_text_color), color-mix(in srgb, var(--tgui--accent_text_color) 70%, #7B4DE0))",
        color: "#fff",
        borderRadius: 16,
        padding: "15px 16px",
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 700 }}>Привет, {name} 👋</div>
      <div style={{ fontSize: 13.5, opacity: 0.92, marginTop: 3 }}>{summary}</div>
    </div>
  );
}
