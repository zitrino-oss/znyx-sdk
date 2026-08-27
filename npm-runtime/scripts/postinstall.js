#!/usr/bin/env node
/**
 * postinstall.js - downloads the platform-matched ZNYX Runtime binary from
 * GitHub Releases, verifies its SHA256 checksum, and marks it executable.
 *
 * Supported platforms:
 *   macOS Apple Silicon  -> znyx-runtime-darwin-arm64
 *   macOS Intel          -> znyx-runtime-darwin-x64
 *   Linux x64            -> znyx-runtime-linux-x64
 *   Linux ARM64          -> znyx-runtime-linux-arm64
 *   Windows x64          -> znyx-runtime-windows-x64.exe
 *
 * Failure model:
 *   - Unsupported platform: skip with guidance (exit 0); pip/Docker cover it.
 *   - ZNYX_SKIP_BINARY_DOWNLOAD set: skip the download (exit 0), for offline
 *     or air-gapped installs where the binary is provided out of band.
 *   - Download failure: exit 1 with an actionable error. A package whose CLI
 *     cannot run should fail at install time, not at first use.
 *   - Checksum verification failure: exit 1 and delete the binary, always.
 *
 * On unsupported platforms a clear message is printed directing the user to
 * `pip install znyx-runtime` or Docker. pip is never invoked automatically.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

const PKG = require('../package.json');
const VERSION = PKG.version;
const GITHUB_REPO = 'zitrino-oss/znyx-runtime';
const RELEASE_BASE = `https://github.com/${GITHUB_REPO}/releases/download/v${VERSION}`;
const DOWNLOAD_TIMEOUT_MS = 60_000;

const PLATFORM_MAP = {
  'darwin-arm64': 'znyx-runtime-darwin-arm64',
  'darwin-x64':   'znyx-runtime-darwin-x64',
  'linux-x64':    'znyx-runtime-linux-x64',
  'linux-arm64':  'znyx-runtime-linux-arm64',
  'win32-x64':    'znyx-runtime-windows-x64.exe',
};

// Pinned, committed SHA256 checksums - the source of truth for binary
// authenticity. When an entry exists for the current version + binary we
// verify against it and FAIL CLOSED on any mismatch, without trusting the
// remote .sha256 (which lives in the same release and so cannot attest to it).
//
// Populate at release time from the release workflow's checksum output, e.g.:
//   KNOWN_CHECKSUMS['1.0.1'] = {
//     'znyx-runtime-darwin-arm64': '<sha256>',
//     ...
//   };
// Until an entry is present we fall back to the remote .sha256 (transport
// integrity only) and print a warning so the gap is visible.
const KNOWN_CHECKSUMS = {};

/** Thrown when a downloaded binary does not match its expected checksum. */
class ChecksumMismatchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ChecksumMismatchError';
  }
}

function getPlatformKey() {
  return `${os.platform()}-${os.arch()}`;
}

function getBinaryName() {
  return PLATFORM_MAP[getPlatformKey()] || null;
}

function getBinaryPath() {
  // Preserve .exe on Windows so the file is directly executable by the OS.
  const ext = os.platform() === 'win32' ? '.exe' : '';
  return path.join(__dirname, '..', 'bin', `znyx-bin${ext}`);
}

function hasPinnedChecksum(version, binaryName, knownChecksums = KNOWN_CHECKSUMS) {
  return Boolean((knownChecksums[version] || {})[binaryName]);
}

/**
 * Decide which checksum the downloaded binary must match.
 *
 * A pinned entry in the committed checksum map always wins and the remote
 * .sha256 is never consulted. Without a pin, fall back to the remote .sha256
 * file at remoteChecksumFile (transport integrity only) and warn, since a
 * checksum served alongside the binary cannot attest to its authenticity.
 *
 * Returns { expected, source } where source is 'pinned' or 'remote'.
 */
function resolveExpectedChecksum(version, binaryName, remoteChecksumFile, knownChecksums = KNOWN_CHECKSUMS) {
  const pinned = (knownChecksums[version] || {})[binaryName];
  if (pinned) {
    return { expected: pinned.trim().toLowerCase(), source: 'pinned' };
  }
  const raw = fs.readFileSync(remoteChecksumFile, 'utf8').trim().split(/\s+/)[0];
  console.warn(
    `[znyx] Warning: no pinned checksum for v${version}/${binaryName}; ` +
    `verifying transport integrity only.`
  );
  return { expected: raw.toLowerCase(), source: 'remote' };
}

/**
 * Verify the file at filePath against a checksum resolved by
 * resolveExpectedChecksum. Throws ChecksumMismatchError on mismatch;
 * returns the matching digest on success.
 */
function verifyChecksum(filePath, { expected, source }) {
  const actual = sha256File(filePath);
  if (actual !== expected) {
    throw new ChecksumMismatchError(
      `SHA256 mismatch (${source} checksum)\n` +
      `  expected: ${expected}\n` +
      `  actual:   ${actual}`
    );
  }
  return actual;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    file.on('error', reject);
    function fetch(u) {
      const req = https.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location || '';
          if (!location.startsWith('https://')) {
            return reject(new Error(`Refusing non-HTTPS redirect to ${location}`));
          }
          res.resume(); // drain the redirect response before following
          return fetch(location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} downloading ${u}`));
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      });
      req.on('error', reject);
      // Guard against a hung connection stalling `npm install` indefinitely.
      req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
        req.destroy(new Error(`Timed out after ${DOWNLOAD_TIMEOUT_MS}ms downloading ${u}`));
      });
    }
    fetch(url);
  });
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function removeIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {
    // Best-effort cleanup; the install is already failing.
  }
}

async function main() {
  const skip = process.env.ZNYX_SKIP_BINARY_DOWNLOAD;
  if (skip && skip !== '0' && skip.toLowerCase() !== 'false') {
    console.log(
      `[znyx] ZNYX_SKIP_BINARY_DOWNLOAD is set; skipping binary download.\n` +
      `       The znyx CLI will not work until a binary is placed at\n` +
      `       ${getBinaryPath()}\n`
    );
    process.exit(0);
  }

  const binaryName = getBinaryName();

  if (!binaryName) {
    console.log(
      `\n[znyx] Unsupported platform: ${getPlatformKey()}\n` +
      `       Binary install is not available for this platform.\n\n` +
      `       Alternative install options:\n` +
      `         pip install znyx-runtime\n` +
      `         docker run znyx/runtime\n`
    );
    process.exit(0); // non-fatal - the package still installs
  }

  const binaryUrl = `${RELEASE_BASE}/${binaryName}`;
  const checksumUrl = `${RELEASE_BASE}/${binaryName}.sha256`;
  const binaryDest = getBinaryPath();
  const checksumDest = binaryDest + '.sha256';

  console.log(`[znyx] Downloading ZNYX Runtime v${VERSION} for ${getPlatformKey()}...`);

  try {
    // Ensure the destination dir exists (it may be absent in a fresh install).
    fs.mkdirSync(path.dirname(binaryDest), { recursive: true });

    await download(binaryUrl, binaryDest);

    // Only fetch the release's .sha256 when no committed pin exists; a pinned
    // checksum must never be overridden by anything the release serves.
    if (!hasPinnedChecksum(VERSION, binaryName)) {
      await download(checksumUrl, checksumDest);
    }
    const resolved = resolveExpectedChecksum(VERSION, binaryName, checksumDest);

    verifyChecksum(binaryDest, resolved);

    fs.chmodSync(binaryDest, 0o755);
    removeIfExists(checksumDest);
    console.log(`[znyx] Binary installed and verified ✓${resolved.source === 'pinned' ? ' (pinned checksum)' : ''}`);
  } catch (err) {
    // Never leave an unverified or partial binary behind.
    removeIfExists(binaryDest);
    removeIfExists(checksumDest);

    if (err instanceof ChecksumMismatchError) {
      console.error(
        `\n[znyx] SECURITY: checksum verification failed for ${binaryName}.\n` +
        `${err.message.replace(/^/gm, '       ')}\n` +
        `       The downloaded binary was removed and will not be installed.\n` +
        `       This may indicate a corrupted or tampered download.\n` +
        `       Re-run npm install to retry.\n`
      );
      process.exit(1);
    }

    console.error(
      `\n[znyx] Failed to download the runtime binary: ${err.message}\n` +
      `       Check network access to github.com and retry, or set\n` +
      `       ZNYX_SKIP_BINARY_DOWNLOAD=1 to install without the binary\n` +
      `       (offline / air-gapped installs).\n\n` +
      `       Alternative install options:\n` +
      `         pip install znyx-runtime\n` +
      `         docker run znyx/runtime\n`
    );
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[znyx] Unexpected installer error: ${err && err.message}`);
    process.exit(1);
  });
}

module.exports = {
  KNOWN_CHECKSUMS,
  PLATFORM_MAP,
  ChecksumMismatchError,
  getPlatformKey,
  getBinaryName,
  getBinaryPath,
  hasPinnedChecksum,
  resolveExpectedChecksum,
  sha256File,
  verifyChecksum,
};
