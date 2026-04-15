/**
 * E2E test: verifies that skill commands from SKILL.md get registered as
 * Discord slash commands through the full provider flow.
 *
 * frankclaw addition: skill commands as Discord slash commands.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  baseConfig,
  baseRuntime,
  getProviderMonitorTestMocks,
  resetDiscordProviderMonitorMocks,
} from "../test-support/provider.test-support.js";

const { createDiscordNativeCommandMock } = getProviderMonitorTestMocks();

describe("skill commands SKILL.md -> Discord slash commands (e2e)", () => {
  let tmpWorkspaceDir: string;

  beforeEach(() => {
    tmpWorkspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "discord-skill-commands-e2e-"));
    const skillDir = path.join(tmpWorkspaceDir, "skills", "commands");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: commands
description: Test commands
---

# Commands Skill

## Registered Commands

---

### /iterate

Add these items to your to-do list without changing the wording.

---

### /iterate_continuously

Schedule an autonomous iteration loop that runs every 2 hours.

---

### /iterate_continously

Alias for \`/iterate_continuously\` (typo-tolerant).

---

### /deploy

Deploy to production.

## Adding New Commands

Not a command section.
`,
    );

    resetDiscordProviderMonitorMocks({
      nativeCommands: [{ name: "status", description: "Status", acceptsArgs: false }],
    });
  });

  afterEach(() => {
    fs.rmSync(tmpWorkspaceDir, { recursive: true, force: true });
  });

  it("registers non-alias skill commands as Discord slash commands alongside native commands", async () => {
    // Dynamically import to pick up the mocks from test-support
    const providerModule = await import("./provider.js");

    // Mock resolveWorkspaceDirsFromConfig to use our temp workspace
    const skillCommandsModule = await import("./skill-commands.frankclaw.js");

    // Temporarily override resolveWorkspaceDirsFromConfig to return our temp dir
    vi.spyOn(skillCommandsModule, "resolveWorkspaceDirsFromConfig").mockReturnValue([
      tmpWorkspaceDir,
    ]);

    try {
      await providerModule.monitorDiscordProvider({
        config: baseConfig(),
        runtime: baseRuntime(),
      });

      const commandNames = (createDiscordNativeCommandMock.mock.calls as Array<unknown[]>)
        .map((call) => (call[0] as { command?: { name?: string } } | undefined)?.command?.name)
        .filter((value): value is string => typeof value === "string");

      // Native command should be present
      expect(commandNames).toContain("status");

      // Skill commands should be registered (non-alias)
      expect(commandNames).toContain("iterate");
      expect(commandNames).toContain("iterate_continuously");
      expect(commandNames).toContain("deploy");

      // Alias should NOT be registered
      expect(commandNames).not.toContain("iterate_continously");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("skill commands have an optional 'args' string option", async () => {
    const skillCommandsModule = await import("./skill-commands.frankclaw.js");
    vi.spyOn(skillCommandsModule, "resolveWorkspaceDirsFromConfig").mockReturnValue([
      tmpWorkspaceDir,
    ]);

    try {
      const providerModule = await import("./provider.js");
      await providerModule.monitorDiscordProvider({
        config: baseConfig(),
        runtime: baseRuntime(),
      });

      // Find the call for the "iterate" command
      const iterateCall = (createDiscordNativeCommandMock.mock.calls as Array<unknown[]>).find(
        (call) =>
          (call[0] as { command?: { name?: string } } | undefined)?.command?.name === "iterate",
      );
      expect(iterateCall).toBeDefined();

      const commandSpec = (
        iterateCall![0] as {
          command: {
            acceptsArgs: boolean;
            args?: Array<{ name: string; type: string; required: boolean }>;
          };
        }
      ).command;
      expect(commandSpec.acceptsArgs).toBe(true);
      expect(commandSpec.args).toBeDefined();
      expect(commandSpec.args).toHaveLength(1);
      expect(commandSpec.args![0].name).toBe("args");
      expect(commandSpec.args![0].required).toBe(false);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("does not duplicate skill commands that overlap with native commands", async () => {
    // Add 'iterate' as a native command too
    resetDiscordProviderMonitorMocks({
      nativeCommands: [
        { name: "status", description: "Status", acceptsArgs: false },
        { name: "iterate", description: "Built-in iterate", acceptsArgs: true },
      ],
    });

    const skillCommandsModule = await import("./skill-commands.frankclaw.js");
    vi.spyOn(skillCommandsModule, "resolveWorkspaceDirsFromConfig").mockReturnValue([
      tmpWorkspaceDir,
    ]);

    try {
      const providerModule = await import("./provider.js");
      await providerModule.monitorDiscordProvider({
        config: baseConfig(),
        runtime: baseRuntime(),
      });

      const commandNames = (createDiscordNativeCommandMock.mock.calls as Array<unknown[]>)
        .map((call) => (call[0] as { command?: { name?: string } } | undefined)?.command?.name)
        .filter((value): value is string => typeof value === "string");

      // 'iterate' should appear only once (the native one)
      const iterateOccurrences = commandNames.filter((n) => n === "iterate");
      expect(iterateOccurrences).toHaveLength(1);

      // Other skill commands should still be added
      expect(commandNames).toContain("iterate_continuously");
      expect(commandNames).toContain("deploy");
    } finally {
      vi.restoreAllMocks();
    }
  });
});
