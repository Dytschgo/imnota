# Contributing to Imnota

Thanks for helping make screenshot context clearer.

## Before you start

Please search existing issues before opening a new one. For security concerns, use the private process in [SECURITY.md](SECURITY.md).

## Local setup

```bash
corepack enable
corepack pnpm install
corepack pnpm dev
```

Before submitting a pull request, run:

```bash
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Do not commit local workspaces, screenshots, exports, recovery files, credentials or signing material. The repository `.gitignore` is deliberately strict, but review staged files before pushing.

## Pull requests

Keep pull requests focused. Explain the user problem, the approach, how it was tested and any platform-specific behaviour. Include screenshots or a short recording for meaningful UI changes when possible.

## Design and product boundaries

Imnota is local-first and focused. Avoid adding accounts, cloud sync, hosted AI calls, telemetry, or complex image-editor features without a documented product decision.
