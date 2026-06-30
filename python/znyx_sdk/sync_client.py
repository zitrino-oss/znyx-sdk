"""Synchronous wrapper for non-async codebases."""
import asyncio
from typing import List, Optional, Dict, Any

from znyx_sdk.client import GuardrailsClient
from znyx_sdk.models import BenchmarkResult, EvaluationResult, ReplayResult


class GuardrailsSyncClient:
    """
    Synchronous client for the Guardrails Runtime API.

    Usage:
        client = GuardrailsSyncClient()  # defaults to http://localhost:8080
        result = client.evaluate_input("Hello!")
        if result.is_blocked:
            print("Blocked!")
    """

    def __init__(self, base_url: str = "http://localhost:8080", api_key: str = "", timeout: float = 5.0):
        self._async_client = GuardrailsClient(base_url, api_key=api_key, timeout=timeout)

    def _run(self, coro):
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(asyncio.run, coro).result()
        return asyncio.run(coro)

    def evaluate_input(self, text: str, **kwargs) -> EvaluationResult:
        return self._run(self._async_client.evaluate_input(text, **kwargs))

    def evaluate_output(self, text: str, **kwargs) -> EvaluationResult:
        return self._run(self._async_client.evaluate_output(text, **kwargs))

    def evaluate_tool(self, tool_name: str, tool_args: Dict[str, Any], **kwargs) -> EvaluationResult:
        return self._run(self._async_client.evaluate_tool(tool_name, tool_args, **kwargs))

    def health(self) -> bool:
        return self._run(self._async_client.health())

    def run_dataset(
        self,
        org_id: str,
        dataset_id: str,
        **kwargs,
    ) -> BenchmarkResult:
        """Start a benchmark run against a dataset. See async client for full docs."""
        return self._run(self._async_client.run_dataset(org_id, dataset_id, **kwargs))

    def replay_decision(
        self,
        org_id: str,
        trace_id: str,
        **kwargs,
    ) -> ReplayResult:
        """Replay a trace against a different policy. See async client for full docs."""
        return self._run(self._async_client.replay_decision(org_id, trace_id, **kwargs))
