import { ADMIN_MENU, type AdminSection } from "../admin-section";
import { Card, Group, MenuRow } from "../../ui";

/** Все разделы админки одним списком. Заменил ленту чипов: в ней половина
 *  разделов была за краем экрана, и «Журнал» с «Настройками» искали прокруткой. */
export function AdminMenu({ onOpen }: { onOpen: (section: AdminSection) => void }) {
  return (
    <>
      {ADMIN_MENU.map((group) => (
        <Group key={group.header} header={group.header}>
          <Card flush>
            {group.items.map((item) => (
              <MenuRow key={item.key} icon={item.icon} title={item.title} hint={item.hint} onClick={() => onOpen(item.key)} />
            ))}
          </Card>
        </Group>
      ))}
    </>
  );
}
