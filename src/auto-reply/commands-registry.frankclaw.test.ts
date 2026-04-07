/**
 * Tests frankclaw-specific command registry behavior:
 *   - /doramon_stop alias on the stop command
 *   - Command registry validation passes with the alias
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("../channels/plugins/index.js", () => ({
  listChannelPlugins: () => [],
}));

vi.mock("../plugins/runtime.js", () => ({
  getActivePluginRegistry: () => null,
}));

import { getChatCommands } from "./commands-registry.data.js";

describe("frankclaw command registry", () => {
  it("stop command includes /doramon_stop alias", () => {
    const commands = getChatCommands();
    const stopCmd = commands.find((c) => c.key === "stop");

    expect(stopCmd).toBeDefined();
    expect(stopCmd!.textAliases).toContain("/stop");
    expect(stopCmd!.textAliases).toContain("/doramon_stop");
  });

  it("registry validates without duplicate key/alias errors", () => {
    // getChatCommands calls assertCommandRegistry internally
    expect(() => getChatCommands()).not.toThrow();
  });

  it("doramon_stop alias has leading slash", () => {
    const commands = getChatCommands();
    const stopCmd = commands.find((c) => c.key === "stop");
    for (const alias of stopCmd!.textAliases) {
      expect(alias.startsWith("/")).toBe(true);
    }
  });
});
