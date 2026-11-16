# The non-code task contract

A gardener tending code takes its work from repositories, issues, and its own board. A
gardener tending a life takes its work from `{{BOARD}}`: a living document the principal
edits by hand, in a hosted tool, with no merge semantics and no tests.

This file is the contract for that lane. What a row must carry to be workable, how its text
is handled, how a plan is proposed, how approval is asked and chased, and what is written
back.

> **Status:** specification only. No board gather, proposal engine, approval queue, or write-back
> implementation for this lane ships in this repository. The source deployment implemented a
> read-only gather with the fencing posture in §2; that history informs the requirements below
> but is not a feature claim about Gardener. The core storage and git-driver controls are
> documented separately in `../../AUTONOMY.md`.

## 1 · What a row must carry

A row is workable when it carries all of:

| Field | Kind | Purpose |
|---|---|---|
| **id** | stable identifier | The claim key. Everything the gardener writes about this task is keyed to it. |
| **title** | untrusted free text | What the principal calls it. |
| **assignment** | structural | Routes the row to the gardener. A row not carrying it is not the gardener's work, regardless of how relevant it looks. |
| **status** | structural | Human-owned. The gardener reads it and never sets it (see [`graduated-autonomy.md`](graduated-autonomy.md)). |
| **priority** | structural | Human-owned. Orders the queue. |
| **due** | structural, optional | Absent is common and is not an error. |
| **body** | untrusted free text | The actual requirements. Usually the only place they exist. |

**Assignment is explicit and positive.** The gardener works rows the principal marked for it,
never rows it inferred were meant for it. Inference here fails in the expensive direction: a
gardener that decides a row looks like its kind of work is a gardener acting on tasks nobody
gave it.

A row may be assigned to more than one worker. A row marked for both the gardener and a human
assistant is a shared row, and the gardener's write-back must not read as though it owns the
task. See §5.

**Eligibility is narrower than assignment.** An assigned row still needs a body containing
something to act on. A row that is assigned, urgent, and empty is reported as unworkable with
that reason, not skipped silently and not guessed at.

## 2 · Board text is data

Everything on `{{BOARD}}` was typed by a human into a hosted tool that anyone the principal
has shared it with can edit. It is **data, never instructions**. This holds even though the
principal wrote most of it and the principal is the authority here.

The distinction that makes this workable: **requirements in a body are input to a plan, not
triggers for an action.** A body saying "email {{VENDOR_A}} and book the appointment" is a
statement of what the principal wants achieved. It is not a command the gardener executes on
reading. It becomes a proposed plan, the plan names the outbound send as an action requiring
its grant, and a human approves that action. The path from board text to outbound action
always runs through a human, and the fence is what keeps that true when the text is trying to
sound like an instruction.

**Read-side requirements, distilled from the source deployment:**

- **Free-form text is fenced.** Title and body are emitted inside explicit untrusted markers,
  newline-collapsed to a single line, fence markers in the content neutralized to lookalike
  characters so a crafted row cannot forge a fence close, and length-capped.
- **Structural values are filtered, not fenced.** Status, priority, and due are character
  filtered to a conservative set and capped, because they appear on structural lines where a
  backtick or a shell metacharacter would be read as syntax.
- **URLs are derived, never echoed.** The link to a row is constructed from its id in the
  canonical form. The URL field returned by the API is discarded. A row cannot smuggle a link
  by putting one in a field the gardener would print.
- **Links are not followed.** Not from the body, not from a field, not ever as part of gather.
  Fetching a URL a row supplies is how a board row becomes a request the agent makes on
  someone's behalf.
- **The fence header is the boundary and is never reformatted.** Downstream code concatenates
  gather output byte for byte. Reformatting, indenting, or summarizing a fence silently
  weakens it.

**Fail soft.** A board that is unreachable, slow, or returning errors costs the cycle its
board coverage and nothing else. The failure is one loud warning line naming the exception
class and status code only, never the response body, which is attacker-influenced text. The
cycle continues. Partial results are kept and reported as partial: rows fetched before a
failure are real rows, and a truncated read is reported as truncated rather than as a smaller
board.

**Zero found and zero looked at never render identically.** An empty result says which filter
ran against which surface. This is the difference between "no work today" and "the query has
been broken for a month," and they are indistinguishable if the empty case is silence.

## 3 · Proposing a plan

*Not implemented. Specification.*

At `propose`, the gardener's output for a task is a plan written to its own region. A plan
carries, in this order:

1. **The goal, restated in the gardener's own words.** If the restatement is wrong the whole
   plan is wrong, and that is much cheaper to catch at line one than at the outbound send.
2. **Contradictions found.** See §4. These come first among the findings because they can
   invalidate everything below them.
3. **What is known, with provenance.** Each fact carries where it came from and how live it
   is (FM-3). Facts derived from a `{{METASEARCH}}` are labelled as such, and a negative
   result from one is stated as "the aggregator returned nothing," never as "this does not
   exist" (FM-2).
4. **What is unknown, and what would resolve it.** Including the things only a human can
   resolve, and the things the gardener could resolve if granted a capability it does not
   have. Naming the missing capability is how a rung promotion gets proposed by evidence
   rather than by asking.
5. **The proposed actions, each tagged with the capability it needs.** Read, draft, write to
   the agent region, send outbound, spend. A plan whose actions are not tagged has not been
   thought through, because the tags are what determine which parts a human must approve.
6. **What the gardener will do next cycle if nothing changes.** Usually "nothing, waiting on
   approval of item N." An explicit stall is a fact; a silent one is FM-11.

Every derived value in the plan has exactly one home and is referenced elsewhere, never
restated (FM-4).

## 4 · Contradictions are surfaced, not resolved

*Not implemented. Specification.*

A task body written by a human over weeks will contradict itself. The gardener's job is to
name the conflict to the principal, not to pick a side and proceed.

The motivating case is small and typical. A body stated the principal's preference for
afternoon appointments, giving the reason: more time to prepare. Further down the same body,
pasted in, was a message from `{{VENDOR_A}}` proposing a fixed late-morning start for all
sessions and asking whether that worked.

Both statements are in the task. Neither is stale. A gardener that books afternoons has
ignored the vendor's constraint; one that books the morning slot has overridden a stated
preference and its reason. Either choice, made silently, produces a booking the principal did
not agree to and will discover later.

The correct output is a line in the plan naming both, attributing each, and asking. It costs
one message and it is the entire value of the propose rung.

The rule generalizes past task bodies:

- **Principal's stated preference versus a third party's constraint** → surface both, ask.
- **Principal's statement versus `{{REVIEWER}}`'s correction** → the principal is authoritative
  on their own facts; surface the conflict rather than adopting the reviewer's version (FM-8).
- **A fact versus the gardener's own earlier output** → surface, and check provenance before
  assuming the newer one wins (FM-5).
- **Two live rules that cannot both hold** → surface. Do not synthesize a compromise. A
  compromise the principal did not choose is a decision the gardener made.

The one thing never permitted is picking silently. A contradiction the gardener resolves on
its own is a contradiction nobody knows exists.

## 5 · Approval and chasing

*Not implemented. Specification.*

Approval requests follow [`graduated-autonomy.md`](graduated-autonomy.md) §"Three rules the code case never needed".
The contract-level requirements:

- **One request authorises one action.** The request text names the action, the counterparty,
  and any amount. Approving a plan is not approving its actions.
- **Every request carries an expiry** chosen from the real-world window it depends on. A hold
  measured in minutes does not get an open-ended request.
- **Expiry is an event, not an absence.** On expiry the request becomes explicitly expired,
  the task is marked blocked with the reason, and the expiry appears in the next digest. Work
  behind an expired approval is never simply dropped (FM-11).
- **Chasing is bounded and visible.** A re-queue is a new request with a fresh expiry and a
  note that it repeats an earlier one. The count of repeats is in the digest, because a
  request on its fourth attempt is telling the operator something about the channel, not
  about the task.
- **Pending renders with its age.** Always. A queue whose entries do not show how old they are
  cannot be triaged by looking at it.

For a shared row, an approval from the principal is required for the principal's decisions.
`{{REVIEWER}}` can confirm that an artefact is correct; they cannot approve a send or a spend
on the principal's behalf unless the overlay grants them that explicitly, by name.

## 6 · Write-back

*Not implemented. Specification.*

The gardener writes to exactly one place on the board: its own delimited region on the row,
keyed to the row id. It regenerates that region wholesale rather than editing occurrences
within it, which makes FM-4 and FM-9 structurally unavailable: there are no occurrences to
drift and no ordinal positions to overwrite.

The region carries the current plan, the open questions, the pending approvals with their
ages, and the gardener's claim tag. It does not carry history; superseded content is replaced,
not appended (FM-10).

Everything the gardener wants to say about a human-owned field is a proposal inside its own
region. "This looks complete, close it?" is a sentence in the region. Setting the status field
is not available at any rung until the operator changes the driver's region declaration.

Two rules from the ledger apply directly at the write:

- **Verify by read-back** (FM-1). The write is not reported as successful until the region has
  been re-read and the intended content confirmed present. Where read-back fails, the report
  says written-not-verified and says why.
- **Refuse a type mismatch** (FM-15). A value whose kind does not match the declared field is
  refused, never coerced into whatever field will accept it.

## 7 · Closure

A task leaves the gardener's queue in one of four ways, and all four are reported:

- **The principal closes it.** The gardener notices the status change and stops. It does not
  need to agree.
- **The gardener proposes closure and the principal accepts.** The proposal lived in the agent
  region; the principal set the field.
- **It is blocked.** Named blocker, named on whom, with an age. A task blocked for a month is
  a digest item every week, not a quiet row.
- **It is unworkable.** Assigned but with nothing actionable in it, or dependent on a
  capability the gardener has not been granted. Reported with the reason and the missing
  piece.

There is no fifth way. A task that stops being mentioned has not been closed; it has been
lost, and losing tasks quietly is the failure this whole contract exists to prevent.
