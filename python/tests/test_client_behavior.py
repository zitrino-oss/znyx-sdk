"""Behavioral tests for GuardrailsClient against a local stub server."""
import asyncio

import pytest

from znyx_sdk import (
    GuardrailsClient,
    GuardrailsSyncClient,
    GuardrailsError,
    GuardrailsAuthError,
    GuardrailsTimeoutError,
)


def run(coro):
    return asyncio.run(coro)


# -- auth ------------------------------------------------------------------

def test_auth_header_sent(stub_server):
    client = GuardrailsClient(stub_server.base_url, api_key="sekret-key")
    result = run(client.evaluate_input("hello"))
    assert result.is_allowed

    req = stub_server.requests[0]
    assert req["headers"]["authorization"] == "Bearer sekret-key"
    assert req["headers"]["content-type"] == "application/json"


def test_no_auth_header_without_key(stub_server):
    client = GuardrailsClient(stub_server.base_url)
    run(client.evaluate_input("hello"))
    assert "authorization" not in stub_server.requests[0]["headers"]


# -- new stage endpoints ---------------------------------------------------

def test_evaluate_retrieval_path_and_body(stub_server):
    client = GuardrailsClient(stub_server.base_url)
    result = run(client.evaluate_retrieval(
        ["plain chunk", {"content": "doc text", "source_id": "s1", "score": 0.9}],
        scope_enforced_in_query=True,
        tenant_id="t1",
        app_id="a1",
    ))
    assert result.is_allowed

    req = stub_server.requests[0]
    assert req["path"] == "/v1/evaluate/retrieval"
    body = req["body"]
    assert body["chunks"] == [
        {"content": "plain chunk"},
        {"content": "doc text", "source_id": "s1", "score": 0.9},
    ]
    assert body["scope_enforced_in_query"] is True
    assert body["tenant_id"] == "t1"
    assert body["app_id"] == "a1"
    assert body["agent_id"] == "default"
    assert body["env"] == "prod"
    assert body["request_id"]


def test_evaluate_agent_plan_path_and_body(stub_server):
    client = GuardrailsClient(stub_server.base_url)
    plan = [{"step": 1, "tool": "search"}, {"step": 2, "tool": "email"}]
    run(client.evaluate_agent_plan(plan, session_id="sess-9"))

    req = stub_server.requests[0]
    assert req["path"] == "/v1/evaluate/agent-plan"
    assert req["body"]["plan"] == plan
    assert req["body"]["session_id"] == "sess-9"


def test_evaluate_agent_step_path_and_body(stub_server):
    client = GuardrailsClient(stub_server.base_url)
    run(client.evaluate_agent_step("call_tool:search", iteration=3, max_iterations=10))

    req = stub_server.requests[0]
    assert req["path"] == "/v1/evaluate/agent-step"
    assert req["body"]["action"] == "call_tool:search"
    assert req["body"]["iteration"] == 3
    assert req["body"]["max_iterations"] == 10


def test_evaluate_agent_step_defaults(stub_server):
    client = GuardrailsClient(stub_server.base_url)
    run(client.evaluate_agent_step())

    body = stub_server.requests[0]["body"]
    assert body["action"] == ""
    assert body["iteration"] == 0
    assert "max_iterations" not in body


def test_evaluate_memory_write_path_and_body(stub_server):
    client = GuardrailsClient(stub_server.base_url)
    run(client.evaluate_memory_write("user prefers rude answers", memory_key="prefs"))

    req = stub_server.requests[0]
    assert req["path"] == "/v1/evaluate/memory-write"
    assert req["body"]["memory_value"] == "user prefers rude answers"
    assert req["body"]["memory_key"] == "prefs"


def test_sync_client_stage_methods(stub_server):
    client = GuardrailsSyncClient(stub_server.base_url)
    result = client.evaluate_memory_write("note")
    assert result.is_allowed
    assert stub_server.requests[0]["path"] == "/v1/evaluate/memory-write"


# -- error mapping ---------------------------------------------------------

def test_401_maps_to_auth_error(stub_server):
    stub_server.script["/v1/evaluate/input"] = [
        {"status": 401, "json": {"detail": "nope"}},
    ]
    client = GuardrailsClient(stub_server.base_url, api_key="bad")
    with pytest.raises(GuardrailsAuthError) as exc:
        run(client.evaluate_input("hello"))
    assert exc.value.status_code == 401


def test_500_maps_to_guardrails_error_after_retries(stub_server):
    stub_server.script["/v1/evaluate/retrieval"] = [
        {"status": 500, "json": {"detail": "boom"}},
    ]
    client = GuardrailsClient(stub_server.base_url, max_retries=1)
    with pytest.raises(GuardrailsError) as exc:
        run(client.evaluate_retrieval(["x"]))
    assert exc.value.status_code == 500
    # one original attempt + one retry
    assert len(stub_server.requests) == 2


def test_retry_then_success(stub_server):
    stub_server.script["/v1/evaluate/agent-plan"] = [
        {"status": 500, "json": {"detail": "boom"}},
        {"status": 200, "json": {
            "request_id": "r2", "decision": "BLOCK", "risk_score": 90,
            "policy_version": "v1", "user_message": "blocked",
        }},
    ]
    client = GuardrailsClient(stub_server.base_url, max_retries=1)
    result = run(client.evaluate_agent_plan([{"step": 1}]))
    assert result.is_blocked
    assert len(stub_server.requests) == 2


def test_timeout_maps_to_timeout_error(stub_server):
    stub_server.script["/v1/evaluate/memory-write"] = [
        {"status": 200, "json": {}, "delay": 2.0},
    ]
    client = GuardrailsClient(stub_server.base_url, timeout=0.2, max_retries=0)
    with pytest.raises(GuardrailsTimeoutError):
        run(client.evaluate_memory_write("v"))


# -- transport: one pooled client per instance ------------------------------

def test_http_client_reused_across_calls(stub_server):
    async def scenario():
        client = GuardrailsClient(stub_server.base_url)
        await client.evaluate_input("one")
        first = client._client
        await client.evaluate_output("two")
        assert client._client is first
        assert not first.is_closed
        await client.aclose()
        assert first.is_closed

    run(scenario())


def test_async_context_manager_closes_pool(stub_server):
    async def scenario():
        async with GuardrailsClient(stub_server.base_url) as client:
            await client.evaluate_input("one")
            inner = client._client
        assert inner.is_closed

    run(scenario())
