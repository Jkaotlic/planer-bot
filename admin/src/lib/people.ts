/**
 * Опознание человека в списках консоли.
 *
 * Само правило — в `@planer/shared/person-identity`: одна палитра на обе
 * консоли, потому что один и тот же человек не может читаться разным цветом на
 * двух экранах. Здесь остался реэкспорт, чтобы у десятка импортов не поменялся
 * путь, и `pluralizeRu`, к людям отношения не имеющий, но живший тут же.
 */
export { initialsOf, personPalette, type PersonPalette } from "@planer/shared";

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
