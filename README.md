# 🌱 Gardener

A portable memory + coordination substrate you hand to your agent. Handoffs, knowledge, and a
task board your agent can tend — markdown + git by default, adaptable to your stack.

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

Read the example board:

```sh
node bin/garden-io.js read state/threads.md
```

A write with no grant is refused. To grant `propose` for the CLI in your own instance, create
`.overlay/autonomy.yml` (outside the tracked `garden/` data):

```yaml
rung: R1
```

Then write through the CLI:

```sh
printf '# Board\n\n## Now\n- [ ] #first Tend the garden\n' \
  | node bin/garden-io.js write state/threads.md
node bin/garden-io.js read state/threads.md
```

For a scratch installation, set `GARDEN_ROOT` to a disposable garden directory and
`GARDEN_OVERLAY_ROOT` to its parent. Do not experiment against your real board. To avoid git
commits while trying these commands, also set `GARDEN_SYNC=off`. See
[`AUTONOMY.md`](AUTONOMY.md) before granting a higher rung or unattended execution.

## What is implemented vs. specified

| Area | Runs today | Still specification |
|---|---|---|
| Garden format | `SPEC.md`, example garden, `npm run validate` | Domain-specific extensions |
| Storage | `garden-io` read/write/list/index/resolve/sync; git-backed driver | `update` and `contribute` commands |
| Autonomy | R0–R4 policy primitives, per-capability grants, unconditional driver write-policy | A resident loop calling the act-gate; non-git board drivers |
| Correctness | `RUBRIC.md` check contract | Rubric runner and shipped reference checks |
| Non-code tasks | Generalized autonomy, incident, and task contracts in `docs/non-code-autonomy/` | Board integration, approval queue, and write-back machinery |
| Distribution | Path ownership model and two-layer sanitize gate | Automated upstream sync and contribution commands |

## Read next

- [`SPEC.md`](SPEC.md) — the garden format: board, decisions, handoffs, knowledge.
- [`AUTONOMY.md`](AUTONOMY.md) — three separable autonomy dials and rungs R0–R4. Fresh installs
  fail closed to R0 (read-only). Grants live in `.overlay/`; the git driver refuses writes that
  lack authority.
- [`DISTRIBUTION.md`](DISTRIBUTION.md) — substrate vs. instance ownership, manual update and
  contribution flow, and the sanitize boundary.
- [`RUBRIC.md`](RUBRIC.md) — deterministic, report-only checks: an input to autonomy decisions,
  never proof by themselves that an action is correct.
- [`docs/non-code-autonomy/`](docs/non-code-autonomy/README.md) — design contracts distilled from
  a reviewed personal-assistant deployment: capability-specific autonomy, observed failure modes,
  and fencing untrusted task-board text. These are **findings and specifications**, not claims
  that this repository ships a personal-assistant integration.
- `npm run sanitize` — credential shapes plus org/person/narrative particulars. Declare your own
  particulars in `.overlay/particulars` (gitignored). Review what the gate does and does not catch
  in `DISTRIBUTION.md`; passing a scan is not a substitute for human release review.

Made by Cyborg Garden.
