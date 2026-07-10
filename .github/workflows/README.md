# Workflows

| Workflow | File | Triggers | Purpose |
|---|---|---|---|
| CI | `ci.yml` | push to main, PRs | Build/compile each language SDK (python, typescript, java, csharp, ruby, rust). |
| Dependency Audit | `audit.yml` | push, PRs, weekly (Mon 08:00 UTC) | `pip-audit`, `npm audit`, `cargo audit`. Java/C#/Ruby deps are covered by Dependabot alerts. |
| Security | `security.yml` | push, PRs, weekly (Mon 06:00 UTC), manual | Multi-language SAST (semgrep `p/security-audit` + `p/secrets`), secret scan (trivy fs), and CodeQL for python / javascript-typescript / ruby. |

Notes:
- CodeQL runs in `build-mode: none` for the interpreted languages (reliable, no
  build needed). Java/C#/Rust get SAST coverage via semgrep and are built in
  CI; their dependencies are audited (rust) or tracked by Dependabot.
- Ruby and Rust use the runner's preinstalled toolchains, so no third-party
  setup actions are required.
