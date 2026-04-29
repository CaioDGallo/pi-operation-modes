# Pi Operation Modes

A [pi](https://pi.dev/) package that adds Claude Code-style operation modes to the pi coding agent.

## Modes

| Mode             | Color  | Behavior                                                                                                                                                               |
| ---------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Safe-Mode**    | Yellow | Default. Every tool call requires approval unless session-approved.                                                                                                    |
| **Read-Only**    | Blue   | Read/search tools and safe read-only bash run automatically. File edits/writes are blocked. Non-whitelisted bash and outside-cwd search/list actions require approval. |
| **Accept-Edits** | Green  | `read`, `edit`, and `write` run automatically. Search/list inside cwd runs automatically. Bash or outside-cwd actions require approval unless safe/approved.           |
| **Unsafe-Auto**  | Red    | Everything runs without approval.                                                                                                                                      |

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

Start normally. The default mode is **Safe-Mode**:

```bash
pi
```

Start in a specific mode:

```bash
pi --operation-mode read-only
pi --operation-mode safe-mode
pi --operation-mode accept-edits
pi --operation-mode unsafe-auto
```

Switch modes while pi is running:

```text
/mode
/mode read-only
/mode safe-mode
/mode accept-edits
/mode unsafe-auto
```

Keyboard:

- `Shift+Tab` cycles operation modes.
- The extension picks the first free `Ctrl+<key>` candidate for thinking-level cycling and shows it in a startup notification.

## Approval behavior

When approval is required, choose:

- **Allow once**
- **Allow for session** based on a normalized signature
- **Deny**

Examples of bash session signatures:

```text
aws s3 ls my-bucket     -> bash:aws s3 ls
git diff --name-only    -> bash:git diff --name-only
rg "foo" resources/js   -> bash:rg
```

## Notes

- `grep`, `find`, and `ls` are considered safe inside the current working directory.
- Access outside the current working directory requires approval in guarded modes.
- In **Read-Only**, `edit` and `write` are removed from active tools and blocked if called.
- In **Unsafe-Auto**, no confirmation is requested.

## Security

Pi packages run with your full system permissions. Review extension source code before installing or sharing.

## License

MIT
