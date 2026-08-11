import type {
  MyShiftsResponse,
  TeamScheduleResponse,
  TemplateDto,
  TemplatesResponse,
} from "@planer/shared";
import type { Transport } from "./core";

/**
 * Чтение, доступное любому работнику.
 *
 * Методы отдают ответ сервера целиком, а не выжимку: мини-аппу от
 * `/api/team/schedule` нужны и работники, и записи, а консоли — только записи.
 * Сужать здесь значило бы выбрать за одного из двух; каждый фронт берёт своё.
 */
export function createReadApi(transport: Transport) {
  return {
    async getTemplates(): Promise<TemplateDto[]> {
      const { templates } = await transport.get<TemplatesResponse>("/api/templates");
      return templates;
    },

    getMyShifts(): Promise<MyShiftsResponse> {
      return transport.get<MyShiftsResponse>("/api/my/shifts");
    },

    getTeamSchedule(from: string, to: string): Promise<TeamScheduleResponse> {
      const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      return transport.get<TeamScheduleResponse>(`/api/team/schedule?${query}`);
    },
  };
}
