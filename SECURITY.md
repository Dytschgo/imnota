# Security policy

## Supported versions

The latest `main` branch and the latest published release receive security fixes.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability. Use GitHub private vulnerability reporting for the `Dytschgo/imnota` repository when available. If it is unavailable, contact the repository owner through GitHub and include a concise description, affected version, reproduction steps and impact.

Do not include secrets or personal screenshots in a report. We will acknowledge reports as soon as practical and coordinate a fix and disclosure timeline with the reporter.

## Security model

Imnota uses Electron context isolation, disabled renderer Node.js integration, a preload bridge, a strict content security policy and workspace-constrained filesystem operations. Project JSON and Markdown are untrusted input and are never executed.
