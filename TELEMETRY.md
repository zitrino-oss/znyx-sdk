# Telemetry

The ZNYX SDKs send **anonymous install telemetry** so we can understand which
languages, versions, and platforms are in active use and prioritize accordingly.
It is **on by default** and designed to be fully transparent and auditable — this
document describes exactly what is sent, when, and how to turn it off.

## What is collected

A single JSON payload with non-sensitive metadata only:

| Field | Example | Description |
|-------|---------|-------------|
| `install_id` | `3f9c…` (random UUID v4) | Random identifier generated on first run, persisted to `~/.znyx/sdk-state.json`. Not tied to you, your account, or your machine's identity. |
| `version` | `1.0.1` | The SDK package version. |
| `source` | `python-sdk` | Which SDK sent the ping (`python-sdk`, `node-sdk`, `java-sdk`, `ruby-sdk`, `dotnet-sdk`, `rust-sdk`). |
| `event_type` | `first_run` / `heartbeat` | Whether this is the first ping or a periodic one. |
| `os` / `os_version` / `arch` | `Linux` / `6.1.0` / `x86_64` | Operating system, release, and CPU architecture. |
| language runtime version | `3.11.4` | e.g. Python/Node/Java/Ruby/.NET/Rust runtime version (where available). |
| `run_count` | `7` | How many times a client has been constructed on this install. |
| `timestamp` | ISO 8601 | When the ping was generated. |

**We do NOT collect:**

- ❌ No personally identifiable information (PII)
- ❌ No request or response content (prompts, completions, tool args, etc.)
- ❌ No tenant, org, app, or API-key data
- ❌ No IP-based tracking or fingerprinting

## When it is sent

- One **first-run** ping the first time an SDK client is constructed on an install.
- After that, at most **one ping per 24 hours** ("heartbeat"), throttled via the
  timestamp in `~/.znyx/sdk-state.json`.

Every ping is **fire-and-forget and best-effort**: it runs off the calling thread
with a short timeout and can never slow down, block, or break your application. On
the first run, a one-line disclosure is printed to `stderr`.

## The endpoint

Pings are sent to the ZNYX production receiver:

```
https://cp.znyx.ai/v1/install-telemetry
```

You can point telemetry at your own receiver instead by setting
`ZNYX_TELEMETRY_URL` (or `ZNYX_HEARTBEAT_URL`).

## How to opt out

Set the environment variable:

```bash
export ZNYX_TELEMETRY=false
```

Accepted "off" values are `false`, `0`, and `no`. With telemetry disabled, no ping
is ever sent. (In browser/Deno environments the TypeScript SDK is always a no-op
and never phones home.)
