"""SSE streaming parse tests: event framing survives arbitrary chunk splits."""
import asyncio
import time

import pytest

from znyx_sdk import GuardrailsClient


def sse_responder(byte_chunks):
    """A stub step that streams the given byte chunks with flushes between."""
    def respond(handler):
        handler.send_response(200)
        handler.send_header("Content-Type", "text/event-stream")
        handler.send_header("Cache-Control", "no-cache")
        handler.send_header("Connection", "close")
        handler.end_headers()
        for chunk in byte_chunks:
            handler.wfile.write(chunk)
            handler.wfile.flush()
            time.sleep(0.02)
        handler.close_connection = True
    return respond


# Four events, deliberately split mid-line and mid-JSON across writes:
#   1. runtime framing (event: + data:)
#   2. runtime framing split across chunks
#   3. legacy framing ({"event", "data"} embedded in the data payload)
#   4. final event with no trailing blank line
CHUNKS = [
    b'event: guard',
    b'rail\ndata: {"decision": "ALL',
    b'OW", "window": 1}\n\nevent: chunk\ndata: {"text": "hel',
    b'lo"}\n\ndata: {"event": "block", "data": {"rule": "pii"}}\n\n',
    b'event: done\ndata: {"total": 2}\n',
]

EXPECTED = [
    ("guardrail", {"decision": "ALLOW", "window": 1}),
    ("chunk", {"text": "hello"}),
    ("block", {"rule": "pii"}),
    ("done", {"total": 2}),
]


def test_stream_events_parse_across_chunk_boundaries(stub_server):
    stub_server.script["/v1/evaluate/stream"] = [sse_responder(CHUNKS)]
    client = GuardrailsClient(stub_server.base_url, api_key="stream-key")

    async def collect():
        events = []
        async for event in client.evaluate_stream(["hello world"], context="output"):
            events.append((event.event, event.data))
        return events

    events = asyncio.run(collect())
    assert events == EXPECTED

    req = stub_server.requests[0]
    assert req["path"] == "/v1/evaluate/stream"
    assert req["headers"]["authorization"] == "Bearer stream-key"
    assert req["body"]["chunks"] == ["hello world"]
    assert req["body"]["context"] == "output"
    assert req["body"]["window_size"] == 200
    assert req["body"]["overlap"] == 50
