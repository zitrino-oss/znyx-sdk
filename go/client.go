// Package znyx is the official Go SDK for the ZNYX Runtime guardrails API.
//
// Usage:
//
//	client := znyx.NewClient("http://localhost:8080")
//
//	result, err := client.EvaluateInput(ctx, znyx.EvaluationRequest{
//	    TenantID: "my-org",
//	    AppID:    "my-app",
//	    Text:     userMessage,
//	})
//	if err != nil {
//	    return err
//	}
//	if result.IsBlocked() {
//	    return errors.New(result.UserMessage)
//	}
package znyx

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Client is the ZNYX SDK client. Create once and reuse across requests.
type Client struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

// Option configures a Client.
type Option func(*Client)

// WithAPIKey sets the Authorization Bearer token sent with every request.
func WithAPIKey(key string) Option {
	return func(c *Client) { c.apiKey = key }
}

// WithTimeout overrides the default 10-second HTTP timeout.
func WithTimeout(d time.Duration) Option {
	return func(c *Client) { c.httpClient.Timeout = d }
}

// NewClient creates a ZNYX SDK client pointed at baseURL (e.g. "http://localhost:8080").
func NewClient(baseURL string, opts ...Option) *Client {
	c := &Client{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// EvaluateInput evaluates a user prompt before it is sent to the LLM.
func (c *Client) EvaluateInput(ctx context.Context, req EvaluationRequest) (*EvaluationResponse, error) {
	applyRequestDefaults(&req)
	return c.post(ctx, "/v1/evaluate/input", req)
}

// EvaluateOutput evaluates an LLM response before it is returned to the user.
func (c *Client) EvaluateOutput(ctx context.Context, req EvaluationRequest) (*EvaluationResponse, error) {
	applyRequestDefaults(&req)
	return c.post(ctx, "/v1/evaluate/output", req)
}

// EvaluateTool evaluates a tool call before it is executed.
func (c *Client) EvaluateTool(ctx context.Context, req ToolEvaluationRequest) (*EvaluationResponse, error) {
	if req.RequestID == "" {
		req.RequestID = newRequestID()
	}
	if req.AgentID == "" {
		req.AgentID = "default"
	}
	if req.Env == "" {
		req.Env = "prod"
	}
	return c.post(ctx, "/v1/evaluate/tool", req)
}

func applyRequestDefaults(req *EvaluationRequest) {
	if req.RequestID == "" {
		req.RequestID = newRequestID()
	}
	if req.AgentID == "" {
		req.AgentID = "default"
	}
	if req.Env == "" {
		req.Env = "prod"
	}
}

func newRequestID() string {
	b := make([]byte, 4)
	rand.Read(b) //nolint:errcheck
	return fmt.Sprintf("req_%x", b)
}

func (c *Client) post(ctx context.Context, path string, body any) (*EvaluationResponse, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("znyx: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("znyx: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("znyx: http: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("znyx: server returned %d for %s", resp.StatusCode, path)
	}

	var result EvaluationResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("znyx: decode response: %w", err)
	}
	return &result, nil
}
