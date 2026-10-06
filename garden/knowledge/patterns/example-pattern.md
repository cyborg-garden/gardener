---
type: pattern
created: 2026-07-11
topics: [agent-workflow, handoffs]
---
# End every session with a handoff

## Pattern
Before closing a work session, the agent writes a short handoff doc and appends a one-liner
to `handoffs/index.md`. The next session starts by reading the index to orient itself.

## Why it works
Handoffs create a lightweight continuity layer — the agent doesn't need to re-read the full
history each time. The index is a quick scan; the doc is the detail.

## Example
```
# Handoff: scaffold-complete
## State
All six tasks from the initial plan are done. Tests green. Validator passes.
## Next steps
- Start on Slice B (reference skills).
```
