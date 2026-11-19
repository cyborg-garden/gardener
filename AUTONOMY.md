# Autonomy: how much a gardener may change without asking

A gardener tends a garden. How much it may change on its own is set by a small set of
dials, and the operator turns them deliberately, one notch at a time. This document is
the contract for those dials.

It is harness-agnostic. It assumes only the garden format (`SPEC.md`) and the driver
contract (`lib/garden-io.js`). It assumes nothing about any particular runtime, memory
system, task shape, or organization. A gardener tending code and a gardener tending a
Notion life-board obey the same contract.

> **Status:** `lib/autonomy.js` enforces the contract below in code. It provides the
> act-gate (`Autonomy#canAct`), the driver write-policy (`writeAllowed`, wired into the
> git driver's `write()`), overlay reading (`loadAutonomy`, which fails closed to R0 when
> the overlay is missing or malformed), and sharp-edge grant files. The write-policy is
> **unconditional**. If it engaged only when a caller passed `authority`, the second
> enforcement layer would be opt-in per call, and a jailbroken loop is exactly the caller
> that would omit it. An absent authority resolves *down* to `observe`, which writes
> nothing, and never to "unrestricted".
> One limit remains: no tending loop ships in this repo yet, so `canAct` has no resident
> caller. The rungs bind exactly as far as your loop routes through the act-gate; the
> write-policy binds regardless.

## Principles

1. **Propose before act.** The default is to *surface* work, not do it. Acting is
   a privilege the operator grants, per capability, in writing.
2. **The operator grants; the gardener never self-grants.** Every escalation is an
   explicit, operator-created token. A gardener at rung N cannot move itself to N+1.
3. **Reversibility and legibility are preconditions for acting**, not afterthoughts.
   An action that can't be cheaply undone or clearly explained needs a higher rung
   than one that can.
4. **Climb deliberately.** A rung is earned when the one below it has proven out:
   good judgment, low noise, nothing broken. Climbing is a decision, not a drift.

## Two enforcement layers

Autonomy is enforced in two independent places, so a prompt can't talk its way past it:

- **The act-gate** (loop level): before a cycle attempts a class of action, it checks
  the granted authority for that capability. Governs *what the loop may attempt.*
- **The driver write-policy** (backend level): the storage driver refuses writes to
  human-owned regions above the granted authority. Governs *what the backend
  physically permits.*

Every driver **MUST** declare which regions are agent-owned and which are human-owned,
and enforce this independently of the loop. With two layers, a jailbroken or confused
loop still cannot mutate protected state, because the driver refuses.

For that to be true the write-policy cannot be something a caller opts into. It is
applied on **every** write:

- A **human-owned region is refused at every authority**, including when the caller
  declares none. There is no rung at which such a write is legal, so there is no
  default under which it may be performed.
- An **undeclared region** fails closed.
- For agent and proposal regions, an absent authority resolves to `observe`, the
  bottom of the ladder, which writes nothing. The caller, the driver construction, or
  `GARDEN_AUTHORITY` can declare otherwise. **Absent is not unrestricted.**

Both layers are implemented in `lib/autonomy.js`: `loadAutonomy()` resolves the
operator's overlay grants (defaulting to R0), `Autonomy#canAct()` is the act-gate,
and `writeAllowed(authority, region)` is the write-policy a driver enforces in its
`write()` via its declared `regionOf()`.

- **Git driver:** git history is reversible and the driver declares no human region,
  so once the operator has granted `propose` or above, every path it owns is writable
  and the act-gate does the interesting work. Being permissive about regions does not
  make it permissive about authority: a write must still declare one, and an
  undeclared write is refused.
  Declare it per call (`write(p, c, { authority })`), once on the driver
  (`new GardenIO({ authority })`), or via `GARDEN_AUTHORITY`; resolve it from the
  overlay with `loadAutonomy(root).authorityFor(capability)`, which fails closed to R0.
  `bin/garden-io.js` does exactly that, and accepts `--authority` to override.
- **A live, human-edited backend (e.g. Notion):** human-set fields are human-owned
  and refused above `propose`, regardless of what the loop asks. Low on the ladder,
  the only thing the gardener may write is a single agent-owned region (one "auto"
  block). This is the difference between *a gardener with a Notion driver* and
  *an agent that merely has a Notion skill*: the skill can write anything; the
  driver enforces propose-don't-clobber at the source of truth.

## The dials

Autonomy is three separable settings, not one number.

### A. Action authority (per capability)

- `observe`: read and digest only; no writes.
- `propose`: write only to proposal surfaces, which are open decisions
  (`garden/state/decisions.md`), `> reply:` notes on the board, and agent-owned
  regions. Never mutate human-owned state.
- `act:contained`: reversible, bounded changes within agent-owned regions (move an
  item it created; write its own sync block; open a draft).
- `act:broad`: wider action, such as opening a PR or tagging a release, allowed only
  where a correctness signal exists (see gating).

Authority is **per capability**, not global: a gardener may be trusted to `act:broad`
on "triage the board" while still only `propose` on "reprioritize the roadmap."

### B. Attendance

- `attended`: runs only when a human is present to see the cycle.
- `unattended`: runs on a schedule with no one watching.

Unattended is itself a rung. It multiplies the blast radius of every granted
authority, so it is granted separately and is **never implied** by action authority
alone.

### C. Sharp-edge grants

Specific high-risk capabilities, each gated by its own named token *regardless of
rung*: auto-merge, self-modification or self-tagging, and any destructive or
irreversible operation. Without its token, the capability is off even at the top of
the ladder.

## Gating a promotion (propose → act)

A capability may be promoted from `propose` to `act` only when all of these hold:

1. **Reversible:** the action can be undone cheaply (git revert; backend edit
   history; a restorable prior value).
2. **Bounded blast radius:** it touches a known, small set of things, not an
   open-ended sweep.
3. **Confined to agent-owned regions:** it does not write human-owned state.
4. **A correctness signal exists.** For non-code work, this is the deciding
   condition:
   - *Code-shaped* capabilities have a deterministic signal: tests pass, CI is green,
     the build succeeds. That signal is what makes code autonomy safe to escalate.
     Rubric checks (`RUBRIC.md`) are a further deterministic *input* here. They
     detect drift a proposed action should account for, though a quiet rubric is
     not by itself proof an action is correct.
   - *Non-code-shaped* capabilities (reprioritizing a roadmap, editing a doc, moving
     rows) have **no green build.** In place of a build they need a human-approved
     *pattern* (the operator has repeatedly accepted this exact class of proposal), a
     *dry-run diff* shown before acting, and strict reversibility. A non-code `act`
     rung is therefore defined by how reversible and how contained the action is, not
     by whether tests passed, and it is expected to climb slower.

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

**R0 · Observe is the default for any fresh install or fork**, and it is what the code
resolves to when no overlay exists (`lib/autonomy.js`, fail-closed). A gardener you
just handed to your agent is strictly read-only until your first explicit grant.
The natural first notch is R1. Proposing is safe by construction because it writes
only to proposal surfaces, never human-owned state, but even that is yours to grant,
not assumed.

## Where grants live

Grants are files the operator creates in an **overlay** the gardener reads but
upstream never ships:

- `.overlay/autonomy.yml`: the rung and any per-capability authority overrides.
- `.overlay/grants/<capability>`: one file per sharp-edge grant; the file's presence
  is the grant.

Because grants live in the overlay, pulling substrate updates from upstream
(`garden-io update`, when it lands) never raises or lowers your autonomy, and forking
the public gardener gives you R0 until you say otherwise. Autonomy is yours to grant,
never something an update can change underneath you.
