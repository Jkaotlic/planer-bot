/**
 * Как имя совпадает с тем, что набрали в поиске.
 *
 * Одно место на всю систему намеренно: правило живёт на семи экранах двух
 * фронтов, и семь похожих копий разъехались бы — «Семён» находился бы по
 * «семен» в консоли и не находился бы в мини-аппе.
 */

export interface SearchablePerson {
  displayName: string;
  /** Как человек попросил себя называть. Необязателен: у `AnnouncementRecipient`
   *  этого поля нет вовсе, и требовать его значило бы разводить заглушки. */
  preferredName?: string | null;
}

/** Больше пяти. На трёх строках поле поиска — лишняя строка, которая занимает
 *  место и ничего не экономит. */
export const PERSON_SEARCH_THRESHOLD = 5;

export function shouldShowPersonSearch(count: number): boolean {
  return count > PERSON_SEARCH_THRESHOLD;
}

/** «Ё» приравнивается к «е»: в ростере она есть, на клавиатуре её не набирают. */
function norm(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е");
}

/**
 * Каждое слово запроса должно найтись подстрокой — не с начала слова: люди
 * ищут по куску фамилии («ванов»), и поиск, который так не умеет, читается как
 * сломанный. Слова независимы, поэтому «ан ив» и «ив ан» — один и тот же запрос.
 */
export function matchesPerson(person: SearchablePerson, query: string): boolean {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = norm(`${person.displayName} ${person.preferredName ?? ""}`);
  return words.every((word) => haystack.includes(word));
}

/** Порядок — решение экрана, а не поиска: фильтр ничего не пересортировывает. */
export function filterPeople<T extends SearchablePerson>(people: readonly T[], query: string): T[] {
  return people.filter((person) => matchesPerson(person, query));
}
