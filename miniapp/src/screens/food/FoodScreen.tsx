import { useEffect, useState } from "react";
import { Button, Title } from "@telegram-apps/telegram-ui";
import { apiClient, type PollView } from "../../api/client";
import { CardStack } from "../../components/Card";
import { ScreenScroll } from "../../components/ScreenScroll";
import type { FoodRoute } from "./food-route";
import { PollCard } from "./PollCard";
import { PollForm } from "./PollForm";

/**
 * Экран «Заказы и опросы» — оверлей поверх вкладок, а не новая вкладка: в
 * таб-баре уже семь мест, а сюда приходят из бота по ссылке с `?screen=orders`.
 */
export function FoodScreen({ initial, onClose }: { initial: FoodRoute; onClose(): void }) {
  const [route, setRoute] = useState<FoodRoute>(initial);
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

  return (
    <ScreenScroll>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Title level="2" weight="2">Заказы и опросы</Title>
        <Button size="s" mode="plain" onClick={onClose}>Закрыть</Button>
      </div>
      <div style={{ display: "flex", gap: 8, padding: "8px 0" }}>
        <Button size="s" mode="bezeled" onClick={() => setRoute({ view: "new-poll" })}>🗳 Новый опрос</Button>
      </div>
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
