package znyx

// Decision represents the outcome of an evaluation.
type Decision string

const (
	DecisionAllow     Decision = "ALLOW"
	DecisionBlock     Decision = "BLOCK"
	DecisionRedact    Decision = "REDACT"
	DecisionWarn      Decision = "WARN"
	DecisionTransform Decision = "TRANSFORM"
)

// EvaluationRequest is sent to /v1/evaluate/input or /v1/evaluate/output.
type EvaluationRequest struct {
	RequestID string                 `json:"request_id"`
	TenantID  string                 `json:"tenant_id"`
	AppID     string                 `json:"app_id"`
	AgentID   string                 `json:"agent_id,omitempty"`
	Env       string                 `json:"env,omitempty"`
	Text      string                 `json:"text"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
	TraceID   string                 `json:"trace_id,omitempty"`
	SessionID string                 `json:"session_id,omitempty"`
	SpanID    string                 `json:"span_id,omitempty"`
}

// ToolEvaluationRequest is sent to /v1/evaluate/tool.
type ToolEvaluationRequest struct {
	RequestID string                 `json:"request_id"`
	TenantID  string                 `json:"tenant_id"`
	AppID     string                 `json:"app_id"`
	AgentID   string                 `json:"agent_id,omitempty"`
	Env       string                 `json:"env,omitempty"`
	ToolName  string                 `json:"tool_name"`
	ToolArgs  map[string]interface{} `json:"tool_args"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
	TraceID   string                 `json:"trace_id,omitempty"`
	SessionID string                 `json:"session_id,omitempty"`
	SpanID    string                 `json:"span_id,omitempty"`
}

// RuleHit describes a triggered guardrail rule.
type RuleHit struct {
	RuleID   string `json:"rule_id"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
}

// DetectorResult holds per-detector timing and outcome.
type DetectorResult struct {
	DetectorName string    `json:"detector_name"`
	Decision     string    `json:"decision"`
	RiskScore    int       `json:"risk_score"`
	LatencyMs    int       `json:"latency_ms"`
	RuleHits     []RuleHit `json:"rule_hits"`
}

// EvaluationResponse is returned by all evaluate endpoints.
type EvaluationResponse struct {
	RequestID        string           `json:"request_id"`
	Decision         Decision         `json:"decision"`
	RiskScore        int              `json:"risk_score"`
	PolicyVersion    string           `json:"policy_version"`
	RuleHits         []RuleHit        `json:"rule_hits"`
	SanitizedText    string           `json:"sanitized_text,omitempty"`
	UserMessage      string           `json:"user_message,omitempty"`
	DeveloperMessage string           `json:"developer_message,omitempty"`
	LatencyMs        int              `json:"latency_ms"`
	TraceID          string           `json:"trace_id,omitempty"`
	SessionID        string           `json:"session_id,omitempty"`
	DetectorResults  []DetectorResult `json:"detector_results"`
}

// IsBlocked reports whether the request was blocked by policy.
func (r *EvaluationResponse) IsBlocked() bool { return r.Decision == DecisionBlock }

// IsRedacted reports whether content was sanitized.
func (r *EvaluationResponse) IsRedacted() bool { return r.Decision == DecisionRedact }

// SafeText returns the sanitized text if available, otherwise the original.
func (r *EvaluationResponse) SafeText(original string) string {
	if r.SanitizedText != "" {
		return r.SanitizedText
	}
	return original
}
