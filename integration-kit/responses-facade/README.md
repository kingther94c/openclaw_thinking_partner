# Responses API Facade — Usage Guide

An **OpenAI Responses API** front door for the Trade Advisor gateway.

The endpoint **shape** is simulated; the **answer is real**. Every request is
translated into the gateway's `/v1/chat/completions`, answered by the same
Codex-backed agents as the main API, and re-dressed as a Responses object.

Use this when your client (or SDK) speaks `POST /v1/responses` instead of
`/v1/chat/completions`, or when you need an endpoint that accepts **any** API
key for local testing.

> Loopback only. It holds the real gateway token in memory, so it must never be
> bound to a public interface. See `../boundaries.md`.

## 60-second quickstart

```bash
curl http://127.0.0.1:18790/v1/responses \
  -H "Authorization: Bearer anything-you-like" \
  -H "Content-Type: application/json" \
  -d '{"model":"openclaw/trade-advisor","input":"Summarise today NVDA setup in 2 lines."}'
```

- Endpoint: `POST http://127.0.0.1:18790/v1/responses`
- Auth: `Authorization: Bearer <any value>`. The **form** is required (no header → `401`); the **value** is ignored.
- Model: same ids as the main API — `openclaw/trade-advisor` (shared memory), `openclaw/trade-advisor-panel` (isolated), `openclaw/mh-*`.
- Memory: send `x-openclaw-session-key: <conversation-id>`; it is forwarded to the gateway unchanged.

### Why any key works

The facade does **not** authenticate you — it authenticates _itself_ to the
gateway using `OPENCLAW_GATEWAY_TOKEN` from its own environment. Your bearer
token is accepted and discarded. That is deliberate (it makes the endpoint drop-in
for clients that require _some_ key), and it is exactly why this must stay on
loopback: anyone who can reach the port can spend your quota.

## Request

| Field                    | Supported    | Notes                                                                      |
| ------------------------ | ------------ | -------------------------------------------------------------------------- |
| `input`                  | **required** | String, or the message-item array form.                                    |
| `model`                  | yes          | Defaults to `openclaw/trade-advisor`.                                      |
| `instructions`           | yes          | Becomes a leading `system` message.                                        |
| `stream`                 | yes          | SSE. See below.                                                            |
| `temperature`, `top_p`   | yes          | Passed through.                                                            |
| `max_output_tokens`      | yes          | Mapped to `max_completion_tokens`.                                         |
| tools / function calling | **no**       | Non-message input items are skipped. Use `/v1/chat/completions` for tools. |

Both `input` forms work:

```jsonc
// bare string
{ "input": "What changed in gold overnight?" }

// message items with typed parts
{
  "instructions": "Be terse.",
  "input": [
    { "type": "message", "role": "user",
      "content": [{ "type": "input_text", "text": "What changed in gold overnight?" }] }
  ]
}
```

## Response

A standard Responses object. Read `output_text` for the simple case:

```jsonc
{
  "id": "resp_…",
  "object": "response",
  "status": "completed",
  "model": "openclaw/trade-advisor",
  "output": [
    {
      "type": "message",
      "role": "assistant",
      "status": "completed",
      "content": [{ "type": "output_text", "text": "…", "annotations": [] }],
    },
  ],
  "output_text": "…",
  "usage": { "input_tokens": 14838, "output_tokens": 56, "total_tokens": 14894 },
}
```

`usage` carries **real** gateway token counts, streaming included.

### Streaming

With `"stream": true` you get `text/event-stream`:

| Event                        | Payload                                    |
| ---------------------------- | ------------------------------------------ |
| `response.created`           | skeleton response, `status: "in_progress"` |
| `response.output_text.delta` | `{ delta: "…" }`, one per upstream chunk   |
| `response.completed`         | full response object incl. final `usage`   |

Terminated by `data: [DONE]`.

```bash
curl -N http://127.0.0.1:18790/v1/responses \
  -H "Authorization: Bearer test" -H "Content-Type: application/json" \
  -d '{"model":"openclaw/trade-advisor-panel","input":"Count 1 to 5.","stream":true}'
```

### Errors

OpenAI-style `{ "error": { "message", "type" } }`.

| Status        | Meaning                                                                              |
| ------------- | ------------------------------------------------------------------------------------ |
| `400`         | Body is not JSON, or `input` missing/empty.                                          |
| `401`         | No `Authorization: Bearer …` header at all.                                          |
| `404` / `405` | Wrong path or verb.                                                                  |
| `413`         | Body over 20 MB.                                                                     |
| `502`         | Gateway unreachable — it is probably down (`../operations.md`).                      |
| other         | Passed through from the gateway (e.g. its own `401` if the facade's token is stale). |

## Running it

Autostarted next to the gateway (see below). To run it by hand:

```bash
node integration-kit/responses-facade/responses-facade.mjs
```

Health check, no auth needed:

```bash
curl http://127.0.0.1:18790/healthz
```

### Configuration

| Env                      | Default                  | Purpose                                                                              |
| ------------------------ | ------------------------ | ------------------------------------------------------------------------------------ |
| `OPENCLAW_GATEWAY_TOKEN` | —                        | **Required.** Real gateway token. Without it every call returns the gateway's `401`. |
| `PORT`                   | `18790`                  | Facade listen port.                                                                  |
| `UPSTREAM`               | `http://127.0.0.1:18789` | Gateway base URL.                                                                    |
| `DEFAULT_MODEL`          | `openclaw/trade-advisor` | Used when the request omits `model`.                                                 |
| `VERBOSE`                | on                       | Set `VERBOSE=0` to silence the per-request log.                                      |

### Autostart

`start-gateway.bat` (in `%LOCALAPPDATA%\openclaw-gateway\`) launches the facade
in the background before the gateway, so both come up together at login. It
clears any stale listener on the port first, which keeps restarts idempotent.

Log: `%LOCALAPPDATA%\openclaw-gateway\logs\responses-facade.out.log`
(overwritten each launch, same as the gateway log).

If a second instance ever starts anyway, it detects `EADDRINUSE`, logs it, and
exits `0` rather than crash-looping — the already-running one keeps serving.

## Troubleshooting

| Symptom                              | Cause                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `502 upstream unreachable`           | Gateway down. Check port 18789 and the gateway log.                                                                                        |
| Upstream `401` passed through        | `OPENCLAW_GATEWAY_TOKEN` missing or stale in the facade's environment. It is read at **start**, so restart after rotating the token.       |
| `400 request body is not valid JSON` | Usually a UTF-8 BOM or shell quoting. The facade strips a leading BOM; on Windows write the body to a file and use `curl -d "@body.json"`. |
| Empty `output_text`                  | The agent returned tool calls only — unsupported here, use `/v1/chat/completions`.                                                         |
| Port already in use at boot          | Expected and harmless; the duplicate exits `0`.                                                                                            |

## Relationship to the gateway's own `/v1/responses`

OpenClaw ships a **native** OpenResponses endpoint (`src/gateway/openresponses-http.ts`),
disabled by default (`gateway.http.responses.enabled`). Enable it with:

```jsonc
{ "gateway": { "http": { "responses": { "enabled": true } } } }
```

Pick deliberately:

- **Native** — one less hop and process, richer input support (files, images). Enforces the **real** gateway token; arbitrary keys are rejected.
- **This facade** — accepts any key, and keeps a single auth story with `/v1/chat/completions`. Text in, text out.

They can run side by side: native on `18789`, facade on `18790`.
