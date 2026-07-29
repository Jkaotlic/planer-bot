import { useState, type ReactNode } from "react";
import { Button, List, Placeholder, Section, Title } from "@telegram-apps/telegram-ui";
import type { SwapRequest } from "../api/client";
import { ArchivedSwapCard, IncomingSwapCard, OutgoingSwapCard } from "../components/SwapRequestCard";
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
  /** Set when the last accept/decline/cancel tap failed — cleared on the next attempt. */
  actionError: string | null;
}

/** "Обмены": what still needs an answer, split from what is already settled. */
export function SwapsScreen({ swaps, onAccept, onDecline, onCancel, busyIds, actionError }: SwapsScreenProps) {
  const { incoming, outgoing, archived } = splitSwaps(swaps);
  // Collapsed by default — the whole point is that finished swaps stop competing
  // for attention with the ones that still need something.
  const [archiveOpen, setArchiveOpen] = useState(false);

  return (
    <ScreenScroll>
      <header style={{ margin: "8px 4px 20px" }}>
        <Title level="2" weight="2">
          Обмены
        </Title>
      </header>

      {actionError && (
        <div style={{ margin: "0 4px 16px", color: "var(--tgui--destructive_text_color)", fontSize: 14 }}>{actionError}</div>
      )}

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
                  onCancel={() => onCancel(request.id)}
                />
              ))}
            </CardStack>
          )}
        </Section>

        {/* An empty archive draws nothing at all — an empty section would be one
            more thing to read past. */}
        {archived.length > 0 && (
          <Section header={`Архив · ${archived.length}`}>
            <CardStack>
              <Button size="s" mode="gray" stretched onClick={() => setArchiveOpen(!archiveOpen)}>
                {archiveOpen ? "Свернуть" : "Показать завершённые"}
              </Button>
              {archiveOpen && archived.map((request) => <ArchivedSwapCard key={request.id} request={request} />)}
            </CardStack>
          </Section>
        )}
      </List>
    </ScreenScroll>
  );
}

/** Vertically stacked cards with breathing room between them — wraps in a single
 * element so `Section` doesn't mistake the cards for separate rows needing dividers. */
function CardStack({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "10px 12px" }}>{children}</div>;
}
