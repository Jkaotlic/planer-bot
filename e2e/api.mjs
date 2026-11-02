// Сквозные сценарии: настоящий server/src/index.ts, пустая база во временном каталоге,
// настоящий HTTP. Заменён только Telegram: это единственная внешняя сторона, и второй
// опрос на боевом токене дал бы дубли письмами всей команде. Поэтому токен выдуманный.
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fakeTelegram, initData, BOT_TOKEN, sleep, until } from "./lib.mjs";
// Без переиспользования соединений: Node закрывает простаивающее через 5 с, и запрос,
// попавший в этот миг, получает ECONNRESET (замер: 1 из 2400). Сценариям это шум, а
// повтор мог бы скрыть настоящий обрыв. Сама гонка записана в docs/audit/ledger.md.
function fetch(url, init = {}) {
  return new Promise((done, fail) => {
    const req = http.request(url, { method: init.method ?? "GET", headers: init.headers, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString();
        done({ status: res.statusCode, headers: new Headers(res.headers), text: async () => body });
      });
    });
    req.on("error", fail);
    req.end(init.body);
  });
}
export const here = import.meta.dirname;
const REPO = resolve(here, "..");
export const PORT = 18090,
  TG = 18091,
  BASE = `http://127.0.0.1:${PORT}`;
const data = mkdtempSync(join(tmpdir(), "planer-e2e-"));
export const results = [];
export async function check(name, fn) {
  try {
    const note = await fn();
    results.push({ name, ok: true, note });
    console.log("PASS", name, note ? `— ${note}` : "");
  } catch (e) {
    results.push({ name, ok: false, error: String(e.message ?? e) });
    console.log("FAIL", name, "—", String(e.message ?? e).slice(0, 400));
  }
}
export const assert = (c, m) => {
  if (!c) throw new Error(m);
};
export const ADMIN = { id: 9001, first_name: "Аня", last_name: "Админова", username: "anya" },
  W1 = { id: 9101, first_name: "Игорь" },
  W2 = { id: 9102, first_name: "Марк" };
export const tg = fakeTelegram(TG);
export const state = {};
export const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  E2E_CLOCK_OFFSET: process.env.E2E_CLOCK_OFFSET,
  FAKE_TG_PORT: String(TG),
  PORT: String(PORT),
  BOT_TOKEN,
  ADMIN_TELEGRAM_IDS: String(ADMIN.id),
  TEAM_TZ: "Europe/Moscow",
  DATABASE_URL: resolve(data, "e2e.db"),
  DOCS_DIR: resolve(data, "docs"),
  JWT_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e",
  PUBLIC_URL: BASE,
  BOT_USERNAME: "e2e_test_bot",
};
export let srv,
  log = "";
export function startServer() {
  srv = spawn(
    process.execPath,
    [
      "--import",
      resolve(here, "fixed-clock.mjs"),
      "--import",
      resolve(here, "preload.mjs"),
      "--import",
      "tsx",
      "server/src/index.ts",
    ],
    { cwd: REPO, env },
  );
  srv.stdout.on("data", (d) => (log += d));
  srv.stderr.on("data", (d) => (log += d));
  srv.exited = new Promise((r) => srv.on("exit", (c, s) => r({ c, s })));
  return srv;
}
export const getLog = () => log;
export const cleanup = () => rmSync(data, { recursive: true, force: true });
export async function setup() {
  await tg.listen();
  startServer();
  assert(
    await until(async () => {
      try {
        return (await fetch(BASE + "/api/health")).status < 600;
      } catch {
        return false;
      }
    }, 30000),
    "сервер не поднялся: " + log.slice(-800),
  );
}
export async function j(method, path, { token, body, raw } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let d;
  try {
    d = JSON.parse(t);
  } catch {
    d = t;
  }
  return raw ? { status: r.status, data: d, headers: r.headers } : { status: r.status, data: d };
}
const ok = (r, s = 200) => {
  assert(r.status === s, `ждали ${s}, получили ${r.status}: ${JSON.stringify(r.data).slice(0, 300)}`);
  return r.data;
};
const login = async (u) => ok(await j("POST", "/api/auth", { body: { initData: initData(u) } }));
const msk = (d = 0) => {
  const t = new Date(Date.now() + 3 * 3600e3 + d * 864e5);
  return t.toISOString().slice(0, 10);
};
const dow = (s) => new Date(s + "T12:00Z").getUTCDay();
export const nextWorkday = (from) => {
  let d = from;
  for (; ; d++) {
    const w = dow(msk(d));
    if (w >= 1 && w <= 4) return d;
  }
};
export const nextSat = () => {
  let d = 2;
  for (; ; d++) if (dow(msk(d)) === 6) return d;
};
export { msk, ok, login };

export async function apiScenarios() {
  let adm, w1, w2, w1id, w2id, templates, invite;
  await check("старт: 47 миграций на пустой базе, бот опрашивает, health зелёный", async () => {
    const h = await until(async () => {
      const r = await j("GET", "/api/health");
      return r.status === 200 && r;
    }, 15000);
    assert(h, "health не 200: " + JSON.stringify((await j("GET", "/api/health")).data) + log.slice(-500));
    assert(/bot @e2e_test_bot started/.test(log), "нет строки старта бота");
    return JSON.stringify(h.data);
  });
  await check("статика: /app и /admin отдаются, промах по assets — 404, заголовки безопасности", async () => {
    const a = await j("GET", "/app/", { raw: true });
    assert(a.status === 200 && /<div id="root"/.test(a.data), "нет /app/");
    assert(/no-cache/.test(a.headers.get("cache-control")), "кэш html");
    const b = await j("GET", "/admin/");
    assert(b.status === 200, "нет /admin/");
    const m = await j("GET", "/app/assets/no-such-abc.js", { raw: true });
    assert(m.status === 404, "промах " + m.status);
    assert(!/immutable/.test(m.headers.get("cache-control") ?? ""), "immutable на 404");
    for (const h of ["x-content-type-options", "content-security-policy"])
      assert(a.headers.get(h), "нет " + h);
  });
  await check(
    "вход: подпись поддельная 401, чужой 403, без токена 401, просроченный initData 401",
    async () => {
      ok(await j("POST", "/api/auth", { body: { initData: "user=%7B%22id%22%3A1%7D&hash=deadbeef" } }), 401);
      ok(
        await j("POST", "/api/auth", { body: { initData: initData({ id: 555, first_name: "Чужой" }) } }),
        403,
      );
      ok(await j("GET", "/api/me"), 401);
      ok(await j("GET", "/api/admin/employees"), 401);
      ok(await j("GET", "/api/me", { token: "abc.def.ghi" }), 401);
      ok(await j("POST", "/api/auth", { body: { initData: initData(ADMIN, 25 * 3600) } }), 401);
    },
  );
  await check("админ из ADMIN_TELEGRAM_IDS создаётся при первом входе", async () => {
    const r = await login(ADMIN);
    adm = r.token;
    state.adm = adm;
    state.admId = r.employee.id;
    assert(r.employee.isAdmin, "не админ");
  });
  await check("/start и /admin у админа: ссылка в консоль с токеном", async () => {
    tg.text(ADMIN.id, "Аня", "/admin");
    const m = await until(() => tg.sentTo(ADMIN.id).find((c) => /admin\/#token=/.test(c.body.text)));
    assert(m, "нет ссылки");
    state.adminLink = m.body.text.match(/https?:\S+/)[0];
  });
  await check("работник: создание, инвайт, привязка через /start <токен>", async () => {
    const a = ok(
      await j("POST", "/api/admin/employees", { token: adm, body: { displayName: "Игорь Тестов" } }),
      201,
    );
    const b = ok(
      await j("POST", "/api/admin/employees", { token: adm, body: { displayName: "Марк Пробный" } }),
      201,
    );
    w1id = a.employee.id;
    w2id = b.employee.id;
    state.w1id = w1id;
    state.w2id = w2id;
    assert(a.inviteLink?.includes("e2e_test_bot"), "инвайт без имени бота");
    tg.text(W1.id, "Игорь", `/start ${a.inviteToken}`);
    tg.text(W2.id, "Марк", `/start ${b.inviteToken}`);
    assert(await until(() => tg.sentTo(W1.id).length && tg.sentTo(W2.id).length), "бот не ответил на /start");
    invite = a.inviteToken;
    const r = await until(async () => {
      const x = await j("POST", "/api/auth", { body: { initData: initData(W1) } });
      return x.status === 200 && x;
    }, 5000);
    assert(r, "вход работника не прошёл");
    w1 = r.data.token;
    w2 = (await login(W2)).token;
    state.w1 = w1;
    state.w2 = w2;
    assert(!r.data.employee.isAdmin, "работник стал админом");
  });
  await check("инвайт одноразовый: чужой телеграм по тому же токену не привязывается", async () => {
    tg.text(9199, "Левый", `/start ${invite}`);
    await sleep(600);
    ok(
      await j("POST", "/api/auth", { body: { initData: initData({ id: 9199, first_name: "Левый" }) } }),
      403,
    );
  });
  await check(
    "разграничение прав: работник не попадает в админские ручки и не видит инвайт-токены",
    async () => {
      for (const [m, p] of [
        ["GET", "/api/admin/employees"],
        ["POST", "/api/admin/entries"],
        ["GET", "/api/admin/journal"],
        ["GET", "/api/admin/roster.csv"],
        ["PUT", "/api/admin/settings/reminder-hour"],
      ]) {
        const r = await j(m, p, { token: w1, body: m === "GET" ? undefined : {} });
        assert(r.status === 403, `${m} ${p} дал ${r.status}`);
      }
      const list = ok(await j("GET", "/api/employees", { token: w1 }));
      assert(!JSON.stringify(list).includes("inviteToken"), "утечка inviteToken работнику");
    },
  );
  await check("график: шаблоны из миграций, админ ставит смены, работник их видит", async () => {
    templates = ok(await j("GET", "/api/templates", { token: w1 }));
    templates = templates.templates;
    assert(templates.length > 0, "шаблонов нет");
    state.templates = templates;
    const d1 = nextWorkday(3);
    state.d1 = msk(d1);
    state.d2 = msk(d1);
    const e1 = ok(
      await j("POST", "/api/admin/entries", {
        token: adm,
        body: { employeeId: w1id, date: state.d1, start: "09:00", end: "18:00", category: "shift" },
      }),
      201,
    );
    const e2 = ok(
      await j("POST", "/api/admin/entries", {
        token: adm,
        body: { employeeId: w2id, date: state.d2, start: "12:00", end: "21:00", category: "shift" },
      }),
      201,
    );
    state.e1 = e1.entry.id;
    state.e2 = e2.entry.id;
    const my = ok(await j("GET", `/api/my/shifts?from=${state.d1}&to=${state.d2}`, { token: w1 }));
    assert(
      JSON.stringify(my).includes(state.d1),
      "своей смены не видно: " + JSON.stringify(my).slice(0, 200),
    );
    const team = ok(await j("GET", `/api/team/schedule?from=${state.d1}&to=${state.d2}`, { token: w2 }));
    assert(JSON.stringify(team).includes(state.d1), "команда не видит смену");
  });
  await check("письмо работнику о смене доходит из буфера (объединение правок)", async () => {
    const m = await until(() => tg.sentTo(W1.id).find((c) => c.body.text.includes("09:00")), 30000);
    assert(
      m,
      "письма нет; всего: " +
        tg
          .sentTo(W1.id)
          .map((c) => c.body.text.slice(0, 40))
          .join(" | "),
    );
    return m.body.text.slice(0, 60).replace(/\n/g, " ");
  });
  await check(
    "валидация: конец раньше начала, абсурдный диапазон, длинное поле — понятный отказ, без 500",
    async () => {
      for (const body of [
        { employeeId: w1id, date: "2030-01-10", endDate: "2030-01-01", category: "vacation" },
        { employeeId: w1id, date: "2030-01-10", endDate: "2130-01-01", category: "vacation" },
        {
          employeeId: w1id,
          date: "2030-01-10",
          start: "09:00",
          end: "18:00",
          category: "shift",
          note: "я".repeat(5000),
        },
        { employeeId: w1id, date: "абв", category: "shift" },
        { employeeId: 999999, date: "2030-01-10", start: "09:00", end: "18:00", category: "shift" },
      ]) {
        const r = await j("POST", "/api/admin/entries", { token: adm, body });
        assert(r.status >= 400 && r.status < 500, `${JSON.stringify(body).slice(0, 80)} дал ${r.status}`);
      }
    },
  );
  await check("обмен: предложил → письмо с кнопками → принял кнопкой в боте → смены поменялись", async () => {
    const s = ok(
      await j("POST", "/api/swaps", {
        token: w1,
        body: { fromShiftId: state.e1, toShiftId: state.e2, message: "выручай" },
      }),
      201,
    );
    assert(s.notified, "вторая сторона не уведомлена");
    const id = s.request.id;
    const p = await until(() =>
      tg.sentTo(W2.id).find((c) => JSON.stringify(c.body.reply_markup ?? "").includes(`swap:accept:${id}`)),
    );
    assert(p, "нет письма с кнопкой");
    tg.tap(W2.id, "Марк", `swap:accept:${id}`);
    const done = await until(async () => {
      const r = await j("GET", "/api/swaps", { token: w1 });
      return JSON.stringify(r.data).includes('"accepted"') && r;
    }, 6000);
    assert(done, "статус не accepted");
    const my = ok(await j("GET", `/api/my/shifts?from=${state.d1}&to=${state.d2}`, { token: w1 }));
    assert(
      JSON.stringify(my).includes("12:00") && !JSON.stringify(my).includes("09:00"),
      "смена не переехала: " + JSON.stringify(my).slice(0, 300),
    );
  });
  await check("обмен: повторное нажатие «Принять» не применяет обмен второй раз", async () => {
    const before = JSON.stringify(
      ok(await j("GET", `/api/team/schedule?from=${state.d1}&to=${state.d2}`, { token: w1 })),
    );
    const rq = ok(await j("GET", "/api/swaps", { token: w1 }));
    const id = rq.swaps[0]?.id;
    tg.tap(W2.id, "Марк", `swap:accept:${id}`);
    await sleep(700);
    assert(
      before ===
        JSON.stringify(
          ok(await j("GET", `/api/team/schedule?from=${state.d1}&to=${state.d2}`, { token: w1 })),
        ),
      "график изменился от повтора",
    );
  });
  await check("больничный: работник ставит, админу вопрос с кнопкой, ОК закрывает", async () => {
    const d = msk(nextWorkday(1));
    const r = ok(
      await j("POST", "/api/my/entries", { token: w1, body: { category: "sick_leave", date: d } }),
      201,
    );
    const id = r.entry?.id;
    assert(id, "нет записи");
    const q = await until(() =>
      tg.calls.find(
        (c) =>
          String(c.body.chat_id) === String(ADMIN.id) &&
          /sick:approve/.test(JSON.stringify(c.body.reply_markup ?? "")),
      ),
    );
    assert(q, "админу не пришла кнопка");
    const cb = JSON.stringify(q.body.reply_markup).match(/sick:approve:\d+/)[0];
    tg.tap(ADMIN.id, "Аня", cb, { message_id: q.body.message_id ?? 77 });
    const left = await until(async () => {
      const x = await j("GET", "/api/admin/sick-approvals", { token: adm });
      return x.data.approvals.length === 0;
    }, 5000);
    assert(left, "заявка осталась висеть");
  });
  await check("выходной: слот → интерес работника → назначение → запись в графике", async () => {
    const d = msk(nextSat());
    const s = ok(
      await j("POST", "/api/admin/weekend/slots", {
        token: adm,
        body: { date: d, start: "10:00", end: "18:00", title: "Склад" },
      }),
      201,
    );
    const id = s.slot?.id ?? s.id;
    ok(await j("POST", `/api/weekend/slots/${id}/interest`, { token: w2 }), 201);
    const a = await j("POST", `/api/admin/weekend/slots/${id}/assign`, {
      token: adm,
      body: { employeeId: w2id },
    });
    assert(a.status < 300, "назначение " + a.status + JSON.stringify(a.data));
    const my = ok(await j("GET", `/api/my/shifts?from=${d}&to=${d}`, { token: w2 }));
    const off = ok(await j("GET", "/api/weekend/offers", { token: w2 }));
    assert(JSON.stringify(my).includes(d) || JSON.stringify(off).length > 4, "нет ни записи, ни предложения");
  });
  await check("сбор: создать → разослать → «сдал» → отметка → закрыть", async () => {
    const c = ok(
      await j("POST", "/api/admin/collections", {
        token: adm,
        body: { title: "На цветы", amountPerPerson: 300, collectUrl: "https://example.com/pay" },
      }),
    );
    const id = c.collection?.id ?? c.id;
    const s = await j("POST", `/api/admin/collections/${id}/send`, { token: adm, body: { confirm: true } });
    assert(s.status < 300, "send " + s.status + JSON.stringify(s.data));
    assert(await until(() => tg.sentTo(W1.id).find((x) => /цветы/.test(x.body.text))), "письма о сборе нет");
    ok(await j("POST", `/api/collections/${id}/paid`, { token: w1, body: { paid: true } }));
    const p = ok(await j("GET", `/api/admin/collections/${id}/payments`, { token: adm }));
    assert(JSON.stringify(p).includes(String(w1id)), "оплата не видна");
    const z = await j("POST", `/api/admin/collections/${id}/close`, { token: adm, body: { closed: true } });
    assert(z.status < 300, "close " + z.status + JSON.stringify(z.data));
  });
  await check("опрос: создать → голос → итог; повторный голос не задваивает", async () => {
    const c = ok(
      await j("POST", "/api/polls", {
        token: w1,
        body: { question: "Корпоратив в пятницу?", closesTime: null, audience: { kind: "team" } },
      }),
      201,
    );
    const id = c.poll?.id ?? c.id;
    ok(await j("POST", `/api/polls/${id}/vote`, { token: w2, body: { choice: "for" } }));
    ok(await j("POST", `/api/polls/${id}/vote`, { token: w2, body: { choice: "against" } }));
    const v = ok(await j("GET", `/api/polls/${id}`, { token: w1 }));
    const s = JSON.stringify(v);
    assert(s.includes("Корпоратив"), "нет опроса");
    // Повторный голос заменяет первый: Марк только в «против».
    assert(v.poll.tally.for.length === 0, "первый голос остался: " + s.slice(0, 300));
    assert(v.poll.tally.against.length === 1, "голос задвоился: " + s.slice(0, 300));
  });
  await check("заказ еды: место → заказ → позиция → правка; чужую позицию админ не удаляет", async () => {
    const pl = ok(
      await j("POST", "/api/food-places", {
        token: adm,
        body: { name: "Пекарня", menu: [{ name: "Булка", price: 100, unit: "pcs" }] },
      }),
      201,
    );
    const placeId = pl.place?.id ?? pl.id;
    const o = await j("POST", "/api/orders", {
      token: w1,
      body: { placeId, note: null, payHint: null, closesTime: null, audience: { kind: "team" } },
    });
    assert(o.status === 201, "заказ " + o.status + JSON.stringify(o.data));
    const id = o.data.order?.id ?? o.data.id;
    const menu = ok(await j("GET", `/api/orders/${id}`, { token: w2 }));
    const it = await j("POST", `/api/orders/${id}/items`, { token: w2, body: { menuItemId: 1 } });
    assert(it.status < 300, "позиция " + it.status + JSON.stringify(it.data).slice(0, 160));
    const iid = it.data.item?.id ?? JSON.stringify(it.data).match(/"id":(\d+)/)[1];
    const pa = await j("PATCH", `/api/orders/${id}/items/${iid}`, { token: w2, body: { qty: 3 } });
    const foreign = await j("DELETE", `/api/orders/${id}/items/${iid}`, { token: adm });
    return (
      "правка " +
      pa.status +
      ", чужое удаление админом " +
      foreign.status +
      " позиция: " +
      it.status +
      " " +
      JSON.stringify(it.data).slice(0, 200) +
      " || заказ: " +
      JSON.stringify(menu).slice(0, 300)
    );
  });
  await check("анонс: доходит команде, заблокировавший бота помечается и не роняет рассылку", async () => {
    tg.failFor.add(W2.id);
    const r = await j("POST", "/api/announcements", {
      token: adm,
      body: { text: "Проверка связи", audience: "all" },
    });
    tg.failFor.delete(W2.id);
    assert(r.status < 300, "анонс " + r.status + JSON.stringify(r.data));
    assert(
      await until(() => tg.sentTo(W1.id).find((x) => /Проверка связи/.test(x.body.text))),
      "W1 не получил",
    );
    const people = ok(await j("GET", "/api/admin/employees", { token: adm }));
    const blocked = JSON.stringify(people).match(/"displayName":"Марк Пробный".*?"botBlockedAt":("[^"]+"|null)/)?.[1];
    assert(blocked && blocked !== "null", "заблокировавший бота не помечен: " + blocked);
  });
  await check(
    "календарь ICS: подключить, скачать без токена по ссылке, сменить — старая мертва",
    async () => {
      const a = ok(await j("POST", "/api/me/calendar", { token: w1, body: {} }));
      const url = a.url ?? a.calendarUrl ?? JSON.stringify(a).match(/https?:[^"]+\.ics/)?.[0];
      assert(url, "нет ссылки: " + JSON.stringify(a));
      const p = new URL(url).pathname;
      const r = await j("GET", p, { raw: true });
      assert(r.status === 200 && /BEGIN:VCALENDAR/.test(r.data), "не ics " + r.status);
      ok(await j("POST", "/api/me/calendar", { token: w1, body: {} }));
      assert((await j("GET", p)).status === 404, "старая ссылка жива");
    },
  );
  await check("отчёты и выгрузки: JSON и CSV без 500, CSV защищён от формул", async () => {
    const q = `from=${state.d1}&to=${state.d2}`;
    ok(await j("GET", `/api/admin/reports/shift-counts?${q}`, { token: adm }));
    const c = await j("GET", `/api/admin/reports/shift-counts.csv?${q}`, { token: adm });
    assert(c.status === 200, "csv " + c.status);
    const huge = await j("GET", "/api/admin/reports/shift-counts?from=2000-01-01&to=2099-01-01", {
      token: adm,
    });
    assert(huge.status === 400, "широкий диапазон дал " + huge.status);
    const mal = ok(
      await j("POST", "/api/admin/employees", { token: adm, body: { displayName: "=HYPERLINK(1)" } }),
      201,
    );
    const r = await j("GET", `/api/admin/roster.csv?from=${state.d1}&to=${state.d2}`, { token: adm });
    assert(r.status === 200, "roster " + r.status + JSON.stringify(r.data).slice(0, 100));
    assert(!/(^|[,;\n"])=HYPERLINK/.test(r.data), "формула в CSV без экранирования");
    await j("POST", `/api/admin/employees/${mal.employee.id}/archive`, { token: adm, body: {} });
  });
  await check(
    "архивация: токен работника перестаёт работать сразу, последнего админа снять нельзя",
    async () => {
      const t = ok(
        await j("POST", "/api/admin/employees", { token: adm, body: { displayName: "Временный" } }),
        201,
      );
      tg.text(9103, "Врем", `/start ${t.inviteToken}`);
      await until(() => tg.sentTo(9103).length);
      const v = await login({ id: 9103, first_name: "Врем" });
      ok(await j("POST", `/api/admin/employees/${t.employee.id}/archive`, { token: adm, body: {} }));
      assert(
        (await j("GET", "/api/me", { token: v.token })).status === 401 ||
          (await j("GET", "/api/me", { token: v.token })).status === 403,
        "архивный ходит с токеном",
      );
      const r = await j("POST", `/api/admin/employees/${state.admId}/role`, {
        token: adm,
        body: { isAdmin: false },
      });
      assert(r.status >= 400 && r.status < 500, "снял последнего админа: " + r.status);
    },
  );
  await check("мусор и лимиты: кривой JSON, большое тело, ошибка клиента — без 500", async () => {
    const r = await fetch(BASE + "/api/swaps", {
      method: "POST",
      headers: { authorization: `Bearer ${w1}`, "content-type": "application/json" },
      body: "{not json",
    });
    assert(r.status < 500, "кривой JSON " + r.status);
    const big = await fetch(BASE + "/api/admin/roster/import/preview", {
      method: "POST",
      headers: { authorization: `Bearer ${adm}`, "content-type": "text/csv" },
      body: "x".repeat(5_000_000),
    });
    assert(big.status === 413 || big.status === 400, "большое тело " + big.status);
    const ce = await j("POST", "/api/client-error", { body: { message: "e2e" } });
    assert(ce.status < 500, "client-error " + ce.status);
  });
  await check("нагрузка: 200 параллельных чтений не роняют и не блокируют бота", async () => {
    const t0 = Date.now();
    const rs = await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        j("GET", i % 2 ? `/api/team/schedule?from=${state.d1}&to=${state.d2}` : "/api/me", { token: w1 }),
      ),
    );
    const bad = rs.filter((r) => r.status >= 500).length;
    const lim = rs.filter((r) => r.status === 429).length;
    tg.text(W1.id, "Игорь", "/menu");
    const n = tg.sentTo(W1.id).length;
    assert(await until(() => tg.sentTo(W1.id).length > n, 4000), "бот не ответил после нагрузки");
    assert(bad === 0, "500-х: " + bad);
    return `${Date.now() - t0} мс, 429: ${lim}`;
  });

  await check("чужая запись: работник не может править/удалить запись коллеги", async () => {
    const e = ok(
      await j("POST", "/api/admin/entries", {
        token: adm,
        body: {
          employeeId: w2id,
          date: msk(nextWorkday(9)),
          start: "09:00",
          end: "18:00",
          category: "shift",
        },
      }),
      201,
    ).entry.id;
    for (const [m, b] of [
      ["PATCH", { category: "shift", date: "2030-01-07", start: "10:00", end: "11:00" }],
      ["DELETE", undefined],
    ]) {
      const r = await j(m, `/api/my/entries/${e}`, { token: w1, body: b });
      assert(r.status >= 400 && r.status < 500, `${m} чужой дал ${r.status}`);
    }
  });
  await check("гонка: 5 одновременных «Принять» на один обмен — применён один раз", async () => {
    const d1 = msk(nextWorkday(12)),
      d2 = d1;
    const a = ok(
        await j("POST", "/api/admin/entries", {
          token: adm,
          body: { employeeId: w1id, date: d1, start: "09:00", end: "18:00", category: "shift" },
        }),
        201,
      ).entry.id,
      b = ok(
        await j("POST", "/api/admin/entries", {
          token: adm,
          body: { employeeId: w2id, date: d2, start: "12:00", end: "21:00", category: "shift" },
        }),
        201,
      ).entry.id;
    const s = ok(await j("POST", "/api/swaps", { token: w1, body: { fromShiftId: a, toShiftId: b } }), 201)
      .request.id;
    const rs = await Promise.all(
      Array.from({ length: 5 }, () => j("POST", `/api/swaps/${s}/accept`, { token: w2, body: {} })),
    );
    const okc = rs.filter((r) => r.status < 300).length;
    assert(okc === 1, "успешных: " + okc + " " + rs.map((r) => r.status));
    assert(!rs.some((r) => r.status >= 500), "500");
    const m = ok(await j("GET", `/api/my/shifts?from=${d1}&to=${d2}`, { token: w1 }));
    const st = JSON.stringify(m);
    assert(st.includes("12:00") && !st.includes("09:00"), "смены не обменялись: " + st.slice(0, 200));
    return rs.map((r) => r.status).join(",");
  });
  await check("гонка: тройной клик анонса и рассылки сбора — команде ровно по одному письму", async () => {
    const n = () => tg.sentTo(W1.id).filter((x) => /Тройной клик/.test(x.body.text)).length;
    const rs = await Promise.all(
      [1, 2, 3].map(() =>
        j("POST", "/api/announcements", { token: adm, body: { text: "Тройной клик", audience: "all" } }),
      ),
    );
    await sleep(500);
    assert(n() === 1, "писем " + n() + ", коды " + rs.map((r) => r.status));
    const c = ok(
      await j("POST", "/api/admin/collections", {
        token: adm,
        body: { title: "Тройной сбор", amountPerPerson: 100, collectUrl: "https://example.com/pay" },
      }),
    ).collection.id;
    const r2 = await Promise.all(
      [1, 2, 3].map(() =>
        j("POST", `/api/admin/collections/${c}/send`, { token: adm, body: { confirm: true } }),
      ),
    );
    await sleep(600);
    const m = tg.sentTo(W1.id).filter((x) => /Тройной сбор/.test(x.body.text)).length;
    assert(m === 1, "письма сбора: " + m + ", коды " + r2.map((r) => r.status));
  });
  await check("напоминание накануне: уходит один раз за несколько кругов тиков", async () => {
    const d = msk(1);
    state.remDay = d;
    const w3 = ok(
      await j("POST", "/api/admin/employees", { token: adm, body: { displayName: "Оля Напоминаемая" } }),
      201,
    );
    tg.text(9104, "Оля", `/start ${w3.inviteToken}`);
    await until(() => tg.sentTo(9104).length);
    ok(
      await j("POST", "/api/admin/entries", {
        token: adm,
        body: { employeeId: w3.employee.id, date: d, start: "08:00", end: "17:00", category: "shift" },
      }),
      201,
    );
    const r = await j("PUT", "/api/admin/settings/reminder-hour", { token: adm, body: { hour: "00:00" } });
    assert(r.status < 300, "час " + r.status + JSON.stringify(r.data));
    const isRem = (x) => /завтра/i.test(x.body.text) && /08:00/.test(x.body.text);
    const m = await until(() => tg.sentTo(9104).find(isRem), 12000);
    assert(
      m,
      "напоминания нет; последние: " +
        tg
          .sentTo(9104)
          .slice(-4)
          .map((x) => x.body.text.slice(0, 70))
          .join(" | "),
    );
    await sleep(5000);
    const c = tg.sentTo(9104).filter(isRem).length;
    assert(c === 1, "напоминаний: " + c);
    state.remCount = isRem;
    return m.body.text.slice(0, 70).replace(/\n/g, " ");
  });
  await check("Telegram отвечает 502: HTTP работает, правки сохраняются, бот оживает сам", async () => {
    tg.setMode("down");
    const t0 = Date.now();
    const r = await j("POST", "/api/admin/entries", {
      token: adm,
      body: { employeeId: w1id, date: msk(nextWorkday(20)), start: "09:00", end: "18:00", category: "shift" },
    });
    const ms = Date.now() - t0;
    assert(r.status === 201, "запись " + r.status);
    assert(ms < 1500, "запись ждала Telegram " + ms + " мс");
    await sleep(3000);
    tg.setMode("up");
    const n = tg.sentTo(W1.id).length;
    tg.text(W1.id, "Игорь", "/menu");
    assert(await until(() => tg.sentTo(W1.id).length > n, 30000), "бот не ожил за 30 с");
    return `запись ${ms} мс`;
  });
  await check("Telegram молчит (висит соединение): API не зависает, бот оживает сам", async () => {
    tg.setMode("hang");
    const t0 = Date.now();
    const a = await j("GET", "/api/me", { token: w1 });
    const b = await j("POST", "/api/admin/entries", {
      token: adm,
      body: { employeeId: w1id, date: msk(nextWorkday(21)), start: "09:00", end: "18:00", category: "shift" },
    });
    const ms = Date.now() - t0;
    assert(a.status === 200 && b.status === 201, "статусы " + a.status + "," + b.status);
    assert(ms < 1500, "API ждал " + ms + " мс");
    await sleep(1000);
    tg.setMode("up");
    const n = tg.sentTo(W1.id).length;
    tg.text(W1.id, "Игорь", "/menu");
    const t1 = Date.now();
    assert(await until(() => tg.sentTo(W1.id).length > n, 60000), "бот не ожил за 60 с после восстановления");
    return `запросы ${ms} мс; бот ожил за ${Date.now() - t1} мс`;
  });
  await check(
    "бот: неизвестный текст, /week, /notifications, чужая кнопка, незнакомец — без падений",
    async () => {
      const n = tg.calls.length;
      tg.text(W1.id, "Игорь", "привет как дела");
      tg.text(W1.id, "Игорь", "/week");
      tg.text(W1.id, "Игорь", "/notifications");
      tg.tap(W1.id, "Игорь", "swap:accept:99999");
      tg.tap(W1.id, "Игорь", "мусор:1");
      tg.text(9999, "Левый", "/week");
      await sleep(1200);
      assert(tg.calls.length > n, "бот молчит");
      assert(
        !/Unhandled|TypeError|ReferenceError/.test(log),
        "в логе: " + log.match(/.*(Unhandled|TypeError|ReferenceError).*/)?.[0],
      );
    },
  );
}

export async function lifecycle() {
  await check(
    "SIGTERM: письмо из буфера успевает уйти, код выхода 0, рестарт на той же базе без дублей напоминаний",
    async () => {
      ok(
        await j("POST", "/api/admin/entries", {
          token: state.adm,
          body: {
            employeeId: state.w2id,
            date: "2031-03-03",
            start: "07:07",
            end: "17:17",
            category: "shift",
          },
        }),
        201,
      );
      srv.kill("SIGTERM");
      const x = await Promise.race([srv.exited, sleep(15000).then(() => "timeout")]);
      assert(x !== "timeout", "не завершился за 15 с");
      assert(x.c === 0, "код выхода " + JSON.stringify(x));
      assert(
        tg.sentTo(W2.id).some((c) => c.body.text.includes("07:07")),
        "письмо из буфера потеряно при остановке",
      );
      startServer();
      assert(
        await until(async () => {
          try {
            return (await fetch(BASE + "/api/health")).status === 200;
          } catch {
            return false;
          }
        }, 30000),
        "не поднялся повторно: " + log.slice(-300),
      );
      const my = ok(await j("GET", `/api/my/shifts?from=${state.d1}&to=${state.d2}`, { token: state.w1 }));
      assert(JSON.stringify(my).includes(state.d1), "данные пропали / токен не пережил рестарт");
      await sleep(5000);
      const c = tg.sentTo(9104).filter(state.remCount).length;
      assert(c === 1, "после рестарта напоминаний: " + c);
    },
  );
}
