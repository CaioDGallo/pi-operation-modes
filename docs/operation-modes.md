# Operation Modes

This package intentionally exposes only two modes.

## Agent-Mode (green)

Agent-Mode is the default. The extension does not filter active tools and does not approve, deny, or prompt for tool calls. pi should behave the same way it does without this package installed, aside from the visible mode status and the `/mode` commands.

Use Agent-Mode when you want the normal pi coding-agent experience.

## Read-Only (blue)

Read-Only is an approval gate for inspection-first work.

Automatically allowed inside the current project (`ctx.cwd`):

- built-in `read`
- built-in `find`
- built-in `ls`
- built-in `grep`
- simple bash commands whose executable is `cat`, `find`, `grep`, `ls`, `rg`, or `ripgrep`

Read-Only asks for approval before everything else, including:

- `edit`, `write`, or any custom/non-read-only tool
- any read tool path outside the current project
- bash commands that are not in the read-only command allowlist
- bash commands with shell control or redirection (`;`, `&&`, `|`, `>`, `<`, backticks, `$VAR`, `$()`)
- `find` commands using unsafe options such as `-exec`, `-execdir`, `-ok`, `-okdir`, or `-delete`

If approval UI is unavailable, Read-Only fails closed and blocks the tool call.

## Session approvals

Approval choices are memory-only and last only for the current pi process.

Session approvals use broad signatures on purpose:

| Tool call | Session signature |
| --------- | ----------------- |
| `read README.md` | `read:*` |
| `grep` outside project | `grep:*` |
| `write package.json` | `write:*` |
| `bash: rg TODO src` | `bash:rg` |
| `bash: npm install` | `bash:npm install` |

## Commands and flags

```text
/mode              Open the mode picker
/mode agent-mode   Switch to normal/default pi behavior
/mode read-only    Switch to Read-Only
/toggle-mode       Toggle between Agent-Mode and Read-Only
Shift+Tab          Toggle between Agent-Mode and Read-Only
```

```bash
pi --operation-mode agent-mode
pi --operation-mode read-only
```

Accepted aliases include `agent`, `default`, `normal`, `read`, `readonly`, and `ro`.

## Path boundary

The project boundary is the current working directory reported by pi. Existing paths are resolved with `realpath` before checking containment, so symlinks that point outside the project are treated as outside the project.
