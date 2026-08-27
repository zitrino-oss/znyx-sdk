"""Async Guardrails client."""
import asyncio
import json
import uuid
import warnings
from typing import AsyncIterator, List, Optional, Dict, Any, Union
from urllib.parse import quote

import httpx

from znyx_sdk.models import (
    BenchmarkResult,
    DatasetSample,
    EvaluationResult,
    ReplayResult,
    StreamEvent,
)
from znyx_sdk.exceptions import (
    GuardrailsError,
    GuardrailsTimeoutError,
    GuardrailsAuthError,
    GuardrailsFailOpenWarning,
)


class GuardrailsClient:
    """
    Async client for the Guardrails Runtime API.

    Usage:
        client = GuardrailsClient()  # defaults to http://localhost:8080

        result = await client.evaluate_input(
            text="Hello, how are you?",
            tenant_id="my-org",
            app_id="my-app",
        )
        if result.is_blocked:
            print("Blocked:", result.user_message)
    """

    def __init__(
        self,
        base_url: str = "http://localhost:8080",
        api_key: str = "",
        timeout: float = 5.0,
        max_retries: int = 1,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self.max_retries = max_retries
        self._client: Optional[httpx.AsyncClient] = None
        self._client_loop: Optional[asyncio.AbstractEventLoop] = None

        # Anonymous, opt-out install telemetry (ZNYX_TELEMETRY=false to disable).
        try:
            from znyx_sdk._telemetry import maybe_send_install_ping
            maybe_send_install_ping()
        except Exception:
            pass

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _ensure_client(self) -> httpx.AsyncClient:
        """Return the shared AsyncClient, creating it lazily.

        One pooled client per GuardrailsClient instance keeps connections
        alive across calls. A pool is bound to the event loop it was created
        on, so if the loop changed (the sync wrapper runs each call in a
        fresh loop) the stale client is dropped and a new pool started.
        """
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if self._client is None or self._client.is_closed or self._client_loop is not loop:
            self._client = httpx.AsyncClient(timeout=self.timeout)
            self._client_loop = loop
        return self._client

    async def aclose(self) -> None:
        """Close the underlying HTTP connection pool."""
        client, self._client, self._client_loop = self._client, None, None
        if client is not None and not client.is_closed:
            try:
                await client.aclose()
            except Exception:
                pass

    async def __aenter__(self) -> "GuardrailsClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.aclose()

    async def _request(self, method: str, path: str, json: dict) -> dict:
        """Make an HTTP request with retry."""
        url = f"{self.base_url}{path}"
        last_error = None

        for attempt in range(1 + self.max_retries):
            try:
                client = self._ensure_client()
                resp = await client.request(method, url, json=json, headers=self._headers())

                if resp.status_code == 401:
                    raise GuardrailsAuthError("Authentication failed", status_code=401)
                if resp.status_code == 403:
                    raise GuardrailsAuthError("Forbidden", status_code=403)
                if resp.status_code >= 500 and attempt < self.max_retries:
                    last_error = GuardrailsError(f"Server error: {resp.status_code}", status_code=resp.status_code)
                    continue
                if resp.status_code >= 400:
                    raise GuardrailsError(f"Request failed: {resp.status_code} {resp.text}", status_code=resp.status_code)

                return resp.json()

            except httpx.TimeoutException:
                if attempt < self.max_retries:
                    last_error = GuardrailsTimeoutError("Request timed out")
                    continue
                raise GuardrailsTimeoutError("Request timed out")
            except (GuardrailsAuthError, GuardrailsError):
                raise
            except Exception as e:
                if attempt < self.max_retries:
                    last_error = GuardrailsError(str(e))
                    continue
                raise GuardrailsError(str(e))

        # Defensive: every terminal path above returns or raises, so this is
        # only reached if the retry loop is ever restructured.
        raise last_error or GuardrailsError("Request failed after retries")

    async def evaluate_input(
        self,
        text: str,
        *,
        tenant_id: str = "default",
        app_id: str = "default",
        agent_id: str = "default",
        env: str = "prod",
        metadata: Optional[Dict[str, Any]] = None,
        request_id: Optional[str] = None,
        trace_id: Optional[str] = None,
        session_id: Optional[str] = None,
        span_id: Optional[str] = None,
    ) -> EvaluationResult:
        """Evaluate input text before sending to LLM."""
        payload = {
            "request_id": request_id or str(uuid.uuid4()),
            "tenant_id": tenant_id,
            "app_id": app_id,
            "agent_id": agent_id,
            "env": env,
            "text": text,
        }
        if metadata:
            payload["metadata"] = metadata
        if trace_id:
            payload["trace_id"] = trace_id
        if session_id:
            payload["session_id"] = session_id
        if span_id:
            payload["span_id"] = span_id

        data = await self._request("POST", "/v1/evaluate/input", payload)
        return EvaluationResult.from_dict(data)

    async def evaluate_output(
        self,
        text: str,
        *,
        tenant_id: str = "default",
        app_id: str = "default",
        agent_id: str = "default",
        env: str = "prod",
        metadata: Optional[Dict[str, Any]] = None,
        request_id: Optional[str] = None,
        trace_id: Optional[str] = None,
        session_id: Optional[str] = None,
        span_id: Optional[str] = None,
    ) -> EvaluationResult:
        """Evaluate output text from LLM before returning to user."""
        payload = {
            "request_id": request_id or str(uuid.uuid4()),
            "tenant_id": tenant_id,
            "app_id": app_id,
            "agent_id": agent_id,
            "env": env,
            "text": text,
        }
        if metadata:
            payload["metadata"] = metadata
        if trace_id:
            payload["trace_id"] = trace_id
        if session_id:
            payload["session_id"] = session_id
        if span_id:
            payload["span_id"] = span_id

        data = await self._request("POST", "/v1/evaluate/output", payload)
        return EvaluationResult.from_dict(data)

    async def evaluate_tool(
        self,
        tool_name: str,
        tool_args: Dict[str, Any],
        *,
        tenant_id: str = "default",
        app_id: str = "default",
        agent_id: str = "default",
        env: str = "prod",
        metadata: Optional[Dict[str, Any]] = None,
        request_id: Optional[str] = None,
    ) -> EvaluationResult:
        """Evaluate a tool invocation against governance policies."""
        payload = {
            "request_id": request_id or str(uuid.uuid4()),
            "tenant_id": tenant_id,
            "app_id": app_id,
            "agent_id": agent_id,
            "env": env,
            "tool_name": tool_name,
            "tool_args": tool_args,
        }
        if metadata:
            payload["metadata"] = metadata

        data = await self._request("POST", "/v1/evaluate/tool", payload)
        return EvaluationResult.from_dict(data)

    @staticmethod
    def _scope_payload(
        request_id: Optional[str],
        tenant_id: str,
        app_id: str,
        agent_id: str,
        env: str,
        metadata: Optional[Dict[str, Any]],
        trace_id: Optional[str],
        session_id: Optional[str],
        span_id: Optional[str],
    ) -> Dict[str, Any]:
        """Common scope/trace fields shared by the per-stage endpoints."""
        payload: Dict[str, Any] = {
            "request_id": request_id or str(uuid.uuid4()),
            "tenant_id": tenant_id,
            "app_id": app_id,
            "agent_id": agent_id,
            "env": env,
        }
        if metadata:
            payload["metadata"] = metadata
        if trace_id:
            payload["trace_id"] = trace_id
        if session_id:
            payload["session_id"] = session_id
        if span_id:
            payload["span_id"] = span_id
        return payload

    async def evaluate_retrieval(
        self,
        chunks: List[Union[str, Dict[str, Any]]],
        *,
        scope_enforced_in_query: Optional[bool] = None,
        tenant_id: str = "default",
        app_id: str = "default",
        agent_id: str = "default",
        env: str = "prod",
        metadata: Optional[Dict[str, Any]] = None,
        request_id: Optional[str] = None,
        trace_id: Optional[str] = None,
        session_id: Optional[str] = None,
        span_id: Optional[str] = None,
    ) -> EvaluationResult:
        """Evaluate retrieved RAG chunks before they enter the model context.

        Calls ``POST /v1/evaluate/retrieval``. Each chunk is either the chunk
        text or a dict with ``content`` plus optional ``source_id``, ``score``,
        ``score_kind`` ("similarity" or "distance"), ``tenant_id`` and
        ``metadata``.

        Args:
            chunks: Retrieved chunks, as plain strings or chunk dicts.
            scope_enforced_in_query: True when tenant scoping was applied
                inside the index query (leave None if unknown).
        """
        payload = self._scope_payload(
            request_id, tenant_id, app_id, agent_id, env,
            metadata, trace_id, session_id, span_id,
        )
        payload["chunks"] = [
            c if isinstance(c, dict) else {"content": c} for c in chunks
        ]
        if scope_enforced_in_query is not None:
            payload["scope_enforced_in_query"] = scope_enforced_in_query

        data = await self._request("POST", "/v1/evaluate/retrieval", payload)
        return EvaluationResult.from_dict(data)

    async def evaluate_agent_plan(
        self,
        plan: Any,
        *,
        tenant_id: str = "default",
        app_id: str = "default",
        agent_id: str = "default",
        env: str = "prod",
        metadata: Optional[Dict[str, Any]] = None,
        request_id: Optional[str] = None,
        trace_id: Optional[str] = None,
        session_id: Optional[str] = None,
        span_id: Optional[str] = None,
    ) -> EvaluationResult:
        """Evaluate a proposed multi-step agent plan before execution.

        Calls ``POST /v1/evaluate/agent-plan``.

        Args:
            plan: The proposed plan (list of steps or structured JSON).
        """
        payload = self._scope_payload(
            request_id, tenant_id, app_id, agent_id, env,
            metadata, trace_id, session_id, span_id,
        )
        payload["plan"] = plan

        data = await self._request("POST", "/v1/evaluate/agent-plan", payload)
        return EvaluationResult.from_dict(data)

    async def evaluate_agent_step(
        self,
        action: str = "",
        *,
        iteration: int = 0,
        max_iterations: Optional[int] = None,
        tenant_id: str = "default",
        app_id: str = "default",
        agent_id: str = "default",
        env: str = "prod",
        metadata: Optional[Dict[str, Any]] = None,
        request_id: Optional[str] = None,
        trace_id: Optional[str] = None,
        session_id: Optional[str] = None,
        span_id: Optional[str] = None,
    ) -> EvaluationResult:
        """Evaluate a single agent-loop iteration (budget/depth caps).

        Calls ``POST /v1/evaluate/agent-step``.

        Args:
            action: The action/tool the agent intends to take this step.
            iteration: Zero-based loop iteration counter.
            max_iterations: The caller's own iteration cap, if any.
        """
        payload = self._scope_payload(
            request_id, tenant_id, app_id, agent_id, env,
            metadata, trace_id, session_id, span_id,
        )
        payload["action"] = action
        payload["iteration"] = iteration
        if max_iterations is not None:
            payload["max_iterations"] = max_iterations

        data = await self._request("POST", "/v1/evaluate/agent-step", payload)
        return EvaluationResult.from_dict(data)

    async def evaluate_memory_write(
        self,
        memory_value: str,
        *,
        memory_key: Optional[str] = None,
        tenant_id: str = "default",
        app_id: str = "default",
        agent_id: str = "default",
        env: str = "prod",
        metadata: Optional[Dict[str, Any]] = None,
        request_id: Optional[str] = None,
        trace_id: Optional[str] = None,
        session_id: Optional[str] = None,
        span_id: Optional[str] = None,
    ) -> EvaluationResult:
        """Evaluate text being written to agent memory (persistent injection).

        Calls ``POST /v1/evaluate/memory-write``.

        Args:
            memory_value: The value being written to memory.
            memory_key: Optional key the value is stored under.
        """
        payload = self._scope_payload(
            request_id, tenant_id, app_id, agent_id, env,
            metadata, trace_id, session_id, span_id,
        )
        payload["memory_value"] = memory_value
        if memory_key is not None:
            payload["memory_key"] = memory_key

        data = await self._request("POST", "/v1/evaluate/memory-write", payload)
        return EvaluationResult.from_dict(data)

    async def health(self) -> bool:
        """Check if the runtime is healthy."""
        try:
            client = self._ensure_client()
            resp = await client.get(f"{self.base_url}/healthz")
            return resp.status_code == 200
        except Exception:
            return False

    # ── Control Plane helpers ────────────────────────────────────────────

    async def run_dataset(
        self,
        org_id: str,
        dataset_id: str,
        *,
        policy_version: Optional[str] = None,
        bundle_id: Optional[str] = None,
        control_plane_url: Optional[str] = None,
    ) -> BenchmarkResult:
        """Start a benchmark run against a dataset and return the result.

        This calls the control plane ``POST /v1/orgs/{org_id}/benchmarks``
        endpoint, which evaluates every sample in the dataset against the
        specified policy or bundle.

        Args:
            org_id: Organisation UUID.
            dataset_id: Dataset UUID to evaluate.
            policy_version: Optional policy version override.
            bundle_id: Optional bundle id override.
            control_plane_url: Base URL of the control plane (defaults to
                self.base_url — set this if runtime and control plane are
                on different hosts).
        """
        base = (control_plane_url or self.base_url).rstrip("/")
        payload: Dict[str, Any] = {"dataset_id": dataset_id}
        if policy_version:
            payload["policy_version"] = policy_version
        if bundle_id:
            payload["bundle_id"] = bundle_id

        url = f"{base}/v1/orgs/{quote(org_id, safe='')}/benchmarks"
        client = self._ensure_client()
        resp = await client.post(url, json=payload, headers=self._headers(), timeout=120.0)
        if resp.status_code >= 400:
            raise GuardrailsError(
                f"run_dataset failed: {resp.status_code} {resp.text}",
                status_code=resp.status_code,
            )
        return BenchmarkResult.from_dict(resp.json())

    async def replay_decision(
        self,
        org_id: str,
        trace_id: str,
        *,
        policy_version: Optional[str] = None,
        control_plane_url: Optional[str] = None,
    ) -> ReplayResult:
        """Replay a previous evaluation trace against a different policy.

        Calls ``POST /v1/orgs/{org_id}/traces/{trace_id}/replay``.

        Args:
            org_id: Organisation UUID.
            trace_id: Trace UUID to replay.
            policy_version: New policy version to evaluate against.
            control_plane_url: Base URL of the control plane.
        """
        base = (control_plane_url or self.base_url).rstrip("/")
        payload: Dict[str, Any] = {}
        if policy_version:
            payload["policy_version"] = policy_version

        url = f"{base}/v1/orgs/{quote(org_id, safe='')}/traces/{quote(trace_id, safe='')}/replay"
        client = self._ensure_client()
        resp = await client.post(url, json=payload, headers=self._headers(), timeout=30.0)
        if resp.status_code >= 400:
            raise GuardrailsError(
                f"replay_decision failed: {resp.status_code} {resp.text}",
                status_code=resp.status_code,
            )
        return ReplayResult.from_dict(resp.json())

    # ── Typed Contract helpers ──────────────────────────────────────────

    async def validate_output_contract(
        self,
        text: str,
        schema_name: str,
        *,
        org_id: str,
        schema_version: Optional[int] = None,
        control_plane_url: Optional[str] = None,
        fail_closed: bool = False,
    ) -> Dict[str, Any]:
        """Validate LLM output against a named output schema contract.

        Calls ``POST /v1/orgs/{org_id}/schemas/{schema_name}/validate``
        on the control plane.  Returns field-level validation results.

        Args:
            text: The LLM output text (must be valid JSON).
            schema_name: Name of the output schema registered in the hub.
            org_id: Organisation UUID.
            schema_version: Optional schema version (latest if omitted).
            control_plane_url: Base URL of the control plane.
            fail_closed: When the control plane is unreachable or errors, treat
                the output as *invalid* (``valid=False``) instead of passing it
                through. Defaults to ``False`` (fail-open) for backwards
                compatibility; set ``True`` for safety-critical paths where
                unvalidated output must not be accepted.

                NOTE: the fail-open default flips to fail-closed in the next
                major release. Until then every fail-open pass-through emits a
                ``GuardrailsFailOpenWarning``.

        Returns:
            Dict with ``valid`` (bool), ``errors`` (list of field errors),
            ``parsed`` (the parsed JSON if valid) and ``outcome``, one of:

            - ``'valid'``: the server validated the output and it passed.
            - ``'invalid'``: the output failed validation (locally or server-side).
            - ``'unavailable'``: the server could not be reached (network error,
              timeout, or a non-auth 4xx); no validation happened.
            - ``'auth_error'``: the server rejected the credentials (401/403);
              no validation happened.
            - ``'server_error'``: the server errored (5xx); no validation happened.

            ``valid=True`` with an outcome other than ``'valid'`` means the
            text was passed through UNVALIDATED (fail-open).
        """
        import json as _json

        # Parse locally first
        try:
            parsed = _json.loads(text)
        except _json.JSONDecodeError as e:
            return {
                "valid": False,
                "errors": [{"path": "/", "message": f"Invalid JSON: {e}"}],
                "parsed": None,
                "outcome": "invalid",
            }

        def _fallthrough(outcome: str) -> Dict[str, Any]:
            if fail_closed:
                return {
                    "valid": False,
                    "errors": [{"path": "/", "message": "Server validation unavailable"}],
                    "parsed": parsed,
                    "warning": "Server validation unavailable",
                    "outcome": outcome,
                }
            warnings.warn(
                "znyx-sdk: output-contract validation could not reach the server "
                f"(outcome={outcome!r}); the output was passed through UNVALIDATED "
                "(fail-open). This default flips to fail-closed in the next major "
                "release; pass fail_closed=True to opt in now.",
                GuardrailsFailOpenWarning,
                stacklevel=2,
            )
            return {
                "valid": True,
                "errors": [],
                "parsed": parsed,
                "warning": "Server validation unavailable",
                "outcome": outcome,
            }

        base = (control_plane_url or self.base_url).rstrip("/")
        payload: Dict[str, Any] = {"text": text}
        if schema_version is not None:
            payload["version"] = schema_version

        url = f"{base}/v1/orgs/{quote(org_id, safe='')}/schemas/{quote(schema_name, safe='')}/validate"
        try:
            client = self._ensure_client()
            resp = await client.post(url, json=payload, headers=self._headers())
            if resp.status_code in (401, 403):
                return _fallthrough("auth_error")
            if resp.status_code >= 500:
                return _fallthrough("server_error")
            if resp.status_code >= 400:
                return _fallthrough("unavailable")
            data = resp.json()
            data.setdefault("outcome", "valid" if data.get("valid", False) else "invalid")
            return data
        except httpx.TimeoutException:
            return _fallthrough("unavailable")
        except Exception:
            return _fallthrough("unavailable")

    async def parse_typed_output(
        self,
        text: str,
        schema_name: str,
        *,
        org_id: str,
        schema_version: Optional[int] = None,
        control_plane_url: Optional[str] = None,
        fail_closed: bool = False,
    ) -> Dict[str, Any]:
        """Parse and validate LLM output, returning the typed result or raising.

        Convenience wrapper around ``validate_output_contract`` that raises
        ``GuardrailsError`` if validation fails. Pass ``fail_closed=True`` to
        also raise when the control plane is unreachable; the raised error
        carries the validation ``outcome`` as ``err.outcome``.
        """
        result = await self.validate_output_contract(
            text, schema_name, org_id=org_id,
            schema_version=schema_version, control_plane_url=control_plane_url,
            fail_closed=fail_closed,
        )
        if not result.get("valid", False):
            errors = result.get("errors", [])
            msg = "; ".join(e.get("message", "") for e in errors[:3])
            raise GuardrailsError(
                f"Output contract validation failed: {msg}",
                outcome=result.get("outcome", "invalid"),
            )
        return result.get("parsed", {})

    async def evaluate_stream(
        self,
        chunks: List[str],
        *,
        context: str = "output",
        window_size: int = 200,
        overlap: int = 50,
        policy: Optional[Dict[str, Any]] = None,
    ) -> AsyncIterator[StreamEvent]:
        """Stream evaluation via SSE.

        Calls ``POST /v1/evaluate/stream`` and yields ``StreamEvent`` objects
        as the server sends them.

        Args:
            chunks: List of text chunks to evaluate.
            context: "input" or "output".
            window_size: Sliding window size for evaluation.
            overlap: Overlap between windows.
            policy: Optional inline policy dict.
        """
        payload: Dict[str, Any] = {
            "chunks": chunks,
            "context": context,
            "window_size": window_size,
            "overlap": overlap,
        }
        if policy:
            payload["policy"] = policy

        def _make_event(event_name: Optional[str], data_str: str) -> Optional[StreamEvent]:
            try:
                data = json.loads(data_str)
            except json.JSONDecodeError:
                return None
            if event_name is not None:
                # SSE `event:` field names the event; the data payload is the body.
                return StreamEvent(
                    event=event_name,
                    data=data if isinstance(data, dict) else {},
                )
            # Legacy framing: the event name is embedded in the data payload.
            if isinstance(data, dict):
                return StreamEvent(event=data.get("event", "unknown"), data=data.get("data", {}))
            return None

        url = f"{self.base_url}/v1/evaluate/stream"
        client = self._ensure_client()
        async with client.stream(
            "POST", url, json=payload, headers=self._headers(), timeout=60.0,
        ) as resp:
            if resp.status_code >= 400:
                body = await resp.aread()
                raise GuardrailsError(
                    f"evaluate_stream failed: {resp.status_code} {body.decode()}",
                    status_code=resp.status_code,
                )
            # SSE framing: fields accumulate until a blank line ends the event.
            event_name: Optional[str] = None
            data_lines: List[str] = []
            async for line in resp.aiter_lines():
                if line == "":
                    if data_lines:
                        event = _make_event(event_name, "\n".join(data_lines))
                        if event is not None:
                            yield event
                    event_name = None
                    data_lines = []
                elif line.startswith("event:"):
                    event_name = line[6:].lstrip(" ")
                elif line.startswith("data:"):
                    data_lines.append(line[5:].lstrip(" "))
            # Flush a final event that ended without a trailing blank line.
            if data_lines:
                event = _make_event(event_name, "\n".join(data_lines))
                if event is not None:
                    yield event
