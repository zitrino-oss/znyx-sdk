"""Shared fixtures: a tiny scriptable HTTP stub server (stdlib only)."""
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

# Keep the SDK's install telemetry out of the tests entirely.
os.environ["ZNYX_TELEMETRY"] = "false"
os.environ["ZNYX_TELEMETRY_URL"] = ""

# A minimal, valid EvaluationResponse body.
DEFAULT_EVAL_RESPONSE = {
    "request_id": "req-1",
    "decision": "ALLOW",
    "risk_score": 0,
    "policy_version": "v1",
}


class StubHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # keep test output quiet
        pass

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            return json.loads(raw) if raw else None
        except json.JSONDecodeError:
            return raw.decode("utf-8", "replace")

    def _respond(self):
        body = self._read_body()
        record = {
            "method": self.command,
            "path": self.path,
            "headers": {k.lower(): v for k, v in self.headers.items()},
            "body": body,
        }
        self.server.requests.append(record)

        script = self.server.script.get(self.path)
        if script:
            step = script.pop(0) if len(script) > 1 else script[0]
        else:
            step = {"status": 200, "json": DEFAULT_EVAL_RESPONSE}

        if callable(step):
            step(self)
            return

        delay = step.get("delay")
        if delay:
            time.sleep(delay)

        payload = json.dumps(step.get("json", DEFAULT_EVAL_RESPONSE)).encode()
        self.send_response(step.get("status", 200))
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    do_GET = _respond
    do_POST = _respond


class StubServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.requests = []
        # path -> list of response steps (a single-entry list repeats forever;
        # a longer list is consumed one step per request until one remains).
        # A step is either a dict {status, json, delay} or a callable(handler).
        self.script = {}


@pytest.fixture()
def stub_server():
    server = StubServer(("127.0.0.1", 0), StubHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    server.base_url = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
