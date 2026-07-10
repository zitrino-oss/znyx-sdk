//! Official Rust SDK for the ZNYX Runtime guardrails API.
//!
//! # Example
//!
//! ```rust,no_run
//! use znyx_sdk::{ZnyxClient, models::EvaluationRequest};
//!
//! #[tokio::main]
//! async fn main() -> Result<(), znyx_sdk::ZnyxError> {
//!     let client = ZnyxClient::new("http://localhost:8080");
//!
//!     let result = client
//!         .evaluate_input(EvaluationRequest::new("my-org", "my-app", user_message))
//!         .await?;
//!
//!     if result.is_blocked() {
//!         eprintln!("Blocked: {}", result.user_message.unwrap_or_default());
//!     }
//!     Ok(())
//! }
//! ```

pub mod models;

use models::{EvaluationRequest, EvaluationResponse, ToolEvaluationRequest};
use reqwest::Client;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ZnyxError {
    #[error("HTTP error {status}: {body}")]
    Http { status: u16, body: String },

    #[error("Request failed: {0}")]
    Request(#[from] reqwest::Error),

    #[error("Parse error: {0}")]
    Parse(String),
}

/// ZNYX SDK client. Create once and reuse — it holds a connection pool.
pub struct ZnyxClient {
    base_url: String,
    client: Client,
}

impl ZnyxClient {
    /// Creates a new client pointed at `base_url` (e.g. `"http://localhost:8080"`).
    pub fn new(base_url: impl Into<String>) -> Self {
        Self::with_api_key(base_url, None)
    }

    /// Creates a new client with an API key sent as `Authorization: Bearer`.
    pub fn with_api_key(base_url: impl Into<String>, api_key: Option<&str>) -> Self {
        let mut headers = reqwest::header::HeaderMap::new();
        if let Some(key) = api_key {
            // Skip the header on a non-ASCII/invalid key rather than panicking
            // the caller's process; the runtime will reject the unauthenticated
            // request with a clear 401.
            if let Ok(value) = format!("Bearer {}", key).parse() {
                headers.insert(reqwest::header::AUTHORIZATION, value);
            }
        }

        let client = Client::builder()
            .default_headers(headers)
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .expect("failed to build HTTP client");

        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            client,
        }
    }

    /// Evaluates a user prompt before sending it to the LLM.
    pub async fn evaluate_input(&self, req: EvaluationRequest) -> Result<EvaluationResponse, ZnyxError> {
        self.post("/v1/evaluate/input", &req).await
    }

    /// Evaluates an LLM response before returning it to the user.
    pub async fn evaluate_output(&self, req: EvaluationRequest) -> Result<EvaluationResponse, ZnyxError> {
        self.post("/v1/evaluate/output", &req).await
    }

    /// Evaluates a tool call before executing it.
    pub async fn evaluate_tool(&self, req: ToolEvaluationRequest) -> Result<EvaluationResponse, ZnyxError> {
        self.post("/v1/evaluate/tool", &req).await
    }

    async fn post<T: serde::Serialize>(
        &self,
        path: &str,
        body: &T,
    ) -> Result<EvaluationResponse, ZnyxError> {
        let url = format!("{}{}", self.base_url, path);
        let response = self.client.post(&url).json(body).send().await?;

        let status = response.status().as_u16();
        if status >= 400 {
            let body = response.text().await.unwrap_or_default();
            return Err(ZnyxError::Http { status, body });
        }

        response
            .json::<EvaluationResponse>()
            .await
            .map_err(|e| ZnyxError::Parse(e.to_string()))
    }
}

pub(crate) fn new_request_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    format!("req_{:08x}", nanos)
}
