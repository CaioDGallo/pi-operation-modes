# Agent Guidelines

## Project Overview

- **Name:** pi-operation-modes
- **Purpose:** Pi package that adds operation modes and approval gates to the pi coding agent.
- **Primary entrypoint:** `extensions/operation-modes.ts`

## Development Guidelines

- Keep the extension dependency-light; prefer pi's built-in extension APIs and Node.js standard library.
- Treat permission-gating logic as security-sensitive. Prefer fail-closed behavior when UI is unavailable or when parsing fails.
- Keep session approvals in memory only unless a future requirement explicitly asks for persistence.
- Use broad session approval signatures intentionally:
  - bash approvals should represent command families/actions, e.g. `bash:aws s3 ls`.
  - non-bash tool approvals should represent tool families, e.g. `read:*`.
- Avoid mutating user keybinding files. Runtime key interception should be reversible by disabling/removing the extension.
- Update `README.md` when changing user-facing behavior or commands.
- Run a local package load check before release:

  ```bash
  pi --no-extensions -e . --help
  ```

## Git / Release Guidelines

- Use Conventional Commits for commit messages, e.g. `feat: add mode selector`, `fix: widen session approvals`.
- Keep commits focused and easy to review.
- Publish the git package by pushing `main` to GitHub.
