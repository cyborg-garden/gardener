---
type: decision
created: 2026-07-11
topics: [architecture, storage]
---
# Use markdown + git as the default storage backend

## Context
Needed a zero-dependency, portable substrate that agents and humans can both read and edit.

## Decision
Default to markdown files in a git repo. This requires no external services, works offline,
and produces a readable, diffable history.

## Consequences
- Simple to adopt: clone the repo, point garden-io at it, done.
- Git history gives a free audit log.
- Sync is best-effort (ff-only pull + push); conflicts require manual resolution.
