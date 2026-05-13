import type {
  SpawnSubagentContextMode,
  SpawnSubagentMode,
  SpawnSubagentSandboxMode,
} from "./subagent-spawn.types.js";

export type SpawnSubagentParams = {
  task: string;
  label?: string;
  agentId?: string;
  model?: string;
  taskName?: string;
  thinking?: string;
  runTimeoutSeconds?: number;
  thread?: boolean;
  mode?: SpawnSubagentMode;
  cleanup?: "delete" | "keep";
  sandbox?: SpawnSubagentSandboxMode;
  context?: SpawnSubagentContextMode;
  lightContext?: boolean;
  expectsCompletionMessage?: boolean;
  attachments?: Array<{
    name: string;
    content: string;
    encoding?: "utf8" | "base64";
    mimeType?: string;
  }>;
  attachMountPath?: string;
};

export type SpawnSubagentContext = {
  agentSessionKey?: string;
  agentChannel?: string;
  agentAccountId?: string;
  agentTo?: string;
  agentThreadId?: string | number;
  agentGroupId?: string | null;
  agentGroupChannel?: string | null;
  agentGroupSpace?: string | null;
  agentMemberRoleIds?: string[];
  requesterAgentIdOverride?: string;
  /** Explicit workspace directory for subagent to inherit (optional). */
  workspaceDir?: string;
  inheritedToolAllowlist?: string[];
  inheritedToolDenylist?: string[];
};

export type SpawnSubagentResult = {
  status: "accepted" | "forbidden" | "error";
  childSessionKey?: string;
  runId?: string;
  mode?: SpawnSubagentMode;
  taskName?: string;
  note?: string;
  modelApplied?: boolean;
  error?: string;
  attachments?: {
    count: number;
    totalBytes: number;
    files: Array<{ name: string; bytes: number; sha256: string }>;
    relDir: string;
  };
};
