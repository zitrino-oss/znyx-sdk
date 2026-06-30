use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Decision {
    Allow,
    Block,
    Redact,
    Warn,
    Transform,
}

/// Sent to `/v1/evaluate/input` or `/v1/evaluate/output`.
#[derive(Debug, Clone, Serialize)]
pub struct EvaluationRequest {
    pub request_id: String,
    pub tenant_id: String,
    pub app_id: String,
    pub agent_id: String,
    pub env: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HashMap<String, serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span_id: Option<String>,
}

impl EvaluationRequest {
    pub fn new(tenant_id: impl Into<String>, app_id: impl Into<String>, text: impl Into<String>) -> Self {
        Self {
            request_id: crate::new_request_id(),
            tenant_id: tenant_id.into(),
            app_id: app_id.into(),
            agent_id: "default".into(),
            env: "prod".into(),
            text: text.into(),
            metadata: None,
            trace_id: None,
            session_id: None,
            span_id: None,
        }
    }

    pub fn trace_id(mut self, id: impl Into<String>) -> Self {
        self.trace_id = Some(id.into());
        self
    }

    pub fn session_id(mut self, id: impl Into<String>) -> Self {
        self.session_id = Some(id.into());
        self
    }

    pub fn agent_id(mut self, id: impl Into<String>) -> Self {
        self.agent_id = id.into();
        self
    }
}

/// Sent to `/v1/evaluate/tool`.
#[derive(Debug, Clone, Serialize)]
pub struct ToolEvaluationRequest {
    pub request_id: String,
    pub tenant_id: String,
    pub app_id: String,
    pub agent_id: String,
    pub env: String,
    pub tool_name: String,
    pub tool_args: HashMap<String, serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

impl ToolEvaluationRequest {
    pub fn new(
        tenant_id: impl Into<String>,
        app_id: impl Into<String>,
        tool_name: impl Into<String>,
        tool_args: HashMap<String, serde_json::Value>,
    ) -> Self {
        Self {
            request_id: crate::new_request_id(),
            tenant_id: tenant_id.into(),
            app_id: app_id.into(),
            agent_id: "default".into(),
            env: "prod".into(),
            tool_name: tool_name.into(),
            tool_args,
            trace_id: None,
            session_id: None,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct RuleHit {
    pub rule_id: String,
    pub severity: String,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DetectorResult {
    pub detector_name: String,
    pub decision: Option<String>,
    pub risk_score: i32,
    pub latency_ms: i32,
    #[serde(default)]
    pub rule_hits: Vec<RuleHit>,
}

/// Returned by all evaluate endpoints.
#[derive(Debug, Clone, Deserialize)]
pub struct EvaluationResponse {
    pub request_id: String,
    pub decision: Decision,
    pub risk_score: i32,
    pub policy_version: String,
    #[serde(default)]
    pub rule_hits: Vec<RuleHit>,
    pub sanitized_text: Option<String>,
    pub user_message: Option<String>,
    pub developer_message: Option<String>,
    pub latency_ms: Option<i32>,
    pub trace_id: Option<String>,
    pub session_id: Option<String>,
    #[serde(default)]
    pub detector_results: Vec<DetectorResult>,
}

impl EvaluationResponse {
    pub fn is_blocked(&self) -> bool {
        self.decision == Decision::Block
    }

    pub fn is_redacted(&self) -> bool {
        self.decision == Decision::Redact
    }

    /// Returns the sanitized text if available, otherwise the original.
    pub fn safe_text<'a>(&'a self, original: &'a str) -> &'a str {
        self.sanitized_text.as_deref().unwrap_or(original)
    }
}
