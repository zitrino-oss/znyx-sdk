/**
 * Anonymous install telemetry for the ZNYX TypeScript SDK.
 *
 * Sends a single fire-and-forget ping when a client is first constructed, then
 * at most one "heartbeat" ping per 24h. Non-sensitive metadata only:
 *
 *   install_id (random UUID, persisted to ~/.znyx/sdk-state.json),
 *   SDK version, source ("node-sdk"), platform / arch / OS release, run_count.
 *
 * No PII, no request content. Mirrors the runtime heartbeat so SDK installs
 * land in the same anonymous_installs table, tagged with source.
 *
 * Node-only: in a browser/Deno (no filesystem) this is a complete no-op — we
 * never phone home from a browser. Opt out with ZNYX_TELEMETRY=false (on by
 * default). Disclosed once to stderr on the first run. Every step is
 * best-effort and must never block, slow, or break the calling application.
 */

// Telemetry endpoint. Empty by default so this OSS SDK never phones home. Set
// ZNYX_TELEMETRY_URL (or ZNYX_HEARTBEAT_URL) to a control plane you operate to
// opt in. When empty, no ping is sent regardless of ZNYX_TELEMETRY.
const ENDPOINT =
  (typeof process !== 'undefined' &&
    (process.env?.ZNYX_TELEMETRY_URL || process.env?.ZNYX_HEARTBEAT_URL)) ||
  '';
const HEARTBEAT_INTERVAL_MS = 86_400_000; // 24h
const SOURCE = 'node-sdk';

// Read the version from package.json at runtime so it can never drift from the
// published version. dist/telemetry.js resolves ../package.json to the package
// root; best-effort, since telemetry must never throw.
function resolveVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../package.json').version || 'unknown';
  } catch {
    return 'unknown';
  }
}
const VERSION = resolveVersion();

const DISCLOSURE =
  '[@znyx/sdk] Anonymous usage telemetry is on (install id, SDK version, OS - ' +
  'no PII, no request content). Opt out with ZNYX_TELEMETRY=false.\n';

// Only attempt once per process, no matter how many clients are constructed.
let attempted = false;

function isNode(): boolean {
  return typeof process !== 'undefined' && !!process.versions?.node;
}

function enabled(): boolean {
  const val = (process.env?.ZNYX_TELEMETRY || 'true').toLowerCase();
  return val !== 'false' && val !== '0' && val !== 'no';
}

/** Send an anonymous install ping, throttled to once per 24h. Fire-and-forget. */
export async function maybeSendInstallPing(): Promise<void> {
  if (attempted) return;
  attempted = true;

  try {
    if (!ENDPOINT || !isNode() || !enabled()) return;

    // Dynamically import node builtins so browser bundles don't pull them in.
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { randomUUID } = await import('node:crypto');

    const stateFile = path.join(os.homedir(), '.znyx', 'sdk-state.json');

    let state: Record<string, any> = {};
    try {
      if (fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch {
      state = {};
    }

    const now = new Date();
    const lastPing = state.last_ping_at ? new Date(state.last_ping_at) : null;
    let eventType: string;
    if (!lastPing || isNaN(lastPing.getTime())) {
      eventType = 'first_run';
    } else if (now.getTime() - lastPing.getTime() < HEARTBEAT_INTERVAL_MS) {
      return; // throttled
    } else {
      eventType = 'heartbeat';
    }

    const installId: string = state.install_id || randomUUID();
    const runCount: number = (Number(state.run_count) || 0) + 1;
    const nowIso = now.toISOString();
    state = {
      ...state,
      install_id: installId,
      first_seen_at: state.first_seen_at || nowIso,
      last_ping_at: nowIso,
      run_count: runCount,
    };
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    } catch {
      // best-effort; never raise
    }

    if (eventType === 'first_run') {
      try {
        process.stderr.write(DISCLOSURE);
      } catch {
        // ignore
      }
    }

    const payload = {
      install_id: installId,
      version: VERSION,
      event_type: eventType,
      source: SOURCE,
      os: process.platform,
      os_version: os.release(),
      arch: process.arch,
      run_count: runCount,
      timestamp: nowIso,
    };

    // Fire-and-forget — do not await; swallow every error.
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  } catch {
    // Telemetry must never break client construction.
  }
}
