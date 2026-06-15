# Memory & Modes

## Session memory (the `x-openclaw-session-key` header)

The server keys a conversation off the `x-openclaw-session-key` request header:

- **Reuse a stable key** across calls → the server keeps the conversation
  (with automatic compaction). Send **only the new user turn** each call; do
  not resend prior history.
- **Omit the key** → each call gets a fresh, stateless session (the server
  makes a random one per request).
- Different keys are **independent conversations** (isolated transcripts).

You may also pass the OpenAI `user` field; if present, it seeds a per-user
session key. The explicit header takes precedence.

## Two modes (choose via `model`)

| Mode                 | model                          | Use when                                                                                                                                                               |
| -------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shared**           | `openclaw/trade-advisor`       | a single persistent advisor that may remember across conversations                                                                                                     |
| **Isolated / panel** | `openclaw/trade-advisor-panel` | each conversation must stay independent (e.g. a role-play panel of personas); per-conversation transcript isolation + the provider's cross-agent memory layer disabled |

For a panel of personas, give each panelist its **own session key** (and use
the panel model). Keep them on distinct keys to prevent transcript bleed.

## Memory layers (so you know what is and isn't isolated)

| Layer                            | Scope                         | Isolated by                                     |
| -------------------------------- | ----------------------------- | ----------------------------------------------- |
| Session transcript               | per `x-openclaw-session-key`  | the header — different key = clean conversation |
| Provider memory-core             | per agent                     | off on the panel model                          |
| **ChatGPT/Codex account memory** | the **whole** ChatGPT account | **not controllable via this API**               |

> **Important caveat.** Because the model runs through Codex on a single ChatGPT
> account, high-level "profile" facts that ChatGPT auto-remembers are shared
> across _every_ session and agent on that account. Conversation transcripts are
> isolated by session key, but those account-level facts can leak in.
>
> **Mitigation (do this in your prompts):** explicitly instruct the model to use
> _only_ the data you provide and ignore any remembered facts about the user's
> currency, accounts, or allocations. This strongly suppresses the leak. For an
> absolute guarantee, the account owner must disable memory in ChatGPT settings
> (that is outside this API).
