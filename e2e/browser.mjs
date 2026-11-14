// Обе морды в браузере. Мост Telegram (`TelegramWebviewProxy`) и полная палитра обязательны:
// без них SDK не поднимается, и на экране не то приложение, что у человека. Контраст мерится
// по живой странице: дефекты темы прошлые jsdom-тесты не видели.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { j, msk, BASE, check, assert, ADMIN, W1, W2, state, here, getLog, tg } from "./api.mjs";
import { initData, sleep } from "./lib.mjs";
const shots = resolve(here, ".out/shots");
mkdirSync(shots, { recursive: true });
function watch(page, issues, tag) {
  page.on("pageerror", (e) => issues.push(`${tag} pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|net::ERR_ABORTED/.test(m.text()))
      issues.push(`${tag} console: ${m.text().slice(0, 240)}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 500 || (r.status() === 404 && /\/(api|assets)\//.test(r.url())) || r.status() === 429)
      issues.push(`${tag} ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  page.on("requestfailed", (r) => {
    if (!/ERR_ABORTED/.test(r.failure()?.errorText ?? ""))
      issues.push(`${tag} failed ${new URL(r.url()).pathname} ${r.failure()?.errorText}`);
  });
}
const LIGHT = {
  accent_text_color: "#3390ec",
  bg_color: "#ffffff",
  button_color: "#3390ec",
  button_text_color: "#ffffff",
  bottom_bar_bg_color: "#ffffff",
  destructive_text_color: "#e23b32",
  header_bg_color: "#ffffff",
  hint_color: "#8a9099",
  link_color: "#3390ec",
  secondary_bg_color: "#efeff4",
  section_bg_color: "#ffffff",
  section_header_text_color: "#8a9099",
  section_separator_color: "#e7e7ed",
  subtitle_text_color: "#8a9099",
  text_color: "#0b0b0f",
};
const DARK = {
  accent_text_color: "#6ab2f2",
  bg_color: "#17212b",
  button_color: "#5288c1",
  button_text_color: "#ffffff",
  bottom_bar_bg_color: "#17212b",
  destructive_text_color: "#ec3942",
  header_bg_color: "#17212b",
  hint_color: "#708499",
  link_color: "#6ab3f3",
  secondary_bg_color: "#232e3c",
  section_bg_color: "#17212b",
  section_header_text_color: "#6ab3f3",
  section_separator_color: "#111921",
  subtitle_text_color: "#708499",
  text_color: "#f5f5f5",
};
let THEME = LIGHT;
let SIGN = true;
const miniUrl = (u) =>
  `${BASE}/app/#tgWebAppData=${encodeURIComponent(initData(u, 0, SIGN))}&tgWebAppVersion=8.0&tgWebAppPlatform=ios&tgWebAppThemeParams=${encodeURIComponent(JSON.stringify(THEME))}`;
// Читаемость: контраст каждого видимого текста с его фактическим фоном.
const contrast = (page) =>
  page.evaluate(() => {
    const parse = (c) => {
      const m = c.match(/[\d.]+/g);
      if (!m) return null;
      return { r: +m[0], g: +m[1], b: +m[2], a: m[3] === undefined ? 1 : +m[3] };
    };
    const lum = ({ r, g, b }) => {
      const f = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bgOf = (e) => {
      for (let n = e; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0.9) return c;
        if (getComputedStyle(n).backgroundImage !== "none") return null;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode()); ) {
      const t = n.textContent.trim();
      if (t.length < 2) continue;
      const e = n.parentElement;
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      if (
        !r.width ||
        cs.visibility === "hidden" ||
        cs.display === "none" ||
        +cs.opacity < 0.3 ||
        e.closest("[aria-hidden=true]") ||
        e.closest(".visually-hidden") ||
        e.closest("button[disabled]")
      )
        continue;
      const fg = parse(cs.color),
        bg = bgOf(e);
      if (!fg || !bg) continue;
      const a = lum(fg),
        b = lum(bg);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (ratio < 2.2) out.push(t.slice(0, 28) + " [" + ratio.toFixed(2) + "]");
    }
    return [...new Set(out)].slice(0, 6);
  });
const overflow = (page) =>
  page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const bad = [...document.querySelectorAll("body *")].filter((e) => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return (
        r.width > 0 &&
        cs.visibility !== "hidden" &&
        r.right > w + 1 &&
        ![
          ...(function* (n) {
            for (let p = n.parentElement; p; p = p.parentElement) yield p;
          })(e),
        ].some((p) => ["auto", "scroll", "hidden"].includes(getComputedStyle(p).overflowX))
      );
    });
    return {
      sw: document.documentElement.scrollWidth,
      w,
      bad: bad.slice(0, 3).map((e) => e.tagName + "." + String(e.className).slice(0, 40)),
    };
  });
const crash = (page) =>
  page.evaluate(() => {
    const t = document.body.innerText;
    return {
      empty: t.trim().length < 5,
      oops:
        /что-то пошло не так|ошибка загрузки|не удалось загрузить|undefined|NaN|\[object/i.exec(t)?.[0] ??
        null,
    };
  });
export async function browserScenarios() {
  const browser = await chromium.launch();
  const mob = async (width = 390) => {
    const c = await browser.newContext({
      viewport: { width, height: 844 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
      locale: "ru-RU",
      timezoneId: "Europe/Moscow",
    });
    await c.clock.setFixedTime(new Date());
    await c.addInitScript(() => {
      window.TelegramWebviewProxy = { postEvent() {} };
    });
    return c;
  };
  async function crawlMini(user, tag) {
    const ctx = await mob();
    const page = await ctx.newPage();
    const issues = [];
    watch(page, issues, tag);
    const out = [];
    await page.goto(miniUrl(user));
    await page.waitForLoadState("networkidle");
    await sleep(600);
    const tabs = await page.locator(".tab-bar-fit button, .tab-bar-fit [role=tab], .tab-bar-fit a").count();
    assert(tabs > 0, `${tag}: нет таббара; текст: ` + (await page.innerText("body")).slice(0, 200));
    for (let i = 0; i < tabs; i++) {
      const t = page.locator(".tab-bar-fit button, .tab-bar-fit [role=tab], .tab-bar-fit a").nth(i);
      const name = (await t.innerText()).trim().split("\n")[0];
      await t.click();
      await page.waitForLoadState("networkidle");
      await sleep(300);
      const c = await crash(page),
        o = await overflow(page);
      out.push(name);
      const lc = await contrast(page);
      if (lc.length) issues.push(`${tag}/${name}: нечитаемо ${lc.join(", ")}`);
      if (c.empty) issues.push(`${tag}/${name}: пустой экран`);
      if (c.oops) issues.push(`${tag}/${name}: на экране «${c.oops}»`);
      if (o.sw > o.w + 1 || o.bad.length)
        issues.push(`${tag}/${name}: вылезает за ширину ${JSON.stringify(o)}`);
      await page.screenshot({ path: resolve(shots, `${tag}-${i}-${name.replace(/[^\p{L}\d]/gu, "")}.png`) });
    }
    return { ctx, page, issues, out };
  }
  await check("мини-апп, работник: вход по подписи, все вкладки открываются", async () => {
    const { ctx, issues, out } = await crawlMini(W1, "worker");
    await ctx.close();
    assert(!issues.length, issues.join(" ;; "));
    return out.join(", ");
  });
  await j("POST", "/api/admin/entries", {
    token: state.adm,
    body: { employeeId: state.w1id, date: msk(0), start: "06:06", end: "07:07", category: "shift" },
  });
  await check("мини-апп, работник: смена из графика видна на экране", async () => {
    const { ctx, page } = await crawlMini(W1, "worker2");
    await page.locator(".tab-bar-fit button").first().click();
    await sleep(500);
    const t = await page.innerText("body");
    await ctx.close();
    assert(/06:06/.test(t), "смены 06:06 не видно: " + t.slice(0, 300));
  });
  await check("мини-апп, ТЁМНАЯ тема: работник — все вкладки читаемы", async () => {
    THEME = DARK;
    const { ctx, issues, out } = await crawlMini(W1, "dark-worker");
    await ctx.close();
    THEME = LIGHT;
    assert(!issues.length, issues.join(" ;; "));
    return out.join(", ");
  });
  await check("мини-апп на 320px: приветствие и сводка читаемы в обеих темах", async () => {
    const ctx = await mob(320);
    try {
      const page = await ctx.newPage();
      for (const palette of [LIGHT, DARK]) {
        THEME = palette;
        await page.goto(miniUrl(W1));
        const greeting = page.getByText(/^Привет,/);
        const services = page.getByRole("button", { name: "Сервисы" });
        await services.waitFor();
        const metrics = await greeting.evaluate(el => {
          const lum = (value) => {
            const [r, g, b] = value.match(/[\d.]+/g).map(Number).map(channel => {
              const v = channel / 255;
              return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          let surface = el;
          while (getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)") surface = surface.parentElement;
          const bg = lum(getComputedStyle(surface).backgroundColor);
          const copy = [el, el.nextElementSibling].map(node => {
            const fg = lum(getComputedStyle(node).color);
            return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
          });
          return { width: el.clientWidth, contrast: Math.min(...copy) };
        });
        const caption = await services.boundingBox();
        const title = await greeting.boundingBox();
        assert(metrics.width >= 200 && caption.y >= title.y + title.height && metrics.contrast >= 4.5, JSON.stringify(metrics));
      }
    } finally {
      THEME = LIGHT;
      await ctx.close();
    }
  });
  await check("СТАРЫЙ клиент Telegram (initData без signature), светлая тема: экраны читаемы", async () => {
    SIGN = false;
    const { ctx, issues, out } = await crawlMini(W1, "oldclient");
    await ctx.close();
    SIGN = true;
    assert(!issues.length, issues.join(" ;; "));
    return out.join(", ");
  });
  await check("мини-апп, плохой initData: понятная ошибка, а не белый экран", async () => {
    const ctx = await mob();
    const page = await ctx.newPage();
    await page.goto(
      `${BASE}/app/#tgWebAppData=${encodeURIComponent("user=%7B%22id%22%3A1%7D&hash=bad")}&tgWebAppVersion=8.0&tgWebAppPlatform=ios&tgWebAppThemeParams=%7B%7D`,
    );
    await sleep(1500);
    const t = (await page.innerText("body")).trim();
    await page.screenshot({ path: resolve(shots, "bad-initdata.png") });
    await ctx.close();
    assert(t.length > 10, "пустой экран");
    return t.slice(0, 90).replace(/\n/g, " ");
  });
  await check("мини-апп вне Telegram: человек видит объяснение", async () => {
    const ctx = await mob();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/app/`);
    await sleep(1500);
    const t = (await page.innerText("body")).trim();
    await ctx.close();
    assert(t.length > 10, "пустой экран");
    return t.slice(0, 90).replace(/\n/g, " ");
  });
  await check("мини-апп, админ: каждый раздел вкладки «Админ» открывается", async () => {
    const { ctx, page, issues, out } = await crawlMini(ADMIN, "madmin");
    const adminTab = page.locator(".tab-bar-fit button", { hasText: "Админ" });
    assert(await adminTab.count(), "нет вкладки Админ: " + out);
    await adminTab.click();
    await page.waitForLoadState("networkidle");
    await sleep(600);
    const visited = [];
    for (const name of [
      "На подтверждение",
      "Расписание",
      "Выходные",
      "Работники",
      "Группы",
      "Анонсы",
      "Чек-листы",
      "Журнал",
      "Баги",
      "Настройки",
    ]) {
      const l = page.getByText(name, { exact: true }).first();
      assert(await l.count(), "нет пункта " + name);
      await l.click({ timeout: 2000 });
      await page.waitForLoadState("networkidle");
      await sleep(300);
      const c = await crash(page),
        o = await overflow(page);
      visited.push(name);
      const lc = await contrast(page);
      if (lc.length) issues.push(`admin/${name}: нечитаемо ${lc.join(", ")}`);
      if (c.empty) issues.push(`admin/${name}: пустой`);
      if (c.oops) issues.push(`admin/${name}: «${c.oops}»`);
      if (o.sw > o.w + 1 || o.bad.length) issues.push(`admin/${name}: ширина ${JSON.stringify(o)}`);
      await page.screenshot({ path: resolve(shots, `madmin-${name.replace(/ /g, "")}.png`) });
      await page.getByText("Разделы", { exact: false }).first().click({ timeout: 2000 });
      await sleep(250);
    }
    await ctx.close();
    assert(!issues.length, issues.join(" ;; "));
    return visited.join(", ");
  });
  await check(
    "веб-консоль: вход по ссылке из бота, токен убран из адреса, все разделы открываются",
    async () => {
      const ctx = await browser.newContext({
        viewport: { width: 1366, height: 850 },
        locale: "ru-RU",
        timezoneId: "Europe/Moscow",
      });
      await ctx.clock.setFixedTime(new Date());
      const page = await ctx.newPage();
      const issues = [];
      watch(page, issues, "console");
      assert(state.adminLink, "нет ссылки");
      await page.goto(state.adminLink);
      await page.waitForLoadState("networkidle");
      await sleep(600);
      assert(!page.url().includes("token="), "токен остался в адресе");
      const names = await page
        .locator(".sidebar button, aside button, nav button, .sidebar a")
        .evaluateAll((es) => [...new Set(es.map((e) => e.innerText.trim().split("\n")[0]).filter(Boolean))]);
      assert(names.length > 2, "нет меню: " + (await page.innerText("body")).slice(0, 200));
      const seen = [];
      for (const n of names) {
        const l = page
          .locator(".sidebar button, aside button, nav button, .sidebar a")
          .filter({ hasText: n })
          .first();
        try {
          await l.click({ timeout: 1500 });
        } catch {
          continue;
        }
        await page.waitForLoadState("networkidle");
        await sleep(300);
        seen.push(n);
        const c = await crash(page);
        if (c.empty) issues.push(`${n}: пустой`);
        if (c.oops) issues.push(`${n}: «${c.oops}»`);
        await page.screenshot({ path: resolve(shots, `console-${seen.length}.png`) });
      }
      state.ctxAdmin = ctx;
      state.pageAdmin = page;
      assert(!issues.length, issues.join(" ;; "));
      return seen.join(", ");
    },
  );

  await check("UI: консоль — добавить работника кнопками, в ответ инвайт-ссылка", async () => {
    const page = state.pageAdmin;
    await page
      .locator(".sidebar button, aside button, nav button, .sidebar a")
      .filter({ hasText: "Работники" })
      .first()
      .click();
    await sleep(400);
    await page
      .getByRole("button", { name: /Добавить/ })
      .first()
      .click();
    await page.fill("#new-employee-name", "Настя Экранная");
    await page.keyboard.press("Enter");
    await sleep(800);
    await page.screenshot({ path: resolve(shots, "flow-add-employee.png") });
    const inv = await page
      .locator(".panel input")
      .first()
      .inputValue()
      .catch(() => "");
    await page.getByRole("button", { name: "Готово" }).click();
    await sleep(200);
    const l = await j("GET", "/api/admin/employees", { token: state.adm });
    assert(JSON.stringify(l.data).includes("Настя Экранная"), "нет в базе");
    const t = await page.innerText("body");
    assert(/Настя Экранная/.test(t), "нет на экране");
    assert(/t\.me\/e2e_test_bot\?start=/.test(inv), "нет ссылки: " + inv);
  });
  await check("веб-консоль, работники: компактные карточки на телефоне, действия на десктопе", async () => {
    const ctx = await mob(320);
    try {
      const page = await ctx.newPage();
      await page.goto(state.adminLink);
      await page.getByRole("button", { name: "Меню", exact: true }).click();
      await page.getByRole("button", { name: "Работники", exact: true }).click();
      const card = page.locator(".employee-row-card").filter({ hasText: "Настя Экранная" });
      const details = card.getByRole("button", { name: /Настройки.*Настя Экранная/ });
      await card.getByText("не привязан", { exact: true }).waitFor();
      assert(await details.count() === 1, "нет кнопки настроек работника");
      const archive = card.getByRole("button", { name: "Архивировать", exact: true });
      assert(!(await archive.isVisible()), "архивирование видно в компактной строке");
      await details.focus();
      await page.keyboard.press("Enter");
      await archive.waitFor();
      await card.getByRole("button", { name: /Ограничения/ }).click();
      await card.getByRole("checkbox", { name: /Не участвует в обменах/ }).waitFor();
      const layout = await overflow(page);
      assert(layout.sw === layout.w, JSON.stringify(layout));
      await details.click();
      assert(!(await archive.isVisible()), "карточка не свернулась");
      const desktop = state.pageAdmin.locator(".employee-row-card").filter({ hasText: "Настя Экранная" });
      assert(await desktop.getByRole("button", { name: "Архивировать", exact: true }).isVisible(), "на десктопе пропал прямой доступ к действию");
    } finally {
      await ctx.close();
    }
  });
  await check(
    "UI: работник — больничный кнопками; у админа появляется на подтверждении в консоли",
    async () => {
      const { ctx, page, issues } = await crawlMini(W2, "flowsick");
      await page.locator(".tab-bar-fit button").first().click();
      await sleep(300);
      await page.getByText("Больничный", { exact: false }).first().click();
      await sleep(500);
      await page.screenshot({ path: resolve(shots, "flow-sick-form.png") });
      const btn = page
        .locator("button")
        .filter({ hasText: /Записать|Сохранить|Отправить|Поставить|Готово/ })
        .first();
      assert(await btn.count(), "нет кнопки: " + (await page.innerText("body")).slice(0, 200));
      await btn.click();
      await sleep(1000);
      await page.screenshot({ path: resolve(shots, "flow-sick-done.png") });
      const a = await j("GET", "/api/admin/sick-approvals", { token: state.adm });
      assert(a.data.approvals.length >= 1, "заявки нет: " + (await page.innerText("body")).slice(0, 300));
      const q = state.pageAdmin;
      await q
        .locator(".sidebar button, aside button, nav button, .sidebar a")
        .filter({ hasText: "На подтверждение" })
        .first()
        .click();
      await sleep(600);
      const t = await q.innerText("body");
      await q.screenshot({ path: resolve(shots, "flow-sick-console.png") });
      await ctx.close();
      assert(/Марк/.test(t), "в консоли нет: " + t.slice(0, 300));
      assert(!issues.length, issues.join(";;"));
    },
  );
  await check("UI: настройки — выключить напоминания кнопкой, сохраняется на сервере", async () => {
    const { ctx, page } = await crawlMini(W1, "flowset");
    await page.locator(".tab-bar-fit button").first().click();
    await sleep(300);
    await page.getByLabel("Настройки").click();
    await sleep(500);
    await page.screenshot({ path: resolve(shots, "flow-settings.png") });
    const before = (await j("GET", "/api/me", { token: state.w1 })).data.remindersEnabled;
    const sw = page.locator("input[type=checkbox], [role=switch]").first();
    assert(await sw.count(), "нет переключателя");
    await sw.click({ force: true });
    await sleep(800);
    const after = (await j("GET", "/api/me", { token: state.w1 })).data.remindersEnabled;
    await ctx.close();
    assert(before !== after, "не изменилось");
    await j("PATCH", "/api/me/settings", { token: state.w1, body: { remindersEnabled: before } });
  });
  await check("UI: работник — обмен с экрана: своя смена → коллега → письмо коллеге", async () => {
    const day = msk(2);
    const a0 = await j("POST", "/api/admin/entries", {
      token: state.adm,
      body: { employeeId: state.w1id, date: day, start: "05:05", end: "14:00", category: "shift" },
    });
    const b = await j("POST", "/api/admin/entries", {
      token: state.adm,
      body: { employeeId: state.w2id, date: day, start: "13:00", end: "22:00", category: "shift" },
    });
    assert(b.status === 201 && a0.status === 201, "смены " + JSON.stringify(b.data));
    const { ctx, page } = await crawlMini(W1, "flowswap");
    await page.locator(".tab-bar-fit button").first().click();
    await sleep(400);
    const btn = page.locator("button:not([disabled])").filter({ hasText: /обмен/i }).first();
    if (!(await btn.count())) {
      await page.screenshot({ path: resolve(shots, "flow-swap-none.png") });
      const t = await page.innerText("body");
      await ctx.close();
      throw new Error("на экране нет кнопки обмена: " + t.slice(0, 240));
    }
    await btn.click();
    await sleep(700);
    await page.screenshot({ path: resolve(shots, "flow-swap-1.png") });
    const n = tg.sentTo(W2.id).length;
    const cand = page.getByText(/Марк/).first();
    assert(await cand.count(), "коллеги в списке нет: " + (await page.innerText("body")).slice(0, 240));
    await cand.click({ force: true });
    await sleep(300);
    const go = page
      .locator("button")
      .filter({ hasText: /Предложить/ })
      .last();
    await go.click();
    await sleep(1000);
    await page.screenshot({ path: resolve(shots, "flow-swap-2.png") });
    await ctx.close();
    assert(tg.sentTo(W2.id).length > n, "письма нет");
  });
  await check("мини-апп, ТЁМНАЯ тема: разделы админа читаемы", async () => {
    THEME = DARK;
    const { ctx, page, issues } = await crawlMini(ADMIN, "dark-admin");
    await page.locator(".tab-bar-fit button", { hasText: "Админ" }).click();
    await sleep(500);
    for (const name of ["На подтверждение", "Расписание", "Работники", "Журнал", "Настройки"]) {
      await page.getByText(name, { exact: true }).first().click();
      await page.waitForLoadState("networkidle");
      await sleep(250);
      const lc = await contrast(page);
      if (lc.length) issues.push(`${name}: нечитаемо ${lc.join(", ")}`);
      await page.screenshot({ path: resolve(shots, `dark-${name.replace(/ /g, "")}.png`) });
      await page.getByText("Разделы", { exact: false }).first().click();
      await sleep(200);
    }
    await ctx.close();
    THEME = LIGHT;
    assert(!issues.length, issues.join(" ;; "));
  });
  await check("веб-консоль на телефоне: нет вылезания за ширину", async () => {
    const ctx = await mob();
    const page = await ctx.newPage();
    await page.goto(state.adminLink);
    await page.waitForLoadState("networkidle");
    await sleep(500);
    const o = await overflow(page);
    await page.screenshot({ path: resolve(shots, "console-mobile.png") });
    await ctx.close();
    assert(o.sw <= o.w + 1, JSON.stringify(o));
  });
  await check("веб-консоль на телефоне: меню достижимо клавишей Tab и возвращает фокус", async () => {
    const ctx = await mob();
    try {
      const page = await ctx.newPage();
      await page.goto(state.adminLink);
      const menu = page.getByRole("button", { name: "Меню", exact: true });
      await menu.waitFor();
      await page.keyboard.press("Tab");
      assert(await menu.evaluate(el => el === document.activeElement), "первый Tab ушёл в закрытую шторку");
      await page.keyboard.press("Enter");
      const active = page.getByRole("button", { name: /^Расписание/ });
      await page.waitForFunction(() => document.activeElement?.classList.contains("sidebar-nav-item"));
      assert(await active.evaluate(el => el === document.activeElement), "открытая шторка не получила фокус");
      await page.keyboard.press("Shift+Tab");
      const last = page.locator(".sidebar-nav-item").last();
      assert(await last.evaluate(el => el === document.activeElement), "Shift+Tab ушёл за пределы шторки");
      await page.keyboard.press("Tab");
      assert(await active.evaluate(el => el === document.activeElement), "Tab ушёл за пределы шторки");
      await page.keyboard.press("Escape");
      assert(await menu.evaluate(el => el === document.activeElement), "Esc не вернул фокус кнопке меню");

      await page.route("**/api/admin/shortfall", route => route.fulfill({ status: 401, json: { error: "Сессия истекла" } }));
      await page.keyboard.press("Enter");
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      const login = page.getByRole("link", { name: "Открыть бота" });
      await login.waitFor();
      await page.keyboard.press("Tab");
      assert(await login.evaluate(el => el === document.activeElement), "закрытая шторка перехватила Tab на экране входа");
    } finally {
      await ctx.close();
    }
  });
  await check("истёкший токен консоли: уводит на вход, без белого экрана", async () => {
    const ctx = await browser.newContext();
    await ctx.clock.setFixedTime(new Date());
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin/#token=expired.bad.token`);
    await sleep(1500);
    const t = (await page.innerText("body")).trim();
    await ctx.close();
    assert(t.length > 10, "пустой экран");
    return t.slice(0, 90).replace(/\n/g, " ");
  });
  await check("сервер падает при открытом мини-аппе — экран не белый", async () => {
    const ctx = await mob();
    await ctx.route("**/api/**", (r, req) => (req.url().includes("/api/auth") ? r.continue() : r.abort()));
    const page = await ctx.newPage();
    await page.goto(miniUrl(W1));
    await sleep(2500);
    const t = (await page.innerText("body")).trim();
    await page.screenshot({ path: resolve(shots, "api-down.png") });
    await ctx.close();
    assert(t.length > 10, "пустой экран");
    return t.slice(0, 90).replace(/\n/g, " ");
  });
  await browser.close();
}
