import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
} from "@mariozechner/pi-coding-agent";
import { matchesKey } from "@mariozechner/pi-tui";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";

type OperationMode = "read-only" | "safe-mode" | "accept-edits" | "unsafe-auto";
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
type GateDecision =
  | { action: "allow" }
  | { action: "confirm"; reason: string; signature: string }
  | { action: "block"; reason: string };

const MODE_ORDER: OperationMode[] = [
  "safe-mode",
  "read-only",
  "accept-edits",
  "unsafe-auto",
];
const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];
const READ_ONLY_TOOLS = new Set(["read", "bash", "grep", "find", "ls"]);
const EDIT_TOOLS = new Set(["read", "edit", "write"]);
const PATH_SAFE_TOOLS = new Set(["grep", "find", "ls"]);
const STATUS_KEY = "operation-mode";

const DEFAULT_OCCUPIED_KEYS = new Set([
  "up",
  "down",
  "left",
  "right",
  "ctrl+b",
  "ctrl+f",
  "alt+left",
  "ctrl+left",
  "alt+b",
  "alt+right",
  "ctrl+right",
  "alt+f",
  "home",
  "ctrl+a",
  "end",
  "ctrl+e",
  "ctrl+]",
  "ctrl+alt+]",
  "pageup",
  "pagedown",
  "backspace",
  "delete",
  "ctrl+d",
  "ctrl+w",
  "alt+backspace",
  "alt+d",
  "alt+delete",
  "ctrl+u",
  "ctrl+k",
  "shift+enter",
  "enter",
  "tab",
  "ctrl+y",
  "alt+y",
  "ctrl+-",
  "ctrl+c",
  "escape",
  "ctrl+z",
  "shift+tab",
  "ctrl+p",
  "shift+ctrl+p",
  "ctrl+l",
  "ctrl+o",
  "ctrl+t",
  "ctrl+n",
  "ctrl+g",
  "alt+enter",
  "alt+up",
  "ctrl+v",
  "shift+l",
  "shift+t",
  "ctrl+s",
  "ctrl+r",
  "ctrl+backspace",
  "ctrl+x",
]);

const THINKING_KEY_CANDIDATES = [
  "ctrl+q",
  "ctrl+shift+q",
  "ctrl+shift+r",
  "ctrl+shift+y",
  "ctrl+shift+u",
  "ctrl+shift+i",
  "ctrl+shift+e",
  "ctrl+shift+;",
];

const READ_ONLY_SAFE_PATTERNS = [
  /^\s*(cat|head|tail|less|more|grep|rg|find|fd|ls|pwd|tree|wc|sort|uniq|diff|file|stat|du|df)\b/i,
  /^\s*(which|whereis|type|env|printenv|uname|whoami|id|date|cal|uptime|ps|top|htop|free)\b/i,
  /^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get|ls-)\b/i,
  /^\s*(npm|pnpm)\s+(list|ls|view|info|search|outdated|audit)\b/i,
  /^\s*yarn\s+(list|info|why|audit)\b/i,
  /^\s*composer\s+(show|audit|validate|outdated|licenses)\b/i,
  /^\s*(node|python|python3|php)\s+--version\b/i,
  /^\s*(jq|awk)\b/i,
  /^\s*sed\s+-n\b/i,
];

const DESTRUCTIVE_PATTERNS = [
  /\b(rm|rmdir|mv|cp|mkdir|touch|chmod|chown|chgrp|ln|tee|truncate|dd|shred)\b/i,
  /(^|[^<])>(?!>)/,
  />>/,
  /\b(npm|pnpm)\s+(install|uninstall|update|ci|link|publish|add|remove)\b/i,
  /\byarn\s+(add|remove|install|publish|upgrade)\b/i,
  /\bcomposer\s+(install|update|require|remove|dump-autoload)\b/i,
  /\bpip\s+(install|uninstall)\b/i,
  /\bbrew\s+(install|uninstall|upgrade|update)\b/i,
  /\bapt(-get)?\s+(install|remove|purge|update|upgrade)\b/i,
  /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|switch|stash|cherry-pick|revert|tag|init|clone)\b/i,
  /\b(sudo|su|kill|pkill|killall|reboot|shutdown)\b/i,
  /\b(systemctl|service)\s+\S*\s*(start|stop|restart|enable|disable)\b/i,
  /\b(vim?|nano|emacs|code|subl)\b/i,
];

const ACTION_DEPTHS: Record<string, number> = {
  aws: 3,
  az: 3,
  gcloud: 3,
  git: 2,
  docker: 2,
  kubectl: 2,
  npm: 2,
  pnpm: 2,
  yarn: 2,
  composer: 2,
  php: 2,
  artisan: 2,
  make: 2,
  brew: 2,
};

const SINGLE_ACTION_COMMANDS = new Set([
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "grep",
  "rg",
  "find",
  "fd",
  "ls",
  "pwd",
  "tree",
  "wc",
  "sort",
  "uniq",
  "diff",
  "file",
  "stat",
  "du",
  "df",
  "sed",
  "awk",
  "jq",
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/\s+/g, "");
}

function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? resolve(homedir(), ".pi", "agent");
}

function readUserOccupiedKeys(): Set<string> {
  const occupied = new Set(DEFAULT_OCCUPIED_KEYS);
  const configPath = resolve(getAgentDir(), "keybindings.json");

  if (!existsSync(configPath)) return occupied;

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    for (const value of Object.values(parsed)) {
      const keys = Array.isArray(value) ? value : [value];
      for (const key of keys) {
        if (typeof key === "string") {
          occupied.add(normalizeKey(key));
        }
      }
    }
  } catch {
    return occupied;
  }

  return occupied;
}

function pickThinkingKey(): string {
  const occupied = readUserOccupiedKeys();
  for (const candidate of THINKING_KEY_CANDIDATES) {
    if (!occupied.has(normalizeKey(candidate))) {
      return candidate;
    }
  }
  return "ctrl+q";
}

function parseMode(value: string | undefined): OperationMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;

  const aliases: Record<string, OperationMode> = {
    readonly: "read-only",
    read: "read-only",
    ro: "read-only",
    "read-only": "read-only",
    safe: "safe-mode",
    "safe-mode": "safe-mode",
    accept: "accept-edits",
    "accept-edits": "accept-edits",
    edits: "accept-edits",
    auto: "unsafe-auto",
    unsafe: "unsafe-auto",
    "unsafe-auto": "unsafe-auto",
  };

  return aliases[normalized];
}

function nextMode(mode: OperationMode): OperationMode {
  const index = MODE_ORDER.indexOf(mode);
  return MODE_ORDER[(index + 1) % MODE_ORDER.length] ?? "safe-mode";
}

function modeLabel(mode: OperationMode): string {
  const labels: Record<OperationMode, string> = {
    "read-only": "Read-Only",
    "safe-mode": "Safe-Mode",
    "accept-edits": "Accept-Edits",
    "unsafe-auto": "Unsafe-Auto",
  };
  return labels[mode];
}

function modeStatus(mode: OperationMode): string {
  const label = `● ${modeLabel(mode)}`;
  const colors: Record<OperationMode, string> = {
    "read-only": `\x1b[38;2;59;130;246m${label}\x1b[39m`,
    "safe-mode": `\x1b[38;2;234;179;8m${label}\x1b[39m`,
    "accept-edits": `\x1b[38;2;34;197;94m${label}\x1b[39m`,
    "unsafe-auto": `\x1b[38;2;239;68;68m${label}\x1b[39m`,
  };
  return colors[mode];
}

function toolNames(pi: ExtensionAPI): string[] {
  return pi.getAllTools().map((tool) => tool.name);
}

function validTools(pi: ExtensionAPI, names: string[]): string[] {
  const available = new Set(toolNames(pi));
  return names.filter((name) => available.has(name));
}

function isPathInsideCwd(inputPath: string | undefined, cwd: string): boolean {
  if (!inputPath || inputPath.trim() === "" || inputPath === ".") return true;

  const absoluteCwd = resolve(cwd);
  const absolutePath = resolve(absoluteCwd, inputPath);
  const rel = relative(absoluteCwd, absolutePath);

  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function stringifyInput(input: Record<string, unknown>): string {
  try {
    const text = JSON.stringify(input, null, 2);
    return text.length > 1200 ? `${text.slice(0, 1200)}…` : text;
  } catch {
    return "(unable to render tool input)";
  }
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }

    if ((char === "'" || char === '"') && quote === undefined) {
      quote = char;
      continue;
    }

    if (char === quote) {
      quote = undefined;
      continue;
    }

    if (/\s/.test(char) && quote === undefined) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) tokens.push(current);
  return tokens;
}

function isLikelyValueToken(token: string): boolean {
  return (
    token.startsWith("/") ||
    token.startsWith("./") ||
    token.startsWith("../") ||
    token.startsWith("~") ||
    token.includes("=") ||
    token.includes("://") ||
    token.length > 32
  );
}

function commandSignature(command: string): string {
  const firstCommand =
    command.split(/&&|\|\||;|\n/)[0]?.trim() ?? command.trim();
  const tokens = tokenizeCommand(firstCommand);
  if (tokens.length === 0) return "bash:(empty)";

  const executable = tokens[0] ?? "";
  const base = executable.split("/").pop() ?? executable;
  const normalizedBase = base.toLowerCase();

  if (SINGLE_ACTION_COMMANDS.has(normalizedBase)) return normalizedBase;

  const depth = ACTION_DEPTHS[normalizedBase];
  if (depth !== undefined) {
    const signatureTokens = tokens.slice(0, Math.min(depth, tokens.length));
    let index = depth;
    while (index < tokens.length && tokens[index]?.startsWith("-")) {
      const option = tokens[index];
      if (option !== undefined) signatureTokens.push(option);
      index++;
    }
    return signatureTokens.join(" ");
  }

  const signatureTokens = [tokens[0]];
  for (
    let index = 1;
    index < tokens.length && signatureTokens.length < 3;
    index++
  ) {
    const token = tokens[index];
    if (
      token === undefined ||
      token.startsWith("-") ||
      isLikelyValueToken(token)
    )
      break;
    signatureTokens.push(token);
  }

  return signatureTokens.join(" ");
}

function isReadOnlySafeCommand(command: string): boolean {
  const destructive = DESTRUCTIVE_PATTERNS.some((pattern) =>
    pattern.test(command),
  );
  if (destructive) return false;
  return READ_ONLY_SAFE_PATTERNS.some((pattern) => pattern.test(command));
}

function pathForTool(event: ToolCallEvent): string | undefined {
  if (
    event.toolName === "grep" ||
    event.toolName === "find" ||
    event.toolName === "ls"
  ) {
    return event.input.path;
  }
  return undefined;
}

function toolSignature(event: ToolCallEvent): string {
  if (event.toolName === "bash") {
    return `bash:${commandSignature(event.input.command)}`;
  }

  return `${event.toolName}:*`;
}

function evaluateGate(
  mode: OperationMode,
  event: ToolCallEvent,
  ctx: ExtensionContext,
): GateDecision {
  if (mode === "unsafe-auto") return { action: "allow" };

  const signature = toolSignature(event);

  if (mode === "safe-mode") {
    return {
      action: "confirm",
      reason: "Safe-Mode requires approval for every tool call.",
      signature,
    };
  }

  if (mode === "read-only") {
    if (!READ_ONLY_TOOLS.has(event.toolName)) {
      return {
        action: "block",
        reason: `Read-Only blocks ${event.toolName}; only read/search tools and bash are available.`,
      };
    }

    if (event.toolName === "bash") {
      if (isReadOnlySafeCommand(event.input.command))
        return { action: "allow" };
      return {
        action: "confirm",
        reason:
          "Read-Only requires approval for non-whitelisted bash commands.",
        signature,
      };
    }

    if (PATH_SAFE_TOOLS.has(event.toolName)) {
      const inside = isPathInsideCwd(pathForTool(event), ctx.cwd);
      if (inside) return { action: "allow" };
      return {
        action: "confirm",
        reason: `${event.toolName} targets a path outside the current directory.`,
        signature,
      };
    }

    return { action: "allow" };
  }

  if (EDIT_TOOLS.has(event.toolName)) return { action: "allow" };

  if (PATH_SAFE_TOOLS.has(event.toolName)) {
    const inside = isPathInsideCwd(pathForTool(event), ctx.cwd);
    if (inside) return { action: "allow" };
    return {
      action: "confirm",
      reason: `${event.toolName} targets a path outside the current directory.`,
      signature,
    };
  }

  if (event.toolName === "bash" && isReadOnlySafeCommand(event.input.command))
    return { action: "allow" };

  return {
    action: "confirm",
    reason:
      "Accept-Edits requires approval for terminal or unknown tool calls.",
    signature,
  };
}

async function confirmToolCall(
  ctx: ExtensionContext,
  mode: OperationMode,
  event: ToolCallEvent,
  reason: string,
  signature: string,
): Promise<"allow-once" | "allow-session" | "deny"> {
  if (!ctx.hasUI) return "deny";

  const title = [
    `${modeLabel(mode)} approval required`,
    `Tool: ${event.toolName}`,
    `Reason: ${reason}`,
    `Session approval: ${signature}`,
    "",
    stringifyInput(event.input),
  ].join("\n");

  const choice = await ctx.ui.select(title, [
    "Allow once",
    `Allow for session (${signature})`,
    "Deny",
  ]);
  if (choice === "Allow once") return "allow-once";
  if (choice?.startsWith("Allow for session")) return "allow-session";
  return "deny";
}

function cycleThinking(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const current = pi.getThinkingLevel() as ThinkingLevel;
  const currentIndex = THINKING_LEVELS.indexOf(current);
  const next =
    THINKING_LEVELS[(currentIndex + 1) % THINKING_LEVELS.length] ?? "off";
  pi.setThinkingLevel(next);
  ctx.ui.notify(`Thinking level: ${pi.getThinkingLevel()}`, "info");
}

export default function operationModesExtension(pi: ExtensionAPI): void {
  let mode: OperationMode = "safe-mode";
  let unrestrictedTools: string[] = [];
  let thinkingKey = pickThinkingKey();
  let unsubscribeInput: (() => void) | undefined;
  const approvedSignatures = new Set<string>();

  pi.registerFlag("operation-mode", {
    description:
      "Start operation mode: read-only, safe-mode, accept-edits, unsafe-auto",
    type: "string",
    default: "safe-mode",
  });

  function updateStatus(ctx: ExtensionContext): void {
    ctx.ui.setStatus(STATUS_KEY, modeStatus(mode));
  }

  function setMode(
    next: OperationMode,
    ctx: ExtensionContext,
    options: { notify?: boolean } = {},
  ): void {
    if (next === "read-only" && mode !== "read-only") {
      const active = pi.getActiveTools();
      unrestrictedTools = active.length > 0 ? active : toolNames(pi);
    }

    mode = next;

    if (mode === "read-only") {
      pi.setActiveTools(validTools(pi, [...READ_ONLY_TOOLS]));
    } else {
      const restoreTools =
        unrestrictedTools.length > 0 ? unrestrictedTools : toolNames(pi);
      pi.setActiveTools(validTools(pi, restoreTools));
    }

    updateStatus(ctx);
    if (options.notify && ctx.hasUI) {
      ctx.ui.notify(`${modeLabel(mode)} active`, "info");
    }
  }

  function cycleMode(ctx: ExtensionContext): void {
    setMode(nextMode(mode), ctx, { notify: true });
  }

  pi.registerCommand("mode", {
    description:
      "Switch operation mode (read-only, safe-mode, accept-edits, unsafe-auto)",
    handler: async (args, ctx) => {
      const requested = parseMode(args);
      if (requested) {
        setMode(requested, ctx, { notify: true });
        return;
      }

      const choice = await ctx.ui.select(
        "Select operation mode",
        MODE_ORDER.map(modeLabel),
      );
      if (!choice) return;

      const selected = MODE_ORDER.find((item) => modeLabel(item) === choice);
      if (selected) setMode(selected, ctx, { notify: true });
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    unrestrictedTools = pi.getActiveTools();
    if (unrestrictedTools.length === 0) unrestrictedTools = toolNames(pi);

    thinkingKey = pickThinkingKey();
    const flagMode = parseMode(
      String(pi.getFlag("operation-mode") ?? "safe-mode"),
    );
    setMode(flagMode ?? "safe-mode", ctx);

    if (unsubscribeInput) unsubscribeInput();
    if (ctx.hasUI) {
      unsubscribeInput = ctx.ui.onTerminalInput((data) => {
        if (matchesKey(data, "shift+tab")) {
          cycleMode(ctx);
          return { consume: true };
        }

        if (matchesKey(data, thinkingKey)) {
          cycleThinking(pi, ctx);
          return { consume: true };
        }

        return undefined;
      });

      ctx.ui.notify(
        `Operation modes loaded. Shift+Tab cycles modes. ${thinkingKey} cycles thinking.`,
        "info",
      );
    }
  });

  pi.on("session_shutdown", async () => {
    if (unsubscribeInput) {
      unsubscribeInput();
      unsubscribeInput = undefined;
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    const decision = evaluateGate(mode, event, ctx);

    if (decision.action === "allow") return undefined;
    if (decision.action === "block")
      return { block: true, reason: decision.reason };

    if (approvedSignatures.has(decision.signature)) return undefined;

    const approval = await confirmToolCall(
      ctx,
      mode,
      event,
      decision.reason,
      decision.signature,
    );
    if (approval === "allow-session") {
      approvedSignatures.add(decision.signature);
      return undefined;
    }
    if (approval === "allow-once") return undefined;

    return {
      block: true,
      reason: `Blocked by ${modeLabel(mode)}: ${decision.reason}`,
    };
  });
}
