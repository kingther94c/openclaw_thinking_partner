# Boundaries

Read this before building. These are the lines that keep your integration stable
and safe.

## Depend on this (stable)

- The **OpenAI Chat Completions wire format** (`POST /v1/chat/completions`,
  `GET /v1/models`) and the safe request/response subset in `api-contract.md`.
- The **`openclaw/<agent>` model ids** (`openclaw/trade-advisor`,
  `openclaw/trade-advisor-panel`) — discover via `GET /v1/models`.
- The **`x-openclaw-session-key`** header for memory.
- Bearer-token auth.

## Do NOT depend on (unstable / internal)

- The **underlying provider model** (e.g. a `gpt-5.x` id) or that it is Codex at
  all. Use the `openclaw/<agent>` id; the routing/model can change.
- Any **non-documented endpoint** (gateway server-methods, Control UI,
  `/v1/responses`, internal admin routes) — they are not your contract.
- Provider **internals**: `~/.openclaw` layout, config keys, `codex-home`,
  on-disk session/memory files, prompt internals.
- Response fields **beyond** the standard OpenAI ones.
- **Exact latency / token counts** — they vary (model, thinking level, history).

## Don't touch the provider

- Integrate **only through the HTTP API**. Do not modify this repo, the
  `~/.openclaw` config, agents, or `SOUL.md` from your project.
- Do not start/stop/reconfigure the gateway from your code. Assume the operator
  runs it; **fail soft** if it is unreachable (see `operations.md`).
- If you need a new agent/persona, a config change, or a new capability on the
  provider side, **request it** from the provider owner — don't reach in.

## Security

- The endpoint is **loopback-only** by default and gated by a bearer token.
  Keep it that way. Do not proxy/expose the port publicly without the owner's
  explicit hardening (TLS, auth, rate limits).
- The token is a secret: read from env/secret store, **never** hardcode, log, or
  commit it. Don't print it in artifacts.
- Output is **informational analysis only** — not financial advice, and the
  system performs **no order/trade execution**. Keep your usage read-only too.

## Quota & rate (be a good neighbor)

- This runs on the **owner's personal ChatGPT/Codex subscription**, which has
  rolling usage limits (e.g. multi-hour and weekly windows). Heavy automated
  calling can exhaust them.
- Prefer **batching/caching** (e.g. dedupe by an input hash), avoid tight retry
  loops, and set sane timeouts. Each call can carry a large system prompt, so
  calls are not free.

## Availability

- A single local long-running process — **not** highly available. Expect cold
  starts and occasional restarts. Treat connection errors as transient and
  degrade gracefully (cache last good result, surface a clear message).

## Compatibility note

This provider is a fork of OpenClaw. The **OpenAI-compatible surface is the
contract**; the fork keeps it stable and may swap internals underneath. Pin to
this kit, not to anything you discover by inspecting the provider.
