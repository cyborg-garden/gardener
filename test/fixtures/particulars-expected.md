# Inverted fixture — this file MUST be flagged

Everything below is SYNTHETIC. It exists so the particulars layer has one real file, in
the tracked tree, that exercises every structural rule end to end — and so that gutting
those rules turns the gate RED instead of quietly green.

This file is listed in `expect_findings` in `sanitize.particulars.json`. That listing is
an inversion, not a skip: its findings do not fail the gate, and its **silence** does. If
a rule stops firing, this file goes quiet and `npm run sanitize` exits 1 pointing here.

It is not a place to hide anything. It is read on every scan, it is one file rather than a
directory, and every line of it shows up in a diff.

- org/repo namespace: `AcmeOrg/artefact-registry`
- person in a person-relation: Hire Dorian to co-design the template
- person with an intent verb: Robin wants the board reshuffled
- engagement money and timing: blocked until Robin gets paid from a company exit
- a sum: a $33.39 deposit against a 12-month runway
- an address: write to dorian@acme.dev
