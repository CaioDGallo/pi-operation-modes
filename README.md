# Pi Operation Modes

A [pi](https://pi.dev/) package that adds a simple two-mode guardrail to the pi coding agent.

## Modes

| Mode           | Color | Behavior |
| -------------- | ----- | -------- |
| **Agent-Mode** | Green | Default. pi behaves like regular/default pi: no extra approvals, no tool filtering, and no permission gates from this extension. |
| **Read-Only**  | Blue  | Read-only inspection inside the current project runs automatically. Anything outside the project or not read-only asks for approval. |

Read-Only auto-allows these read actions when they stay inside the current working directory/project:

- built-in `read`, `find`, `ls`, and `grep`
- simple `bash` commands using `cat`, `find`, `grep`, `ls`, `rg`, or `ripgrep`

Approvals are in-memory only and reset when pi exits.

## Install

```bash
pi install git:github.com/CaioDGallo/pi-operation-modes
```

Or try it without installing:

```bash
pi -e git:github.com/CaioDGallo/pi-operation-modes
```

## Usage

Start normally in **Agent-Mode**:

```bash
pi
```

Start in Read-Only:

```bash
pi --operation-mode read-only
```

Switch modes while pi is running:

```text
/mode
/mode agent-mode
/mode read-only
/toggle-mode
```

Keyboard:

- `Shift+Tab` toggles between Read-Only and Agent-Mode.

Aliases accepted by `/mode` and `--operation-mode` include `agent`, `default`, `normal`, `read`, `readonly`, and `ro`.

## Approval behavior in Read-Only

When approval is required, choose:

- **Allow once**
- **Allow for session** based on a broad tool/action signature
- **Deny**

Read-Only asks before:

- any tool that is not read-only, such as `edit`, `write`, or custom mutating tools
- any read tool targeting a path outside the current project
- bash commands outside the read-only allowlist
- bash commands using shell control, redirection, expansion, or unsafe `find` options such as `-exec` or `-delete`

If pi is running without an interactive UI and approval would be required, the extension blocks the tool call.

## More detail

See [docs/operation-modes.md](docs/operation-modes.md) for implementation notes and examples.

## Security

Pi packages run with your full system permissions. Review extension source code before installing or sharing.

## License

MIT
