#!/usr/bin/env node
/**
 * postinstall.js — downloads the platform-matched ZNYX Runtime binary from
 * GitHub Releases, verifies its SHA256 checksum, and marks it executable.
 *
 * Supported platforms:
 *   macOS Apple Silicon  → znyx-runtime-darwin-arm64
 *   macOS Intel          → znyx-runtime-darwin-x64
 *   Linux x64            → znyx-runtime-linux-x64
 *   Linux ARM64          → znyx-runtime-linux-arm64
 *   Windows x64          → znyx-runtime-windows-x64.exe
 *
 * On unsupported platforms a clear message is printed directing the user to
 * `pip install znyx-runtime` or Docker. pip is never invoked automatically.
 */
'use strict';

const { execFileSync } = require('child_process');
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

// Pinned, committed SHA256 checksums — the source of truth for binary
// authenticity. When an entry exists for the current version + binary we verify
// against it and FAIL CLOSED on any mismatch, without trusting the remote
// .sha256 (which lives in the same release and so cannot attest to it).
//
// Populate at release time, e.g.:
//   KNOWN_CHECKSUMS['1.0.1'] = {
//     'znyx-runtime-darwin-arm64': '<sha256>',
//     ...
//   };
// Until an entry is present we fall back to the remote .sha256 (transport-
// integrity only) and print a warning so the gap is visible.
const KNOWN_CHECKSUMS = {};

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

async function main() {
  const binaryName = getBinaryName();

  if (!binaryName) {
    console.log(
      `\n[znyx] Unsupported platform: ${getPlatformKey()}\n` +
      `       Binary install is not available for this platform.\n\n` +
      `       Alternative install options:\n` +
      `         pip install znyx-runtime\n` +
      `         docker run znyx/runtime\n`
    );
    process.exit(0); // non-fatal — the package still installs
  }

  const binaryUrl = `${RELEASE_BASE}/${binaryName}`;
  const checksumUrl = `${RELEASE_BASE}/${binaryName}.sha256`;
  const binaryDest = getBinaryPath();
  const checksumDest = binaryDest + '.sha256';
  const pinned = (KNOWN_CHECKSUMS[VERSION] || {})[binaryName];

  console.log(`[znyx] Downloading ZNYX Runtime v${VERSION} for ${getPlatformKey()}...`);

  try {
    // Ensure the destination dir exists (it may be absent in a fresh install).
    fs.mkdirSync(path.dirname(binaryDest), { recursive: true });

    await download(binaryUrl, binaryDest);

    let expected;
    if (pinned) {
      // Authenticity: verify against the committed hash, ignore the remote one.
      expected = pinned;
    } else {
      // No pinned hash yet — fall back to the release's own .sha256, which only
      // attests to transport integrity, not authenticity.
      await download(checksumUrl, checksumDest);
      expected = fs.readFileSync(checksumDest, 'utf8').trim().split(/\s+/)[0];
      console.warn(
        `[znyx] Warning: no pinned checksum for v${VERSION}/${binaryName}; ` +
        `verifying transport integrity only.`
      );
    }

    const actual = sha256File(binaryDest);

    if (actual !== expected) {
      fs.unlinkSync(binaryDest);
      if (fs.existsSync(checksumDest)) fs.unlinkSync(checksumDest);
      throw new Error(
        `SHA256 mismatch!\n  expected: ${expected}\n  actual:   ${actual}\n` +
        `Binary removed. Re-run npm install to retry.`
      );
    }

    fs.chmodSync(binaryDest, 0o755);
    if (fs.existsSync(checksumDest)) fs.unlinkSync(checksumDest);
    console.log(`[znyx] Binary installed and verified ✓${pinned ? ' (pinned checksum)' : ''}`);
  } catch (err) {
    console.error(`\n[znyx] Could not download binary: ${err.message}`);
    console.error(
      `       Fallback: pip install znyx-runtime\n` +
      `                 docker run znyx/runtime\n`
    );
    // Exit 0 so npm install succeeds; the shim will print guidance at runtime.
    process.exit(0);
  }
}

main();
