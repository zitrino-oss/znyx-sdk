"""Outcome semantics of validate_output_contract / parse_typed_output."""
import asyncio
import warnings

import pytest

from znyx_sdk import GuardrailsClient, GuardrailsError, GuardrailsFailOpenWarning


def run(coro):
    return asyncio.run(coro)


VALIDATE_PATH = "/v1/orgs/org-1/schemas/invoice/validate"


def _validate(client, **kwargs):
    return client.validate_output_contract(
        '{"total": 5}', "invoice", org_id="org-1", **kwargs,
    )


def test_outcome_valid(stub_server):
    stub_server.script[VALIDATE_PATH] = [
        {"status": 200, "json": {"valid": True, "errors": [], "parsed": {"total": 5}}},
    ]
    client = GuardrailsClient(stub_server.base_url)
    result = run(_validate(client))
    assert result["valid"] is True
    assert result["outcome"] == "valid"


def test_outcome_invalid_from_server(stub_server):
    stub_server.script[VALIDATE_PATH] = [
        {"status": 200, "json": {
            "valid": False,
            "errors": [{"path": "/total", "message": "must be >= 10"}],
            "parsed": None,
        }},
    ]
    client = GuardrailsClient(stub_server.base_url)
    result = run(_validate(client))
    assert result["valid"] is False
    assert result["outcome"] == "invalid"


def test_outcome_invalid_local_json():
    client = GuardrailsClient("http://127.0.0.1:1")  # never reached
    result = run(client.validate_output_contract("not json", "invoice", org_id="org-1"))
    assert result["valid"] is False
    assert result["outcome"] == "invalid"


def test_outcome_auth_error_fails_open_with_warning(stub_server):
    stub_server.script[VALIDATE_PATH] = [{"status": 401, "json": {"detail": "no"}}]
    client = GuardrailsClient(stub_server.base_url)
    with pytest.warns(GuardrailsFailOpenWarning):
        result = run(_validate(client))
    assert result["valid"] is True  # fail-open kept for backwards compatibility
    assert result["outcome"] == "auth_error"
    assert result["warning"] == "Server validation unavailable"


def test_outcome_server_error_fails_open_with_warning(stub_server):
    stub_server.script[VALIDATE_PATH] = [{"status": 500, "json": {"detail": "boom"}}]
    client = GuardrailsClient(stub_server.base_url)
    with pytest.warns(GuardrailsFailOpenWarning):
        result = run(_validate(client))
    assert result["valid"] is True
    assert result["outcome"] == "server_error"


def test_outcome_unavailable_when_unreachable():
    client = GuardrailsClient("http://127.0.0.1:1", timeout=0.3)
    with pytest.warns(GuardrailsFailOpenWarning):
        result = run(client.validate_output_contract(
            '{"total": 5}', "invoice", org_id="org-1",
        ))
    assert result["valid"] is True
    assert result["outcome"] == "unavailable"


def test_fail_closed_suppresses_pass_through(stub_server):
    stub_server.script[VALIDATE_PATH] = [{"status": 500, "json": {"detail": "boom"}}]
    client = GuardrailsClient(stub_server.base_url)
    with warnings.catch_warnings():
        warnings.simplefilter("error", GuardrailsFailOpenWarning)
        result = run(_validate(client, fail_closed=True))  # must not warn
    assert result["valid"] is False
    assert result["outcome"] == "server_error"


def test_parse_typed_output_returns_parsed(stub_server):
    stub_server.script[VALIDATE_PATH] = [
        {"status": 200, "json": {"valid": True, "errors": [], "parsed": {"total": 5}}},
    ]
    client = GuardrailsClient(stub_server.base_url)
    parsed = run(client.parse_typed_output('{"total": 5}', "invoice", org_id="org-1"))
    assert parsed == {"total": 5}


def test_parse_typed_output_raises_with_outcome_on_invalid(stub_server):
    stub_server.script[VALIDATE_PATH] = [
        {"status": 200, "json": {
            "valid": False,
            "errors": [{"path": "/total", "message": "must be >= 10"}],
            "parsed": None,
        }},
    ]
    client = GuardrailsClient(stub_server.base_url)
    with pytest.raises(GuardrailsError) as exc:
        run(client.parse_typed_output('{"total": 5}', "invoice", org_id="org-1"))
    assert exc.value.outcome == "invalid"
    assert "must be >= 10" in str(exc.value)


def test_parse_typed_output_fail_closed_raises_on_unreachable():
    client = GuardrailsClient("http://127.0.0.1:1", timeout=0.3)
    with pytest.raises(GuardrailsError) as exc:
        run(client.parse_typed_output(
            '{"total": 5}', "invoice", org_id="org-1", fail_closed=True,
        ))
    assert exc.value.outcome == "unavailable"


def test_parse_typed_output_fail_open_passes_through_unreachable():
    client = GuardrailsClient("http://127.0.0.1:1", timeout=0.3)
    with pytest.warns(GuardrailsFailOpenWarning):
        parsed = run(client.parse_typed_output('{"total": 5}', "invoice", org_id="org-1"))
    assert parsed == {"total": 5}
