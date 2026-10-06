# Gardener format SPEC

The substrate is **markdown + light YAML frontmatter**, under `garden/`. No database. Every
document is a plain file; the layout below *is* the contract. `garden-io` reads and writes it;
a validator (`tools/validate.js`) enforces this SPEC.

## `garden/state/threads.md` — the board
Sectioned kanban. Each `##` heading is a lane; each `- [ ]`/`- [x]` line is an item.

```
# Board

## Now
- [ ] (P1) #a1 Ship the thing — short description
      > reply: any freeform note, one per line, prefixed "> reply:"

## Next
- [ ] (P2) #a2 Another item

## Done
- [x] #a0 A finished item
```
Grammar: `- [status] (Pn) #id title — desc`. `status` ∈ {space, x}. `(Pn)` optional priority,
n ∈ 1..4. `#id` is a short stable slug. Replies are `> reply:` lines under an item. The ` — `
(spaced em-dash) separates title from description; it splits at the FIRST occurrence, so a title
cannot itself contain ` — `.

## `garden/state/decisions.md` — open decisions
```
## D-2026-07-11-01  needs: you
Question text.
- option a
- option b
status: open        # open | resolved
```

## `garden/state/global.md` — cycle log + header
First block is a machine-read header; the rest is an append-only log.
```
<!-- gardener:header
verdict: quiet          # quiet | acted | needs-you
needs_you: 2
in_flight: 3
last_cycle: 2026-07-11
-->

## 2026-07-11
- log line
```

## `garden/state/projects/<slug>.md`
```
---
slug: example-project
status: active          # active | paused | done
---
# Example Project
Freeform notes.
```

## `garden/handoffs/`
`{YYYY-MM}/{DD-topic}.md` plus `index.md` (reverse-chronological one-liners):
```
- 2026-07-11 · example-handoff · one-line summary
```
A handoff doc:
```
---
date: 2026-07-11
topic: example-handoff
---
# Handoff: example
## State
## Next steps
```

## `garden/knowledge/{decisions,patterns,findings}/`
Dated doc with frontmatter:
```
---
type: pattern            # decision | pattern | finding
created: 2026-07-11
topics: [example]
---
# Title
Body.
```
