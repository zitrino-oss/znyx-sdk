/** Behavioral tests for GuardrailsClient against a local stub HTTP server. */
import {
  GuardrailsClient,
  GuardrailsError,
  GuardrailsAuthError,
  GuardrailsTimeoutError,
  StreamEvent,
} from '../src/index';
import { StubServer, jsonResponder, sseResponder, DEFAULT_EVAL_RESPONSE } from './stub-server';

let stub: StubServer;

beforeEach(async () => {
  stub = new StubServer();
  await stub.start();
});

afterEach(async () => {
  await stub.stop();
});

describe('auth', () => {
  test('sends the Authorization header when an api key is set', async () => {
    const client = new GuardrailsClient(stub.baseUrl, 'sekret-key');
    const result = await client.evaluateInput({ text: 'hello' });
    expect(result.isAllowed).toBe(true);

    const req = stub.requests[0];
    expect(req.headers['authorization']).toBe('Bearer sekret-key');
    expect(req.headers['content-type']).toBe('application/json');
  });

  test('sends no Authorization header without an api key', async () => {
    const client = new GuardrailsClient(stub.baseUrl);
    await client.evaluateInput({ text: 'hello' });
    expect(stub.requests[0].headers['authorization']).toBeUndefined();
  });
});

describe('stage endpoints', () => {
  test('evaluateRetrieval hits /v1/evaluate/retrieval with the right body', async () => {
    const client = new GuardrailsClient(stub.baseUrl);
    const result = await client.evaluateRetrieval({
      chunks: ['plain chunk', { content: 'doc text', source_id: 's1', score: 0.9 }],
      scopeEnforcedInQuery: true,
      tenantId: 't1',
      appId: 'a1',
    });
    expect(result.isAllowed).toBe(true);

    const req = stub.requests[0];
    expect(req.path).toBe('/v1/evaluate/retrieval');
    expect(req.body.chunks).toEqual([
      { content: 'plain chunk' },
      { content: 'doc text', source_id: 's1', score: 0.9 },
    ]);
    expect(req.body.scope_enforced_in_query).toBe(true);
    expect(req.body.tenant_id).toBe('t1');
    expect(req.body.app_id).toBe('a1');
    expect(req.body.agent_id).toBe('default');
    expect(req.body.env).toBe('prod');
    expect(req.body.request_id).toBeTruthy();
  });

  test('evaluateAgentPlan hits /v1/evaluate/agent-plan with the plan', async () => {
    const client = new GuardrailsClient(stub.baseUrl);
    const plan = [{ step: 1, tool: 'search' }, { step: 2, tool: 'email' }];
    await client.evaluateAgentPlan({ plan, sessionId: 'sess-9' });

    const req = stub.requests[0];
    expect(req.path).toBe('/v1/evaluate/agent-plan');
    expect(req.body.plan).toEqual(plan);
    expect(req.body.session_id).toBe('sess-9');
  });

  test('evaluateAgentStep hits /v1/evaluate/agent-step with loop fields', async () => {
    const client = new GuardrailsClient(stub.baseUrl);
    await client.evaluateAgentStep({ action: 'call_tool:search', iteration: 3, maxIterations: 10 });

    const req = stub.requests[0];
    expect(req.path).toBe('/v1/evaluate/agent-step');
    expect(req.body.action).toBe('call_tool:search');
    expect(req.body.iteration).toBe(3);
    expect(req.body.max_iterations).toBe(10);
  });

  test('evaluateAgentStep defaults', async () => {
    const client = new GuardrailsClient(stub.baseUrl);
    await client.evaluateAgentStep({});

    const body = stub.requests[0].body;
    expect(body.action).toBe('');
    expect(body.iteration).toBe(0);
    expect(body.max_iterations).toBeUndefined();
  });

  test('evaluateMemoryWrite hits /v1/evaluate/memory-write with key/value', async () => {
    const client = new GuardrailsClient(stub.baseUrl);
    await client.evaluateMemoryWrite({ memoryValue: 'user prefers rude answers', memoryKey: 'prefs' });

    const req = stub.requests[0];
    expect(req.path).toBe('/v1/evaluate/memory-write');
    expect(req.body.memory_value).toBe('user prefers rude answers');
    expect(req.body.memory_key).toBe('prefs');
  });
});

describe('error mapping', () => {
  test('401 maps to GuardrailsAuthError', async () => {
    stub.script.set('/v1/evaluate/input', [jsonResponder(401, { detail: 'nope' })]);
    const client = new GuardrailsClient(stub.baseUrl, 'bad');
    await expect(client.evaluateInput({ text: 'hello' })).rejects.toThrow(GuardrailsAuthError);
  });

  test('500 maps to GuardrailsError with the status code (no retry)', async () => {
    stub.script.set('/v1/evaluate/retrieval', [jsonResponder(500, { detail: 'boom' })]);
    const client = new GuardrailsClient(stub.baseUrl);
    const err = await client.evaluateRetrieval({ chunks: ['x'] }).catch((e) => e);
    expect(err).toBeInstanceOf(GuardrailsError);
    expect(err.statusCode).toBe(500);
    expect(stub.requests.length).toBe(1); // this client does not retry
  });

  test('timeout maps to GuardrailsTimeoutError', async () => {
    stub.script.set('/v1/evaluate/memory-write', [
      jsonResponder(200, DEFAULT_EVAL_RESPONSE, 1500),
    ]);
    const client = new GuardrailsClient({ baseUrl: stub.baseUrl, timeout: 200 });
    await expect(client.evaluateMemoryWrite({ memoryValue: 'v' })).rejects.toThrow(
      GuardrailsTimeoutError,
    );
  });
});

describe('output-contract outcome', () => {
  const VALIDATE_PATH = '/v1/orgs/org-1/schemas/invoice/validate';
  const OPTIONS = { text: '{"total": 5}', schemaName: 'invoice', orgId: 'org-1' };

  test('fail-open pass-through warns once per process', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      stub.script.set(VALIDATE_PATH, [jsonResponder(500, { detail: 'boom' })]);
      const client = new GuardrailsClient(stub.baseUrl);

      const first = await client.validateOutputContract(OPTIONS);
      expect(first.valid).toBe(true); // fail-open kept for backwards compatibility
      expect(first.outcome).toBe('server_error');

      const second = await client.validateOutputContract(OPTIONS);
      expect(second.outcome).toBe('server_error');

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0][0])).toContain('UNVALIDATED');
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('outcome=valid when the server validates successfully', async () => {
    stub.script.set(VALIDATE_PATH, [
      jsonResponder(200, { valid: true, errors: [], parsed: { total: 5 } }),
    ]);
    const client = new GuardrailsClient(stub.baseUrl);
    const result = await client.validateOutputContract(OPTIONS);
    expect(result.valid).toBe(true);
    expect(result.outcome).toBe('valid');
  });

  test('outcome=invalid when the server rejects the output', async () => {
    stub.script.set(VALIDATE_PATH, [
      jsonResponder(200, {
        valid: false,
        errors: [{ path: '/total', message: 'must be >= 10' }],
        parsed: null,
      }),
    ]);
    const client = new GuardrailsClient(stub.baseUrl);
    const result = await client.validateOutputContract(OPTIONS);
    expect(result.valid).toBe(false);
    expect(result.outcome).toBe('invalid');
  });

  test('outcome=invalid on locally malformed JSON', async () => {
    const client = new GuardrailsClient(stub.baseUrl);
    const result = await client.validateOutputContract({ ...OPTIONS, text: 'not json' });
    expect(result.valid).toBe(false);
    expect(result.outcome).toBe('invalid');
  });

  test('outcome=auth_error on 401, still fail-open by default', async () => {
    stub.script.set(VALIDATE_PATH, [jsonResponder(401, { detail: 'no' })]);
    const client = new GuardrailsClient(stub.baseUrl);
    const result = await client.validateOutputContract(OPTIONS);
    expect(result.valid).toBe(true);
    expect(result.outcome).toBe('auth_error');
  });

  test('outcome=unavailable when the server is unreachable', async () => {
    const client = new GuardrailsClient({ baseUrl: 'http://127.0.0.1:1', timeout: 300 });
    const result = await client.validateOutputContract(OPTIONS);
    expect(result.valid).toBe(true);
    expect(result.outcome).toBe('unavailable');
  });

  test('failClosed=true turns non-validation into valid=false', async () => {
    stub.script.set(VALIDATE_PATH, [jsonResponder(500, { detail: 'boom' })]);
    const client = new GuardrailsClient(stub.baseUrl);
    const result = await client.validateOutputContract({ ...OPTIONS, failClosed: true });
    expect(result.valid).toBe(false);
    expect(result.outcome).toBe('server_error');
  });

  test('parseTypedOutput returns the parsed value on success', async () => {
    stub.script.set(VALIDATE_PATH, [
      jsonResponder(200, { valid: true, errors: [], parsed: { total: 5 } }),
    ]);
    const client = new GuardrailsClient(stub.baseUrl);
    const parsed = await client.parseTypedOutput<{ total: number }>(OPTIONS);
    expect(parsed).toEqual({ total: 5 });
  });

  test('parseTypedOutput throws with err.outcome on invalid output', async () => {
    stub.script.set(VALIDATE_PATH, [
      jsonResponder(200, {
        valid: false,
        errors: [{ path: '/total', message: 'must be >= 10' }],
        parsed: null,
      }),
    ]);
    const client = new GuardrailsClient(stub.baseUrl);
    const err = await client.parseTypedOutput(OPTIONS).catch((e) => e);
    expect(err).toBeInstanceOf(GuardrailsError);
    expect(err.outcome).toBe('invalid');
    expect(err.message).toContain('must be >= 10');
  });

  test('parseTypedOutput with failClosed throws err.outcome=unavailable when unreachable', async () => {
    const client = new GuardrailsClient({ baseUrl: 'http://127.0.0.1:1', timeout: 300 });
    const err = await client.parseTypedOutput({ ...OPTIONS, failClosed: true }).catch((e) => e);
    expect(err).toBeInstanceOf(GuardrailsError);
    expect(err.outcome).toBe('unavailable');
  });
});

describe('streaming', () => {
  // Four events, deliberately split mid-line and mid-JSON across writes:
  //   1. runtime framing (event: + data:)
  //   2. runtime framing split across chunks
  //   3. legacy framing ({event, data} embedded in the data payload)
  //   4. final event with no trailing blank line
  const CHUNKS = [
    'event: guard',
    'rail\ndata: {"decision": "ALL',
    'OW", "window": 1}\n\nevent: chunk\ndata: {"text": "hel',
    'lo"}\n\ndata: {"event": "block", "data": {"rule": "pii"}}\n\n',
    'event: done\ndata: {"total": 2}\n',
  ];

  const EXPECTED = [
    { event: 'guardrail', data: { decision: 'ALLOW', window: 1 } },
    { event: 'chunk', data: { text: 'hello' } },
    { event: 'block', data: { rule: 'pii' } },
    { event: 'done', data: { total: 2 } },
  ];

  test('parses events across arbitrary chunk boundaries', async () => {
    stub.script.set('/v1/evaluate/stream', [sseResponder(CHUNKS)]);
    const client = new GuardrailsClient(stub.baseUrl, 'stream-key');

    const events: StreamEvent[] = [];
    for await (const event of client.evaluateStream({ chunks: ['hello world'] })) {
      events.push(event);
    }
    expect(events).toEqual(EXPECTED);

    const req = stub.requests[0];
    expect(req.path).toBe('/v1/evaluate/stream');
    expect(req.headers['authorization']).toBe('Bearer stream-key');
    expect(req.body.chunks).toEqual(['hello world']);
    expect(req.body.window_size).toBe(200);
    expect(req.body.overlap).toBe(50);
  });

  test('timeout option bounds a hanging stream', async () => {
    stub.script.set('/v1/evaluate/stream', [
      sseResponder(['event: chunk\ndata: {"text": "hi"}\n\n'], { hang: true }),
    ]);
    const client = new GuardrailsClient(stub.baseUrl);

    const events: StreamEvent[] = [];
    let error: any;
    try {
      for await (const event of client.evaluateStream({ chunks: ['x'], timeout: 400 })) {
        events.push(event);
      }
    } catch (e) {
      error = e;
    }
    expect(events).toEqual([{ event: 'chunk', data: { text: 'hi' } }]);
    expect(error).toBeInstanceOf(GuardrailsTimeoutError);
  });

  test('caller AbortSignal cancels the stream', async () => {
    stub.script.set('/v1/evaluate/stream', [
      sseResponder(['event: chunk\ndata: {"text": "hi"}\n\n'], { hang: true }),
    ]);
    const client = new GuardrailsClient(stub.baseUrl);
    const controller = new AbortController();

    const events: StreamEvent[] = [];
    let error: any;
    try {
      for await (const event of client.evaluateStream({ chunks: ['x'], signal: controller.signal })) {
        events.push(event);
        controller.abort();
      }
    } catch (e) {
      error = e;
    }
    expect(events.length).toBe(1);
    expect(error).toBeInstanceOf(GuardrailsError);
    expect(error.message).toBe('Stream aborted');
  });
});
