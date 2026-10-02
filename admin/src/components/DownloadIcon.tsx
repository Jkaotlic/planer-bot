// Один значок «выгрузить» на шапку расписания и журнал: эмодзи ⬇ рисовался
// шрифтом системы — у каждого браузера по-своему и не в цвет кнопки.
export function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />
    </svg>
  );
}
