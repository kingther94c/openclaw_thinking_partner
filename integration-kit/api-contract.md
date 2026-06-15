# Trade Advisor API — Contract

A stable, OpenAI-compatible surface. **Depend only on what is documented here.**

## Base

- Base URL: `http://127.0.0.1:18789/v1` (loopback by default).
- Auth: send `Authorization: Bearer <token>` on every request. Token is
  `gateway.auth.token` in `~/.openclaw/openclaw.json`. Missing/wrong → HTTP 401.

## Endpoints

### `POST /v1/chat/completions`

Standard OpenAI Chat Completions. Minimal request body:

```json
{
  "model": "openclaw/trade-advisor",
  "messages": [{ "role": "user", "content": "..." }]
}
```

Supported request fields (safe subset): `model`, `messages` (roles
`system`/`developer`/`user`/`assistant`/`tool`), `stream`, `temperature`,
`top_p`, `max_tokens` / `max_completion_tokens`, `response_format`, `stop`,
`frequency_penalty`, `presence_penalty`, `seed`, `tools` + `tool_choice`
(function tools), `user`.

Special header: `x-openclaw-session-key: <id>` — see `memory-and-modes.md`.

Response: a standard `chat.completion` object. Read:

- `choices[0].message.content` — the advisory text.
- `choices[0].finish_reason` — `stop` or `tool_calls`.
- `usage.{prompt_tokens,completion_tokens,total_tokens}`.

With `"stream": true` you get SSE `chat.completion.chunk` events, terminated by
`data: [DONE]`.

Errors: OpenAI-style `{ "error": { "message", "type" } }` with the matching HTTP
status (400 invalid request, 401 auth, 5xx upstream/model).

### `GET /v1/models`

Lists available model ids, e.g. `openclaw`, `openclaw/default`,
`openclaw/trade-advisor`, `openclaw/trade-advisor-panel`. Call this to discover
agent ids at runtime instead of assuming they exist.

## `model` values (what to pass)

| model                            | meaning                                                |
| -------------------------------- | ------------------------------------------------------ |
| `openclaw/trade-advisor`         | shared-memory advisor (default persona)                |
| `openclaw/trade-advisor-panel`   | isolated per-conversation advisor (panels / role-play) |
| `openclaw` or `openclaw/default` | the configured default agent (currently trade-advisor) |

Do **not** pass a raw provider model id (e.g. a `gpt-5.x` string). The
underlying model is an internal detail and may change — pick the `openclaw/<agent>`
id and let the provider route it. (See `boundaries.md`.)

## Examples

Python (stdlib only — no dependency; mirrors how the network call should be isolated):

```python
import json, os, urllib.request

def ask(message, *, session_key=None, model="openclaw/trade-advisor"):
    token = os.environ["OPENCLAW_GATEWAY_TOKEN"]  # never hardcode
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": message}]}).encode()
    req = urllib.request.Request("http://127.0.0.1:18789/v1/chat/completions", data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {token}")
    if session_key:
        req.add_header("x-openclaw-session-key", session_key)
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.load(r)
    return data["choices"][0]["message"]["content"]
```

Python (OpenAI SDK):

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:18789/v1", api_key="<token>")
r = client.chat.completions.create(
    model="openclaw/trade-advisor",
    messages=[{"role": "user", "content": "..."}],
    extra_headers={"x-openclaw-session-key": "conv-123"},
)
print(r.choices[0].message.content)
```

curl:

```bash
curl -s http://127.0.0.1:18789/v1/chat/completions \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -H "x-openclaw-session-key: conv-123" \
  -d '{"model":"openclaw/trade-advisor","messages":[{"role":"user","content":"..."}]}'
```
