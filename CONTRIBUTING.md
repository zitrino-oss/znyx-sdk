# Contributing to the Znyx SDK

Thanks for your interest in contributing! This is a multi-language monorepo —
each SDK lives in its own top-level directory and is built/tested with that
language's standard toolchain.

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md),
and that your contributions are licensed under the [Apache-2.0 license](LICENSE).
For security issues, do **not** open a public issue — see [SECURITY.md](SECURITY.md).

## Layout

| Language | Directory | Build |
|----------|-----------|-------|
| Python | `python/` | `pip install .` |
| TypeScript | `typescript/` | `npm ci && npm run build` |
| Java | `java/` | `mvn -B compile` |
| C# | `csharp/` | `dotnet build` |
| Ruby | `ruby/` | `gem build znyx-sdk.gemspec` |
| Rust | `rust/` | `cargo build` |

## Submitting changes

1. Fork the repo and create a topic branch (`git checkout -b fix/short-description`).
2. Keep changes focused; one logical change per pull request, scoped to a single
   language SDK where possible.
3. Make sure the relevant language build passes locally, and that CI, **Dependency
   Audit**, and **Security** workflows are green.
4. Write a clear PR description and link any related issue. Fill in the PR template.
5. Comments should describe what the code does — please avoid narrative or
   changelog-style comments in source.
6. A maintainer (`@zitrino-oss/maintainers`) will review.

Do not commit secrets or real API keys — credentials belong in environment
variables, never in the repo.

## Reporting bugs / requesting features

Use the issue templates. Include the affected language SDK, version, and steps to
reproduce.
