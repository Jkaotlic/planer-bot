import { Placeholder } from "@telegram-apps/telegram-ui";
import type { SwapRequest } from "../api/client";
import { ArchivedSwapCard, IncomingSwapCard, OutgoingSwapCard } from "../components/SwapRequestCard";
import { CollapsibleArchive } from "../components/CollapsibleArchive";
import { splitSwaps } from "../lib/swaps";
import { Group, Screen } from "../ui";

export interface SwapsScreenProps {
  swaps: SwapRequest[];
  onAccept: (id: number) => void;
  onDecline: (id: number) => void;
  onCancel: (id: number) => void;
  /** Ids of requests currently being mutated — each row disables only its own
   *  buttons while its own request is in flight, regardless of what else is tapped. */
  busyIds: ReadonlySet<number>;
  /**
   * Why a tap on this request failed, by request id — the answer belongs in the
   * card that was tapped. A single message above the list is off-screen for
   * every card the reader had to scroll to (замер: третья «Принять» на y=846
   * при окне 844). Cleared on the next attempt on that same card.
   */
  actionErrors: ReadonlyMap<number, string>;
}

/** "Обмены": what still needs an answer, split from what is already settled. */
export function SwapsScreen({ swaps, onAccept, onDecline, onCancel, busyIds, actionErrors }: SwapsScreenProps) {
  const { incoming, outgoing, archived } = splitSwaps(swaps);

  return (
    <Screen title="Обмены">
      <Group header="Входящие">
        {incoming.length === 0 ? (
          <Placeholder description="Пока нет заявок на обмен" />
        ) : (
          incoming.map((request) => (
            <IncomingSwapCard
              key={request.id}
              request={request}
              busy={busyIds.has(request.id)}
              error={actionErrors.get(request.id)}
              onAccept={() => onAccept(request.id)}
              onDecline={() => onDecline(request.id)}
            />
          ))
        )}
      </Group>

      <Group header="Мои заявки">
        {outgoing.length === 0 ? (
          <Placeholder description="Пока нет заявок на обмен" />
        ) : (
          outgoing.map((request) => (
            <OutgoingSwapCard
              key={request.id}
              request={request}
              busy={busyIds.has(request.id)}
              error={actionErrors.get(request.id)}
              onCancel={() => onCancel(request.id)}
            />
          ))
        )}
      </Group>

      {/* Тумблер, счётчик и «пустое не рисуем» переехали в `CollapsibleArchive`:
          те же три решения понадобились архиву работников и закрытым сборам, а
          три набранные вручную копии одного поведения разъезжаются. */}
      <CollapsibleArchive plain title="Архив" items={archived}>
        {(rows) => (
          <>
            {rows.map((request) => (
              <ArchivedSwapCard key={request.id} request={request} />
            ))}
          </>
        )}
      </CollapsibleArchive>
    </Screen>
  );
}
