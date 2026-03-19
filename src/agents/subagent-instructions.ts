import fs from "node:fs/promises";
import path from "node:path";
import { resolveUserPath } from "../utils.js";

export const DEFAULT_SUBAGENTS_FILENAME = "SUBAGENTS.md";

const subagentInstructionsCache = new Map<string, { content: string; mtimeMs: number }>();

export async function loadSubagentInstructions(
  workspaceDir: string,
  fileName: string = DEFAULT_SUBAGENTS_FILENAME,
): Promise<string | undefined> {
  const filePath = path.join(resolveUserPath(workspaceDir), fileName);
  try {
    const stats = await fs.stat(filePath);
    const cached = subagentInstructionsCache.get(filePath);
    if (cached && cached.mtimeMs === stats.mtimeMs) {
      return cached.content || undefined;
    }
    const raw = await fs.readFile(filePath, "utf-8");
    const content = raw.trim();
    subagentInstructionsCache.set(filePath, { content, mtimeMs: stats.mtimeMs });
    return content || undefined;
  } catch {
    subagentInstructionsCache.delete(filePath);
    return undefined;
  }
}

export function prependSubagentInstructions(baseMessage: string, instructions?: string): string {
  const trimmed = instructions?.trim();
  if (!trimmed) {
    return baseMessage;
  }
  return [`[Subagent Global Instructions]`, trimmed, baseMessage].join("\n\n");
}
