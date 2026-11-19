# Rubric: deterministic checks, the gardener's eyes

A rubric is a set of small, deterministic checks the gardener runs before it proposes
or acts. Each check reads the garden, reports findings, and **never acts**. Checks are
the eyes of the propose layer. They are a deterministic input to `AUTONOMY.md`'s
propose→act gate: they report drift a proposed action must account for, and a quiet
rubric is not by itself proof an action is correct.

This is harness-agnostic: a check is just an executable and a line of output. Nothing
here assumes any particular tracker, driver, or org.

> **Status:** this is the check contract; no rubric directory, runner, or example
> check ships in this repo yet. The contract and the three lessons below come from the
> rubric of a running instance, and are written down so an implementation lands against
> them, not after them.

## The check contract

A check is any executable that:

- reads the garden (via the driver or files) and any external source it needs;
- writes findings to stdout, one per line, as `LEVEL|check-name|message`
  (LEVEL is `WARN` or another level your loop understands);
- exits `0` whether or not it found anything, because **a finding is output, not an
  exit code** (a non-zero exit means the check itself broke, not that the garden has
  drift);
- is **pure report**: it makes no writes to the garden. The gardener, at its granted
  rung, or a human decides what to do with a finding.

Checks are drop-in by design: adding a file to the rubric directory adds a check, and
each should ship with its own test. Because a check is deterministic and
side-effect-free, it is safe to run at any autonomy rung, including R0. That is why the
propose layer can lean on it.

## Three lessons every reconcile check should obey

Each of these came from a real bug. Ignore them and a rubric reports work it never
checked, or worse, invents stale work that does not exist.

### 1. Surfacers are not reconcilers
A miner that surfaces new items answers one question: *"is this already on the board?"*
Once the answer is yes, the miner stops looking. Nothing then asks the **reverse**
question: *"is this board row still true?"* So when the underlying item is finished or
resolved somewhere else, its stale open row is unreachable by every surfacer and stays
open forever, closable only by a human who happens to notice. A healthy garden needs at
least one pass that *reconciles* existing rows against reality, not only surfaces new
ones.

### 2. Absence of signal is never a finding
A check that cannot reach its source (no auth, offline, an unresolvable reference) must
yield **nothing**, never a guess. A reconciler that fabricates drift is worse than no
reconciler: it manufactures the exact stale-work problem it exists to kill. Make the
silence *intentional* by probing auth and reachability explicitly and passing quietly,
so that "the source was unreachable" and "the garden is clean" never collapse into the
same signal.

### 3. A fixed cap without rotation is a permanent blind spot
If a check caps its work per run ("first N items") to stay polite to an API, a fixed
head-of-list cap means items `N+1..end` are **never** examined, on any run. Everything
past the cap is reported clean without being read. Rotate the window by a pure function
of the date, so each run stays bounded and reproducible while every item is reached
within `ceil(total / cap)` runs.

---

A rubric that follows the contract and these three lessons is deterministic,
report-only, and honest about what it cannot see. That is the standard it must meet
before autonomy decisions lean on it.
