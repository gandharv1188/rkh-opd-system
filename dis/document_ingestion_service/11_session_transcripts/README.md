# Session Transcripts

> Raw Claude Code session transcripts preserved for audit and replay.
> Complement the structured artefacts in `dis/handoffs/` and the
> decision log in commit messages.

## Format

Each file is **JSONL** (one JSON object per line) as emitted by Claude
Code. Each line is one "event" in the session — user messages,
assistant responses, tool calls, tool results, teammate messages,
system reminders.

**Typical event shape:**

```jsonc
{
  "type": "user" | "assistant" | "system",
  "timestamp": "2026-04-20T...",
  "uuid": "...",                    // event id
  "parentUuid": "...",              // chain
  "sessionId": "...",
  "message": {
    "role": "user" | "assistant",
    "content": [                     // assistant multimodal content
      { "type": "text", "text": "..." },
      { "type": "tool_use", "name": "Bash", "input": {...}, "id": "..." },
      { "type": "tool_result", "tool_use_id": "...", "content": "..." }
    ]
  }
}
```

## How to consume

- **Human replay:** open in a text editor with word wrap; each line is
  one turn. Search for `"type":"tool_use"` to find actions taken.
- **Programmatic:**

  ```bash
  # All user messages:
  jq -c 'select(.type=="user") | .message.content' file.jsonl

  # All Bash commands run:
  jq -c 'select(.message.content[]?.name=="Bash") | .message.content[].input.command' file.jsonl

  # All commits that happened:
  jq -r 'select(.message.content[]?.input.command? | tostring | contains("git commit"))' file.jsonl
  ```

- **Import into another session:** Claude Code can resume from a JSONL
  transcript — copy the file to `%USERPROFILE%\.claude\projects\<project>\`
  and launch the CLI pointed at the same project.

## Storage on disk (origin)

Claude Code stores live transcripts at:

- **Windows:** `%USERPROFILE%\.claude\projects\<encoded-project-path>\<session-uuid>.jsonl`
- **macOS/Linux:** `~/.claude/projects/<encoded-project-path>/<session-uuid>.jsonl`

Project paths are encoded by replacing `/` and `:` with `-`. Example:
`E:\AI-Enabled HMIS\radhakishan_hospital_prescription_system_2026` →
`E--AI-Enabled-HMIS-radhakishan-hospital-prescription-system-2026`.

Each session gets a new UUID. Closing Claude Code does **not** delete
these files; they accumulate until manually pruned.

## What's archived here

| File                                 | Session UUID                           | Span (approx)                         | What happened                                                                                                                                                                                                                                                                    |
| ------------------------------------ | -------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-04-20_dis-build-session.jsonl` | `783e7b47-9182-4acd-bfc2-371cb44fe402` | ~2026-04-20 morning through afternoon | DIS feature: plan authored (Waves 0 doc-writing) + Wave 1 foundation + Wave 2 core business logic + Wave 3 adapters. All merged into `feat/dis-plan` and pushed (PR #1). Teammate system `dis-squad` created, 15+ teammates dispatched, health-check cron installed + cancelled. |

## Privacy note

These transcripts may contain:

- Patient-hash references (opaque IDs only — per coding_standards §8, no PHI in logs)
- File paths, commit messages, command outputs

They do **not** contain:

- Patient names, UHIDs, DOB
- API keys or secrets (those are in `.env` / secrets manager and are redacted by the harness)

## Retention

Keep indefinitely. They are the only verbatim record of what the
orchestrator + teammates actually did, beyond what made it into
commit messages and handoff files.
