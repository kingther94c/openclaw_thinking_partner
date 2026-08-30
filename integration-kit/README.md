# Thinking Partner — Trade Advisor API: Integration Kit

This folder is the **consumer integration kit** for the Thinking Partner
"Trade Advisor" API. It is written for an external developer or agent (e.g. the
`market_helper` project) that wants to call this API to get LLM advisories.

**You are the consumer.** This API is provided by a local OpenClaw gateway (a
fork called "Thinking Partner") backed by Codex (ChatGPT OAuth). You talk to it
as a standard **OpenAI-compatible** HTTP endpoint — nothing more.

> You integrate **against the HTTP API only**. Do not modify this repo or the
> provider's `~/.openclaw` config from your project. See `boundaries.md`.

## Read in this order

1. **`api-contract.md`** — the stable endpoint / request / response contract + examples. Start here.
2. **`memory-and-modes.md`** — session memory, shared vs isolated/panel modes, and the account-memory caveat.
3. **`boundaries.md`** — what you may depend on, what you must NOT, security + quota limits. **Read before building.**
4. **`operations.md`** — confirming the gateway is up, health checks, troubleshooting.

Optional: **`responses-facade/README.md`** — an OpenAI **Responses API**
(`POST /v1/responses`) front door on port 18790, if your client speaks that
instead of chat-completions. Same agents, same answers.

## 60-second quickstart

- Endpoint: `POST http://127.0.0.1:18789/v1/chat/completions` (OpenAI-compatible).
- Auth: `Authorization: Bearer <token>` — token is `gateway.auth.token` in `~/.openclaw/openclaw.json`. Read it from your own env/secret (e.g. `OPENCLAW_GATEWAY_TOKEN`); never hardcode or commit it.
- Model: `openclaw/trade-advisor` (shared memory) or `openclaw/trade-advisor-panel` (isolated).
- Memory: send header `x-openclaw-session-key: <conversation-id>` to keep server-side memory across calls (then send only the new turn); omit it for a stateless call.
- Prereq: the gateway must be running (see `operations.md`). If it is down, calls fail with a connection error — handle it gracefully.

## Golden rules (short version)

- Depend on the **OpenAI chat-completions contract** + the `openclaw/<agent>` model ids + the `x-openclaw-session-key` header. Nothing else.
- Treat it as **localhost-only and informational** (analysis, not orders or financial advice).
- It runs on a **personal ChatGPT/Codex subscription** with usage quotas. Don't hammer it; cache where sensible.
- Full operator/setup runbook (the provider side, FYI only): `../docs/architecture/trade-advisor.md`.
