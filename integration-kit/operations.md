# Operations & Troubleshooting (consumer side)

You don't run the provider, but you need to know it's up and how to react when
it isn't.

## Confirm the gateway is up

```bash
curl -s -o NUL -w "%{http_code}" \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
  http://127.0.0.1:18789/v1/models
# 200 = up and authorized
```

A robust client should treat a failed `GET /v1/models` (or a connection error on
`/v1/chat/completions`) as "provider unavailable" and degrade gracefully —
cache the last good advisory, skip the step, or surface a clear message. Do not
crash the whole pipeline because the advisor is down.

## Getting the token

The token lives at `gateway.auth.token` in `~/.openclaw/openclaw.json`. In your
project, surface it via an env var / secret (e.g. `OPENCLAW_GATEWAY_TOKEN`) and
read that — do not read the provider's config file from your code in production,
and never commit the value.

## If the gateway is NOT running

Starting it is the **operator's** job, not yours. The owner starts it from the
provider repo (FYI; full runbook at `../docs/architecture/trade-advisor.md`):

```
OPENCLAW_SKIP_CHANNELS=1 node scripts/run-node.mjs gateway run   # binds 127.0.0.1:18789
```

## Common errors

| Symptom                                 | Likely cause                                                       | What you do                                            |
| --------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| Connection refused / timeout on connect | gateway not running                                                | fail soft; ask the owner to start it                   |
| HTTP 401                                | missing/wrong bearer token                                         | check `OPENCLAW_GATEWAY_TOKEN`                         |
| HTTP 400 `invalid_request_error`        | bad body (e.g. `model` not `openclaw/<agent>`, malformed messages) | fix the request per `api-contract.md`                  |
| Empty/short or slow responses           | model thinking level / quota pressure                              | retry sparingly; check quota with the owner            |
| Advisory mentions facts you didn't send | ChatGPT account-memory leak                                        | add the data-only prompt guard (`memory-and-modes.md`) |
| HTTP 5xx / `api_error`                  | upstream/model error                                               | transient — back off and retry once, then degrade      |

## Quota awareness

Codex usage runs on the owner's ChatGPT subscription with rolling limits. If you
see throttling or refusals, you may have hit a window — back off, batch, and
coordinate with the owner rather than retrying in a loop.
