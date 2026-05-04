import { beforeEach, describe, expect, it } from "vitest";
import { clearPluginCommands, registerPluginCommand } from "../../../../src/plugins/commands.js";
import {
  baseConfig,
  baseRuntime,
  getProviderMonitorTestMocks,
  resetDiscordProviderMonitorMocks,
} from "../test-support/provider.test-support.js";

const { createDiscordNativeCommandMock, clientDeployCommandsMock, monitorLifecycleMock } =
  getProviderMonitorTestMocks();

describe("monitorDiscordProvider real plugin registry", () => {
  beforeEach(() => {
    clearPluginCommands();
    resetDiscordProviderMonitorMocks({
      nativeCommands: [{ name: "status", description: "Status", acceptsArgs: false }],
    });
  });

  it("registers plugin commands from the real registry as native Discord commands", async () => {
    expect(
      registerPluginCommand("demo-plugin", {
        name: "pair",
        description: "Pair device",
        acceptsArgs: true,
        requireAuth: false,
        handler: async ({ args }) => ({ text: `paired:${args ?? ""}` }),
      }),
    ).toEqual({ ok: true });

    const { monitorDiscordProvider, __testing } = await import("./provider.js");
    __testing.setGetPluginCommandSpecs(() => [
      { name: "pair", description: "Pair device", acceptsArgs: true },
    ]);

    try {
      await monitorDiscordProvider({
        config: baseConfig(),
        runtime: baseRuntime(),
      });
    } finally {
      __testing.setGetPluginCommandSpecs(undefined);
    }

    const commandNames = (createDiscordNativeCommandMock.mock.calls as Array<unknown[]>)
      .map((call) => (call[0] as { command?: { name?: string } } | undefined)?.command?.name)
      .filter((value): value is string => typeof value === "string");

    expect(commandNames).toContain("status");
    expect(commandNames).toContain("pair");
    expect(clientDeployCommandsMock).toHaveBeenCalledTimes(1);
    expect(monitorLifecycleMock).toHaveBeenCalledTimes(1);
  });
});
