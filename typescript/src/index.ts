/**
 * Guardrails TypeScript SDK
 *
 * Zero-dependency client for the Guardrails Runtime API.
 * Uses native fetch (Node 18+, browser, Deno, Bun).
 *
 * Usage:
 *   import { GuardrailsClient } from '@znyx/sdk';
 *
 *   const client = new GuardrailsClient('http://localhost:8080');
 *   const result = await client.evaluateInput({ text: 'Hello!' });
 *   if (result.isBlocked) console.log('Blocked:', result.userMessage);
 */

import { maybeSendInstallPing } from './telemetry';

// --- Types ---

export type Decision = 'ALLOW' | 'BLOCK' | 'REDACT' | 'WARN' | 'TRANSFORM';

export interface RuleHit {
  rule_id: string;
  severity: string;
  message: string;
}

export interface DetectorTimingResult {
  detector_name: string;
  decision: string | null;
  risk_score: number;
  latency_ms: number;
  rule_hits: RuleHit[];
  transformed: boolean;
}

export interface QualityScore {
  metric: string;
  score: number;
  details: string;
  sub_scores: Record<string, number> | null;
}

export interface QualityReport {
  scores: QualityScore[];
  overall_score: number;
  evaluated_at: string;
}

export interface EvaluationResult {
  request_id: string;
  decision: Decision;
  risk_score: number;
  policy_version: string;
  rule_hits: RuleHit[];
  sanitized_text: string | null;
  sanitized_tool_args: Record<string, any> | null;
  user_message: string | null;
  developer_message: string | null;
  latency_ms: number | null;
  trace_id: string | null;
  detector_results: DetectorTimingResult[];
  quality: QualityReport | null;
  isBlocked: boolean;
  isAllowed: boolean;
  isRedacted: boolean;
}

export interface EvaluateOptions {
  text: string;
  tenantId?: string;
  appId?: string;
  agentId?: string;
  env?: string;
  metadata?: Record<string, any>;
  requestId?: string;
  traceId?: string;
  sessionId?: string;
  spanId?: string;
}

export interface EvaluateToolOptions {
  toolName: string;
  toolArgs: Record<string, any>;
  tenantId?: string;
  appId?: string;
  agentId?: string;
  env?: string;
  metadata?: Record<string, any>;
  requestId?: string;
}

export interface ClientOptions {
  baseUrl: string;
  apiKey?: string;
  timeout?: number;
  controlPlaneUrl?: string;
}

export interface BenchmarkResult {
  run_id: string;
  dataset_id: string;
  status: string;
  total_samples: number;
  completed_samples: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  results_summary: Record<string, any> | null;
}

export interface ReplayResult {
  source_trace_id: string;
  replay_decision: string;
  replay_risk_score: number;
  replay_detector_results: Record<string, any>[];
  replay_latency_ms: number;
}

export interface StreamEvent {
  event: string; // "chunk" | "guardrail" | "block" | "done"
  data: Record<string, any>;
}

export interface RunDatasetOptions {
  orgId: string;
  datasetId: string;
  policyVersion?: string;
  bundleId?: string;
}

export interface ReplayDecisionOptions {
  orgId: string;
  traceId: string;
  policyVersion?: string;
}

export interface EvaluateStreamOptions {
  chunks: string[];
  context?: string;
  windowSize?: number;
  overlap?: number;
  policy?: Record<string, any>;
}

// --- Errors ---

export class GuardrailsError extends Error {
  statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'GuardrailsError';
    this.statusCode = statusCode;
  }
}

export class GuardrailsTimeoutError extends GuardrailsError {
  constructor() {
    super('Request timed out');
    this.name = 'GuardrailsTimeoutError';
  }
}

export class GuardrailsAuthError extends GuardrailsError {
  constructor(message: string = 'Authentication failed', statusCode: number = 401) {
    super(message, statusCode);
    this.name = 'GuardrailsAuthError';
  }
}

// --- Client ---

export class GuardrailsClient {
  private baseUrl: string;
  private apiKey: string;
  private timeout: number;
  private controlPlaneUrl: string;

  constructor(baseUrlOrOptions: string | ClientOptions, apiKey?: string) {
    if (typeof baseUrlOrOptions === 'string') {
      this.baseUrl = baseUrlOrOptions.replace(/\/$/, '');
      this.apiKey = apiKey || '';
      this.timeout = 5000;
      this.controlPlaneUrl = this.baseUrl;
    } else {
      this.baseUrl = baseUrlOrOptions.baseUrl.replace(/\/$/, '');
      this.apiKey = baseUrlOrOptions.apiKey || '';
      this.timeout = baseUrlOrOptions.timeout || 5000;
      this.controlPlaneUrl = (baseUrlOrOptions.controlPlaneUrl || baseUrlOrOptions.baseUrl).replace(/\/$/, '');
    }

    // Anonymous, opt-out install telemetry (ZNYX_TELEMETRY=false to disable).
    // Node-only and fire-and-forget; never awaited, never throws.
    try {
      void maybeSendInstallPing();
    } catch {
      // ignore
    }
  }

  private async request(path: string, body: Record<string, any>): Promise<EvaluationResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    try {
      const resp = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (resp.status === 401 || resp.status === 403) {
        throw new GuardrailsAuthError('Authentication failed', resp.status);
      }
      if (!resp.ok) {
        const text = await resp.text();
        throw new GuardrailsError(`Request failed: ${resp.status} ${text}`, resp.status);
      }

      const data: any = await resp.json();
      return {
        ...data,
        isBlocked: data.decision === 'BLOCK',
        isAllowed: data.decision === 'ALLOW',
        isRedacted: data.decision === 'REDACT',
      };
    } catch (err: any) {
      if (err.name === 'AbortError') throw new GuardrailsTimeoutError();
      if (err instanceof GuardrailsError) throw err;
      throw new GuardrailsError(err.message);
    } finally {
      clearTimeout(timer);
    }
  }

  private uuid(): string {
    return crypto.randomUUID?.() || Math.random().toString(36).slice(2);
  }

  async evaluateInput(options: EvaluateOptions): Promise<EvaluationResult> {
    return this.request('/v1/evaluate/input', {
      request_id: options.requestId || this.uuid(),
      tenant_id: options.tenantId || 'default',
      app_id: options.appId || 'default',
      agent_id: options.agentId || 'default',
      env: options.env || 'prod',
      text: options.text,
      metadata: options.metadata,
      trace_id: options.traceId,
      session_id: options.sessionId,
      span_id: options.spanId,
    });
  }

  async evaluateOutput(options: EvaluateOptions): Promise<EvaluationResult> {
    return this.request('/v1/evaluate/output', {
      request_id: options.requestId || this.uuid(),
      tenant_id: options.tenantId || 'default',
      app_id: options.appId || 'default',
      agent_id: options.agentId || 'default',
      env: options.env || 'prod',
      text: options.text,
      metadata: options.metadata,
      trace_id: options.traceId,
      session_id: options.sessionId,
      span_id: options.spanId,
    });
  }

  async evaluateTool(options: EvaluateToolOptions): Promise<EvaluationResult> {
    return this.request('/v1/evaluate/tool', {
      request_id: options.requestId || this.uuid(),
      tenant_id: options.tenantId || 'default',
      app_id: options.appId || 'default',
      agent_id: options.agentId || 'default',
      env: options.env || 'prod',
      tool_name: options.toolName,
      tool_args: options.toolArgs,
      metadata: options.metadata,
    });
  }

  async health(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.baseUrl}/healthz`);
      return resp.ok;
    } catch {
      return false;
    }
  }

  /**
   * Start a benchmark run against a dataset.
   * Calls POST /v1/orgs/{orgId}/benchmarks on the control plane.
   */
  async runDataset(options: RunDatasetOptions): Promise<BenchmarkResult> {
    const body: Record<string, any> = { dataset_id: options.datasetId };
    if (options.policyVersion) body.policy_version = options.policyVersion;
    if (options.bundleId) body.bundle_id = options.bundleId;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const resp = await fetch(
      `${this.controlPlaneUrl}/v1/orgs/${options.orgId}/benchmarks`,
      { method: 'POST', headers, body: JSON.stringify(body) },
    );

    if (!resp.ok) {
      const text = await resp.text();
      throw new GuardrailsError(`runDataset failed: ${resp.status} ${text}`, resp.status);
    }

    const data: any = await resp.json();
    const summary = data.results_summary || {};
    return {
      run_id: data.id || '',
      dataset_id: data.dataset_id || '',
      status: data.status || 'unknown',
      total_samples: data.total_samples || 0,
      completed_samples: data.completed_samples || 0,
      accuracy: summary.accuracy || 0,
      precision: summary.precision || 0,
      recall: summary.recall || 0,
      f1: summary.f1 || 0,
      results_summary: summary,
    };
  }

  /**
   * Replay a previous evaluation trace against a different policy.
   * Calls POST /v1/orgs/{orgId}/traces/{traceId}/replay.
   */
  async replayDecision(options: ReplayDecisionOptions): Promise<ReplayResult> {
    const body: Record<string, any> = {};
    if (options.policyVersion) body.policy_version = options.policyVersion;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const resp = await fetch(
      `${this.controlPlaneUrl}/v1/orgs/${options.orgId}/traces/${options.traceId}/replay`,
      { method: 'POST', headers, body: JSON.stringify(body) },
    );

    if (!resp.ok) {
      const text = await resp.text();
      throw new GuardrailsError(`replayDecision failed: ${resp.status} ${text}`, resp.status);
    }

    const data: any = await resp.json();
    return {
      source_trace_id: data.source_trace_id || '',
      replay_decision: data.replay_decision || 'ALLOW',
      replay_risk_score: data.replay_risk_score || 0,
      replay_detector_results: data.replay_detector_results || [],
      replay_latency_ms: data.replay_latency_ms || 0,
    };
  }

  // -- Typed Contract Helpers -----------------------------------------------

  /**
   * Validate LLM output against a named output schema contract.
   * Calls POST /v1/orgs/{orgId}/schemas/{schemaName}/validate on the control plane.
   */
  async validateOutputContract(options: {
    text: string;
    schemaName: string;
    orgId: string;
    schemaVersion?: number;
  }): Promise<{ valid: boolean; errors: Array<{ path: string; message: string }>; parsed: any }> {
    // Parse locally first
    let parsed: any;
    try {
      parsed = JSON.parse(options.text);
    } catch (e: any) {
      return { valid: false, errors: [{ path: '/', message: `Invalid JSON: ${e.message}` }], parsed: null };
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const body: Record<string, any> = { text: options.text };
    if (options.schemaVersion !== undefined) body.version = options.schemaVersion;

    try {
      const resp = await fetch(
        `${this.controlPlaneUrl}/v1/orgs/${options.orgId}/schemas/${options.schemaName}/validate`,
        { method: 'POST', headers, body: JSON.stringify(body) },
      );
      if (!resp.ok) {
        return { valid: true, errors: [], parsed };
      }
      return await resp.json() as { valid: boolean; errors: Array<{ path: string; message: string }>; parsed: any };
    } catch {
      return { valid: true, errors: [], parsed };
    }
  }

  /**
   * Parse and validate LLM output, returning the typed result or throwing.
   * Convenience wrapper that throws GuardrailsError on validation failure.
   */
  async parseTypedOutput<T = any>(options: {
    text: string;
    schemaName: string;
    orgId: string;
    schemaVersion?: number;
  }): Promise<T> {
    const result = await this.validateOutputContract(options);
    if (!result.valid) {
      const msg = result.errors.slice(0, 3).map(e => e.message).join('; ');
      throw new GuardrailsError(`Output contract validation failed: ${msg}`);
    }
    return result.parsed as T;
  }

  /**
   * Stream evaluation via SSE.
   * Calls POST /v1/evaluate/stream and yields StreamEvent objects.
   */
  async *evaluateStream(options: EvaluateStreamOptions): AsyncGenerator<StreamEvent> {
    const body: Record<string, any> = {
      chunks: options.chunks,
      context: options.context || 'output',
      window_size: options.windowSize || 200,
      overlap: options.overlap || 50,
    };
    if (options.policy) body.policy = options.policy;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const resp = await fetch(`${this.baseUrl}/v1/evaluate/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new GuardrailsError(`evaluateStream failed: ${resp.status} ${text}`, resp.status);
    }

    const reader = resp.body?.getReader();
    if (!reader) throw new GuardrailsError('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(line.slice(6));
            yield {
              event: parsed.event || 'unknown',
              data: parsed.data || {},
            };
          } catch {
            // skip malformed lines
          }
        }
      }
    }
  }
}

