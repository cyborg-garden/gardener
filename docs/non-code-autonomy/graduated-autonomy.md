# Graduated autonomy for non-code work

[`AUTONOMY.md`](../../AUTONOMY.md) states the contract: three separable dials (action authority per capability,
attendance, sharp-edge grants), a five-rung preset ladder from `R0 · Observe` to
`R4 · Act (broad)`, operator-created grants living in an overlay upstream never ships, and
two independent enforcement layers so that a jailbroken loop still cannot mutate protected
state.

That document says a gardener tending a life-board obeys the same contract as one tending
code, and it is right, but it leaves the life-board column empty. This file fills it in: the
concrete capabilities of assistant work, where each sits on the ladder, and what evidence
moves one up a notch.

> **Status:** specification only. This repository implements the core autonomy primitives and
> git-driver write-policy, but no live human-edited board driver exists here. The region
> declarations and capability mappings below are requirements for such a driver, not a
> description of shipped machinery. Read the rung column as "where the operator should start,"
> not "where this repository will hold it."

## Why this domain is harder than code

[`AUTONOMY.md`](../../AUTONOMY.md) §"Gating a promotion" names the crux directly: code-shaped capabilities have a
deterministic correctness signal, and non-code-shaped ones do not. There is no green build
for "researched the right flights" or "drafted the right email." The substitutes it offers
are a human-approved pattern, a dry-run diff, and strict reversibility.

Assistant work strains that further in three ways the code case does not:

1. **The actions reach outside the system.** A git commit is reversible inside a repository.
   An email is received. A booking is charged. A message to a third party has been read. The
   reversibility precondition is not satisfiable for a whole class of the work, which means
   those capabilities do not climb the ladder at all; they stay behind per-action approval
   and get *faster*, not *unattended*. That distinction is the core of this document.
2. **The source of truth is a human's living document,** edited by the human, in a substrate
   with no merge semantics. The write-policy matters more here than in git, where history
   makes almost everything recoverable.
3. **Failures are absences.** [`failure-modes.md`](failure-modes.md) §2 catalogs the expensive half: approvals
   that expire into silence, capabilities that vanish, scheduled runs that do not happen. A
   correctness signal that only looks at what the agent *did* cannot see any of them.

## The capability table

Authority is per capability. The rung column is the recommended starting authority for a
fresh instance, not a ceiling.

| Capability | What it covers | Start at | Ceiling |
|---|---|---|---|
| `research:public` | Reading public sources, aggregators, vendor sites | `observe` | `observe` |
| `research:principal` | Reading the principal's own mail, calendar, files, board | `observe` + scope grant | `observe` + scope grant |
| `draft` | Producing a message, plan, or itinerary for review. No send. | `propose` | `act:contained` |
| `board:agent-region` | Writing the agent's own block on `{{BOARD}}` | `propose` | `act:contained` |
| `board:human-field` | Changing a field the principal set | `propose` | `propose` |
| `correspond:outbound` | Sending anything to anyone who is not the principal | sharp-edge grant | sharp-edge grant |
| `transact:spend` | Committing money, including holds and deposits | sharp-edge grant | sharp-edge grant |
| `schedule` | Creating a recurring or deferred action | inherits, see below | inherits |

### `research:public` stays at `observe`

There is nothing above `observe` for reading. It is listed because the *quality* rules that
apply to it are load-bearing even though the authority never changes: a negative result from
an aggregator is not a negative result about the world (FM-2), and a figure carries its
provenance and liveness (FM-3). Reading badly is how most of the reasoning failures in this
catalog started.

### `research:principal` is an authority *and* a scope

Reading the principal's correspondence is `observe` authority and therefore writes nothing,
but it is not therefore free. The grant names which corpora are in scope: this calendar, this
label, this folder. A capability that can read everything the principal can read is a
capability whose blast radius is the principal's whole life, and it should be enumerated for
the same reason a sharp edge is.

Scope is an overlay value, not a runtime argument.

### `draft` climbs, and that is where the value is

`propose` is the natural home for drafting: the output is written to a proposal surface and a
human decides. It climbs to `act:contained` only in the sense of the agent placing the draft
somewhere itself rather than handing it over, which is contained and reversible. The draft
being *sent* is a different capability entirely and never rides on this one.

The promotion evidence here is the human-approved pattern: `{{OPERATOR}}` has repeatedly
accepted drafts of this exact class, unedited. "Unedited" is the measurable part. A draft
class that is always accepted after edits has not proven out; it has proven that the human is
willing to fix it.

### `board:agent-region` and `board:human-field` are different capabilities

This is the sharpest specification in this file, and it is where a board driver earns its
existence.

A driver for a live, human-edited board **must** declare its region split and enforce it
independently of the loop, per [`AUTONOMY.md`](../../AUTONOMY.md) §"Two enforcement layers". The recommended
split:

- **Agent-owned:** one clearly delimited block per row, written and regenerated only by the
  gardener. Everything the agent has to say about a task lives here: its plan, its findings,
  its open questions, its claim tag. This region is `act:contained` once granted, because it
  is bounded and the agent is the only writer.
- **Human-owned:** every field the principal sets. Title, status, priority, due date,
  assignment, and the body they wrote. Per the contract, a human-owned region is **refused at
  every authority**, including when no authority is declared. There is no rung at which the
  gardener may set the principal's status field.

The natural objection is that write-back of status is useful, and it is. The answer is that
making a field agent-writable is a change the **operator** makes to the driver's region
declaration, deliberately, per field. It is not an authority the loop can request and not
something a rung promotion confers. The distinction matters because it is the difference
between an operator deciding the agent may close tasks and an agent talking its way into
closing tasks.

Until that declaration changes, the gardener's way of saying "this looks done" is a proposal
in its own region.

### `correspond:outbound` and `transact:spend` never become rungs

Both are sharp-edge grants under [`AUTONOMY.md`](../../AUTONOMY.md) §C: gated by their own named token regardless
of rung, off by default even at the top of the ladder. Neither becomes unattended, because
neither is reversible, and reversibility is a precondition of the promotion gate rather than
a nice-to-have.

What *does* graduate is the friction, along this path:

1. **Draft, human sends.** The agent produces the message; a human copies it out and sends it
   from their own account. The agent has no send capability at all.
2. **Draft, human approves, agent sends.** The agent holds the send capability and uses it
   only on a specific approved message to a specific recipient. One approval authorises one
   send. This is the first rung at which the token exists.
3. **Standing approval for a narrow class.** A named recipient and a named message class the
   operator has approved repeatedly, with every send still reported. For example: replies
   chasing a response on a thread the principal already approved opening. The class is
   enumerated in the grant, not inferred by the agent.

There is no step four in the near term. `transact:spend` does not get step three at all: every
transaction is approved individually, with the amount and the counterparty in the approval
text, because the failure mode of a mis-scoped standing approval is unbounded.

### `schedule` inherits

**A scheduled action carries the grant of the action it performs, plus `unattended`.**

Scheduling is not a capability with its own risk profile; it is a multiplier on whatever it
schedules. A cron that reads is `observe` and needs `unattended`. A cron that chases an email
reply is `correspond:outbound` and needs that token *and* `unattended`, which per
[`AUTONOMY.md`](../../AUTONOMY.md) is never implied by action authority alone and must be granted separately.

The practical consequence: "set up a job to check for responses and follow up" is two grants,
not one, and the follow-up half is the sharp edge. A useful decomposition is to schedule the
`observe` half freely and have it escalate, so the recurring job watches for the reply and the
sending stays per-action.

## Three rules the code case never needed

### 1. The approval channel is part of the grant

A grant that says "the agent may send after approval" is incomplete until it says **where
approval is asked and what counts as approval.** The channel is part of the security boundary,
not a delivery detail:

- Approval is requested and given on a channel the operator named in the overlay.
- An approval arriving on any other channel is not an approval.
- The identity of the approver is checked, not assumed from the channel. A group channel
  contains people who are not the operator. A deployment in this ledger ran with its
  assistant answering any member of any group it had joined, which means an approval prompt
  posted to a group was answerable by anyone in it.
- The approval text names the specific action, including the counterparty and any amount. An
  approval of a plan is not an approval of the actions in it.

### 2. An expired approval must fail loudly

This follows from FM-11, the most expensive mode in the catalog. Requests that time out into
an indistinguishable pending state converted "needs permission" into "silently did not
happen," and lost real work.

The rule: on expiry the request transitions to an explicit expired state, the dependent work
is marked blocked with the reason, and the expiry appears in the next digest as an item.
Re-queuing is a decision, made visibly, with a fresh expiry. Nothing about an approval is
allowed to be an absence.

A queue nothing reads on a cadence is not a queue, and pending state must render with its own
age.

### 3. A grant the agent can write is not a grant

[`AUTONOMY.md`](../../AUTONOMY.md) §"Where grants live" puts grants in an overlay for a reason that generalizes
past updates: **the file governing what the agent may do must not be writable by the agent.**

In the deployment behind this catalog the agent's operating instructions and its autonomy
language lived in its own memory store, on a read-write mount, with self-directed memory
writing enabled and no deny rule covering that path. It never abused this. That is not the
point; the point is that the arrangement made the grant advisory.

Two consequences worth stating plainly:

- Autonomy language belongs in the overlay, mounted read-only to the agent, separate from any
  memory the agent maintains about itself.
- Prose autonomy is not a grant even when it is unwritable. The same deployment's memory held
  "board updates: just do, no need to ask" three sentences from "never take external actions
  without explicit permission, this is a hard rule," with a board update being an external
  action. Both clauses were live simultaneously. Per-capability grants exist precisely because
  prose contradicts itself and a table cannot.

## Promoting a capability

[`AUTONOMY.md`](../../AUTONOMY.md)'s gate holds unchanged: reversible, bounded, confined to agent-owned regions,
and a correctness signal. For this domain, add one requirement to the substituted non-code
signal:

**The countermeasure for the relevant failure mode is in place as machinery, not as prose.**

A capability that writes may not be promoted while FM-1's read-back verification is a practice
rather than a check. A capability that escalates may not be promoted while FM-11's expiry
handling is unimplemented. A scheduled capability may not be granted `unattended` while
FM-13's expected-versus-produced reconciliation does not exist, because unattended is exactly
the condition under which a silent run loss goes unseen.

This is the honest version of "climb deliberately." The ladder in this domain is not gated on
the agent behaving well for long enough. It is gated on the operator building the thing that
would notice if it did not.
