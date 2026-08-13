import { type ReactNode } from "react";
import { List, Placeholder, Section, Title } from "@telegram-apps/telegram-ui";
import type { SwapRequest } from "../api/client";
import { ArchivedSwapCard, IncomingSwapCard, OutgoingSwapCard } from "../components/SwapRequestCard";
import { CollapsibleArchive } from "../components/CollapsibleArchive";
import { ScreenScroll } from "../components/ScreenScroll";
import { splitSwaps } from "../lib/swaps";

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
    <ScreenScroll>
      <header style={{ margin: "8px 4px 20px" }}>
        <Title level="2" weight="2">
          Обмены
        </Title>
      </header>

      <List>
        <Section header="Входящие">
          {incoming.length === 0 ? (
            <Placeholder description="Пока нет заявок на обмен" />
          ) : (
            <CardStack>
              {incoming.map((request) => (
                <IncomingSwapCard
                  key={request.id}
                  request={request}
                  busy={busyIds.has(request.id)}
                  error={actionErrors.get(request.id)}
                  onAccept={() => onAccept(request.id)}
                  onDecline={() => onDecline(request.id)}
                />
              ))}
            </CardStack>
          )}
        </Section>

        <Section header="Мои заявки">
          {outgoing.length === 0 ? (
            <Placeholder description="Пока нет заявок на обмен" />
          ) : (
            <CardStack>
              {outgoing.map((request) => (
                <OutgoingSwapCard
                  key={request.id}
                  request={request}
                  busy={busyIds.has(request.id)}
                  error={actionErrors.get(request.id)}
                  onCancel={() => onCancel(request.id)}
                />
              ))}
            </CardStack>
          )}
        </Section>

        {/* Тумблер, счётчик и «пустое не рисуем» переехали в `CollapsibleArchive`:
            те же три решения понадобились архиву работников и закрытым сборам, а
            три набранные вручную копии одного поведения разъезжаются. */}
        <CollapsibleArchive title="Архив" items={archived}>
          {(rows) => (
            <CardStack>
              {rows.map((request) => (
                <ArchivedSwapCard key={request.id} request={request} />
              ))}
            </CardStack>
          )}
        </CollapsibleArchive>
      </List>
    </ScreenScroll>
  );
}

/** Vertically stacked cards with breathing room between them — wraps in a single
 * element so `Section` doesn't mistake the cards for separate rows needing dividers. */
function CardStack({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "10px 12px" }}>{children}</div>;
}
