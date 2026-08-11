/**
 * Задержка мока — параметр, а не константа.
 *
 * В `npm run dev` она делает экраны честными: видно спиннеры и гонки. В тестах она
 * ровно ноль — иначе гейт платит за сон реальными секундами (до этой правки:
 * 13.5 с на один файл).
 */
export const delay = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
