import { Cell, List, Section, Title } from "@telegram-apps/telegram-ui";

interface SampleShift {
  id: string;
  text: string;
}

// Purely illustrative — proves the SDK + UI kit + theming render natively.
// No backend calls yet (see project plan for the next tasks).
const SAMPLE_SHIFTS: SampleShift[] = [
  { id: "mon", text: "Пн 1 июл · 08:00–17:00 · Утро" },
  { id: "wed", text: "Ср 3 июл · 12:00–21:00 · День" },
  { id: "fri", text: "Пт 5 июл · 17:00–23:00 · Вечер" },
];

export function App() {
  return (
    <div style={{ padding: "16px 16px 24px" }}>
      <Title level="1" weight="2" style={{ margin: "8px 4px 16px" }}>
        Смены
      </Title>
      <List>
        <Section footer="Заглушка интерфейса: данные пока не подключены к серверу.">
          {SAMPLE_SHIFTS.map((shift) => (
            <Cell key={shift.id}>{shift.text}</Cell>
          ))}
        </Section>
      </List>
    </div>
  );
}
