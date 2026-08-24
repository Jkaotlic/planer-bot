import { lazy, Suspense } from "react";
import { Title } from "@telegram-apps/telegram-ui";
import { ScreenScroll, TAB_BAR_CLEARANCE } from "../components/ScreenScroll";
import { TeamCollections } from "./team/TeamCollections";

/**
 * Админский экран сборов — отдельным куском: работнику его 40 КБ не нужны
 * никогда, а мини-апп открывают с телефона через облачный релей, где каждый
 * килобайт основного бандла платят все. Тот же приём, что у вкладки «Админ».
 */
const AdminCollections = lazy(() => import("./admin/AdminCollections"));

/**
 * Вкладка «Сборы».
 *
 * У работника — идущие сборы, у админа — тот же экран, которым он их ведёт.
 * Одно место вместо двух: сбор жил секцией во вкладке «Команда» и разделом в
 * админке, и на вопрос «где посмотреть сбор» было два разных ответа в
 * зависимости от роли.
 */
export function CollectionsTabScreen({ isAdmin }: { isAdmin: boolean }) {
  if (isAdmin) {
    return (
      <Suspense fallback={<div style={{ padding: 16, color: "var(--tgui--hint_color)" }}>Загружаю сборы…</div>}>
        <AdminCollections />
      </Suspense>
    );
  }

  return (
    <ScreenScroll style={{ padding: `16px 12px ${TAB_BAR_CLEARANCE}` }}>
      <Title level="2" weight="2">
        Сборы
      </Title>
      {/* Секция во вкладке «Команда» умела исчезать целиком, когда сборов нет.
          Отдельная вкладка исчезнуть не может, и пустой экран без слов читался
          бы как «не загрузилось». */}
      <TeamCollections emptyLabel="Сейчас сборов нет. Когда админ разошлёт новый — он появится здесь." />
    </ScreenScroll>
  );
}
