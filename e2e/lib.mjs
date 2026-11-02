// Подпись initData и фейковый Bot API. Режимы down и hang повторяют то, как у нас на
// самом деле рвётся путь до Telegram: 502 релея и соединение, которое молчит.
import http from "node:http";
import { createHmac } from "node:crypto";
export const BOT_TOKEN = "123456:E2E-FAKE-TOKEN-not-real";
export function initData(user, age = 0, signature = true) {
  const p = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000) - age),
    query_id: "e2e",
    user: JSON.stringify(user),
    ...(signature ? { signature: "e2e-signature" } : {}),
  });
  const dcs = [...p.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const key = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  p.set("hash", createHmac("sha256", key).update(dcs).digest("hex"));
  return p.toString();
}
export function fakeTelegram(port) {
  const state = { mode: "up", hung: [] };
  const calls = [];
  let queue = [];
  let waiters = [];
  let updId = 1;
  let msgId = 1000;
  const failFor = new Set();
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const m = req.url.match(/^\/bot[^/]+\/(\w+)/);
      const method = m?.[1] ?? "?";
      if (state.mode === "hang") {
        state.hung.push(res);
        return;
      }
      if (state.mode === "down") {
        res.statusCode = 502;
        return res.end("bad gateway");
      }
      let body = {};
      const raw = Buffer.concat(chunks);
      try {
        body = JSON.parse(raw.toString() || "{}");
      } catch {
        body = { _binary: raw.length };
      }
      const send = (o) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(o));
      };
      if (method === "getMe")
        return send({
          ok: true,
          result: {
            id: 123456,
            is_bot: true,
            first_name: "E2E",
            username: "e2e_test_bot",
            can_join_groups: true,
            can_read_all_group_messages: false,
            supports_inline_queries: false,
          },
        });
      if (method === "getUpdates") {
        const offset = body.offset ?? 0;
        queue = queue.filter((u) => u.update_id >= offset);
        if (queue.length) return send({ ok: true, result: queue.splice(0) });
        const t = setTimeout(() => {
          waiters = waiters.filter((w) => w !== flush);
          send({ ok: true, result: [] });
        }, 800);
        const flush = () => {
          clearTimeout(t);
          send({ ok: true, result: queue.splice(0) });
        };
        waiters.push(flush);
        return;
      }
      calls.push({ method, body, at: Date.now() });
      if (failFor.has(body.chat_id)) {
        res.statusCode = 403;
        return send({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" });
      }
      if (/^send/.test(method))
        return send({
          ok: true,
          result: {
            message_id: ++msgId,
            date: Math.floor(Date.now() / 1000),
            chat: { id: Number(body.chat_id) || 1, type: "private" },
            text: body.text ?? "",
          },
        });
      if (/^edit/.test(method))
        return send({
          ok: true,
          result: {
            message_id: body.message_id ?? ++msgId,
            date: Math.floor(Date.now() / 1000),
            chat: { id: Number(body.chat_id) || 1, type: "private" },
            text: body.text ?? "",
          },
        });
      send({ ok: true, result: true });
    });
  });
  const push = (u) => {
    queue.push({ update_id: updId++, ...u });
    waiters.splice(0).forEach((f) => f());
  };
  const from = (id, name) => ({
    id,
    is_bot: false,
    first_name: name,
    username: `u${id}`,
    language_code: "ru",
  });
  return {
    state,
    setMode: (m) => {
      state.mode = m;
      if (m === "up") {
        state.hung.splice(0).forEach((r) => r.destroy());
      }
    },
    calls,
    failFor,
    listen: () => new Promise((r) => srv.listen(port, "127.0.0.1", r)),
    close: () => {
      srv.closeAllConnections();
      srv.close();
    },
    text: (id, name, text) => {
      const entities = text.startsWith("/")
        ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }]
        : undefined;
      push({
        message: {
          message_id: ++msgId,
          date: Math.floor(Date.now() / 1000),
          chat: { id, type: "private", first_name: name },
          from: from(id, name),
          text,
          entities,
        },
      });
    },
    tap: (id, name, data, message = {}) =>
      push({
        callback_query: {
          id: String(++msgId),
          from: from(id, name),
          chat_instance: "e2e",
          data,
          message: {
            message_id: message.message_id ?? ++msgId,
            date: Math.floor(Date.now() / 1000),
            chat: { id, type: "private" },
            text: message.text ?? "x",
            ...message,
          },
        },
      }),
    sentTo: (id) => calls.filter((c) => String(c.body.chat_id) === String(id) && c.body.text),
  };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(fn, ms = 6000, step = 100) {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) {
    v = await fn();
    if (v) return v;
    await sleep(step);
  }
  return v;
}
