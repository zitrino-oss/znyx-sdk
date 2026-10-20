# @znyx/runtime

The `znyx` command for npm. Installs the `znyx` CLI binary on macOS, Linux, and Windows, the same command that `pip install znyx` provides.

## Install

```bash
npm install -g @znyx/runtime
```

On install, a platform-matched binary is downloaded from GitHub Releases and its
SHA256 checksum is verified before being marked executable. If the download or
the checksum verification fails, the install fails rather than leaving a broken
`znyx` command behind.

For offline or air-gapped installs, set `ZNYX_SKIP_BINARY_DOWNLOAD=1` to skip
the download; place a binary at `bin/znyx-bin` (`bin/znyx-bin.exe` on Windows)
inside the installed package to use the CLI.

## Usage

```bash
znyx serve                          # run ZNYX on http://127.0.0.1:8080 (znyx start is the same)
znyx serve --port 9090              # another port
znyx serve --policy ./policies.yaml # your own policy file
znyx serve --workers auto           # one worker process per CPU, up to 4, all on the one port
znyx serve --ml                     # also start the ML model server (loopback only)
znyx serve --airgapped              # no outbound calls at all
znyx init                           # write znyx.yaml and policies.yaml to edit (-o DIR, --force)
znyx config                         # the effective settings and where each came from (--json)
znyx status                         # the running workers
znyx key                            # this install's API key (--rotate for a new one)
znyx version                        # one platform version and its components (--json)
znyx models list                    # vetted model weights (znyx models fetch to download one)
znyx benchmark ...                  # certify a model-backed detector (znyx benchmark -h)
```

`znyx serve` works from an empty folder: it uses a built-in starter policy,
creates an API key on first run in `~/.znyx/api-key` (show it with `znyx key`),
and prints a dashboard URL and a curl example. Every API, including the local
dashboard at `/dashboard`, is on one port.

Settings come from flags, then environment variables, then `znyx.yaml`, then
defaults. Run `znyx config` to see where each value came from.

## Supported platforms

| Platform | Release asset |
|---|---|
| macOS Apple Silicon | `znyx-darwin-arm64` |
| macOS Intel | `znyx-darwin-x64` |
| Linux x64 | `znyx-linux-x64` |
| Linux ARM64 | `znyx-linux-arm64` |
| Windows x64 | `znyx-windows-x64.exe` |

Older releases published these binaries as `znyx-runtime-<target>`. If a release has no
`znyx-<target>` asset, the installer falls back to the `znyx-runtime-<target>` name.

On unsupported platforms, install via `pip install znyx` or Docker instead.

## Alternative installs

```bash
# Python
pip install znyx

# Docker
docker run -p 8080:8080 znyx/znyx
```

## License

Apache-2.0
