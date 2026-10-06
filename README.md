# 🌱 Gardener

A portable memory + coordination substrate you hand to your agent. Handoffs, knowledge, and a
task board your agent can tend — markdown + git by default, adaptable to your stack.

> Early scaffold. See `SPEC.md` for the format contract and `garden-io` for the storage layer.

- **`SPEC.md`** — the garden format: board, decisions, handoffs, knowledge.
- **`AUTONOMY.md`** — how much your gardener may change without asking; rungs R0–R4, granted by you, defaulting to R0 (read-only until your first grant). Enforced by `lib/autonomy.js`, and enforced *unconditionally* in the driver: a write with no declared authority is refused, not permitted. Grant a rung in `.overlay/autonomy.yml`, or pass `garden-io --authority <a>`.
- **`DISTRIBUTION.md`** — pulling substrate updates without losing your customizations, and contributing sanitized patterns back.
- **`RUBRIC.md`** — deterministic, report-only checks: the correctness signal autonomy is gated on.
- **`npm run sanitize`** — the two-layer sanitize gate: credential shapes, plus the org/person/narrative particulars that make a "generic" artefact identifiable. Declare your own particulars in `.overlay/particulars` (gitignored — they never leave your instance).

Made by Cyborg Garden.
