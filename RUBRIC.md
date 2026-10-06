# Rubric — deterministic checks, the gardener's eyes

A rubric is a set of small, deterministic checks the gardener runs before it proposes
or acts. Each check reads the garden, reports findings, and **never acts**. Checks are
the eyes of the propose layer — a deterministic input to `AUTONOMY.md`'s propose→act
gate (drift a proposed action must account for; a quiet rubric is not by itself proof
an action is correct).

This is harness-agnostic: a check is just an executable and a line of output. Nothing
here assumes any particular tracker, driver, or org.

> **Status:** this is the check contract; no rubric directory, runner, or example
> check ships in this repo yet. The contract and the three lessons below come from a
> running instance's rubric and are written down so an implementation lands against
> them, not after them.

## The check contract

A check is any executable that:

- reads the garden (via the driver or files) and any external source it needs;
- writes findings to stdout, one per line, as `LEVEL|check-name|message`
  (LEVEL is `WARN` or another level your loop understands);
- exits `0` whether or not it found anything — **a finding is output, not an exit
  code** (a non-zero exit means the check itself broke, not that the garden has drift);
- is **pure report**: it makes no writes to the garden. The gardener, at its granted
  rung, or a human decides what to do with a finding.

Checks are drop-in by design: adding a file to the rubric directory adds a check, and
each should ship with its own test. Because a check is deterministic and
side-effect-free, it is safe to run at any autonomy rung — including R0 — which is
exactly why the propose layer can lean on it.

## Three lessons every reconcile check should obey

These are paid for in real bugs. Ignore them and a rubric becomes theatre — or worse, a
fabricator of false work.

### 1. Surfacers are not reconcilers
A miner that surfaces new items answers one question: *"is this already on the board?"*
— and once it is, the miner stops looking. Nothing then asks the **reverse** question:
*"is this board row still true?"* So when the underlying item is finished or resolved
somewhere else, its stale-open row becomes unreachable by every surfacer and rots
forever — closable only by a human happening to notice. A healthy garden needs at least
one pass that *reconciles* existing rows against reality, not only surfaces new ones.

### 2. Absence of signal is never a finding
A check that cannot reach its source — no auth, offline, an unresolvable reference —
must yield **nothing**, never a guess. A reconciler that fabricates drift is worse than
no reconciler: it manufactures the exact stale-work problem it exists to kill. Make the
silence *intentional* — probe auth and reachability explicitly and pass quietly — rather
than incidental, so "the source was unreachable" and "the garden is clean" never
collapse into the same signal.

### 3. A fixed cap without rotation is a permanent blind spot
If a check caps its work per run ("first N items") to stay polite to an API, a fixed
head-of-list cap means items `N+1..end` are **never** examined — on any run, forever. A
cap alone turns a check into theatre for everything past the cap. Rotate the window by a
pure function of the date, so each run stays bounded and reproducible while every item is
reached within `ceil(total / cap)` runs. Bounded, reproducible, and starves nothing.

---

Together these make the rubric trustworthy enough to gate autonomy on: deterministic,
report-only, honest about what it cannot see, and blind to nothing.
