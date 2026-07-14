/** One or two initials from a full display name: "Аня Смирнова" -> "АС". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? "";
  return (first + second).toUpperCase();
}

export interface PersonPalette {
  readonly bg: string;
  readonly fg: string;
}

// Fixed, theme-independent avatar colors -- the same roster-slot swatches
// used for these positions in the approved product mockups (admin schedule
// grid + balance panel), so a person's color identity stays stable across
// light and dark rather than shifting with the theme.
const PALETTE: readonly PersonPalette[] = [
  { bg: "#3390EC", fg: "#FFFFFF" },
  { bg: "#E8890C", fg: "#FFFFFF" },
  { bg: "#2AA84F", fg: "#FFFFFF" },
  { bg: "#8A55E0", fg: "#FFFFFF" },
  { bg: "#0F9AA8", fg: "#FFFFFF" },
];

/** A stable color pair for a given employee id, so the same person always
 * reads as the same color across rows and days. */
export function personPalette(employeeId: number | null): PersonPalette {
  const id = employeeId ?? 1;
  const index = (((id - 1) % PALETTE.length) + PALETTE.length) % PALETTE.length;
  return PALETTE[index] ?? PALETTE[0]!;
}

/**
 * Russian plural form for a count: 1 -> one, 2-4 -> few, 5+ -> many
 * (with the standard 11-14 exception, which always takes `many`).
 * Mirrors miniapp/src/lib/shift.ts's helper of the same name.
 */
export function pluralizeRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
