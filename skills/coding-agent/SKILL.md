---
name: coding-agent
description: "Delegate coding work to Codex, Claude Code, OpenCode, or Pi as background workers; not simple edits or read-only code lookup."
metadata:
  {
    "openclaw":
      {
        "emoji": "🧩",
        "requires":
          {
            "anyBins": ["claude", "codex", "opencode", "pi"],
            "config": ["skills.entries.coding-agent.enabled"],
          },
        "install":
          [
            {
              "id": "node-claude",
              "kind": "node",
              "package": "@anthropic-ai/claude-code",
              "bins": ["claude"],
              "label": "Install Claude Code CLI (npm)",
            },
            {
              "id": "node-codex",
              "kind": "node",
              "package": "@openai/codex",
              "bins": ["codex"],
              "label": "Install Codex CLI (npm)",
            },
          ],
      },
  }
---

# Coding Agent

Use for background feature builds, PR reviews, large refactors, and issue-to-PR loops. Do not use for simple edits, read-only lookup, ACP thread-bound work, or any run inside `~/.openclaw`, `$OPENCLAW_STATE_DIR`, or active OpenClaw state dirs.

## Hard rules

- Always launch with `background:true`.
- Codex, Pi, OpenCode: use `pty:true`.
- Claude Code: no PTY; use `claude --permission-mode bypassPermissions --print`.
- Capture a real notification route before spawning.
- Worker must send completion/failure via `openclaw message send`.
- Do not rely on heartbeat, system events, or notify-on-exit.
- Monitor with `process`; do not kill slow workers without cause.
- If user asked for a specific agent, use that agent.
- If worker fails/hangs, respawn or ask; do not silently hand-code instead.
- Never checkout branches or run background coding agents in `~/Projects/openclaw`; use an isolated checkout.

## Notification block

Append this shape to every worker prompt with real values:

```text
Notification route:
- channel: <notifyChannel>
- target: <notifyTarget>
- account: <notifyAccount or omit>
- reply_to: <notifyReplyTo or omit>
- thread_id: <notifyThreadId or omit>

When finished, send exactly one completion or failure message using:
openclaw message send --channel <channel> --target '<target>' --message '<brief result>'
Add --account, --reply-to, or --thread-id only when present above.
Do not use openclaw system event or heartbeat.
```

If no trustworthy route exists, say completion auto-notify is unavailable.

## Launch forms

Write the worker prompt to a temp file first. This avoids shell quoting bugs when the required notification block contains quotes or newlines.

```bash
PROMPT=$(mktemp -t openclaw-worker-prompt.XXXXXX)
cat >"$PROMPT" <<'EOF'
Task.
<notification block>
EOF
printf 'prompt file: %s\n' "$PROMPT"
```

Use `$PROMPT` when launching from the same shell/session. If using a separate tool call, substitute the printed path.

Codex:

```bash
bash pty:true background:true workdir:/path/repo command:"codex exec - < \"$PROMPT\""
```

Claude Code:

```bash
bash background:true workdir:/path/repo command:"claude --permission-mode bypassPermissions --print < \"$PROMPT\""
```

OpenCode:

```bash
bash pty:true background:true workdir:/path/repo command:"opencode run < \"$PROMPT\""
```

Pi:

```bash
bash pty:true background:true workdir:/path/repo command:"pi -p \"$(cat \"$PROMPT\")\""
```

## Long issue-to-PR work

1. Create/reuse a GitHub issue as durable spec.
2. Include issue URL, repo, base branch, expected PR, proof, and notification route.
3. Tell worker to branch, implement, test, run review until no accepted actionable findings, open PR.
4. Return issue URL and `sessionId` immediately.
5. Monitor with `process`; cancel through Task Registry if mirrored there.

## Scratch Codex

Codex needs a trusted git repo:

```bash
SCRATCH=$(mktemp -d)
git -C "$SCRATCH" init
PROMPT=$(mktemp -t openclaw-worker-prompt.XXXXXX)
cat >"$PROMPT" <<'EOF'
Build X.
<notification block>
EOF
printf 'prompt file: %s\n' "$PROMPT"
bash pty:true background:true workdir:$SCRATCH command:"codex exec - < \"$PROMPT\""
```

## Process actions

- `list`: running/recent sessions.
- `poll`: status.
- `log`: output.
- `submit`: send input + Enter.
- `write`: raw stdin.
- `paste`: paste text.
- `kill`: terminate.

## Status to user

**Model:** `gpt-5.2-codex` is the default (set in ~/.codex/config.toml)

### Flags

| Flag            | Effect                                   |
| --------------- | ---------------------------------------- |
| `exec “prompt”` | One-shot execution inside the worker CLI |
| `--full-auto`   | Sandboxed but auto-approves in workspace |
| `--yolo`        | No sandbox, no approvals                 |

### Building/Creating

```bash
# Always background immediately
bash pty:true workdir:~/project background:true command:”codex exec --full-auto 'Build a dark mode toggle'”

# More autonomy
bash pty:true workdir:~/project background:true command:”codex --yolo 'Refactor the auth module'”
```

### Reviewing PRs

**Never review PRs in OpenClaw's own project folder.**
Clone to a temp folder or use a worktree.

```bash
REVIEW_DIR=$(mktemp -d)
git clone https://github.com/user/repo.git $REVIEW_DIR
cd $REVIEW_DIR && gh pr checkout 130

bash pty:true workdir:$REVIEW_DIR background:true command:”codex review --base origin/main”
```

Or:

```bash
git worktree add /tmp/pr-130-review pr-130-branch
bash pty:true workdir:/tmp/pr-130-review background:true command:”codex review --base main”
```

### Batch PR Reviews

```bash
git fetch origin '+refs/pull/*/head:refs/remotes/origin/pr/*'

bash pty:true workdir:~/project background:true command:”codex exec 'Review PR #86. git diff origin/main...origin/pr/86'”
bash pty:true workdir:~/project background:true command:”codex exec 'Review PR #87. git diff origin/main...origin/pr/87'”

process action:list
process action:log sessionId:XXX
```

---

## Claude Code

```bash
bash workdir:~/project background:true command:”claude --permission-mode bypassPermissions --print 'Your task'”
```

---

## OpenCode

```bash
bash pty:true workdir:~/project background:true command:”opencode run 'Your task'”
```

---

## Pi Coding Agent

```bash
# Install: npm install -g @earendil-works/pi-coding-agent
bash pty:true workdir:~/project background:true command:”pi 'Your task'”

# Non-interactive mode
bash pty:true workdir:~/project background:true command:”pi -p 'Summarize src/'”

# Different provider/model
bash pty:true workdir:~/project background:true command:”pi --provider openai --model gpt-4o-mini -p 'Your task'”
```

---

## Parallel Issue Fixing with git worktrees

```bash
git worktree add -b fix/issue-78 /tmp/issue-78 main
git worktree add -b fix/issue-99 /tmp/issue-99 main

bash pty:true workdir:/tmp/issue-78 background:true command:”pnpm install && codex --yolo 'Fix issue #78: <description>. Commit and push after review. Send the completion message with openclaw message send using the provided notify route.'”
bash pty:true workdir:/tmp/issue-99 background:true command:”pnpm install && codex --yolo 'Fix issue #99 from the approved ticket summary. Implement only the in-scope edits. Send the completion message with openclaw message send using the provided notify route.'”

process action:list
process action:log sessionId:XXX
```

---

## ⚠️ Rules

1. **Use the right execution mode per agent**:
   - Codex/Pi/OpenCode: `pty:true`
   - Claude Code: `--print --permission-mode bypassPermissions` (no PTY required)
2. **Respect tool choice** - if user asks for Codex, use Codex.
   - Orchestrator mode: do NOT hand-code patches yourself.
   - If an agent fails/hangs, respawn it or ask the user for direction, but don't silently take over.
3. **Be patient** - don't kill sessions because they're “slow”
4. **Monitor with process:log** - check progress without interfering
5. **--full-auto for building** - auto-approves changes
6. **vanilla for reviewing** - no special flags needed
7. **Parallel is OK** - run many Codex processes at once for batch work
8. **NEVER start Codex inside your OpenClaw state directory** (`$OPENCLAW_STATE_DIR`, default `~/.openclaw`) - it'll read your soul docs and get weird ideas about the org chart!
9. **NEVER checkout branches in ~/Projects/openclaw/** - that's the LIVE OpenClaw instance!
10. **Default coding completion bar is end-to-end, not halfway** - unless Frank explicitly asks for an intermediate checkpoint, do not stop at “feature implemented.” Carry the task through local tests, manual verification, commit/push, PR check review, and an explicit merge-readiness assessment.
11. **If the next step is obvious, keep going** - when a coding task has a clear low-risk next action needed to reach completion, do not stop to ask Frank whether you should continue.
12. **After merge, keep going into production by default** - verify the deployment actually finishes in the target environment, then log in through the production URL and perform a real production smoke test before declaring the work complete, unless Frank explicitly tells you to stop earlier.
13. **Always inject the Completion Prompt Snippet** into the worker prompt before spawning. The simplified examples below omit it for brevity — never spawn a worker without it.

---

## Progress Updates (Critical)

When you spawn a coding agent in the background, keep the user in the loop.

- Send 1 short message when you start: what is running and where.
- Update only when something changes:
  - a milestone completes
  - the worker asks a question
  - you hit an error or need user action
  - the worker finishes
- If you kill a session, immediately say you killed it and why.
- If you are expecting the worker to self-notify with `openclaw message send`, say that clearly in your start update.

This prevents the user from seeing only a missing reply and having no idea what happened.

---

## Rules

1. **Always background immediately.**
   - Use `background:true` for every coding-agent launch.
   - Do not use the foreground one-shot path in this skill.
2. **Use the right execution mode per agent.**
   - Codex/Pi/OpenCode: `pty:true`
   - Claude Code: `--print --permission-mode bypassPermissions`
3. **Respect tool choice.**
   - If the user asked for Codex, use Codex.
   - Orchestrator mode: do not hand-code the patch yourself instead of using the requested coding agent.
4. **Capture notify routing before spawn.**
   - Completion messaging must have a real route.
5. **Use direct completion messaging.**
   - Require `openclaw message send`.
   - Do not rely on `openclaw system event` or heartbeat.
6. **Do not silently take over.**
   - If a worker fails or hangs, respawn it or ask for direction. Do not quietly switch to hand-editing.
7. **Monitor with `process`.**
   - `process action:log` is the default low-friction check.
8. **Be patient.**
   - Do not kill sessions just because they are slow.
9. **Parallel is OK.**
   - Many background Codex sessions can run at once.
10. **Never start Codex in `~/.openclaw/`.**
11. **Never checkout branches in `~/Projects/openclaw/`.**

---

## Learnings

- **PTY is essential** for Codex/Pi/OpenCode.
- **Git repo required**: Codex needs a trusted git directory.
- **Use `exec` under background orchestration**: short and long tasks follow the same path now.
- **`submit` vs `write`**: use `submit` to send input plus Enter.
- **Direct message send beats heartbeat for completion notification** when the user must be told immediately and heartbeat may be disabled.
