import type { StartTab } from "@planer/shared";
import type { Me } from "../api/client";
import { AddressField } from "../components/AddressField";
import { CalendarSection } from "../components/CalendarSection";
import { RemindersSwitch } from "../components/RemindersSwitch";
import { SelfScheduleSwitch } from "../components/SelfScheduleSwitch";
import { StartTabPicker } from "../components/StartTabPicker";
import { Card, Group, Screen } from "../ui";

export interface SettingsScreenProps {
  me: Me;
  onClose: () => void;
  onRemindersChanged: (enabled: boolean) => void;
  onStartTabChanged: (tab: StartTab | null) => void;
  onSelfScheduleChanged: (enabled: boolean) => void;
  onAddressChanged: (next: { preferredName: string | null; address: string }) => void;
}

/**
 * Личные настройки работника. До 2026-10 все четыре блока лежали на «Сменах»
 * под списком смен: экран, который открывают ради «когда я работаю», тянулся
 * на три высоты телефона. Блоки переехали как есть — здесь меняется только
 * место; данные по-прежнему живут в `App`, поэтому новое обращение видно в
 * приветствии сразу после возврата.
 */
export function SettingsScreen({
  me,
  onClose,
  onRemindersChanged,
  onStartTabChanged,
  onSelfScheduleChanged,
  onAddressChanged,
}: SettingsScreenProps) {
  return (
    <Screen title="Настройки" onBack={onClose}>
      <Group header="Уведомления">
        <Card flush>
          {/* Каждый блок — в своём `div`: эти компоненты возвращают фрагмент
              (ячейка + строка ошибки), а разделитель `Card flush` ставится между
              прямыми детьми DOM — без обёртки линия легла бы между ячейкой и её
              же ошибкой, а в «Календаре» — между каждой строкой раздела. */}
          <div>
            <RemindersSwitch enabled={me.remindersEnabled} onChanged={onRemindersChanged} />
          </div>
        </Card>
      </Group>

      <Group header="Запуск">
        <Card flush>
          <div>
            <StartTabPicker me={me} onChanged={onStartTabChanged} />
          </div>
          {/* Только наблюдателю: остальным тумблер ничего не включает. */}
          {me.isObserver && (
            <div>
              <SelfScheduleSwitch enabled={me.selfScheduleEnabled} onChanged={onSelfScheduleChanged} />
            </div>
          )}
        </Card>
      </Group>

      <Group header="Календарь">
        <Card flush>
          {/* Верхний отступ: `Card flush` без поля, а первая кнопка раздела иначе липнет к краю. */}
          <div style={{ paddingTop: 10 }}>
            <CalendarSection />
          </div>
        </Card>
      </Group>

      <Group header="Обращение">
        <Card flush>
          <AddressField preferredName={me.preferredName} address={me.address} onSaved={onAddressChanged} />
        </Card>
      </Group>
    </Screen>
  );
}
