#!/usr/bin/env node
/**
 * znyx.js — CLI shim for @znyx/runtime.
 *
 * Launches the platform-matched ZNYX Runtime binary that postinstall.js
 * downloaded to ../bin/znyx-bin (znyx-bin.exe on Windows), forwarding all
 * arguments and streaming stdio. If the binary is missing (e.g. the
 * postinstall download failed or was skipped on an unsupported platform),
 * prints actionable guidance and exits non-zero.
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ext = os.platform() === 'win32' ? '.exe' : '';
const binary = path.join(__dirname, `znyx-bin${ext}`);

if (!fs.existsSync(binary)) {
  console.error(
    `\n[znyx] Runtime binary not found at ${binary}\n` +
    `       The postinstall download may have failed or been skipped.\n\n` +
    `       Try reinstalling:\n` +
    `         npm install -g @znyx/runtime\n\n` +
    `       Or use an alternative install:\n` +
    `         pip install znyx-runtime\n` +
    `         docker run -p 8080:8080 znyx/runtime\n`
  );
  process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), { stdio: 'inherit' });

if (result.error) {
  console.error(`[znyx] Failed to launch runtime: ${result.error.message}`);
  process.exit(1);
}

// Propagate the child's exit code (or signal-terminated -> non-zero).
process.exit(result.status === null ? 1 : result.status);
