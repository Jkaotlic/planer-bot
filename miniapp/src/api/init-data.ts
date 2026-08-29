import { initDataRaw, restoreInitData } from "@telegram-apps/sdk-react";

/**
 * Откуда взять пропуск, если SDK его не отдал.
 *
 * `@telegram-apps/sdk` разбирает параметры запуска строгой схемой, и в этой
 * схеме поле `signature` обязательное. Telegram начал его присылать только с
 * Bot API 7.10 (сентябрь 2024) — значит у любого, чьё приложение старше, разбор
 * падает целиком: `LaunchParamsRetrieveError`, «Unable to retrieve launch
 * parameters from any known source», и это при живом Telegram и настоящем
 * подписанном пропуске в адресе. Проверено контрольным опытом: те же параметры,
 * одна разница — наличие `signature`; с ним всё читается, без него не читается
 * ничего.
 *
 * Отсюда и «не работает у одних и тех же людей»: версия приложения у человека
 * не меняется сама, поэтому у него не работало ни разу и ни из какого входа.
 *
 * Строгость эта чужая и нам не нужна: подлинность проверяет сервер по `hash`
 * (см. `validateInitData`), а `signature` он не смотрит вовсе. Клиенту хватит
 * сырой строки — откуда бы она ни пришла. Поэтому источников четыре, и берётся
 * первый заговоривший.
 */

/** Ключ, под которым SDK кладёт параметры запуска на время сессии вебвью. */
const SDK_STORAGE_KEY = "tapps/launchParams";

interface TelegramGlobal {
  Telegram?: { WebApp?: { initData?: unknown } };
}

/** Достаёт `tgWebAppData` из строки параметров запуска. */
function dataFromLaunchParams(query: string): string {
  return new URLSearchParams(query).get("tgWebAppData") ?? "";
}

export function readInitData(): string {
  // 1. Штатный путь. `restoreInitData` ещё и поднимает пропуск из хранилища
  //    сессии, когда вебвью перезагрузился и хеша в адресе уже нет.
  try {
    restoreInitData();
    const fromSdk = initDataRaw();
    if (fromSdk) return fromSdk;
  } catch {
    // Разбор параметров не удался — ниже три источника, которым он не нужен.
  }

  // 2. Глобал самого Telegram. Его кладёт клиент, а не библиотека, и лежит он
  //    там в любой версии — ровно то, что нужно старому приложению.
  try {
    const fromGlobal = (window as unknown as TelegramGlobal).Telegram?.WebApp?.initData;
    if (typeof fromGlobal === "string" && fromGlobal.length > 0) return fromGlobal;
  } catch {
    // Глобала может не быть вовсе — это не повод падать.
  }

  // 3. Адрес запуска. Telegram кладёт параметры в хеш при открытии вебвью.
  try {
    const fromHash = dataFromLaunchParams(location.hash.slice(1));
    if (fromHash) return fromHash;
  } catch {
    // Нечитаемый адрес — идём дальше.
  }

  // 4. То, что SDK успел сохранить до того, как споткнулся о разбор. Пригодится
  //    после перезагрузки вебвью, когда хеша уже нет.
  try {
    const stored = sessionStorage.getItem(SDK_STORAGE_KEY);
    if (stored) {
      const query: unknown = JSON.parse(stored);
      if (typeof query === "string") {
        const fromStorage = dataFromLaunchParams(query);
        if (fromStorage) return fromStorage;
      }
    }
  } catch {
    // Хранилище может быть запрещено политикой вебвью — тогда просто нечего взять.
  }

  return "";
}
