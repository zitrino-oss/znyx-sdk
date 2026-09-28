/**
 * Single source of the SDK's identity for both telemetry and request headers.
 *
 * The version is read from package.json at runtime so it can never drift from the
 * published version: the release workflow stamps the tag in with
 * `npm version --no-git-tag-version`, which rewrites package.json only. A literal
 * in a source file would not be touched by a release and would go stale - exactly
 * what happened to the Python SDK, which shipped a hardcoded 1.1.2 in every wheel
 * up to and including 1.2.1.
 *
 * dist/version.js resolves ../package.json to the package root. Best-effort: this
 * is imported on the client's hot path, so it must never throw.
 */

function resolveVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../package.json').version || 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Version of this SDK, as published. */
export const SDK_VERSION: string = resolveVersion();

/**
 * Which SDK is calling. Same vocabulary as the telemetry `source` field and
 * anonymous_installs.source, so the console and the admin install table label
 * languages identically.
 */
export const SDK_SOURCE = 'node-sdk';
