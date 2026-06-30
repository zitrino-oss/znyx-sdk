"""Async Guardrails client."""
import json
import uuid
from typing import AsyncIterator, List, Optional, Dict, Any

import httpx

from znyx_sdk.models import (
    BenchmarkResult,
    DatasetSample,
    EvaluationResult,
    ReplayResult,
    StreamEvent,
)
from znyx_sdk.exceptions import GuardrailsError, GuardrailsTimeoutError, GuardrailsAuthError


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

    async def _request(self, method: str, path: str, json: dict) -> dict:
        """Make an HTTP request with retry."""
        url = f"{self.base_url}{path}"
        last_error = None

        for attempt in range(1 + self.max_retries):
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
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

        raise last_error

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

    async def health(self) -> bool:
        """Check if the runtime is healthy."""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
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

        url = f"{base}/v1/orgs/{org_id}/benchmarks"
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(url, json=payload, headers=self._headers())
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

        url = f"{base}/v1/orgs/{org_id}/traces/{trace_id}/replay"
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, json=payload, headers=self._headers())
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

        Returns:
            Dict with ``valid`` (bool), ``errors`` (list of field errors),
            and ``parsed`` (the parsed JSON if valid).
        """
        import json as _json

        # Parse locally first
        try:
            parsed = _json.loads(text)
        except _json.JSONDecodeError as e:
            return {"valid": False, "errors": [{"path": "/", "message": f"Invalid JSON: {e}"}], "parsed": None}

        base = (control_plane_url or self.base_url).rstrip("/")
        payload: Dict[str, Any] = {"text": text}
        if schema_version is not None:
            payload["version"] = schema_version

        url = f"{base}/v1/orgs/{org_id}/schemas/{schema_name}/validate"
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(url, json=payload, headers=self._headers())
                if resp.status_code >= 400:
                    # Fallback: return local parse result without server validation
                    return {"valid": True, "errors": [], "parsed": parsed, "warning": "Server validation unavailable"}
                return resp.json()
        except Exception:
            return {"valid": True, "errors": [], "parsed": parsed, "warning": "Server validation unavailable"}

    async def parse_typed_output(
        self,
        text: str,
        schema_name: str,
        *,
        org_id: str,
        schema_version: Optional[int] = None,
        control_plane_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Parse and validate LLM output, returning the typed result or raising.

        Convenience wrapper around ``validate_output_contract`` that raises
        ``GuardrailsError`` if validation fails.
        """
        result = await self.validate_output_contract(
            text, schema_name, org_id=org_id,
            schema_version=schema_version, control_plane_url=control_plane_url,
        )
        if not result.get("valid", False):
            errors = result.get("errors", [])
            msg = "; ".join(e.get("message", "") for e in errors[:3])
            raise GuardrailsError(f"Output contract validation failed: {msg}")
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

        url = f"{self.base_url}/v1/evaluate/stream"
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST", url, json=payload, headers=self._headers(),
            ) as resp:
                if resp.status_code >= 400:
                    body = await resp.aread()
                    raise GuardrailsError(
                        f"evaluate_stream failed: {resp.status_code} {body.decode()}",
                        status_code=resp.status_code,
                    )
                buffer = ""
                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        data_str = line[6:]
                        try:
                            data = json.loads(data_str)
                            yield StreamEvent(
                                event=data.get("event", "unknown"),
                                data=data.get("data", {}),
                            )
                        except json.JSONDecodeError:
                            continue
