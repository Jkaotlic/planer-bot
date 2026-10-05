import { Group, Hint, MenuRow, Screen } from "../../ui";

/**
 * «Сервисы» — список инструментов команды. Оверлей, а не вкладка: в таб-баре уже
 * семь мест, а сюда потом ложатся новые инструменты, не трогая ни таб-бар, ни «Смены».
 */
export function ServicesScreen({ onOpenFood, onOpenQr, onClose }: { onOpenFood(): void; onOpenQr(): void; onClose(): void }) {
  return (
    <Screen title="Сервисы" onBack={onClose}>
      <Group>
        <MenuRow icon="🍱" title="Заказы и опросы" hint="Скинуться на еду, проголосовать" onClick={onOpenFood} />
        <MenuRow icon="🔳" title="QR-код" hint="Из любой ссылки или текста — с подписью" onClick={onOpenQr} />
      </Group>
      <Hint>Это же меню — кнопкой «🧰 Сервисы» в боте.</Hint>
    </Screen>
  );
}
