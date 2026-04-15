/**
 * skill-commands.frankclaw.ts
 *
 * Parses skills/commands/SKILL.md for `### /command_name` headings and produces
 * NativeCommandSpec[] entries that get registered as Discord slash commands.
 *
 * frankclaw addition: auto-register skill commands as Discord slash commands.
 */
import fs from "node:fs";
import path from "node:path";
import type { NativeCommandSpec } from "openclaw/plugin-sdk/native-command-registry";
import { createSubsystemLogger } from "openclaw/plugin-sdk/runtime-env";

const log = createSubsystemLogger("discord/skill-commands-frankclaw");

// Discord slash command name constraints:
// - 1-32 chars, lowercase, alphanumeric, hyphens, underscores only.
// - Must match /^[-_a-z0-9]{1,32}$/
const DISCORD_COMMAND_NAME_RE = /^[-_a-z0-9]{1,32}$/;
const DISCORD_COMMAND_NAME_MAX = 32;

/**
 * Normalize a command name (from SKILL.md heading like `/iterate_continuously`)
 * to a valid Discord slash command name.
 *
 * Rules:
 * - Strip leading `/`
 * - Lowercase
 * - Replace disallowed characters with hyphens
 * - Collapse consecutive hyphens
 * - Trim leading/trailing hyphens
 * - Truncate to 32 chars
 */
export function normalizeDiscordCommandName(raw: string): string | null {
  let name = raw.trim();
  // Strip leading slash(es)
  while (name.startsWith("/")) {
    name = name.slice(1);
  }
  name = name.toLowerCase();
  // Replace disallowed chars with hyphens
  name = name.replace(/[^a-z0-9_-]/g, "-");
  // Collapse consecutive hyphens
  name = name.replace(/-{2,}/g, "-");
  // Trim leading/trailing hyphens
  name = name.replace(/^-+|-+$/g, "");
  // Truncate
  if (name.length > DISCORD_COMMAND_NAME_MAX) {
    name = name.slice(0, DISCORD_COMMAND_NAME_MAX).replace(/-+$/, "");
  }
  if (!name || !DISCORD_COMMAND_NAME_RE.test(name)) {
    return null;
  }
  return name;
}

export interface ParsedSkillCommand {
  /** Raw name from SKILL.md heading (e.g. "/iterate_continuously") */
  rawName: string;
  /** First meaningful line of the body, used as description */
  description: string;
  /** Whether this is an alias for another command */
  isAlias: boolean;
}

/**
 * Parse the commands SKILL.md content and extract command definitions.
 *
 * Looks for headings matching `### /command_name` under a `## Registered Commands` section.
 * Extracts a short description from the first non-empty body line.
 * Detects alias sections (body starts with "Alias for").
 */
export function parseSkillCommandsMd(content: string): ParsedSkillCommand[] {
  const lines = content.split("\n");
  const commands: ParsedSkillCommand[] = [];
  let inRegisteredSection = false;
  let currentCommand: { rawName: string; bodyLines: string[] } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect the "## Registered Commands" section
    if (/^##\s+Registered Commands/i.test(trimmed)) {
      inRegisteredSection = true;
      continue;
    }

    // A new H2 exits the registered commands section
    if (inRegisteredSection && /^##\s+/.test(trimmed) && !trimmed.startsWith("###")) {
      // Flush last command
      if (currentCommand) {
        commands.push(finalizeCommand(currentCommand));
        currentCommand = null;
      }
      inRegisteredSection = false;
      continue;
    }

    if (!inRegisteredSection) {
      continue;
    }

    // Detect ### /command_name headings
    const commandMatch = trimmed.match(/^###\s+\/(\S+)/);
    if (commandMatch) {
      // Flush previous command
      if (currentCommand) {
        commands.push(finalizeCommand(currentCommand));
      }
      currentCommand = {
        rawName: `/${commandMatch[1]}`,
        bodyLines: [],
      };
      continue;
    }

    // Collect body lines for the current command
    if (currentCommand) {
      currentCommand.bodyLines.push(trimmed);
    }
  }

  // Flush last command
  if (currentCommand) {
    commands.push(finalizeCommand(currentCommand));
  }

  return commands;
}

function finalizeCommand(cmd: { rawName: string; bodyLines: string[] }): ParsedSkillCommand {
  const firstLine = cmd.bodyLines.find((l) => l.length > 0 && l !== "---") ?? "";
  const isAlias = /^Alias for\b/i.test(firstLine);

  // Build description: first meaningful line, stripped of markdown bold/links
  let description = firstLine
    .replace(/\*\*([^*]+)\*\*/g, "$1") // strip bold
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // strip links
    .trim();

  // Truncate to 100 chars (Discord limit)
  if (description.length > 100) {
    description = description.slice(0, 97) + "...";
  }

  if (!description) {
    const nameClean = cmd.rawName.replace(/^\//, "");
    description = `Run the ${nameClean} command`;
  }

  return {
    rawName: cmd.rawName,
    description,
    isAlias,
  };
}

/**
 * Read and parse skills/commands/SKILL.md from a workspace directory.
 * Returns NativeCommandSpec[] for non-alias commands, with deterministic
 * collision handling (first wins).
 */
export function loadSkillCommandSpecs(params: {
  workspaceDirs: string[];
  skipAliases?: boolean;
}): NativeCommandSpec[] {
  const { skipAliases = true } = params;
  const allParsed: ParsedSkillCommand[] = [];

  for (const workspaceDir of params.workspaceDirs) {
    const skillMdPath = path.join(workspaceDir, "skills", "commands", "SKILL.md");
    let content: string;
    try {
      content = fs.readFileSync(skillMdPath, "utf-8");
    } catch {
      // File doesn't exist or isn't readable - skip silently
      continue;
    }
    allParsed.push(...parseSkillCommandsMd(content));
  }

  const specs: NativeCommandSpec[] = [];
  const usedNames = new Set<string>();

  for (const cmd of allParsed) {
    if (skipAliases && cmd.isAlias) {
      continue;
    }
    const name = normalizeDiscordCommandName(cmd.rawName);
    if (!name) {
      log.warn(
        `discord: skill command "${cmd.rawName}" cannot be normalized to a valid Discord command name. Skipping.`,
      );
      continue;
    }
    if (usedNames.has(name)) {
      log.warn(
        `discord: skill command "${cmd.rawName}" (normalized: "${name}") collides with an already registered command. Skipping.`,
      );
      continue;
    }
    usedNames.add(name);
    specs.push({
      name,
      description: cmd.description,
      acceptsArgs: true,
      args: [
        {
          name: "args",
          description: "Optional arguments for the command",
          type: "string",
          required: false,
        },
      ],
    });
  }

  return specs;
}

/**
 * Resolve unique workspace directories from OpenClaw config.
 * Lightweight alternative to the full agent-scope resolution that doesn't
 * require importing from the main source tree.
 */
export function resolveWorkspaceDirsFromConfig(cfg: {
  agents?: {
    defaults?: { workspace?: string };
    list?: Array<{ workspace?: string }>;
  };
}): string[] {
  const dirs = new Set<string>();

  // Collect workspace dirs from agent list
  const agentList = cfg.agents?.list;
  if (Array.isArray(agentList)) {
    for (const agent of agentList) {
      const ws = agent.workspace?.trim();
      if (ws) {
        try {
          const resolved = fs.realpathSync(
            ws.startsWith("~") ? path.join(process.env.HOME ?? "/", ws.slice(1)) : path.resolve(ws),
          );
          dirs.add(resolved);
        } catch {
          // workspace dir doesn't exist, skip
        }
      }
    }
  }

  // Add default workspace
  const defaultWs = cfg.agents?.defaults?.workspace?.trim();
  if (defaultWs) {
    try {
      const resolved = fs.realpathSync(
        defaultWs.startsWith("~")
          ? path.join(process.env.HOME ?? "/", defaultWs.slice(1))
          : path.resolve(defaultWs),
      );
      dirs.add(resolved);
    } catch {
      // skip
    }
  }

  // Fallback: cwd
  if (dirs.size === 0) {
    dirs.add(process.cwd());
  }

  return [...dirs];
}

/**
 * Append skill-command specs to an existing list, skipping duplicates.
 * This is the public entry point called from provider.ts.
 */
export function appendSkillCommandSpecs(params: {
  commandSpecs: NativeCommandSpec[];
  workspaceDirs: string[];
}): NativeCommandSpec[] {
  const skillSpecs = loadSkillCommandSpecs({
    workspaceDirs: params.workspaceDirs,
  });

  if (skillSpecs.length === 0) {
    return params.commandSpecs;
  }

  const merged = [...params.commandSpecs];
  const existingNames = new Set(merged.map((s) => s.name.toLowerCase()).filter(Boolean));

  let added = 0;
  for (const spec of skillSpecs) {
    if (existingNames.has(spec.name)) {
      log.warn(
        `discord: skill command "/${spec.name}" duplicates an existing native/plugin command. Skipping.`,
      );
      continue;
    }
    existingNames.add(spec.name);
    merged.push(spec);
    added++;
  }

  if (added > 0) {
    log.info(`discord: registered ${added} skill commands from SKILL.md as slash commands`);
  }

  return merged;
}
