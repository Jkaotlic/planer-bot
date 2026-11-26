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
  const rateLimitNextPollFor = new Map();
  const pollsByMessage = new Map();
  const pollsById = new Map();
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
      const call = { method, body, at: Date.now() };
      calls.push(call);
      if (method === "sendPoll" && rateLimitNextPollFor.has(body.chat_id)) {
        const retry_after = rateLimitNextPollFor.get(body.chat_id);
        rateLimitNextPollFor.delete(body.chat_id);
        res.statusCode = 429;
        return send({ ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after } });
      }
      if (failFor.has(body.chat_id)) {
        res.statusCode = 403;
        return send({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" });
      }
      if (/^send/.test(method)) {
        call.messageId = ++msgId;
        call.messageDate = Math.floor(Date.now() / 1000);
        const poll = method === "sendPoll" ? {
          id: `native-${call.messageId}`, question: body.question, type: "regular",
          is_anonymous: body.is_anonymous ?? true, allows_multiple_answers: body.allows_multiple_answers ?? false,
          total_voter_count: 0, is_closed: false,
          options: body.options.map((option, index) => ({
            persistent_id: String(index), text: typeof option === "string" ? option : option.text, voter_count: 0,
          })),
        } : undefined;
        if (poll) {
          call.pollId = poll.id;
          pollsByMessage.set(`${body.chat_id}:${call.messageId}`, poll);
          pollsById.set(poll.id, { poll, chatId: Number(body.chat_id) });
        }
        return send({
          ok: true,
          result: {
            message_id: call.messageId,
            date: call.messageDate,
            chat: { id: Number(body.chat_id) || 1, type: "private" },
            ...(poll ? { poll } : { text: body.text ?? "" }),
          },
        });
      }
      if (method === "stopPoll") {
        const poll = pollsByMessage.get(`${body.chat_id}:${body.message_id}`);
        if (!poll) return send({ ok: false, error_code: 400, description: "Bad Request: poll not found" });
        poll.is_closed = true;
        return send({ ok: true, result: poll });
      }
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
    rateLimitNextPollFor,
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
    voteNative: (id, name, pollId, optionIds, emit = true) => {
      const answer = pollsById.get(pollId);
      if (answer?.chatId === id && !answer.poll.is_closed) {
        answer.poll.total_voter_count = Number(optionIds.length > 0);
        answer.poll.options.forEach((option, index) => {
          option.voter_count = Number(optionIds.includes(index));
        });
      }
      if (emit) push({ poll_answer: {
        poll_id: pollId, user: from(id, name), option_ids: optionIds, option_persistent_ids: optionIds.map(String),
      } });
    },
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
