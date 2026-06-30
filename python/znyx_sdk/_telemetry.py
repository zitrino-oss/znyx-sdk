"""Anonymous install telemetry for the ZNYX Python SDK.

Sends a single fire-and-forget ping when a client is first constructed, then at
most one "heartbeat" ping per 24h. Non-sensitive metadata only:

    install_id (random UUID, persisted to ~/.znyx/sdk-state.json),
    SDK version, source ("python-sdk"), OS / arch / Python version, run_count.

No PII, no request content, no tenant data. Mirrors the runtime heartbeat
(app/runtime/heartbeat.py) so SDK installs land in the same anonymous_installs
table, tagged with source so they're distinguishable from runtime installs.

Opt-out: set ZNYX_TELEMETRY=false (on by default). Disclosed once to stderr on
the first run. Every operation here is best-effort — telemetry must never slow
down, block, or break the calling application.
"""
import json
import os
import platform
import sys
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

_ENDPOINT = os.getenv(
    # Default target is the ZNYX prod control plane. Override with
    # ZNYX_HEARTBEAT_URL to point at preprod (https://pprd-cp.znyx.ai/...),
    # a self-hosted control plane, or a local CP for testing.
    "ZNYX_HEARTBEAT_URL",
    "https://cp.znyx.ai/v1/install-telemetry",
)
_STATE_FILE = Path.home() / ".znyx" / "sdk-state.json"
_HEARTBEAT_INTERVAL = 86400  # seconds (24h) — don't ping more often than this
_SOURCE = "python-sdk"

# Only attempt once per process, no matter how many clients are constructed.
_attempted = False

_DISCLOSURE = (
    "[znyx-sdk] Anonymous usage telemetry is on (install id, SDK version, OS - "
    "no PII, no request content). Opt out with ZNYX_TELEMETRY=false.\n"
)


def _enabled() -> bool:
    """Telemetry is on unless explicitly disabled (mirrors the runtime)."""
    val = (os.getenv("ZNYX_TELEMETRY") or os.getenv("GUARDRAILS_TELEMETRY") or "true").lower()
    return val not in ("false", "0", "no")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _load_state() -> dict:
    try:
        if _STATE_FILE.exists():
            return json.loads(_STATE_FILE.read_text())
    except (OSError, json.JSONDecodeError):
        pass
    return {}


def _save_state(state: dict) -> None:
    try:
        _STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        _STATE_FILE.write_text(json.dumps(state, indent=2))
    except OSError:
        pass  # best-effort; never raise


def _sdk_version() -> str:
    # Lazy import to avoid a circular import at package load time.
    try:
        from znyx_sdk import __version__
        return __version__
    except Exception:
        return "unknown"


def _post(payload: dict) -> None:
    try:
        import httpx
        httpx.post(_ENDPOINT, json=payload, timeout=3.0)
    except Exception:
        pass  # never fail the app because of telemetry


def maybe_send_install_ping() -> None:
    """Send an anonymous install ping, throttled to once per 24h. Fire-and-forget."""
    global _attempted
    if _attempted:
        return
    _attempted = True

    try:
        if not _enabled():
            return

        state = _load_state()
        last_ping = state.get("last_ping_at")

        if not last_ping:
            event_type = "first_run"
        else:
            try:
                elapsed = (_now() - datetime.fromisoformat(last_ping)).total_seconds()
            except (ValueError, TypeError):
                elapsed = _HEARTBEAT_INTERVAL  # unparseable -> treat as due
            if elapsed < _HEARTBEAT_INTERVAL:
                return  # throttled
            event_type = "heartbeat"

        install_id = state.get("install_id") or str(uuid.uuid4())
        run_count = int(state.get("run_count", 0)) + 1
        now_iso = _now().isoformat()
        state.update({
            "install_id": install_id,
            "first_seen_at": state.get("first_seen_at", now_iso),
            "last_ping_at": now_iso,
            "run_count": run_count,
        })
        _save_state(state)

        if event_type == "first_run":
            try:
                sys.stderr.write(_DISCLOSURE)
            except Exception:
                pass

        payload = {
            "install_id": install_id,
            "version": _sdk_version(),
            "event_type": event_type,
            "source": _SOURCE,
            "os": platform.system(),
            "os_version": platform.release(),
            "arch": platform.machine(),
            "python_version": platform.python_version(),
            "run_count": run_count,
            "timestamp": now_iso,
        }
        threading.Thread(target=_post, args=(payload,), daemon=True).start()
    except Exception:
        pass  # telemetry must never break client construction
