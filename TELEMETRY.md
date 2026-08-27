# Telemetry

The ZNYX SDKs send **anonymous install telemetry** so we can understand which
languages, versions, and platforms are in active use and prioritize accordingly.
It is **on by default** and designed to be fully transparent and auditable — this
document describes exactly what is sent, when, and how to turn it off.

## What is collected

A single JSON payload with non-sensitive metadata only:

| Field | Example | Description |
|-------|---------|-------------|
| `install_id` | `3f9c…` (random UUID v4) | Random identifier generated on first run, persisted to the SDK's state file under `~/.znyx/` (e.g. `sdk-state-java.json`). Not tied to you, your account, or your machine's identity. |
| `version` | `1.0.1` | The SDK package version. |
| `source` | `python-sdk` | Which SDK sent the ping (`python-sdk`, `node-sdk`, `java-sdk`, `ruby-sdk`, `dotnet-sdk`, `rust-sdk`). |
| `event_type` | `first_run` / `heartbeat` | Whether this is the first ping or a periodic one. |
| `os` / `os_version` / `arch` | `Linux` / `6.1.0` / `x86_64` | Operating system, release, and CPU architecture. |
| `python_version` | `3.11.4` | The language runtime version (where available). The receiver's schema predates the multi-language SDKs, so every SDK reports its runtime version under this field name; `source` says which runtime it actually is. |
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
  timestamp in the SDK's state file under `~/.znyx/`. Each SDK language keeps its
  own state file, so one SDK's ping schedule never suppresses another's.

Every ping is **fire-and-forget and best-effort**: it runs off the calling thread
with a short timeout and can never slow down, block, or break your application. On
the first run, a one-line disclosure is printed to `stderr`.

## The endpoint

Pings are sent to the ZNYX receiver:

```
https://cp.znyx.ai/v1/install-telemetry
```

Point telemetry at your own receiver instead with `ZNYX_TELEMETRY_URL` (or
`ZNYX_HEARTBEAT_URL`), or set either to an **empty string** to remove the
destination entirely — with no URL there is nowhere to send and nothing is sent,
which is verifiable on the wire.

### Enable-defaults differ between the SDKs and the runtime

Worth stating plainly, because the two are not the same:

| Component | Default | Turn it off / on |
|---|---|---|
| These SDKs | **on** (opt-out) | `ZNYX_TELEMETRY=false` |
| ZNYX Runtime heartbeat | **off** (opt-in) | `ZNYX_TELEMETRY=true` |

## How to opt out

Set the environment variable:

```bash
export ZNYX_TELEMETRY=false
```

Accepted "off" values are `false`, `0`, and `no`. With telemetry disabled, no ping
is ever sent. (In browser/Deno environments the TypeScript SDK is always a no-op
and never phones home.)
