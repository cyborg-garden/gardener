# 🌱 Gardener

A portable memory and coordination substrate you hand to your agent: handoffs, knowledge, and a
task board your agent can tend. It runs on markdown and git by default and adapts to your stack.

**Early release: storage and safety primitives, not an autonomous tending service.** The CLI,
format validator, and fail-closed autonomy controls run today. A resident tending loop, rubric
runner, live-board driver, and `garden-io update` / `contribute` commands are specifications,
not shipped features.

## Run it

Requires Node.js 22 or later. No package dependencies.

```sh
npm test
npm run validate
npm run sanitize
```

Read the example board using an explicit path (the default garden is relative to your current
directory):

```sh
GARDEN_ROOT="${PWD}/garden" node bin/garden-io.js read state/threads.md
```

A write with no declared authority is refused. To try writes safely, make a scratch installation.
Set **both** `GARDEN_ROOT` and `GARDEN_OVERLAY_ROOT` to absolute paths in the same disposable
parent directory, and set `GARDEN_SYNC=off` so nothing is committed:

```sh
SCRATCH_DIR="$(mktemp -d)"
export GARDEN_ROOT="$SCRATCH_DIR/garden"
export GARDEN_OVERLAY_ROOT="$SCRATCH_DIR"
export GARDEN_SYNC=off
mkdir -p "$SCRATCH_DIR/.overlay"
```

To grant `propose` for this CLI in your scratch instance, create `.overlay/autonomy.yml` outside
the tracked `garden/` data:

```yaml
rung: R1
```

Then write through the CLI:

```sh
printf '# Board\n\n## Now\n- [ ] #first Tend the garden\n' \
  | node bin/garden-io.js write state/threads.md
node bin/garden-io.js read state/threads.md
```

Export the scratch variables again in every new shell rather than relying on an earlier
working directory or overlay location. Do not experiment against your real board. See
[`AUTONOMY.md`](AUTONOMY.md) before granting a higher rung or unattended execution.

**Caller trust boundary:** `--authority` and `GARDEN_AUTHORITY` are declarations by a trusted
operator or embedding harness, **not authenticated grants**. Anyone who can choose the process's
arguments or environment can declare a higher rung. The overlay is safe only when the agent
cannot modify it; use a read-only mount and OS-level process/filesystem isolation when exposing
this CLI to an untrusted agent. Path confinement limits this driver's filesystem reach, but does
not turn an unrestricted shell account into a sandbox.

## What is implemented vs. specified

| Area | Runs today | Still specification |
|---|---|---|
| Garden format | `SPEC.md`, example garden, `npm run validate` | Domain-specific extensions |
| Storage | `garden-io` read/write/list/index/resolve/sync; git-backed driver | `update` and `contribute` commands |
| Autonomy | R0–R4 policy primitives, per-capability grants, unconditional driver write-policy | A resident loop calling the act-gate; non-git board drivers |
| Correctness | `RUBRIC.md` check contract | Rubric runner and shipped reference checks |
| Non-code tasks | Generalized autonomy, incident, and task contracts in `docs/non-code-autonomy/` | Board integration, approval queue, and write-back machinery |
| PR triage | `stages/pr-triage/`: a verdict per open pull request, draft decisions, and an opt-in pinned merge step | Wiring into a resident loop |
| Distribution | Path ownership model and two-layer sanitize gate | Automated upstream sync and contribution commands |

## Read next

- [`SPEC.md`](SPEC.md) defines the garden format: board, decisions, handoffs, knowledge.
- [`AUTONOMY.md`](AUTONOMY.md) sets out three separable autonomy dials and rungs R0–R4. Fresh installs
  fail closed to R0 (read-only). Grants live in `.overlay/`; the git driver refuses writes that
  lack authority.
- [`DISTRIBUTION.md`](DISTRIBUTION.md) covers substrate vs. instance ownership, the manual update
  and contribution flow, and the sanitize boundary.
- [`RUBRIC.md`](RUBRIC.md) specifies deterministic, report-only checks. They are an input to
  autonomy decisions, never proof by themselves that an action is correct.
- [`docs/non-code-autonomy/`](docs/non-code-autonomy/README.md) holds design contracts distilled from
  a reviewed personal-assistant deployment: capability-specific autonomy, observed failure modes,
  and fencing untrusted task-board text. These are **findings and specifications**, not claims
  that this repository ships a personal-assistant integration.
- [`stages/pr-triage/`](stages/pr-triage/README.md) is a gardener stage you can run today: one
  verdict per open pull request, supply-chain gates on dependency bumps, and draft decisions for
  anything a person must call. It proposes; merging is a separate, opt-in, pinned step.
- `npm run sanitize` scans for credential shapes and org/person/narrative particulars. Declare your own
  particulars in `.overlay/particulars` (gitignored). Review what the gate does and does not catch
  in `DISTRIBUTION.md`; passing a scan is not a substitute for human release review.

Made by Cyborg Garden.
