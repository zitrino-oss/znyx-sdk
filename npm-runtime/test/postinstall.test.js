'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

// Requiring the installer must be side-effect free (no download, no exit);
// main() only runs when the script is executed directly by npm.
const installer = require('../scripts/postinstall.js');

const BINARY_NAME = 'znyx-runtime-linux-x64';
const VERSION = '9.9.9';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'znyx-postinstall-test-'));
}

function writeBinary(dir, contents) {
  const file = path.join(dir, BINARY_NAME);
  fs.writeFileSync(file, contents);
  const digest = crypto.createHash('sha256').update(contents).digest('hex');
  return { file, digest };
}

test('pinned checksum match passes without consulting the remote .sha256', () => {
  const dir = makeTempDir();
  const { file, digest } = writeBinary(dir, 'binary-bytes');
  const known = { [VERSION]: { [BINARY_NAME]: digest } };

  assert.equal(installer.hasPinnedChecksum(VERSION, BINARY_NAME, known), true);

  // A nonexistent remote checksum path proves the pin short-circuits the
  // remote fallback: reading it would throw ENOENT.
  const resolved = installer.resolveExpectedChecksum(
    VERSION, BINARY_NAME, path.join(dir, 'does-not-exist.sha256'), known
  );
  assert.deepEqual(resolved, { expected: digest, source: 'pinned' });
  assert.equal(installer.verifyChecksum(file, resolved), digest);
});

test('pinned checksum mismatch fails hard', () => {
  const dir = makeTempDir();
  const { file } = writeBinary(dir, 'binary-bytes');
  const wrong = 'a'.repeat(64);
  const known = { [VERSION]: { [BINARY_NAME]: wrong } };

  const resolved = installer.resolveExpectedChecksum(
    VERSION, BINARY_NAME, path.join(dir, 'does-not-exist.sha256'), known
  );
  assert.equal(resolved.source, 'pinned');
  assert.throws(
    () => installer.verifyChecksum(file, resolved),
    installer.ChecksumMismatchError
  );
});

test('no pin falls back to the remote .sha256 with a warning', () => {
  const dir = makeTempDir();
  const { file, digest } = writeBinary(dir, 'binary-bytes');
  const remote = path.join(dir, `${BINARY_NAME}.sha256`);
  fs.writeFileSync(remote, `${digest}  ${BINARY_NAME}\n`);

  assert.equal(installer.hasPinnedChecksum(VERSION, BINARY_NAME, {}), false);

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  let resolved;
  try {
    resolved = installer.resolveExpectedChecksum(VERSION, BINARY_NAME, remote, {});
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(resolved, { expected: digest, source: 'remote' });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /no pinned checksum/);
  assert.equal(installer.verifyChecksum(file, resolved), digest);
});

test('remote checksum mismatch also fails hard', () => {
  const dir = makeTempDir();
  const { file } = writeBinary(dir, 'binary-bytes');
  const remote = path.join(dir, `${BINARY_NAME}.sha256`);
  fs.writeFileSync(remote, `${'b'.repeat(64)}  ${BINARY_NAME}\n`);

  const originalWarn = console.warn;
  console.warn = () => {};
  let resolved;
  try {
    resolved = installer.resolveExpectedChecksum(VERSION, BINARY_NAME, remote, {});
  } finally {
    console.warn = originalWarn;
  }

  assert.throws(
    () => installer.verifyChecksum(file, resolved),
    installer.ChecksumMismatchError
  );
});

test('ZNYX_SKIP_BINARY_DOWNLOAD skips the download and exits 0', () => {
  const script = path.join(__dirname, '..', 'scripts', 'postinstall.js');
  const result = spawnSync(process.execPath, [script], {
    env: { ...process.env, ZNYX_SKIP_BINARY_DOWNLOAD: '1' },
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /skipping binary download/);
});
