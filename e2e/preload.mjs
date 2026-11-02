// Подгружается в процесс сервера, чтобы гонять index.ts без единой правки в нём.
// Весь исходящий трафик: Telegram -> локальный фейк, остальное -> отказ, иначе результат
// зависел бы от сети машины (xmlcalendar) и ходил бы наружу из CI.
import http from "node:http";
import https from "node:https";
const port = Number(process.env.FAKE_TG_PORT);
const orig = https.request;
https.request = (opts, cb) => {
  const host = opts.hostname ?? opts.host;
  if (host === "api.telegram.org") {
    return http.request(
      { ...opts, protocol: "http:", hostname: "127.0.0.1", host: undefined, port, agent: undefined },
      cb,
    );
  }
  throw new Error("e2e: исходящий запрос заблокирован: " + host);
};
void orig;
const realFetch = globalThis.fetch;
globalThis.fetch = (u, i) => {
  const s = String(u?.url ?? u);
  if (s.startsWith("http://127.0.0.1") || s.startsWith("http://localhost")) return realFetch(u, i);
  return Promise.reject(new Error("e2e: fetch заблокирован: " + s));
};
// Пятиминутный круг тиков -> 2 с: иначе напоминания не проверить за разумное время.
const realSI = globalThis.setInterval;
globalThis.setInterval = (f, ms, ...a) => realSI(f, ms === 300000 ? 2000 : ms, ...a);
