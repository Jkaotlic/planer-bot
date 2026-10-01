import { lazy, Suspense } from "react";
import { Screen } from "../ui";
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
export interface CollectionsTabScreenProps {
  isAdmin: boolean;
  /** Командная дата из bootstrap — для админской ветки; работнику она не
   *  нужна, `TeamCollections` её не берёт. */
  today: string;
  /** Только для работника — у админа своя отметка «Я перевёл» этому экрану
   *  не показывается, и метки на «Сборах» у него вовсе нет (см. `tabBadges`). */
  onPaidChanged?: (id: number, paid: boolean) => void;
}

export function CollectionsTabScreen({ isAdmin, today, onPaidChanged }: CollectionsTabScreenProps) {
  // Заголовок «Сборы» один на обе роли: у админа экран раньше начинался сразу
  // с карточек, и вкладка выглядела безымянной.
  if (isAdmin) {
    // Не `Screen`: `AdminCollections` приносит свой `ScreenScroll` с боковым
    // отступом и резервом под таб-бар, и в обёртке они удваивались. Пока
    // админские вкладки не переделаны, заголовок рисуем тем же классом, а поля
    // и низ оставляем самому экрану.
    return (
      <>
        <div style={{ padding: "16px var(--app-gutter) 0" }}>
          <header className="ui-screen__header">
            <h1 className="ui-screen__title">Сборы</h1>
          </header>
        </div>
        <Suspense fallback={<div style={{ padding: 16, color: "var(--tgui--hint_color)" }}>Загружаю сборы…</div>}>
          <AdminCollections today={today} />
        </Suspense>
      </>
    );
  }

  return (
    <Screen title="Сборы">
      {/* Секция во вкладке «Команда» умела исчезать целиком, когда сборов нет.
          Отдельная вкладка исчезнуть не может, и пустой экран без слов читался
          бы как «не загрузилось». */}
      <TeamCollections
        emptyLabel="Сейчас сборов нет. Когда админ разошлёт новый — он появится здесь."
        onPaidChanged={onPaidChanged}
      />
    </Screen>
  );
}
