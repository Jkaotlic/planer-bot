import type {
  AdminEmployeeDto,
  AdminEmployeesResponse,
  CreateEmployeeResponse,
  EmployeeInviteResponse,
} from "@planer/shared";
import type { Transport } from "./core";

/** Что можно поменять у работника одним PATCH'ем. */
export interface EmployeeRestrictionsPatch {
  excludedFromAssignment?: boolean;
  excludedFromSwaps?: boolean;
}

/**
 * Работники.
 *
 * Набор методов — объединение того, что зовут два фронта: консоль не трогает
 * «обращение», мини-апп зовёт всё. Каждый берёт нужное и ничего не обязан
 * использовать целиком — иначе общий слой пришлось бы делить надвое по причине,
 * которой в самом домене нет.
 *
 * Возвращаемые значения тех методов, что объявлены `void` у обоих фронтов,
 * отбрасываются здесь же: ответ у них есть (сервер отдаёт работника), но экраны
 * перечитывают список после правки, и делать вид, что кто-то читает возврат,
 * значило бы врать типом.
 */
export function createEmployeesApi(transport: Transport) {
  return {
    async getAdminEmployees(): Promise<AdminEmployeeDto[]> {
      const { employees } = await transport.get<AdminEmployeesResponse>("/api/admin/employees");
      return employees;
    },

    createEmployee(displayName: string): Promise<CreateEmployeeResponse> {
      return transport.post("/api/admin/employees", { displayName }) as Promise<CreateEmployeeResponse>;
    },

    async archiveEmployee(id: number): Promise<void> {
      await transport.post(`/api/admin/employees/${id}/archive`, {});
    },

    async restoreEmployee(id: number): Promise<void> {
      await transport.post(`/api/admin/employees/${id}/restore`, {});
    },

    async setEmployeeAdmin(id: number, isAdmin: boolean): Promise<void> {
      await transport.post(`/api/admin/employees/${id}/role`, { isAdmin });
    },

    async renameEmployee(id: number, displayName: string): Promise<void> {
      await transport.patch(`/api/admin/employees/${id}`, { displayName });
    },

    async setEmployeePreferredName(id: number, preferredName: string | null): Promise<void> {
      await transport.patch(`/api/admin/employees/${id}`, { preferredName });
    },

    async setBirthDate(id: number, birthDate: string | null): Promise<void> {
      await transport.patch(`/api/admin/employees/${id}`, { birthDate });
    },

    async setEmployeeRestrictions(id: number, patch: EmployeeRestrictionsPatch): Promise<void> {
      await transport.patch(`/api/admin/employees/${id}`, patch);
    },

    async reorderEmployee(id: number, position: number): Promise<AdminEmployeeDto[]> {
      const { employees } = (await transport.post(`/api/admin/employees/${id}/order`, {
        position,
      })) as AdminEmployeesResponse;
      return employees;
    },

    getEmployeeInvite(id: number, regenerate = false): Promise<EmployeeInviteResponse> {
      return transport.post(`/api/admin/employees/${id}/invite`, {
        regenerate,
      }) as Promise<EmployeeInviteResponse>;
    },
  };
}
