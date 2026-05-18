// frankclaw: re-exports SpawnSubagent* types from subagent-spawn.ts for frankclaw module isolation.
// subagent-spawn.frankclaw.ts imports from here to avoid pulling in all of subagent-spawn.ts.
export type {
  SpawnSubagentContext,
  SpawnSubagentParams,
  SpawnSubagentResult,
} from "./subagent-spawn.js";
