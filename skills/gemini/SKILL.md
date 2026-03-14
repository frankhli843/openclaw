---
name: gemini
description: Gemini CLI for one-shot Q&A, summaries, and generation.
homepage: https://ai.google.dev/
metadata:
  {
    "openclaw":
      {
        "emoji": "✨",
        "requires": { "bins": ["gemini"] },
        "install":
          [
            {
              "id": "brew",
              "kind": "brew",
              "formula": "gemini-cli",
              "bins": ["gemini"],
              "label": "Install Gemini CLI (brew)",
            },
          ],
      },
  }
---

# Gemini CLI

Use Gemini in one-shot mode with a positional prompt (avoid interactive mode).

Quick start

- `gemini "Answer this question..."`
- `gemini --model <name> "Prompt..."`
- `gemini --output-format json "Return JSON"`

Extensions

- List: `gemini --list-extensions`
- Manage: `gemini extensions <command>`

Notes

- If auth is required, run `gemini` once interactively and follow the login flow.
- Avoid `--yolo` for safety.

## Mandatory fallback protocol (every Gemini call)

Before each Gemini invocation, include/remember this operational order:

1. Try direct Gemini call first.
2. If it fails, run manual Gemini UI search via MCP (open Gemini, type query, snapshot, extract text/sources).
3. If manual MCP fails, spawn a sub-agent to fix MCP/browser path.
4. Continue task using direct browser/manual fetches so user still gets results.
5. Never stop at tool failure without executing fallback path.
