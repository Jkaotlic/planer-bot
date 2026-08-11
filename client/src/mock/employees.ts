import type { AdminEmployeeDto, CreateEmployeeResponse, EmployeeInviteResponse } from "@planer/shared";
import { delay } from "./delay";

/**
 * Состояние мока — параметр, ровно по той же причине, что у домена `read`.
 *
 * Работников читают и пишут домены, которые ещё не переехали: отчёты, выходные,
 * сборы, дни рождения, — и все они держат тот же массив. Пока они живут во
 * фронте, массив принадлежит фронту, а пакет владеет формой ответа и правилами
 * правки. Массив приходит по ссылке, поэтому мутации остаются видны и моку
 * `read`, который читает тот же список.
 */
export interface EmployeesMockState {
  employees: AdminEmployeeDto[];
}

export interface EmployeesMockOptions {
  delayMs: number;
  state?: EmployeesMockState;
  /**
   * Как собрать ссылку-приглашение. Имя бота приходит из переменных сборки
   * фронта (`VITE_BOT_USERNAME`), а пакет про них знать не должен — иначе он
   * перестанет быть переносимым между двумя мордами.
   */
  inviteLinkFor?: (token: string) => string | null;
}

/** Проекция в чистый DTO: список полей один, как и на сервере. */
const toDto = (employee: AdminEmployeeDto): AdminEmployeeDto => ({
  id: employee.id,
  displayName: employee.displayName,
  preferredName: employee.preferredName,
  address: employee.address,
  isAdmin: employee.isAdmin,
  isActive: employee.isActive,
  telegramUserId: employee.telegramUserId,
  birthDate: employee.birthDate,
  excludedFromAssignment: employee.excludedFromAssignment,
  excludedFromSwaps: employee.excludedFromSwaps,
});

export function createEmployeesMock(opts: EmployeesMockOptions) {
  const { delayMs } = opts;
  const state = opts.state ?? seedEmployeesMockState();
  const inviteLinkFor = opts.inviteLinkFor ?? (() => null);
  const find = (id: number): AdminEmployeeDto | undefined =>
    state.employees.find((employee) => employee.id === id);

  return {
    async getAdminEmployees(): Promise<AdminEmployeeDto[]> {
      await delay(delayMs);
      return state.employees.map(toDto);
    },

    async createEmployee(displayName: string): Promise<CreateEmployeeResponse> {
      await delay(delayMs);
      const id = Math.max(0, ...state.employees.map((e) => e.id)) + 1;
      const employee: AdminEmployeeDto = {
        id,
        displayName,
        preferredName: null,
        address: displayName,
        isAdmin: false,
        isActive: true,
        telegramUserId: null,
        birthDate: null,
        excludedFromAssignment: false,
        excludedFromSwaps: false,
      };
      state.employees.push(employee);
      const inviteToken = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
      return { employee: toDto(employee), inviteToken, inviteLink: inviteLinkFor(inviteToken) };
    },

    async archiveEmployee(id: number): Promise<void> {
      await delay(delayMs);
      const employee = find(id);
      if (employee) employee.isActive = false;
    },

    async restoreEmployee(id: number): Promise<void> {
      await delay(delayMs);
      const employee = find(id);
      if (employee) employee.isActive = true;
    },

    async setEmployeeAdmin(id: number, isAdmin: boolean): Promise<void> {
      await delay(delayMs);
      const employee = find(id);
      if (employee) employee.isAdmin = isAdmin;
    },

    async renameEmployee(id: number, displayName: string): Promise<void> {
      await delay(delayMs);
      const employee = find(id);
      if (!employee) return;
      employee.displayName = displayName;
      // Повторяет `addressOf`: обращение перебивает ФИО, и переименование не
      // должно оставить на экране прежнее обращение.
      employee.address = employee.preferredName ?? displayName;
    },

    async setEmployeePreferredName(id: number, preferredName: string | null): Promise<void> {
      await delay(delayMs);
      const employee = find(id);
      if (!employee) return;
      employee.preferredName = preferredName?.trim() || null;
      employee.address = employee.preferredName ?? employee.displayName;
    },

    async setBirthDate(id: number, birthDate: string | null): Promise<void> {
      await delay(delayMs);
      const employee = find(id);
      if (employee) employee.birthDate = birthDate;
    },

    async setEmployeeRestrictions(
      id: number,
      patch: { excludedFromAssignment?: boolean; excludedFromSwaps?: boolean },
    ): Promise<void> {
      await delay(delayMs);
      const employee = find(id);
      if (!employee) return;
      if (patch.excludedFromAssignment !== undefined) employee.excludedFromAssignment = patch.excludedFromAssignment;
      if (patch.excludedFromSwaps !== undefined) employee.excludedFromSwaps = patch.excludedFromSwaps;
    },

    /** Как на сервере: переставить одного, затем перенумеровать всех подряд. */
    async reorderEmployee(id: number, position: number): Promise<AdminEmployeeDto[]> {
      await delay(delayMs);
      const active = state.employees.filter((e) => e.isActive);
      const from = active.findIndex((e) => e.id === id);
      if (from === -1) throw new Error("Работник не найден");
      const target = Math.min(Math.max(Math.trunc(position), 1), active.length) - 1;
      const [moved] = active.splice(from, 1);
      active.splice(target, 0, moved!);
      // Массив переписывается на месте, а не подменяется: на него держат ссылку
      // и мок `read`, и ещё не переехавшие домены фронта.
      const archived = state.employees.filter((e) => !e.isActive);
      state.employees.length = 0;
      state.employees.push(...active, ...archived);
      return active.map(toDto);
    },

    async getEmployeeInvite(id: number, regenerate = false): Promise<EmployeeInviteResponse> {
      await delay(delayMs);
      const inviteToken = `${id}-${regenerate ? "regen" : "keep"}`.padEnd(12, "0").slice(0, 12);
      return { inviteToken, inviteLink: inviteLinkFor(inviteToken) };
    },
  };
}

/**
 * Сид по умолчанию: те же трое, что у мока `read`.
 *
 * Он нужен, чтобы мок был запускаем и проверяем сам по себе, без фронта. Имена
 * вымышлены — репозиторий публичный.
 */
export function seedEmployeesMockState(): EmployeesMockState {
  return {
    employees: [
      {
        id: 1, displayName: "Аня", preferredName: "Аня", address: "Аня", isAdmin: true,
        isActive: true, telegramUserId: 555, birthDate: "03-14",
        excludedFromAssignment: false, excludedFromSwaps: false,
      },
      {
        id: 2, displayName: "Игорь", preferredName: null, address: "Игорь", isAdmin: false,
        isActive: true, telegramUserId: null, birthDate: null,
        excludedFromAssignment: false, excludedFromSwaps: false,
      },
      {
        id: 3, displayName: "Марк", preferredName: null, address: "Марк", isAdmin: false,
        isActive: false, telegramUserId: null, birthDate: null,
        excludedFromAssignment: true, excludedFromSwaps: true,
      },
    ],
  };
}
