#!/usr/bin/env node
/**
 * OpenAI Responses API facade over the OpenClaw gateway.
 *
 * The endpoint SHAPE is simulated; the answer is real. Every request is
 * translated to the gateway's /v1/chat/completions and the reply is re-dressed
 * as a Responses API object.
 *
 * Any `Authorization: Bearer <value>` is accepted -- that is the point. The
 * real gateway token is read from the environment and never comes from the
 * caller, so this must stay bound to loopback.
 *
 *   node integration-kit/responses-facade/responses-facade.mjs
 *
 * Env: PORT (18790), UPSTREAM (http://127.0.0.1:18789), DEFAULT_MODEL,
 *      OPENCLAW_GATEWAY_TOKEN (required), VERBOSE=0 to quiet the log.
 */
import { randomUUID } from "node:crypto";
import http from "node:http";

const PORT = Number(process.env.PORT ?? 18790);
const UPSTREAM = (process.env.UPSTREAM ?? "http://127.0.0.1:18789").replace(/\/+$/, "");
const UPSTREAM_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN ?? "";
const DEFAULT_MODEL = process.env.DEFAULT_MODEL ?? "openclaw/trade-advisor";
const VERBOSE = process.env.VERBOSE !== "0";

if (!UPSTREAM_TOKEN) {
  console.error("[facade] OPENCLAW_GATEWAY_TOKEN is not set; upstream calls will 401.");
}

const log = (...args) => {
  if (VERBOSE) {
    console.error(`[facade ${new Date().toISOString()}]`, ...args);
  }
};

/** Collects a request body with a hard cap so a bad client cannot exhaust memory. */
function readBody(req, limitBytes = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error("request body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Flattens one Responses `content` value into plain text. */
function partsToText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      // input_text / output_text / text all carry the payload on `.text`.
      if (part && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("");
}

/**
 * Maps a Responses request onto Chat Completions messages.
 * `input` is either a bare string or the message-item array form.
 */
function toChatMessages(body) {
  const messages = [];
  if (typeof body.instructions === "string" && body.instructions.trim()) {
    messages.push({ role: "system", content: body.instructions });
  }
  const input = body.input;
  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
    return messages;
  }
  if (!Array.isArray(input)) {
    return messages;
  }
  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue;
    }
    // Only message items carry conversational text; skip tool/function items.
    if (item.type && item.type !== "message") {
      continue;
    }
    const text = partsToText(item.content);
    if (!text) {
      continue;
    }
    const role = item.role === "developer" ? "system" : (item.role ?? "user");
    messages.push({ role, content: text });
  }
  return messages;
}

/** Builds the Responses-shaped envelope around finished assistant text. */
function toResponsesObject({ id, model, text, usage, status = "completed" }) {
  return {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status,
    model,
    output: [
      {
        type: "message",
        id: `msg_${randomUUID().replace(/-/g, "")}`,
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    // SDK convenience mirror of output[0].content[0].text.
    output_text: text,
    usage: {
      input_tokens: usage?.prompt_tokens ?? 0,
      output_tokens: usage?.completion_tokens ?? 0,
      total_tokens: usage?.total_tokens ?? 0,
    },
  };
}

function sendJson(res, status, payload) {
  const buf = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": String(buf.length),
  });
  res.end(buf);
}

function sendError(res, status, message, type = "invalid_request_error") {
  sendJson(res, status, { error: { message, type } });
}

/** Forwards to the gateway, carrying the session key through when supplied. */
async function callUpstream(payload, sessionKey) {
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${UPSTREAM_TOKEN}`,
  };
  if (sessionKey) {
    headers["x-openclaw-session-key"] = sessionKey;
  }
  return fetch(`${UPSTREAM}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

async function handleResponses(req, res, body) {
  let parsed;
  try {
    // Windows clients (PowerShell `-Encoding utf8`, some editors) prepend a
    // UTF-8 BOM that JSON.parse rejects outright.
    parsed = JSON.parse(body.replace(/^﻿/, "") || "{}");
  } catch {
    sendError(res, 400, "request body is not valid JSON");
    return;
  }

  const messages = toChatMessages(parsed);
  if (messages.length === 0) {
    sendError(res, 400, "`input` is required and must contain text");
    return;
  }

  const model = parsed.model || DEFAULT_MODEL;
  const wantsStream = parsed.stream === true;
  const sessionKey = req.headers["x-openclaw-session-key"];

  const upstreamPayload = { model, messages, stream: wantsStream };
  if (wantsStream) {
    // Without this the chunk stream carries no usage, and the terminal
    // response.completed event would report zero tokens.
    upstreamPayload.stream_options = { include_usage: true };
  }
  if (typeof parsed.temperature === "number") {
    upstreamPayload.temperature = parsed.temperature;
  }
  if (typeof parsed.top_p === "number") {
    upstreamPayload.top_p = parsed.top_p;
  }
  if (typeof parsed.max_output_tokens === "number") {
    upstreamPayload.max_completion_tokens = parsed.max_output_tokens;
  }

  log(`-> ${model} (${messages.length} msg, stream=${wantsStream})`);

  let upstream;
  try {
    upstream = await callUpstream(upstreamPayload, sessionKey);
  } catch (error) {
    sendError(res, 502, `upstream unreachable: ${error.message}`, "upstream_error");
    return;
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    log(`<- upstream ${upstream.status}`);
    sendError(res, upstream.status, `upstream error: ${detail.slice(0, 500)}`, "upstream_error");
    return;
  }

  const responseId = `resp_${randomUUID().replace(/-/g, "")}`;

  if (!wantsStream) {
    const json = await upstream.json();
    const text = json?.choices?.[0]?.message?.content ?? "";
    log(`<- ${text.length} chars`);
    sendJson(res, 200, toResponsesObject({ id: responseId, model, text, usage: json?.usage }));
    return;
  }

  // Streaming: translate chat.completion.chunk deltas into Responses events.
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const emit = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const skeleton = toResponsesObject({ id: responseId, model, text: "", status: "in_progress" });
  emit("response.created", { type: "response.created", response: skeleton });

  let full = "";
  let usage;
  let buffer = "";
  for await (const chunk of upstream.body) {
    buffer += Buffer.from(chunk).toString("utf8");
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) {
        continue;
      }
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") {
        continue;
      }
      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      if (event.usage) {
        usage = event.usage;
      }
      const delta = event?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) {
        full += delta;
        emit("response.output_text.delta", {
          type: "response.output_text.delta",
          response_id: responseId,
          delta,
        });
      }
    }
  }

  emit("response.completed", {
    type: "response.completed",
    response: toResponsesObject({ id: responseId, model, text: full, usage }),
  });
  res.write("data: [DONE]\n\n");
  res.end();
  log(`<- streamed ${full.length} chars`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    sendJson(res, 200, { ok: true, upstream: UPSTREAM, defaultModel: DEFAULT_MODEL });
    return;
  }

  if (url.pathname !== "/v1/responses") {
    sendError(res, 404, `unknown route ${req.method} ${url.pathname}`, "not_found");
    return;
  }
  if (req.method !== "POST") {
    sendError(res, 405, "use POST /v1/responses", "method_not_allowed");
    return;
  }

  // The form is enforced, the value is not: any bearer token is accepted.
  const auth = req.headers.authorization ?? "";
  if (!/^Bearer\s+\S+/i.test(auth)) {
    sendError(res, 401, "missing Authorization: Bearer <any value>", "authentication_error");
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    sendError(res, error.status ?? 400, error.message);
    return;
  }

  try {
    await handleResponses(req, res, body);
  } catch (error) {
    log("handler error:", error);
    if (!res.headersSent) {
      sendError(res, 500, `facade error: ${error.message}`, "server_error");
    } else {
      res.end();
    }
  }
});

// Autostart runs this next to the gateway, so a leftover instance must not turn
// a restart into a crash loop -- exit quietly and let the existing one serve.
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`[facade] port ${PORT} already in use; another instance is serving. Exiting.`);
    process.exit(0);
  }
  console.error(`[facade] fatal: ${error.message}`);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

server.listen(PORT, "127.0.0.1", () => {
  console.error(`[facade] POST http://127.0.0.1:${PORT}/v1/responses -> ${UPSTREAM}`);
  console.error(`[facade] default model: ${DEFAULT_MODEL}; any bearer token accepted`);
});
