"""SDK data models."""
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional, Dict, Any, AsyncIterator


class Decision(str, Enum):
    ALLOW = "ALLOW"
    BLOCK = "BLOCK"
    REDACT = "REDACT"
    WARN = "WARN"
    TRANSFORM = "TRANSFORM"


@dataclass
class RuleHit:
    rule_id: str
    severity: str
    message: str


@dataclass
class DetectorTimingResult:
    """Per-detector timing and decision from an evaluation."""
    detector_name: str
    decision: Optional[str] = None
    risk_score: int = 0
    latency_ms: int = 0
    rule_hits: List[RuleHit] = field(default_factory=list)
    transformed: bool = False


@dataclass
class QualityScore:
    """A single quality dimension score."""
    metric: str
    score: float
    details: str = ""
    sub_scores: Optional[Dict[str, float]] = None


@dataclass
class QualityReport:
    """Aggregate quality report across all scored dimensions."""
    scores: List[QualityScore] = field(default_factory=list)
    overall_score: float = 0.0
    evaluated_at: str = ""

    def get_score(self, metric: str) -> Optional[float]:
        for s in self.scores:
            if s.metric == metric:
                return s.score
        return None


@dataclass
class EvaluationResult:
    """Result of a guardrails evaluation."""
    request_id: str
    decision: Decision
    risk_score: int
    policy_version: str
    rule_hits: List[RuleHit] = field(default_factory=list)
    sanitized_text: Optional[str] = None
    sanitized_tool_args: Optional[Dict[str, Any]] = None
    user_message: Optional[str] = None
    developer_message: Optional[str] = None
    latency_ms: Optional[int] = None
    trace_id: Optional[str] = None
    detector_results: List[DetectorTimingResult] = field(default_factory=list)
    quality: Optional[QualityReport] = None

    @property
    def is_blocked(self) -> bool:
        return self.decision == Decision.BLOCK

    @property
    def is_allowed(self) -> bool:
        return self.decision == Decision.ALLOW

    @property
    def is_redacted(self) -> bool:
        return self.decision == Decision.REDACT

    @classmethod
    def from_dict(cls, data: dict) -> "EvaluationResult":
        hits = [
            RuleHit(rule_id=h["rule_id"], severity=h["severity"], message=h["message"])
            for h in data.get("rule_hits", [])
        ]
        detector_results = []
        for dr in data.get("detector_results", []):
            dr_hits = [
                RuleHit(rule_id=h["rule_id"], severity=h["severity"], message=h["message"])
                for h in dr.get("rule_hits", [])
            ]
            detector_results.append(DetectorTimingResult(
                detector_name=dr.get("detector_name", ""),
                decision=dr.get("decision"),
                risk_score=dr.get("risk_score", 0),
                latency_ms=dr.get("latency_ms", 0),
                rule_hits=dr_hits,
                transformed=dr.get("transformed", False),
            ))

        quality = None
        if data.get("quality"):
            q = data["quality"]
            quality = QualityReport(
                scores=[
                    QualityScore(
                        metric=s.get("metric", ""),
                        score=s.get("score", 0.0),
                        details=s.get("details", ""),
                        sub_scores=s.get("sub_scores"),
                    )
                    for s in q.get("scores", [])
                ],
                overall_score=q.get("overall_score", 0.0),
                evaluated_at=q.get("evaluated_at", ""),
            )

        return cls(
            request_id=data.get("request_id", ""),
            decision=Decision(data.get("decision", "ALLOW")),
            risk_score=data.get("risk_score", 0),
            policy_version=data.get("policy_version", ""),
            rule_hits=hits,
            sanitized_text=data.get("sanitized_text"),
            sanitized_tool_args=data.get("sanitized_tool_args"),
            user_message=data.get("user_message"),
            developer_message=data.get("developer_message"),
            latency_ms=data.get("latency_ms"),
            trace_id=data.get("trace_id"),
            detector_results=detector_results,
            quality=quality,
        )


@dataclass
class DatasetSample:
    """A single sample in an evaluation dataset."""
    input_text: str
    context: str = "input"
    expected_decision: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class BenchmarkResult:
    """Result of a benchmark run against a dataset."""
    run_id: str
    dataset_id: str
    status: str
    total_samples: int = 0
    completed_samples: int = 0
    accuracy: float = 0.0
    precision: float = 0.0
    recall: float = 0.0
    f1: float = 0.0
    results_summary: Optional[Dict[str, Any]] = None

    @classmethod
    def from_dict(cls, data: dict) -> "BenchmarkResult":
        summary = data.get("results_summary", {})
        return cls(
            run_id=data.get("id", ""),
            dataset_id=data.get("dataset_id", ""),
            status=data.get("status", "unknown"),
            total_samples=data.get("total_samples", 0),
            completed_samples=data.get("completed_samples", 0),
            accuracy=summary.get("accuracy", 0.0),
            precision=summary.get("precision", 0.0),
            recall=summary.get("recall", 0.0),
            f1=summary.get("f1", 0.0),
            results_summary=summary,
        )


@dataclass
class ReplayResult:
    """Result of replaying a trace against a different policy."""
    source_trace_id: str
    replay_decision: str
    replay_risk_score: int = 0
    replay_detector_results: List[Dict[str, Any]] = field(default_factory=list)
    replay_latency_ms: int = 0

    @classmethod
    def from_dict(cls, data: dict) -> "ReplayResult":
        return cls(
            source_trace_id=data.get("source_trace_id", ""),
            replay_decision=data.get("replay_decision", "ALLOW"),
            replay_risk_score=data.get("replay_risk_score", 0),
            replay_detector_results=data.get("replay_detector_results", []),
            replay_latency_ms=data.get("replay_latency_ms", 0),
        )


@dataclass
class StreamEvent:
    """A single event from the streaming evaluation API."""
    event: str  # "chunk", "guardrail", "block", "done"
    data: Dict[str, Any] = field(default_factory=dict)
