import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  normalizeDiscordCommandName,
  parseSkillCommandsMd,
  loadSkillCommandSpecs,
  appendSkillCommandSpecs,
  resolveWorkspaceDirsFromConfig,
} from "./skill-commands.frankclaw.js";

describe("normalizeDiscordCommandName", () => {
  it("strips leading slash and lowercases", () => {
    expect(normalizeDiscordCommandName("/Iterate")).toBe("iterate");
  });

  it("handles underscores", () => {
    expect(normalizeDiscordCommandName("/iterate_continuously")).toBe("iterate_continuously");
  });

  it("replaces spaces and special chars with hyphens", () => {
    expect(normalizeDiscordCommandName("/my command!")).toBe("my-command");
  });

  it("collapses consecutive hyphens", () => {
    expect(normalizeDiscordCommandName("/foo--bar---baz")).toBe("foo-bar-baz");
  });

  it("truncates to 32 chars", () => {
    const long = "/" + "a".repeat(40);
    const result = normalizeDiscordCommandName(long);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(32);
  });

  it("returns null for empty input", () => {
    expect(normalizeDiscordCommandName("")).toBeNull();
    expect(normalizeDiscordCommandName("/")).toBeNull();
  });

  it("strips multiple leading slashes", () => {
    expect(normalizeDiscordCommandName("///test")).toBe("test");
  });

  it("handles pure numeric names", () => {
    expect(normalizeDiscordCommandName("/123")).toBe("123");
  });

  it("trims leading/trailing hyphens after normalization", () => {
    expect(normalizeDiscordCommandName("/-test-")).toBe("test");
  });
});

describe("parseSkillCommandsMd", () => {
  it("parses commands from registered commands section", () => {
    const md = `# Commands Skill

## Registered Commands

---

### /iterate

Add these items to your to-do list without changing the wording.

**Note:** Do not rely on Playwright.

---

### /iterate_continuously

Schedule an autonomous iteration loop that runs every 2 hours.

---

### /iterate_continously

Alias for \`/iterate_continuously\` (typo-tolerant).

## Adding New Commands

To add a new command, add a section.
`;
    const commands = parseSkillCommandsMd(md);
    expect(commands).toHaveLength(3);

    expect(commands[0].rawName).toBe("/iterate");
    expect(commands[0].description).toBe(
      "Add these items to your to-do list without changing the wording.",
    );
    expect(commands[0].isAlias).toBe(false);

    expect(commands[1].rawName).toBe("/iterate_continuously");
    expect(commands[1].description).toBe(
      "Schedule an autonomous iteration loop that runs every 2 hours.",
    );
    expect(commands[1].isAlias).toBe(false);

    expect(commands[2].rawName).toBe("/iterate_continously");
    expect(commands[2].isAlias).toBe(true);
  });

  it("returns empty array for content without registered commands section", () => {
    const md = `# Some Other File\n\n### /foo\n\nNot a command.`;
    expect(parseSkillCommandsMd(md)).toHaveLength(0);
  });

  it("handles empty content", () => {
    expect(parseSkillCommandsMd("")).toHaveLength(0);
  });

  it("stops parsing at next H2 section", () => {
    const md = `## Registered Commands

### /alpha

First command description.

## Other Section

### /beta

This should NOT be parsed.
`;
    const commands = parseSkillCommandsMd(md);
    expect(commands).toHaveLength(1);
    expect(commands[0].rawName).toBe("/alpha");
  });

  it("generates fallback description when body is empty", () => {
    const md = `## Registered Commands

### /deploy

---
`;
    const commands = parseSkillCommandsMd(md);
    expect(commands).toHaveLength(1);
    expect(commands[0].description).toBe("Run the deploy command");
  });

  it("strips bold markdown from description", () => {
    const md = `## Registered Commands

### /test

**Key:** This is a test command with **bold** text.
`;
    const commands = parseSkillCommandsMd(md);
    expect(commands[0].description).toBe("Key: This is a test command with bold text.");
  });

  it("truncates long descriptions to 100 chars", () => {
    const longDesc = "A".repeat(120);
    const md = `## Registered Commands

### /longdesc

${longDesc}
`;
    const commands = parseSkillCommandsMd(md);
    expect(commands[0].description.length).toBeLessThanOrEqual(100);
    expect(commands[0].description).toMatch(/\.\.\.$/);
  });
});

describe("loadSkillCommandSpecs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-commands-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSkillMd(workspaceDir: string, content: string) {
    const skillDir = path.join(workspaceDir, "skills", "commands");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), content);
  }

  it("loads commands from SKILL.md in workspace", () => {
    writeSkillMd(
      tmpDir,
      `## Registered Commands

### /iterate

Run iterate.

### /deploy

Deploy to production.
`,
    );

    const specs = loadSkillCommandSpecs({ workspaceDirs: [tmpDir] });
    expect(specs).toHaveLength(2);
    expect(specs[0].name).toBe("iterate");
    expect(specs[0].acceptsArgs).toBe(true);
    expect(specs[0].args).toHaveLength(1);
    expect(specs[0].args![0].name).toBe("args");
    expect(specs[1].name).toBe("deploy");
  });

  it("skips aliases by default", () => {
    writeSkillMd(
      tmpDir,
      `## Registered Commands

### /iterate

Run iterate.

### /interate

Alias for /iterate.
`,
    );

    const specs = loadSkillCommandSpecs({ workspaceDirs: [tmpDir] });
    expect(specs).toHaveLength(1);
    expect(specs[0].name).toBe("iterate");
  });

  it("includes aliases when skipAliases=false", () => {
    writeSkillMd(
      tmpDir,
      `## Registered Commands

### /iterate

Run iterate.

### /interate

Alias for /iterate.
`,
    );

    const specs = loadSkillCommandSpecs({
      workspaceDirs: [tmpDir],
      skipAliases: false,
    });
    expect(specs).toHaveLength(2);
  });

  it("handles missing SKILL.md gracefully", () => {
    const specs = loadSkillCommandSpecs({ workspaceDirs: [tmpDir] });
    expect(specs).toHaveLength(0);
  });

  it("handles collision (first wins)", () => {
    const ws1 = path.join(tmpDir, "ws1");
    const ws2 = path.join(tmpDir, "ws2");
    writeSkillMd(
      ws1,
      `## Registered Commands

### /iterate

First workspace iterate.
`,
    );
    writeSkillMd(
      ws2,
      `## Registered Commands

### /iterate

Second workspace iterate.
`,
    );

    const specs = loadSkillCommandSpecs({ workspaceDirs: [ws1, ws2] });
    expect(specs).toHaveLength(1);
    expect(specs[0].description).toBe("First workspace iterate.");
  });
});

describe("appendSkillCommandSpecs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-commands-append-test-"));
    const skillDir = path.join(tmpDir, "skills", "commands");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `## Registered Commands

### /iterate

Run iterate.

### /deploy

Deploy to prod.
`,
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends skill commands to existing specs", () => {
    const existing = [{ name: "ask", description: "Ask something", acceptsArgs: true }];
    const result = appendSkillCommandSpecs({
      commandSpecs: existing,
      workspaceDirs: [tmpDir],
    });
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe("ask");
    expect(result[1].name).toBe("iterate");
    expect(result[2].name).toBe("deploy");
  });

  it("skips duplicates of existing native commands", () => {
    const existing = [{ name: "iterate", description: "Built-in iterate", acceptsArgs: true }];
    const result = appendSkillCommandSpecs({
      commandSpecs: existing,
      workspaceDirs: [tmpDir],
    });
    expect(result).toHaveLength(2); // iterate (existing) + deploy
    expect(result[0].description).toBe("Built-in iterate");
    expect(result[1].name).toBe("deploy");
  });

  it("returns original specs when no skill commands found", () => {
    const existing = [{ name: "ask", description: "Ask something", acceptsArgs: true }];
    const result = appendSkillCommandSpecs({
      commandSpecs: existing,
      workspaceDirs: ["/nonexistent/path"],
    });
    expect(result).toEqual(existing);
  });
});

describe("resolveWorkspaceDirsFromConfig", () => {
  it("resolves from agent list workspaces", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-resolve-test-"));
    try {
      const dirs = resolveWorkspaceDirsFromConfig({
        agents: {
          list: [{ workspace: tmpDir }],
        },
      });
      expect(dirs).toContain(fs.realpathSync(tmpDir));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("resolves from defaults workspace", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-resolve-default-test-"));
    try {
      const dirs = resolveWorkspaceDirsFromConfig({
        agents: {
          defaults: { workspace: tmpDir },
        },
      });
      expect(dirs).toContain(fs.realpathSync(tmpDir));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("falls back to cwd when no config", () => {
    const dirs = resolveWorkspaceDirsFromConfig({});
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe(process.cwd());
  });

  it("deduplicates workspace dirs", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-dedup-test-"));
    try {
      const dirs = resolveWorkspaceDirsFromConfig({
        agents: {
          defaults: { workspace: tmpDir },
          list: [{ workspace: tmpDir }],
        },
      });
      const unique = new Set(dirs);
      expect(unique.size).toBe(dirs.length);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
