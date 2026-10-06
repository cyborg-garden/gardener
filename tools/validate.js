// tools/validate.js
import { GardenIO } from '../lib/garden-io.js';

export function validate(root) {
  const io = new GardenIO({ driver: 'git', root, sync: false });
  const errors = [];

  // Full grammar: - [status] (Pn) #id title — desc
  // status must be space or x (lowercase); Pn must be 1-4; #id and title are required.
  const BOARD_FULL = /^- \[( |x)\]\s*(?:\(P([1-4])\)\s*)?#(\S+)\s+(.+?)(?:\s+—\s+(.+))?\s*$/;

  const threads = io.read('state/threads.md');
  if (threads !== null) {
    threads.split('\n').forEach((raw, i) => {
      if (!/^- \[/.test(raw)) return; // not an item line at all
      if (!BOARD_FULL.test(raw))
        errors.push(`state/threads.md:${i + 1}: malformed board line — "${raw.trim()}"`);
    });
  }

  const decisions = io.read('state/decisions.md');
  if (decisions !== null) {
    const blocks = decisions.split(/^## /m).slice(1);
    for (const b of blocks) {
      const id = b.split(/\s|\n/)[0];
      if (!/^status:\s*(open|resolved)\s*$/m.test(b))
        errors.push(`state/decisions.md: decision ${id} missing a "status: open|resolved" line`);
    }
  }
  return errors;
}

// CLI: `node tools/validate.js <root>` — exit 1 if any errors.
if (import.meta.url === `file://${process.argv[1]}`) {
  const errs = validate(process.argv[2] || 'garden');
  if (errs.length) { errs.forEach(e => console.error('✗ ' + e)); process.exit(1); }
  console.log('✓ garden content conforms to SPEC');
}
