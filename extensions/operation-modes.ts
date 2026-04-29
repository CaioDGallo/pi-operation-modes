import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
} from "@mariozechner/pi-coding-agent";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, relative, resolve } from "node:path";

type OperationMode = "read-only" | "agent-mode";
type GateDecision =
  | { action: "allow" }
  | { action: "confirm"; reason: string; signature: string };

const MODE_ORDER: OperationMode[] = ["read-only", "agent-mode"];
const STATUS_KEY = "operation-mode";
const READ_ONLY_TOOL_NAMES = new Set(["read", "find", "ls", "grep"]);
const READ_ONLY_ACTIVE_TOOLS = ["read", "bash", "find", "ls", "grep"];
const READ_ONLY_BASH_COMMANDS = new Set([
  "cat",
  "find",
  "grep",
  "ls",
  "rg",
  "ripgrep",
]);
const UNSAFE_FIND_OPTIONS = new Set([
  "-delete",
  "-exec",
  "-execdir",
  "-ok",
  "-okdir",
]);
const SHELL_CONTROL_PATTERN = /[;&|<>`]|\$\(|\$\{|\$[A-Za-z_][A-Za-z0-9_]*/;

function parseMode(value: string | undefined): OperationMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;

  const aliases: Record<string, OperationMode> = {
    agent: "agent-mode",
    "agent-mode": "agent-mode",
    default: "agent-mode",
    normal: "agent-mode",
    green: "agent-mode",
    read: "read-only",
    readonly: "read-only",
    "read-only": "read-only",
    ro: "read-only",
    blue: "read-only",
  };

  return aliases[normalized];
}

function nextMode(mode: OperationMode): OperationMode {
  const index = MODE_ORDER.indexOf(mode);
  return MODE_ORDER[(index + 1) % MODE_ORDER.length] ?? "agent-mode";
}

function modeLabel(mode: OperationMode): string {
  const labels: Record<OperationMode, string> = {
    "read-only": "Read-Only",
    "agent-mode": "Agent-Mode",
  };
  return labels[mode];
}

function modeStatus(mode: OperationMode): string {
  const label = `● ${modeLabel(mode)}`;
  const colors: Record<OperationMode, string> = {
    "read-only": `\x1b[38;2;59;130;246m${label}\x1b[39m`,
    "agent-mode": `\x1b[38;2;34;197;94m${label}\x1b[39m`,
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

function stringifyInput(input: Record<string, unknown>): string {
  try {
    const text = JSON.stringify(input, null, 2);
    return text.length > 1200 ? `${text.slice(0, 1200)}…` : text;
  } catch {
    return "(unable to render tool input)";
  }
}

function stripQuotedText(command: string): string {
  let output = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      output += quote ? " " : char;
      escaped = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaped = true;
      output += quote ? " " : char;
      continue;
    }

    if ((char === "'" || char === '"') && quote === undefined) {
      quote = char;
      output += " ";
      continue;
    }

    if (char === quote) {
      quote = undefined;
      output += " ";
      continue;
    }

    output += quote ? " " : char;
  }

  return output;
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

function realpathIfExists(path: string): string {
  try {
    return existsSync(path) ? realpathSync.native(path) : path;
  } catch {
    return path;
  }
}

function normalizeInputPath(inputPath: string, cwd: string): string {
  const trimmed = inputPath.trim().replace(/^@/, "");
  if (trimmed === "" || trimmed === ".") return resolve(cwd);

  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return resolve(homedir(), trimmed.slice(2));

  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(cwd, trimmed);
}

function isPathInsideCwd(inputPath: string | undefined, cwd: string): boolean {
  if (!inputPath || inputPath.trim() === "" || inputPath.trim() === ".") {
    return true;
  }

  const absoluteCwd = realpathIfExists(resolve(cwd));
  const absolutePath = realpathIfExists(normalizeInputPath(inputPath, cwd));
  const rel = relative(absoluteCwd, absolutePath);

  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function pathForTool(event: ToolCallEvent): string | undefined {
  const input = event.input as Record<string, unknown>;
  const path = input.path;
  return typeof path === "string" ? path : undefined;
}

function commandBase(token: string): string {
  return basename(token).toLowerCase();
}

function commandSignature(command: string): string {
  const tokens = tokenizeCommand(command.trim());
  if (tokens.length === 0) return "bash:(empty)";

  const base = commandBase(tokens[0] ?? "");
  if (READ_ONLY_BASH_COMMANDS.has(base)) return base;

  const signatureTokens = [tokens[0]];
  for (
    let index = 1;
    index < tokens.length && signatureTokens.length < 3;
    index++
  ) {
    const token = tokens[index];
    if (
      !token ||
      token.startsWith("-") ||
      token.startsWith("/") ||
      token.startsWith(".")
    ) {
      break;
    }
    signatureTokens.push(token);
  }

  return signatureTokens.join(" ");
}

function isClearlyOutsidePathToken(token: string): boolean {
  if (token === ".." || token.startsWith("../")) return true;
  if (token.startsWith("/")) return true;
  if (token === "~" || token.startsWith("~/")) return true;
  return false;
}

function tokenPathFragments(token: string): string[] {
  if (token.startsWith("--") && token.includes("=")) {
    const value = token.slice(token.indexOf("=") + 1);
    return value ? [value] : [];
  }

  return [token];
}

function commandUsesOnlyProjectPaths(tokens: string[], cwd: string): boolean {
  for (const token of tokens.slice(1)) {
    if (token === "-" || token.startsWith("-") && !token.includes("=")) {
      continue;
    }

    for (const fragment of tokenPathFragments(token)) {
      if (!isClearlyOutsidePathToken(fragment)) continue;
      if (!isPathInsideCwd(fragment, cwd)) return false;
    }
  }

  return true;
}

function evaluateReadOnlyBash(
  command: string,
  cwd: string,
): { allow: true } | { allow: false; reason: string } {
  const trimmed = command.trim();
  if (!trimmed) {
    return { allow: false, reason: "empty bash command" };
  }

  if (SHELL_CONTROL_PATTERN.test(stripQuotedText(trimmed))) {
    return {
      allow: false,
      reason: "bash command uses shell control, redirection, or expansion",
    };
  }

  const tokens = tokenizeCommand(trimmed);
  const base = commandBase(tokens[0] ?? "");
  if (!READ_ONLY_BASH_COMMANDS.has(base)) {
    return {
      allow: false,
      reason: `${base || "bash"} is not a read-only command`,
    };
  }

  if (base === "find") {
    for (const token of tokens) {
      if (UNSAFE_FIND_OPTIONS.has(token)) {
        return { allow: false, reason: `find ${token} is not read-only safe` };
      }
    }
  }

  if (!commandUsesOnlyProjectPaths(tokens, cwd)) {
    return {
      allow: false,
      reason: "bash read command references a path outside the current project",
    };
  }

  return { allow: true };
}

function toolSignature(event: ToolCallEvent): string {
  if (event.toolName === "bash") {
    const input = event.input as Record<string, unknown>;
    const command = typeof input.command === "string" ? input.command : "";
    return `bash:${commandSignature(command)}`;
  }

  return `${event.toolName}:*`;
}

function evaluateGate(event: ToolCallEvent, ctx: ExtensionContext): GateDecision {
  const signature = toolSignature(event);

  if (READ_ONLY_TOOL_NAMES.has(event.toolName)) {
    const path = pathForTool(event);
    if (isPathInsideCwd(path, ctx.cwd)) return { action: "allow" };

    return {
      action: "confirm",
      reason: `${event.toolName} targets a path outside the current project.`,
      signature,
    };
  }

  if (event.toolName === "bash") {
    const input = event.input as Record<string, unknown>;
    const command = typeof input.command === "string" ? input.command : "";
    const decision = evaluateReadOnlyBash(command, ctx.cwd);
    if (decision.allow) return { action: "allow" };

    return {
      action: "confirm",
      reason: `Read-Only requires approval: ${decision.reason}.`,
      signature,
    };
  }

  return {
    action: "confirm",
    reason: `${event.toolName} is not a read-only tool.`,
    signature,
  };
}

async function confirmToolCall(
  ctx: ExtensionContext,
  event: ToolCallEvent,
  reason: string,
  signature: string,
): Promise<"allow-once" | "allow-session" | "deny"> {
  if (!ctx.hasUI) return "deny";

  const title = [
    "Read-Only approval required",
    `Tool: ${event.toolName}`,
    `Reason: ${reason}`,
    `Session approval: ${signature}`,
    "",
    stringifyInput(event.input as Record<string, unknown>),
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

export default function operationModesExtension(pi: ExtensionAPI): void {
  let mode: OperationMode = "agent-mode";
  let agentModeTools: string[] | undefined;
  const approvedSignatures = new Set<string>();

  pi.registerFlag("operation-mode", {
    description: "Start operation mode: agent-mode or read-only",
    type: "string",
    default: "agent-mode",
  });

  function updateStatus(ctx: ExtensionContext): void {
    ctx.ui.setStatus(STATUS_KEY, modeStatus(mode));
  }

  function setMode(
    next: OperationMode,
    ctx: ExtensionContext,
    options: { notify?: boolean } = {},
  ): void {
    if (next === "read-only") {
      if (mode !== "read-only") {
        agentModeTools = pi.getActiveTools();
      }

      const readOnlyTools = new Set([
        ...(agentModeTools ?? pi.getActiveTools()),
        ...READ_ONLY_ACTIVE_TOOLS,
      ]);
      pi.setActiveTools(validTools(pi, [...readOnlyTools]));
    } else if (agentModeTools !== undefined) {
      pi.setActiveTools(validTools(pi, agentModeTools));
      agentModeTools = undefined;
    }

    mode = next;
    updateStatus(ctx);

    if (options.notify && ctx.hasUI) {
      ctx.ui.notify(`${modeLabel(mode)} active`, "info");
    }
  }

  pi.registerCommand("mode", {
    description: "Switch operation mode (agent-mode or read-only)",
    handler: async (args, ctx) => {
      const requested = parseMode(args);
      if (requested) {
        setMode(requested, ctx, { notify: true });
        return;
      }

      if (args.trim().length > 0) {
        ctx.ui.notify(
          `Unknown mode "${args.trim()}". Use agent-mode or read-only.`,
          "warning",
        );
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

  pi.registerCommand("toggle-mode", {
    description: "Toggle between Read-Only and Agent-Mode",
    handler: async (_args, ctx) => {
      setMode(nextMode(mode), ctx, { notify: true });
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const rawFlag = String(pi.getFlag("operation-mode") ?? "agent-mode");
    const flagMode = parseMode(rawFlag);

    if (!flagMode && rawFlag.trim().length > 0) {
      setMode("read-only", ctx);
      if (ctx.hasUI) {
        ctx.ui.notify(
          `Unknown operation mode "${rawFlag}". Falling back to Read-Only.`,
          "warning",
        );
      }
      return;
    }

    setMode(flagMode ?? "agent-mode", ctx);
  });

  pi.on("before_agent_start", async (event) => {
    if (mode !== "read-only") return undefined;

    return {
      systemPrompt:
        event.systemPrompt +
        "\n\nOperation mode: Read-Only. Prefer read-only inspection only. Read tools and simple cat/find/grep/rg/ls commands inside the current project may run automatically. Any mutation, non-read-only tool, shell expansion/control, or access outside the current project requires explicit user approval before execution.",
    };
  });

  pi.on("tool_call", async (event, ctx) => {
    if (mode === "agent-mode") return undefined;

    const decision = evaluateGate(event, ctx);
    if (decision.action === "allow") return undefined;

    if (approvedSignatures.has(decision.signature)) return undefined;

    const approval = await confirmToolCall(
      ctx,
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
      reason: `Blocked by Read-Only: ${decision.reason}`,
    };
  });
}
