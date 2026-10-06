// lib/autonomy.js
// Autonomy enforcement — the AUTONOMY.md contract expressed as code.
//
// Harness-agnostic: this depends only on the garden format and the operator's
// overlay, nothing about any runtime. It gives the two enforcement layers the
// contract requires:
//   - the act-gate (loop level):        Autonomy#canAct(capability, required)
//   - the driver write-policy (backend): writeAllowed(authority, region)
//
// Grants live in an operator-owned overlay the gardener reads but upstream never
// ships (`.overlay/`). A fresh install or fork has no overlay and resolves to
// R0 — observe + propose only — until the operator grants more, notch by notch.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// The action-authority ladder (AUTONOMY.md §A). Index is the comparable rank.
export const AUTHORITY = ['observe', 'propose', 'act:contained', 'act:broad'];
export const rankOf = (a) => AUTHORITY.indexOf(a);

// Rung presets over the dials (AUTONOMY.md §Rungs).
export const RUNGS = {
  R0: { authority: 'observe',       attended: true  },
  R1: { authority: 'propose',       attended: true  },
  R2: { authority: 'act:contained', attended: true  },
  R3: { authority: 'act:contained', attended: false },
  R4: { authority: 'act:broad',     attended: false },
};

// R0 is the default for any fresh install or fork (AUTONOMY.md §Rungs).
export const DEFAULT_RUNG = 'R0';

// Storage regions a driver declares (AUTONOMY.md §Two enforcement layers):
//   human    — human-owned; the gardener may never write it (propose-don't-clobber).
//   proposal — proposal surfaces: open decisions + `> reply:` notes.
//   agent    — agent-owned; writable once the gardener may write at all.
export const REGIONS = ['human', 'proposal', 'agent'];

// The driver write-policy (backend enforcement). Given the authority granted for
// a write and the region it targets, may the backend physically permit it?
//   - observe (or an unknown authority) never writes.
//   - a human-owned region is refused at every rung — the gardener proposes
//     changes to human state, it never writes that state directly.
//   - proposal / agent regions are writable once authority is >= propose.
//   - an unknown region fails closed (refused).
export function writeAllowed(authority, region) {
  if (rankOf(authority) < rankOf('propose')) return false;
  if (region === 'human') return false;
  return region === 'proposal' || region === 'agent';
}

// Minimal reader for the overlay's declared shape. We parse only what the
// contract defines — a top-level `rung:` and a `capabilities:` map — and never
// add a YAML dependency (the substrate ships zero deps). A JSON overlay is
// accepted too, for operators who prefer it.
export function parseOverlay(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return {};
  if (trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed); } catch { return {}; }
  }
  const out = { capabilities: {} };
  let inCaps = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    const indented = /^\s/.test(line);
    const kv = line.trim().match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, val] = kv;
    if (!indented) {
      if (key === 'capabilities') { inCaps = true; continue; }
      inCaps = false;
      if (key === 'rung' && val) out.rung = val.trim();
    } else if (inCaps && val) {
      out.capabilities[key] = val.trim();
    }
  }
  return out;
}

// Resolve the operator's granted autonomy from the overlay. Missing overlay,
// unknown rung, or a parse failure all fall back to R0 — autonomy is only ever
// raised by an explicit, well-formed grant, never by accident.
export function loadAutonomy(root, { overlayDir = '.overlay' } = {}) {
  const dir = join(root, overlayDir);
  let cfg = {};
  for (const name of ['autonomy.yml', 'autonomy.yaml', 'autonomy.json']) {
    const f = join(dir, name);
    if (existsSync(f)) { cfg = parseOverlay(readFileSync(f, 'utf8')); break; }
  }
  return new Autonomy({ root, overlayDir, cfg });
}

export class Autonomy {
  constructor({ root, overlayDir = '.overlay', cfg = {} } = {}) {
    this.root = root;
    this.overlayDir = overlayDir;
    this.rung = RUNGS[cfg.rung] ? cfg.rung : DEFAULT_RUNG;
    this._preset = RUNGS[this.rung];
    this._caps = cfg.capabilities || {};
  }

  // Whether the granted rung runs unattended (AUTONOMY.md §B).
  get attended() { return this._preset.attended; }

  // Authority for a capability: a valid per-capability override wins, otherwise
  // the rung's authority. "Authority is per capability, not global" (§A).
  authorityFor(capability) {
    const override = this._caps[capability];
    return AUTHORITY.includes(override) ? override : this._preset.authority;
  }

  // Sharp-edge grant (§C): the presence of `.overlay/grants/<name>` means the
  // named capability is granted. Absent its token it is off even at R4.
  hasGrant(name) {
    return existsSync(join(this.root, this.overlayDir, 'grants', name));
  }

  // The act-gate: may `capability` attempt an action needing `required`
  // authority? A sharp-edge action additionally requires its named grant.
  canAct(capability, required, { grant } = {}) {
    if (!AUTHORITY.includes(required)) return false;
    if (rankOf(this.authorityFor(capability)) < rankOf(required)) return false;
    if (grant && !this.hasGrant(grant)) return false;
    return true;
  }
}
