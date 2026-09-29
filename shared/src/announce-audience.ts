/**
 * Адресаты анонса по кнопкам «Админам» и «Работникам».
 *
 * Наблюдатель не входит ни в одну из них — так он попросил (2026-09-29): роль
 * заводилась для тех, кто смотрит со стороны, и новости «для админов» и «для
 * команды» им адресованы не бывают. «Всем» по-прежнему включает всех.
 *
 * Админ, он же наблюдатель, считается наблюдателем: просьба была «без учёта
 * наблюдающих», а не «без наблюдателей, кроме админов». В проде таких нет, и
 * правило записано, чтобы не решаться заново, когда появятся.
 */
export type AnnouncementRole = "admin" | "worker" | "observer";

/** Один потенциальный адресат — контракт `GET /api/announcements/recipients`.
 *  Без телефонов и инвайт-токенов: экрану «Анонсы» нужны имя, «дойдёт ли» и роль
 *  для кнопок. */
export interface AnnouncementRecipient {
  id: number;
  displayName: string;
  reachable: boolean;
  role: AnnouncementRole;
}

export type AnnouncementPreset = "admins" | "workers";

export function announcementRole(e: { isAdmin: boolean; isObserver: boolean }): AnnouncementRole {
  if (e.isObserver) return "observer";
  return e.isAdmin ? "admin" : "worker";
}

const PRESET_ROLE: Record<AnnouncementPreset, AnnouncementRole> = { admins: "admin", workers: "worker" };

/** Кого отметить галочками по кнопке — в порядке списка, как его видит отправитель. */
export function presetRecipientIds(
  recipients: readonly Pick<AnnouncementRecipient, "id" | "role">[],
  preset: AnnouncementPreset,
): number[] {
  return recipients.filter((r) => r.role === PRESET_ROLE[preset]).map((r) => r.id);
}
