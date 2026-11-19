# Autonomy for non-code work

These documents distill one reviewed personal-assistant deployment into reusable design
contracts. The source deployment and its identifying particulars remain private; role and
system names below are placeholders.

**Status: findings and specifications, not shipped machinery.** The incident catalog records
what happened in the source deployment. The autonomy and task documents describe how a future
integration should behave. No live task-board driver, approval queue, personal-assistant loop,
or non-code write-back implementation ships in this repository. The storage and git-driver
controls described in [`AUTONOMY.md`](../../AUTONOMY.md) do exist; they do not by themselves
implement these contracts.

## Documents

- **[Graduated autonomy](graduated-autonomy.md)** — maps research, drafting, board writes,
  outbound correspondence, spending, and scheduling onto the core autonomy dials. It separates
  reversible drafting from irreversible external action and explains why scheduling multiplies,
  rather than grants, authority.
- **[Failure modes](failure-modes.md)** — seventeen observed failures, their detection signals,
  and countermeasures. It includes absence failures: expired approvals, lost scheduled runs, and
  capabilities that disappear while the status surface still looks healthy.
- **[Non-code task contract](task-contract.md)** — a proposed task lane covering explicit
  assignment, a normative JSON-encoded untrusted-row wire format, evidence-backed plans,
  role-bound per-action approvals with loud expiry, and read-back-verified writes.

Read these alongside [`RUBRIC.md`](../../RUBRIC.md): a deterministic check can report drift, but
non-code work has no universal green build. Human-approved patterns, visible dry-run diffs,
strict reversibility, and machinery that detects absence remain necessary.

## Placeholder glossary

The roles are distinct even when one human holds more than one of them in a small deployment.

| Placeholder | Role |
|---|---|
| `{{PRINCIPAL}}` | The person whose life, calendar, correspondence, and money are at stake; authoritative on their own preferences and circle. |
| `{{OPERATOR}}` | The person who grants agent authority and owns the overlay; may or may not be the principal. |
| `{{REVIEWER}}` | A human who reviews output; not automatically an authority on the principal's facts or an approver of external actions. |
| `{{THIRD_PARTY}}` | A person the work concerns who is not in the review loop. |
| `{{BOARD}}` | A live, human-edited task surface; human-owned by default. |
| `{{VENDOR_A}}` | A business the work must transact with. |
| `{{METASEARCH}}` | An aggregator that indexes other providers. |
| `{{PROVIDER}}` | A provider that an aggregator may or may not index. |

The catalog's countermeasure statuses describe the **source deployment**, not this repository:
`applied` means a countermeasure was applied there, `practice` means it existed only as prose
guidance, and `unapplied` means it was not implemented there. They are not implementation claims
about Gardener.
