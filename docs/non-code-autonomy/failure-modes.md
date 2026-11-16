# Failure modes of a personal-assistant agent

A catalog derived from one long-running deployment's verified incident ledger: a personal
agent doing multi-leg travel research, correspondence drafting, and task-board maintenance
for a single principal, with a human reviewer reading its output daily over roughly six
weeks of concentrated work.

Every mode below happened. None is hypothetical, and none is a lint rule dressed up as a
finding. Particulars are replaced using the glossary in `README.md`.

> **Scope:** statuses in this catalog describe the source deployment, not this repository.

> **Status:** this is a catalog, not a test suite. Of the countermeasures listed, a small
> number were actually applied to the deployment (marked **applied**), a larger number were
> written into the agent's own memory as practice and therefore hold only as well as prose
> holds (**practice**), and the rest were never applied at all (**unapplied**). The honest
> reading of this document is that naming a failure is the cheap half.

## Two things visible only in aggregate

**Detection was human, almost without exception.** Of the reasoning failures in §1, one was
self-caught. The rest were caught by `{{REVIEWER}}` reading the output and noticing that it
did not add up. No automated check caught any of them, because the agent's outputs were
prose and documents, and nothing in the loop read prose adversarially. A code-shaped agent
has a build that goes red. This one had a person, and when the person was busy the failures
shipped.

**Corrections landed as data edits, not as checks.** Nearly every fix in this ledger was a
correction to the artefact that was wrong: the count restated, the page rewritten, the line
amended. Only the transport-layer bugs (FM-13) produced code that would catch the next
instance. This is the ledger's own bias and it is worth naming, because a catalog of
failures whose fixes are all data edits is a catalog that will grow at the same rate next
month.

---

## §1 Reasoning and reporting failures

### FM-1 · Fabricated-fix report

**Shape.** The agent performs a write, the write does not take effect (or takes effect
malformed), and the agent reports success without re-reading. The report is confident and
specific. The failure surfaces later, at a moment chosen by the artefact rather than by
anyone watching.

In the recorded instance the agent had already been told once that a link it wrote was
dead, fixed it, and reported the fix. The second read-back showed the link was still dead.
The agent's own words on being pushed: it had misreported the fix as complete.

**Detection signal.** A second human read of the same artefact. Nothing else. A first read
confirms the *report*, not the artefact.

**Countermeasure.** **Verify by read-back.** No write may be reported as successful on the
strength of the write call returning. The agent re-reads the written region and asserts the
intended value is present before any claim of success reaches a human. Where read-back is
impossible, the report says "written, not verified" and says why.

This is the single highest-value countermeasure in the catalog, because a fabricated-fix
report poisons every downstream decision made in reliance on it, and because it is cheap:
one extra read per write.

**Status:** practice.

### FM-2 · Strong negative from a weak source

**Shape.** The agent needs to know whether something exists in the world. It queries a
`{{METASEARCH}}`, gets nothing, and concludes the thing does not exist. The aggregator's
silence was not evidence of absence; the aggregator simply does not index that
`{{PROVIDER}}`. A whole plan is then built around an unnecessary constraint.

In the recorded instance the conclusion was baked into a durable knowledge file and shaped
the itinerary for days. The `{{PROVIDER}}` in question ran the route, on a schedule that
suited the dates, and its own site was hostile to automated reading, which is precisely why
no automated pass found it.

**Detection signal.** `{{REVIEWER}}` opened the `{{PROVIDER}}`'s own site by hand.

**Countermeasure.** **A negative claim about the world requires a primary source.** An
aggregator returning no results establishes only that the aggregator returned no results,
and that fact must be reported in exactly those words. Escalate to the primary source, and
when the primary source is unreachable by the agent, escalate to a human rather than
converting "could not check" into "does not exist."

Corollary: aggregator coverage gaps are a known, enumerable class. Where an instance has
learned specific gaps, they belong in the instance overlay as a lookup, not in a public
artefact.

**Status:** practice.

### FM-3 · Teaser figure quoted as a live quote

**Shape.** A promotional or indicative figure scraped from a marketing surface is carried
into a plan as though it were an obtainable quote. Everything downstream inherits a number
that was never available.

**Detection signal.** `{{REVIEWER}}` recognised the figure's provenance and said plainly
that it was not indicative of a real transaction.

**Countermeasure.** Every figure carries its provenance and its liveness: quoted from a
promotional surface, observed in a configured cart, or confirmed at point of transaction.
These are three different kinds of number and may never be substituted for one another. A
plan built on the first kind says so at the top.

**Status:** practice.

### FM-4 · Derived-value drift

**Shape.** A value derived once (a count, a duration, a total) is restated in many places
across a long document. The source changes, or the original derivation was wrong, and the
restatements diverge. The document now asserts several mutually exclusive things with equal
confidence.

Three recorded instances. A headcount was wrong in eleven separate locations after one
double-counting error. A duration was wrong in five locations because a checkout date was
read as a departure date. A non-numeric particular, a person's name, was misspelled once and
propagated throughout.

**Detection signal.** `{{REVIEWER}}` counted the names by hand and got a different number
than the header claimed. In the duration case, `{{REVIEWER}}` re-derived from the dates.

**Countermeasure.** **Any derived value has exactly one home.** State it once, reference it
everywhere else, and never restate it. Where the substrate cannot express a reference,
regenerate the whole region from the source rather than editing occurrences. Treat
"occurrences of a number I need to update" as a defect in the document's structure, not a
chore.

The non-numeric variant has the same fix: a particular that appears N times is a particular
that will be wrong in N-1 places eventually.

**Status:** unapplied.

### FM-5 · Self-contradicting sourcing story

**Shape.** Asked how it knows something, the agent produces an explanation that contradicts
its own earlier work. In the recorded instance it explained that a `{{PROVIDER}}` was absent
from a `{{METASEARCH}}` because of the provider's category, while the original data about
that provider had come from a subagent citing that very `{{METASEARCH}}`.

Both statements were confident. The agent was not lying; it had two passes of work in
context and no mechanism that required them to be consistent with each other.

**Detection signal.** `{{REVIEWER}}` remembered the earlier pass. The agent had it in
context and did not.

**Countermeasure.** Provenance is recorded at acquisition, attached to the datum, and
retrieved with it. An account of how something is known is generated from those records, not
reconstructed from plausibility. When no record exists, the answer is "I do not have the
provenance for this," which is a real and acceptable answer.

**Status:** unapplied.

### FM-6 · Understated human handoff cost

**Shape.** The agent hands work back to a human and estimates the cost of that work at a
fraction of its real size. The human accepts the framing, starts, and discovers the true
scope. Trust in every subsequent estimate degrades.

**Detection signal.** `{{REVIEWER}}` pushed back on the estimate before starting.

**Countermeasure.** A handoff enumerates the steps it is asking for. An estimate that is not
backed by an enumeration is not offered. Where the agent has not itself traversed the flow it
is handing over, it says the estimate is unverified.

There is a self-serving gradient here worth naming: understating handoff cost makes the
agent's own plan look better. A countermeasure that relies on the agent's judgment about its
own convenience is weak by construction, which is why the enumeration is the requirement
rather than the estimate.

**Status:** practice.

### FM-7 · Mirrored misgendering

**Shape.** The agent adopts a third party's pronoun usage for a person, in preference to the
principal's own consistent usage for that same person. In the recorded instance
`{{PRINCIPAL}}` referred to `{{THIRD_PARTY}}` with they/them across many messages;
`{{REVIEWER}}` used she/her; the agent mirrored `{{REVIEWER}}` and carried she/her into
written deliverables. No correction appears anywhere in the record.

**Detection signal.** None fired. This was found later by an audit reading the transcript for
other reasons.

**Countermeasure.** Three rules, in order:

1. **The principal's usage for a person wins** over any other speaker's, including a
   reviewer's, and including the agent's own earlier output.
2. **Where usage is unstated, use they/them.** A name is not evidence of pronouns and must
   never be used to infer them.
3. **A pronoun error is a correctness defect, not a style preference.** It misgenders a real
   person in a way no neutral default does. It belongs in the same class as a wrong date, and
   it is checkable: a review pass over any deliverable naming a person can compare pronoun
   usage against the principal's recorded usage for that person.

This is the highest-stakes instance of FM-8. It is listed separately because the general
rule about source authority is not sufficient here: someone gets misgendered while the
general rule is being reasoned about, and the specific rule is short enough to just follow.

**Status:** unapplied.

### FM-8 · Authority laundering through a reviewer

**Shape.** `{{REVIEWER}}` reads and corrects the agent's work, so the agent begins treating
`{{REVIEWER}}` as authoritative on everything, including facts that belong to
`{{PRINCIPAL}}`: preferences, relationships, facts about `{{PRINCIPAL}}`'s circle,
tolerances, and what `{{PRINCIPAL}}` would actually want.

A reviewer's authority is real but narrow. They are authoritative on whether the artefact is
internally consistent and whether it matches what was asked. They are not authoritative on
the principal's own facts, and they will sometimes be confidently wrong about them in a way
the principal never would be.

**Detection signal.** None. Visible only in audit, and only when the principal's own record
is read alongside the reviewer's corrections.

**Countermeasure.** Keep the roles separate in the agent's model of the world and in its
memory. Record who asserted each fact. When a reviewer's assertion conflicts with the
principal's recorded usage or preference, the conflict is surfaced to the principal rather
than silently resolved in either direction. See [`task-contract.md`](task-contract.md) §Contradictions.

**Status:** unapplied.

### FM-9 · Destructive in-place edit

**Shape.** Editing a long shared document by position rather than by anchor, the agent
overwrites a region it did not intend to touch. In the recorded instance the document's
opening block, a human-authored orientation note, was overwritten mid-edit.

**Detection signal.** Self-caught, on this occasion, and restored. Nothing guaranteed that.

**Countermeasure.** Writes to a human-owned document are anchored to stable identifiers, never
to ordinal position. Read the target region immediately before writing it, and refuse the
write if what is there is not what was expected. This is the document-substrate form of the
general rule that human-owned regions are refused above `propose`; see
[`graduated-autonomy.md`](graduated-autonomy.md).

**Status:** unapplied.

### FM-10 · Superseded content left live

**Shape.** A long-lived work surface accumulates. Current plans, abandoned plans, and open
questions sit at the same visual level with no marker distinguishing them. The document grows
monotonically because appending is safe and deleting feels risky. Eventually no reader can
tell which parts are true, and a duplicated item can sit in a list of blockers unnoticed.

**Detection signal.** `{{REVIEWER}}` could not act on the document. That is the signal: not an
error, but a human stopping because they cannot tell what is current.

**Countermeasure.** A living work surface needs exactly one current-state region, regenerated
in place, with history moved below a marked boundary rather than interleaved. Superseded
content is either deleted or explicitly struck; it is never merely older. If the agent cannot
tell whether a section is current, that is itself reportable.

**Status:** applied for the one document (restructured), unapplied as a contract.

---

## §2 Operational and lifecycle failures

These are the more expensive half, and the half with almost no countermeasures applied. They
share a shape: **the system's own status reporting said everything was fine.**

### FM-11 · Approval request that expires into silence

**Shape.** The agent reaches a step it may not take alone, so it escalates to a human with a
time-boxed request: approve this, paste this code, complete this payment. The human does not
answer in time. The request's timeout passes. Nothing happens. The entry stays in the queue
marked pending, indistinguishable from a request made a minute ago, and the work behind it is
abandoned without anyone deciding to abandon it.

Two such entries sat pending for weeks past their timeouts in the recorded deployment. One
was a re-authentication code request for a credential the agent needed to do half its job.
The other was a hand-off to complete a small refundable deposit on a time-limited hold; the
hold was measured in minutes, the entry sat for weeks, and the booking was simply lost.

This is the most expensive mode in the catalog. It converts "the agent needs permission" into
"the work silently did not happen," which is exactly the outcome graduated autonomy exists to
prevent.

**Detection signal.** None fired. Found by an audit reading the queue file directly.

**Countermeasure.** An expired approval **fails loudly**. On expiry the request transitions
to an explicit expired state, the dependent work is marked blocked with the reason, and the
expiry is reported on the next digest as a first-class item rather than as an absence. A
request the agent still needs is re-queued with a fresh expiry and a note that it is a repeat.
The queue is read by something on every cycle; a queue nothing reads is not a queue.

Two supporting rules: pending state must carry its own age in any rendering, and a timeout
must be a single configured value rather than several values recorded in different places.

**Status:** unapplied.

### FM-12 · Silent capability loss

**Shape.** A named skill or capability the agent's configuration depends on disappears from
disk. The runtime notices and warns on every run: skill not found, skipped. The warning is
then resolved by removing the reference rather than restoring the capability. The warning
stops. The degradation does not.

Downstream, the agent needed the capability anyway, so it improvised: it wrote throwaway
clients against the target API at runtime, on whatever API version it happened to reach for,
including a version the missing skill existed specifically to steer it away from. Nothing
bound the work to a reviewed implementation, so there was no version to be on, only whatever
was improvised that morning.

**Detection signal.** The runtime's own warning, for seven runs, and then nothing at all.

**Countermeasure.** Two parts, and the second is the important one:

1. A configuration referencing a capability that does not exist is a hard failure at load,
   not a warning at use.
2. **Silencing a warning is not resolving it.** Removing the reference that generates a
   warning, without restoring the capability, is a change that makes the system less
   observable and no more correct. Where a capability is genuinely no longer needed, the
   change removes the *dependency*, and says so.

Corollary: if a duty can be performed by improvisation, it will be, whenever the reviewed
path is unavailable. Bind duties to committed implementations so that the improvised path is
a visible fallback rather than the silent default.

**Status:** unapplied.

### FM-13 · Silent scheduled-run loss

**Shape.** A scheduled job is configured to run on a cadence. Some fires produce no output,
no execution record, and no error. Others fail outright and the failure is not retained,
because the status field returns to its healthy value after the next run. The job's own
record therefore reports health at all times, including across a multi-day outage caused by
an unpaid upstream bill.

The only witness to what actually happened was a directory of rendered output that nothing
reconciled against the schedule. Reconciling it by hand found two fires that had vanished
without any trace at all and five that had failed while the status said otherwise.

**Detection signal.** None fired. Found by counting expected fires against produced outputs
during an audit.

**Countermeasure.** **Expected fires versus produced outputs, checked on a cadence.** This is
about ten lines of work and would have caught every instance. Status fields that return to
healthy must be accompanied by a retained failure history; a status that cannot express "has
failed recently" is not a status.

Related and worth stating separately: a configured restraint with a zero firing rate is not
evidence of good behavior. The deployment's quiet-day opt-out appeared in the instructions
for every run and in the output of none, over forty-five runs. Either the condition never
occurred, which is itself surprising and worth knowing, or the restraint does not work. Both
readings demand a look; neither is satisfied by the restraint being written down.

**Status:** unapplied.

### FM-14 · Transport silence

**Shape.** Messages the agent believes it sent do not arrive. There is no error at the send
site, so the agent's record shows a delivered message and the human's device shows nothing.
The agent then reasons on the assumption that the human has the information.

**Detection signal.** The human said they had received nothing. Four consecutive sends were
lost before that happened.

**Countermeasure.** A send is not complete until the transport confirms it, and a send the
transport cannot confirm is reported as unconfirmed rather than as sent. This is FM-1 at the
transport layer, and the same rule applies: the call returning is not the outcome.

**Status:** **applied.** This is the only cluster in the ledger that produced merged code
fixes, which is consistent with it being the only one whose symptom was visible to the human
as an absence they noticed.

### FM-15 · Wrong-field write

**Shape.** A value is written into a semantically different field because that field was
reachable and the correct one was not, or because the two were confused. In the recorded
instance priority values were written into a status field while a separate priority field
existed alongside it, corrupting both fields' meaning for anything reading them later.

**Detection signal.** None fired. Found in audit.

**Countermeasure.** A driver declares the fields it may write and what each means. A write to
a field whose declared type does not match the value is refused, not coerced. See
[`task-contract.md`](task-contract.md) §Write-back.

**Status:** unapplied.

### FM-16 · Working state on a disposable substrate

**Shape.** The agent accumulates working files inside a container or workspace that routine
maintenance recreates. A scheduled fleet rebuild destroys the working state of an in-flight
task. Nothing was corrupted and no alarm fired, because from the platform's point of view
nothing was lost.

**Detection signal.** None. Noticed afterwards, as absence.

**Countermeasure.** Distinguish durable state from scratch explicitly, and place durable
state where the rebuild does not reach. Where scratch must survive a task, promote it to
durable at a checkpoint rather than hoping. A task in flight across a maintenance window
should be resumable from its durable record alone.

**Status:** unapplied.

### FM-17 · Unreviewed artefact in a delivery

**Shape.** A large incidental file produced during the work is included in a delivery that is
otherwise reviewable. In the recorded instance a multi-hundred-line captured accessibility
tree from a booking flow shipped at the root of a pull request, which correctly failed
automatic merge and then sat unresolved for weeks.

**Detection signal.** An automated merge gate refused it. This is one of the few automatic
detections in the whole catalog, and it worked.

**Countermeasure.** The delivery gate is doing its job; the follow-through is what failed. A
refused delivery needs an owner and an age, or it becomes a permanent open item. See FM-11:
this is the same shape, applied to a delivery rather than an approval.

**Status:** detection applied, follow-through unapplied.

---

## Using this catalog

The modes are stable identifiers. Cite them as `FM-n` in reviews, in board rows, and in
handoffs, so that "this is FM-1 again" is a sentence that carries its own countermeasure.

When adding a mode, require the same three things every entry here has: a real instance, the
signal that actually caught it, and a countermeasure that would catch the next one rather
than repair the last one. An entry whose countermeasure is "be more careful" is not an entry.
