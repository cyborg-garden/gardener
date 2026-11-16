# Autonomy — how much a gardener may change without asking

A gardener tends a garden. How much it may change on its own is not one switch —
it is a small set of dials the operator turns deliberately, one notch at a time.
This document is the contract for those dials.

It is harness-agnostic. It assumes only the garden format (`SPEC.md`) and the
driver contract (`lib/garden-io.js`) — nothing about any particular runtime,
memory system, task shape, or organization. A gardener tending code and a
gardener tending a Notion life-board obey the same contract.

> **Status:** the contract below is enforced in code by `lib/autonomy.js` —
> the act-gate (`Autonomy#canAct`), the driver write-policy (`writeAllowed`,
> wired into the git driver's `write()`), overlay reading (`loadAutonomy`,
> fail-closed to R0 on a missing or malformed overlay), and sharp-edge grant
> files. The write-policy is **unconditional**: it used to engage only when a caller
> passed `authority`, which made the second enforcement layer opt-in per call — and a
> jailbroken loop is exactly a caller that would omit it. An absent authority now
> resolves *down* (to `observe`, which writes nothing), never to "unrestricted".
> One honest limit remains: no tending loop ships in this repo yet, so `canAct` has
> no resident caller. The rungs bind exactly as far as your loop routes through the
> act-gate; the write-policy binds regardless.

## Principles

1. **Propose before act.** The default is to *surface* work, not do it. Acting is
   a privilege the operator grants, per capability, in writing.
2. **The operator grants; the gardener never self-grants.** Every escalation is an
   explicit, operator-created token. A gardener at rung N cannot move itself to N+1.
3. **Reversibility and legibility are preconditions for acting**, not afterthoughts.
   An action that can't be cheaply undone or clearly explained needs a higher rung
   than one that can.
4. **Climb deliberately.** A rung is earned by the one below it proving out — good
   judgment, low noise, nothing broken. Climbing is a decision, not a drift.

## Two enforcement layers

Autonomy is enforced in two independent places, so a prompt can't talk its way past it:

- **The act-gate** (loop level): before a cycle attempts a class of action, it checks
  the granted authority for that capability. Governs *what the loop may attempt.*
- **The driver write-policy** (backend level): the storage driver refuses writes to
  human-owned regions above the granted authority. Governs *what the backend
  physically permits.*

Every driver **MUST** declare which regions are agent-owned vs human-owned and
enforce this independently of the loop. Two layers means a jailbroken or confused
loop still cannot mutate protected state — the driver refuses.

For that to be true the write-policy cannot be something a caller opts into. It is
applied on **every** write:

- A **human-owned region is refused at every authority**, including when the caller
  declares none. There is no rung at which such a write is legal, so there is no
  default under which it may be performed.
- An **undeclared region** fails closed.
- For agent/proposal regions, an absent authority resolves to `observe` — the bottom
  of the ladder, which writes nothing — unless the caller, the driver construction, or
  `GARDEN_AUTHORITY` declares otherwise. **Absent is not unrestricted.**

Both layers are implemented in `lib/autonomy.js`: `loadAutonomy()` resolves the
operator's overlay grants (defaulting to R0), `Autonomy#canAct()` is the act-gate,
and `writeAllowed(authority, region)` is the write-policy a driver enforces in its
`write()` via its declared `regionOf()`.

Path scope is part of that boundary, not a convenience: the git driver confines every
read, write, and list to the configured garden root, refuses `..` and absolute-path
escapes, and resolves the deepest existing ancestor so a symlink (including a symlinked
directory with a not-yet-created file beneath it) cannot redirect an operation outside
the root. The configured root itself must be a real directory, not a symlink. A missing
garden is still created lazily by its first valid write. This is a filesystem boundary
for the driver, not a general OS sandbox: an agent with an unrestricted shell or another
writable mount must be isolated separately, and the overlay should be mounted read-only
to the agent as well. Path checks are not a race-proof defence against a concurrent
filesystem attacker; use OS-level confinement when that is in the threat model.

- **Git driver:** git history is reversible and it declares no human region, so once
  the operator has granted `propose` or above every path it owns is writable and the
  act-gate does the interesting work. "Permissive about regions" is not "permissive
  about authority": a write must still declare one, and an undeclared write is refused.
  Declare it per call (`write(p, c, { authority })`), once on the driver
  (`new GardenIO({ authority })`), or via `GARDEN_AUTHORITY`; resolve it from the
  overlay with `loadAutonomy(root).authorityFor(capability)`, which fails closed to R0.
  `bin/garden-io.js` does exactly that, and accepts `--authority` to override.
- **Git metadata is not a document.** Agent read/write/list operations refuse `.git`
  paths and omit them from recursive listings. Only the operator may configure Git;
  no garden document is allowed to become repository configuration, a hook, or a
  remote URL. The guard checks the canonical target against the actual Git
  directory, so aliases and renamed metadata do not bypass it. Only a conventional,
  operator-owned real `<garden>/.git` directory is supported: symlinked or pointer
  markers, separate metadata, and `commondir` redirection fail closed for storage
  operations as well as sync, rather than being mistaken for an absent repository.
- **Sync is a separate state-changing capability.** It requires `act:contained` or
  higher (`garden-io:sync` in the overlay, or the trusted-caller override), not R0/R1.
  It refuses nested-repository discovery: the canonical Git top-level must equal the
  configured garden root before staging. Staging is scoped to that root, and Git
  environment configuration/global includes/editor execution are cleared for the
  subprocess; only the operator's global `user.name` and `user.email` are retained
  as commit identity. Staging and commit failures are explicit and never reported as a
  successful synchronization or followed by pushing stale `HEAD`. An empty staged
  diff is the only no-op path. Local `.git/config` remains operator-owned; arbitrary repository
  configuration is not made safe by this check. Sync can commit and push, so it
  belongs behind the same explicit grant and deployment isolation as other actions.
- **A live, human-edited backend (e.g. Notion):** human-set fields are human-owned
  and refused above `propose`, regardless of what the loop asks. Low on the ladder,
  the only thing the gardener may write is a single agent-owned region (one "auto"
  block). This is the difference between *a gardener with a Notion driver* and
  *an agent that merely has a Notion skill*: the skill can write anything; the
  driver enforces propose-don't-clobber at the source of truth.

## The dials

Autonomy is three separable things, not one number.

### A. Action authority (per capability)

- `observe` — read + digest only; no writes.
- `propose` — write only to proposal surfaces: open decisions (`garden/state/decisions.md`),
  `> reply:` notes on the board, and agent-owned regions. Never mutate human-owned state.
- `act:contained` — reversible, bounded changes within agent-owned regions (move an
  item it created; write its own sync block; open a draft).
- `act:broad` — wider action, allowed only where a correctness signal exists (see
  gating) — e.g. open a PR, tag a release.

Authority is **per capability**, not global: a gardener may be trusted to `act:broad`
on "triage the board" while still only `propose` on "reprioritize the roadmap."

### B. Attendance

- `attended` — runs only when a human is present to see the cycle.
- `unattended` — runs on a schedule with no one watching.

Unattended is itself a rung. It multiplies the blast radius of every granted
authority, so it is granted separately and is **never implied** by action authority
alone.

### C. Sharp-edge grants

Specific high-risk capabilities, each gated by its own named token *regardless of
rung*: auto-merge, self-modification / self-tagging, and any destructive or
irreversible operation. Absent its token, the capability is off even at the top of
the ladder.

## Gating a promotion (propose → act)

A capability may be promoted from `propose` to `act` only when all of these hold:

1. **Reversible** — the action can be undone cheaply (git revert; backend edit
   history; a restorable prior value).
2. **Bounded blast radius** — it touches a known, small set of things, not an
   open-ended sweep.
3. **Confined to agent-owned regions** — it does not write human-owned state.
4. **A correctness signal exists.** This is the crux for non-code work:
   - *Code-shaped* capabilities have a deterministic signal — tests pass, CI green,
     build succeeds. That signal is what makes code autonomy safe to escalate.
     Rubric checks (`RUBRIC.md`) are a further deterministic *input* here: they
     detect drift a proposed action should account for, though a quiet rubric is
     not by itself proof an action is correct.
   - *Non-code-shaped* capabilities (reprioritizing a roadmap, editing a doc, moving
     rows) have **no green build.** Their signal is substituted by: a human-approved
     *pattern* (the operator has repeatedly accepted this exact class of proposal), a
     *dry-run diff* shown before acting, and strict reversibility. A non-code `act`
     rung is therefore defined by "how reversible and how contained," not "did the
     tests pass" — and it is expected to climb slower.

## Rungs (presets)

Rungs are named presets over the dials, for operators who don't want to set every
capability by hand. Climbing from one to the next is an explicit grant.

| Rung | Authority | Attendance | Sharp edges |
|------|-----------|------------|-------------|
| **R0 · Observe** | `observe` | attended | none |
| **R1 · Propose** | `propose` | attended | none |
| **R2 · Act (contained)** | `act:contained` where the gate passes | attended | none |
| **R3 · Act, unattended** | `act:contained` where the gate passes (the gate never relaxes unattended) | unattended | none |
| **R4 · Act (broad)** | `act:broad` where a signal exists | unattended | each still per-token |

**R0 · Observe is the default for any fresh install or fork** — and it is what the
code resolves to when no overlay exists (`lib/autonomy.js`, fail-closed). A gardener
you just handed to your agent is strictly read-only until your first explicit grant.
The natural first notch is R1: proposing is safe by construction because it writes
only to proposal surfaces, never human-owned state — but even that is yours to
grant, not assumed.

## Where grants live

Grants are files the operator creates in an **overlay** the gardener reads but
upstream never ships:

- `.overlay/autonomy.yml` — the rung + per-capability authority overrides.
- `.overlay/grants/<capability>` — one file per sharp-edge grant (presence = granted).

The overlay is configuration, not an authentication mechanism for its caller. The CLI's
`--authority` flag and `GARDEN_AUTHORITY` environment variable are **trusted-caller
declarations**, not operator grants: anyone who can choose the process's arguments or
environment can assert a higher rung. They take precedence over the overlay for compatibility
with an operator or embedding harness, so they must never be exposed to an untrusted agent.
Likewise, an agent that can modify its overlay can rewrite its own grant; mount it read-only
and isolate the process and other writable paths at the OS boundary when that matters.

Because grants live in the overlay, pulling substrate updates from upstream
(`garden-io update`, when it lands) never raises or lowers your autonomy, and forking
the public gardener gives you R0 until you say otherwise. Autonomy is yours to grant,
never something an update can change underneath you.
