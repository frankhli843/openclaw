import { listChannelPlugins } from "../channels/plugins/index.js";
import { getActivePluginRegistry } from "../plugins/runtime.js";
import {
  assertCommandRegistry,
  buildBuiltinChatCommands,
  defineChatCommand,
} from "./commands-registry.shared.js";
import type { ChatCommandDefinition } from "./commands-registry.types.js";

type ChannelPlugin = ReturnType<typeof listChannelPlugins>[number];

function supportsNativeCommands(plugin: ChannelPlugin): boolean {
  return plugin.capabilities?.nativeCommands === true;
}

function defineDockCommand(plugin: ChannelPlugin): ChatCommandDefinition {
  return defineChatCommand({
    key: `dock:${plugin.id}`,
    nativeName: `dock_${plugin.id}`,
    description: `Switch to ${plugin.id} for replies.`,
    textAliases: [`/dock-${plugin.id}`, `/dock_${plugin.id}`],
    category: "docks",
  });
}

let cachedCommands: ChatCommandDefinition[] | null = null;
let cachedRegistry: ReturnType<typeof getActivePluginRegistry> | null = null;
let cachedNativeCommandSurfaces: Set<string> | null = null;
let cachedNativeRegistry: ReturnType<typeof getActivePluginRegistry> | null = null;

function buildChatCommands(): ChatCommandDefinition[] {
  const commands: ChatCommandDefinition[] = [
    ...buildBuiltinChatCommands().map((cmd) =>
      // frankclaw: add /doramon_stop alias to the stop command
      cmd.key === "stop"
        ? { ...cmd, textAliases: ["/stop", "/doramon_stop"] }
        : cmd,
    ),
    ...listChannelPlugins()
      .filter(supportsNativeCommands)
      .map((plugin) => defineDockCommand(plugin)),
  ];

  assertCommandRegistry(commands);
  return commands;
}

export function getChatCommands(): ChatCommandDefinition[] {
  const registry = getActivePluginRegistry();
  if (cachedCommands && registry === cachedRegistry) {
    return cachedCommands;
  }
  const commands = buildChatCommands();
  cachedCommands = commands;
  cachedRegistry = registry;
  cachedNativeCommandSurfaces = null;
  return commands;
}

export function getNativeCommandSurfaces(): Set<string> {
  const registry = getActivePluginRegistry();
  if (cachedNativeCommandSurfaces && registry === cachedNativeRegistry) {
    return cachedNativeCommandSurfaces;
  }
  cachedNativeCommandSurfaces = new Set(
    listChannelPlugins()
      .filter(supportsNativeCommands)
      .map((plugin) => plugin.id),
  );
  cachedNativeRegistry = registry;
  return cachedNativeCommandSurfaces;
}
