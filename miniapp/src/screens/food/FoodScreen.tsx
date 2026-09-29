import { useEffect, useState } from "react";
import { Button, Title } from "@telegram-apps/telegram-ui";
import { apiClient, type PlaceView, type PollView } from "../../api/client";
import { CardShell, CardStack } from "../../components/Card";
import { ConfirmButton } from "../../components/ConfirmButton";
import { ScreenScroll } from "../../components/ScreenScroll";
import type { FoodRoute } from "./food-route";
import { PlaceEditor } from "./PlaceEditor";
import { PollCard } from "./PollCard";
import { PollForm } from "./PollForm";

/** Пока не готово (Задача 14): сам заказ. Ссылка на него из бота уже
 *  существует («🍱 Новый заказ»), а экрана — ещё нет; без этой проверки
 *  кнопка открывала оверлей, вечно висящий на «Загружаю…» — `useEffect` ниже
 *  выходит рано для всего, что не «list». Места (Задача 8) уже готовы и в
 *  этот список не входят. */
function isNotYetReady(route: FoodRoute): boolean {
  return route.view === "new-order" || route.view === "order";
}

/**
 * Экран «Заказы и опросы» — оверлей поверх вкладок, а не новая вкладка: в
 * таб-баре уже семь мест, а сюда приходят из бота по ссылке с `?screen=orders`.
 */
export function FoodScreen({ initial, onClose }: { initial: FoodRoute; onClose(): void }) {
  // Замер один раз, от НАЧАЛЬНОГО маршрута: переход «Новый опрос» → «Назад»
  // не должен внезапно показать подсказку про заказы, которых человек не просил.
  const [notYetReadyHint] = useState(() => isNotYetReady(initial));
  const [route, setRoute] = useState<FoodRoute>(isNotYetReady(initial) ? { view: "list" } : initial);
  const [polls, setPolls] = useState<PollView[] | null | "error">(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (route.view !== "list") return;
    let alive = true;
    setPolls(null);
    apiClient.getPolls().then((p) => { if (alive) setPolls(p); }).catch(() => { if (alive) setPolls("error"); });
    return () => { alive = false; };
  }, [route, attempt]);

  const toList = () => setRoute({ view: "list" });
  if (route.view === "new-poll") return <PollForm onDone={toList} onCancel={toList} />;
  if (route.view === "places") return <PlacesScreen onBack={toList} />;

  return (
    <ScreenScroll>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Title level="2" weight="2">Заказы и опросы</Title>
        <Button size="s" mode="plain" onClick={onClose}>Закрыть</Button>
      </div>
      <div style={{ display: "flex", gap: 8, padding: "8px 0", flexWrap: "wrap" }}>
        <Button size="s" mode="bezeled" onClick={() => setRoute({ view: "new-poll" })}>🗳 Новый опрос</Button>
        <Button size="s" mode="bezeled" onClick={() => setRoute({ view: "places" })}>🍴 Места и меню</Button>
      </div>
      {notYetReadyHint && (
        <div style={{ color: "var(--tgui--hint_color)", fontSize: 13, paddingBottom: 8 }}>
          Заказы еды появятся в следующем обновлении.
        </div>
      )}
      {polls === null && <div style={{ color: "var(--tgui--hint_color)" }}>Загружаю…</div>}
      {polls === "error" && (
        <div>Не удалось загрузить. <Button size="s" mode="plain" onClick={() => setAttempt((n) => n + 1)}>Повторить</Button></div>
      )}
      {Array.isArray(polls) && polls.length === 0 && <div style={{ color: "var(--tgui--hint_color)" }}>Пока ничего не запускали.</div>}
      {Array.isArray(polls) && polls.length > 0 && (
        <CardStack>{polls.map((p) => <PollCard key={p.id} poll={p} />)}</CardStack>
      )}
    </ScreenScroll>
  );
}

type PlacesView = { mode: "list" } | { mode: "editor"; place: PlaceView | null };

/**
 * Список мест с меню и их правка — своя загрузка, отдельная от опросов:
 * место общее для всей команды и не связано со сроком закрытия опроса.
 */
function PlacesScreen({ onBack }: { onBack(): void }) {
  const [view, setView] = useState<PlacesView>({ mode: "list" });
  const [places, setPlaces] = useState<PlaceView[] | null | "error">(null);
  const [attempt, setAttempt] = useState(0);
  // Кто именно архивируется — а не общий флаг: иначе тап «Удалить» на одной
  // карточке гасил бы кнопки у всех остальных мест в списке.
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    if (view.mode !== "list") return;
    let alive = true;
    setPlaces(null);
    apiClient.getFoodPlaces().then((p) => { if (alive) setPlaces(p); }).catch(() => { if (alive) setPlaces("error"); });
    return () => { alive = false; };
  }, [view, attempt]);

  if (view.mode === "editor") {
    return (
      <PlaceEditor
        place={view.place}
        onCancel={() => setView({ mode: "list" })}
        onSaved={() => { setView({ mode: "list" }); setAttempt((n) => n + 1); }}
      />
    );
  }

  async function archive(id: number) {
    setBusyId(id);
    try {
      await apiClient.archiveFoodPlace(id);
      setAttempt((n) => n + 1);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ScreenScroll>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Title level="2" weight="2">Места и меню</Title>
        <Button size="s" mode="plain" onClick={onBack}>Назад</Button>
      </div>
      <div style={{ padding: "8px 0" }}>
        <Button size="s" mode="bezeled" onClick={() => setView({ mode: "editor", place: null })}>+ Место</Button>
      </div>
      {places === null && <div style={{ color: "var(--tgui--hint_color)" }}>Загружаю…</div>}
      {places === "error" && (
        <div>Не удалось загрузить. <Button size="s" mode="plain" onClick={() => setAttempt((n) => n + 1)}>Повторить</Button></div>
      )}
      {Array.isArray(places) && places.length === 0 && <div style={{ color: "var(--tgui--hint_color)" }}>Мест ещё нет.</div>}
      {Array.isArray(places) && places.length > 0 && (
        <CardStack>
          {places.map((p) => (
            <CardShell key={p.id}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>🍴 {p.name}</div>
              <div style={{ color: "var(--tgui--hint_color)", fontSize: 13 }}>
                {p.menu.length > 0 ? p.menu.map((m) => `${m.name} — ${m.price} ₽`).join(", ") : "Меню пусто"}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button size="s" mode="bezeled" onClick={() => setView({ mode: "editor", place: p })}>Изменить</Button>
                <ConfirmButton label="Удалить" question={`Удалить «${p.name}»?`} confirmLabel="Удалить"
                  onConfirm={() => archive(p.id)} disabled={busyId === p.id} loading={busyId === p.id} />
              </div>
            </CardShell>
          ))}
        </CardStack>
      )}
    </ScreenScroll>
  );
}
