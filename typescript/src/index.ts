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

/** Common scope/trace fields shared by the per-stage evaluate options. */
export interface StageScopeOptions {
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

/** One retrieved RAG chunk, mirroring the runtime's RetrievalChunk model. */
export interface RetrievalChunk {
  content: string;
  source_id?: string;
  score?: number;
  /** Whether a higher score is better ('similarity') or worse ('distance'). */
  score_kind?: 'similarity' | 'distance';
  /** Tenant the chunk belongs to, as recorded in the index. */
  tenant_id?: string;
  metadata?: Record<string, any>;
}

export interface EvaluateRetrievalOptions extends StageScopeOptions {
  /** Retrieved chunks, as plain strings or RetrievalChunk objects. */
  chunks: Array<string | RetrievalChunk>;
  /** True when tenant scoping was applied inside the index query. */
  scopeEnforcedInQuery?: boolean;
}

export interface EvaluateAgentPlanOptions extends StageScopeOptions {
  /** The proposed plan (list of steps or structured JSON). */
  plan: any;
}

export interface EvaluateAgentStepOptions extends StageScopeOptions {
  /** The action/tool the agent intends to take this step. */
  action?: string;
  /** Zero-based loop iteration counter. */
  iteration?: number;
  /** The caller's own iteration cap, if any. */
  maxIterations?: number;
}

export interface EvaluateMemoryWriteOptions extends StageScopeOptions {
  /** The value being written to memory. */
  memoryValue: string;
  /** Optional key the value is stored under. */
  memoryKey?: string;
}

/**
 * How an output-contract validation concluded.
 *
 * - 'valid': the server validated the output and it passed.
 * - 'invalid': the output failed validation (locally or server-side).
 * - 'unavailable': the server could not be reached (network error, timeout,
 *   or a non-auth 4xx); no validation happened.
 * - 'auth_error': the server rejected the credentials (401/403); no
 *   validation happened.
 * - 'server_error': the server errored (5xx); no validation happened.
 *
 * valid=true with an outcome other than 'valid' means the text was passed
 * through UNVALIDATED (fail-open).
 */
export type ValidationOutcome = 'valid' | 'invalid' | 'unavailable' | 'auth_error' | 'server_error';

export interface OutputContractResult {
  valid: boolean;
  errors: Array<{ path: string; message: string }>;
  parsed: any;
  outcome: ValidationOutcome;
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
  /** Abort the stream from the caller's side (in addition to any timeout). */
  signal?: AbortSignal;
  /** Overall timeout for the stream in milliseconds. No timeout when unset. */
  timeout?: number;
}

// --- Errors ---

export class GuardrailsError extends Error {
  statusCode?: number;
  /** Set on contract-validation failures: how the validation concluded. */
  outcome?: ValidationOutcome;
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

// Warn once per process when a fail-open pass-through happens, so the
// default's flip to fail-closed in the next major does not surprise anyone.
let failOpenWarned = false;

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

  /** fetch with an AbortController-based timeout, normalizing aborts to GuardrailsTimeoutError. */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err: any) {
      if (err?.name === 'AbortError') throw new GuardrailsTimeoutError();
      throw err;
    } finally {
      clearTimeout(timer);
    }
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

  /** Common scope/trace fields shared by the per-stage endpoints. */
  private scopeBody(options: StageScopeOptions): Record<string, any> {
    return {
      request_id: options.requestId || this.uuid(),
      tenant_id: options.tenantId || 'default',
      app_id: options.appId || 'default',
      agent_id: options.agentId || 'default',
      env: options.env || 'prod',
      metadata: options.metadata,
      trace_id: options.traceId,
      session_id: options.sessionId,
      span_id: options.spanId,
    };
  }

  /**
   * Evaluate retrieved RAG chunks before they enter the model context.
   * Calls POST /v1/evaluate/retrieval.
   */
  async evaluateRetrieval(options: EvaluateRetrievalOptions): Promise<EvaluationResult> {
    const body = this.scopeBody(options);
    body.chunks = options.chunks.map(c => (typeof c === 'string' ? { content: c } : c));
    if (options.scopeEnforcedInQuery !== undefined) {
      body.scope_enforced_in_query = options.scopeEnforcedInQuery;
    }
    return this.request('/v1/evaluate/retrieval', body);
  }

  /**
   * Evaluate a proposed multi-step agent plan before execution.
   * Calls POST /v1/evaluate/agent-plan.
   */
  async evaluateAgentPlan(options: EvaluateAgentPlanOptions): Promise<EvaluationResult> {
    const body = this.scopeBody(options);
    body.plan = options.plan;
    return this.request('/v1/evaluate/agent-plan', body);
  }

  /**
   * Evaluate a single agent-loop iteration (budget/depth caps).
   * Calls POST /v1/evaluate/agent-step.
   */
  async evaluateAgentStep(options: EvaluateAgentStepOptions): Promise<EvaluationResult> {
    const body = this.scopeBody(options);
    body.action = options.action || '';
    body.iteration = options.iteration ?? 0;
    if (options.maxIterations !== undefined) body.max_iterations = options.maxIterations;
    return this.request('/v1/evaluate/agent-step', body);
  }

  /**
   * Evaluate text being written to agent memory (persistent injection).
   * Calls POST /v1/evaluate/memory-write.
   */
  async evaluateMemoryWrite(options: EvaluateMemoryWriteOptions): Promise<EvaluationResult> {
    const body = this.scopeBody(options);
    body.memory_value = options.memoryValue;
    if (options.memoryKey !== undefined) body.memory_key = options.memoryKey;
    return this.request('/v1/evaluate/memory-write', body);
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

    const resp = await this.fetchWithTimeout(
      `${this.controlPlaneUrl}/v1/orgs/${encodeURIComponent(options.orgId)}/benchmarks`,
      { method: 'POST', headers, body: JSON.stringify(body) },
      120_000, // benchmark runs can take a while
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

    const resp = await this.fetchWithTimeout(
      `${this.controlPlaneUrl}/v1/orgs/${encodeURIComponent(options.orgId)}/traces/${encodeURIComponent(options.traceId)}/replay`,
      { method: 'POST', headers, body: JSON.stringify(body) },
      30_000,
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
   *
   * The result's `outcome` says how validation concluded (see
   * ValidationOutcome). `valid: true` with an outcome other than 'valid'
   * means the text was passed through UNVALIDATED (fail-open); every such
   * pass-through logs a console warning once per process. The fail-open
   * default flips to fail-closed in the next major release.
   */
  async validateOutputContract(options: {
    text: string;
    schemaName: string;
    orgId: string;
    schemaVersion?: number;
    /**
     * When the control plane is unreachable or errors, treat the output as
     * invalid instead of passing it through. Defaults to false (fail-open) for
     * backwards compatibility; set true on safety-critical paths. This
     * default flips to fail-closed in the next major release.
     */
    failClosed?: boolean;
  }): Promise<OutputContractResult> {
    // Parse locally first
    let parsed: any;
    try {
      parsed = JSON.parse(options.text);
    } catch (e: any) {
      return {
        valid: false,
        errors: [{ path: '/', message: `Invalid JSON: ${e.message}` }],
        parsed: null,
        outcome: 'invalid',
      };
    }

    const fallthrough = (outcome: ValidationOutcome): OutputContractResult => {
      if (options.failClosed) {
        return {
          valid: false,
          errors: [{ path: '/', message: 'Server validation unavailable' }],
          parsed,
          outcome,
        };
      }
      if (!failOpenWarned) {
        failOpenWarned = true;
        console.warn(
          `@znyx/sdk: output-contract validation could not reach the server (outcome=${outcome}); ` +
            'the output was passed through UNVALIDATED (fail-open). This default flips to ' +
            'fail-closed in the next major release; pass failClosed: true to opt in now.',
        );
      }
      return { valid: true, errors: [], parsed, outcome };
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const body: Record<string, any> = { text: options.text };
    if (options.schemaVersion !== undefined) body.version = options.schemaVersion;

    try {
      const resp = await this.fetchWithTimeout(
        `${this.controlPlaneUrl}/v1/orgs/${encodeURIComponent(options.orgId)}/schemas/${encodeURIComponent(options.schemaName)}/validate`,
        { method: 'POST', headers, body: JSON.stringify(body) },
        this.timeout,
      );
      if (resp.status === 401 || resp.status === 403) return fallthrough('auth_error');
      if (resp.status >= 500) return fallthrough('server_error');
      if (!resp.ok) return fallthrough('unavailable');
      const data = (await resp.json()) as OutputContractResult;
      if (!data.outcome) data.outcome = data.valid ? 'valid' : 'invalid';
      return data;
    } catch {
      return fallthrough('unavailable');
    }
  }

  /**
   * Parse and validate LLM output, returning the typed result or throwing.
   * Convenience wrapper that throws GuardrailsError on validation failure;
   * the thrown error carries the validation outcome as `err.outcome`.
   */
  async parseTypedOutput<T = any>(options: {
    text: string;
    schemaName: string;
    orgId: string;
    schemaVersion?: number;
    failClosed?: boolean;
  }): Promise<T> {
    const result = await this.validateOutputContract(options);
    if (!result.valid) {
      const msg = result.errors.slice(0, 3).map(e => e.message).join('; ');
      const err = new GuardrailsError(`Output contract validation failed: ${msg}`);
      err.outcome = result.outcome || 'invalid';
      throw err;
    }
    return result.parsed as T;
  }

  /**
   * Stream evaluation via SSE.
   * Calls POST /v1/evaluate/stream and yields StreamEvent objects.
   *
   * Pass `signal` to abort from the caller's side and/or `timeout` (ms) to
   * bound the whole stream. A timeout throws GuardrailsTimeoutError; a
   * caller abort throws GuardrailsError('Stream aborted').
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

    // One controller drives the fetch; it aborts on timeout or when the
    // caller's signal fires (AbortSignal.any needs Node 20.3+, so wire it
    // manually while Node 18 is supported).
    const controller = new AbortController();
    let timedOut = false;
    const timer =
      options.timeout !== undefined
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, options.timeout)
        : undefined;
    const onAbort = () => controller.abort();
    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
    }

    const mapAbort = (err: any): never => {
      if (timedOut) throw new GuardrailsTimeoutError();
      if (err?.name === 'AbortError') throw new GuardrailsError('Stream aborted');
      if (err instanceof GuardrailsError) throw err;
      throw new GuardrailsError(err?.message ?? String(err));
    };

    // SSE framing: fields accumulate until a blank line ends the event. The
    // `event:` field names the event and the data payload is the body; when
    // the server embeds {event, data} in the payload instead, honor that.
    let eventName: string | undefined;
    let dataLines: string[] = [];
    const makeEvent = (): StreamEvent | undefined => {
      if (dataLines.length === 0) return undefined;
      const raw = dataLines.join('\n');
      dataLines = [];
      const name = eventName;
      eventName = undefined;
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return undefined; // skip malformed events
      }
      if (name !== undefined) {
        return { event: name, data: typeof parsed === 'object' && parsed !== null ? parsed : {} };
      }
      return { event: parsed?.event || 'unknown', data: parsed?.data || {} };
    };
    const parseLine = (line: string): StreamEvent | undefined => {
      if (line === '') return makeEvent();
      if (line.startsWith('event:')) eventName = line.slice(6).replace(/^ /, '');
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      return undefined;
    };

    try {
      let resp: Response;
      try {
        resp = await fetch(`${this.baseUrl}/v1/evaluate/stream`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err: any) {
        mapAbort(err);
        throw err; // unreachable, keeps TS control-flow happy
      }

      if (!resp.ok) {
        const text = await resp.text();
        throw new GuardrailsError(`evaluateStream failed: ${resp.status} ${text}`, resp.status);
      }

      const reader = resp.body?.getReader();
      if (!reader) throw new GuardrailsError('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        let done: boolean;
        let value: Uint8Array | undefined;
        try {
          ({ done, value } = await reader.read());
        } catch (err: any) {
          mapAbort(err);
          throw err; // unreachable
        }

        // Flush the decoder at end-of-stream so a multi-byte character split
        // across the final chunk still comes through.
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx).replace(/\r$/, '');
          buffer = buffer.slice(idx + 1);
          const event = parseLine(line);
          if (event) yield event;
        }

        if (done) {
          // Flush a final event that ended without a trailing blank line.
          const tail = buffer.replace(/\r$/, '');
          if (tail !== '') parseLine(tail);
          const event = makeEvent();
          if (event) yield event;
          break;
        }
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }
}

