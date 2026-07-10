# Security Policy

## Reporting a Vulnerability

We take the security of the Znyx SDK seriously. If you believe you have found a
security vulnerability, please report it to us privately.

**Please do not report security vulnerabilities through public GitHub issues.**

Use GitHub's **[Security → Report a vulnerability](https://github.com/zitrino-oss/znyx-sdk/security/advisories/new)**
to open a private security advisory for this repository. Please include:

- a description of the vulnerability and its impact,
- the affected language SDK(s) and version,
- steps to reproduce (proof-of-concept), and
- a suggested fix, if you have one.

You can expect an acknowledgement promptly, and we will coordinate a fix and a
disclosure timeline with you.

## Supported Versions

Security fixes are applied to the latest released version of each language SDK
on the `main` branch.

## Scope and Operational Notes

- **These are client SDKs.** They send requests to a ZNYX Runtime endpoint you
  configure; they do not store credentials. Pass API keys via environment
  variables or your secret manager — never hard-code them.
- **Transport.** Always point SDKs at an HTTPS Runtime endpoint in production.
- **Telemetry.** Off by default — the SDKs never phone home unless you set
  `ZNYX_TELEMETRY_URL` to a receiver you operate. When configured, they send a
  single anonymous install ping (no PII, no request content), which you can
  disable with `ZNYX_TELEMETRY=false`.
