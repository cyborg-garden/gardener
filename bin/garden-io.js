#!/usr/bin/env node
// bin/garden-io.js
import { GardenIO } from '../lib/garden-io.js';
import { loadAutonomy } from '../lib/autonomy.js';

const argv = process.argv.slice(2);

// `--authority <a>` is the explicit, per-invocation declaration. Everything else is
// resolved below; nothing is assumed.
//
// The flag is accepted on *either* side of the operation. The usage string below has
// always documented the leading form — `garden-io [--authority <a>] <op> ...` — but the
// parser used to bind `op` to argv[2] unconditionally, so the documented invocation hit
// the unknown-op branch and exited 2 while printing the very usage line it had just
// obeyed. Test `test/cli.test.js` now pins both orderings: a usage string with no test
// behind it is how the two drifted apart in the first place.
const args = [];
let flagAuthority;
let op;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--authority') { flagAuthority = argv[++i]; continue; }
  if (a.startsWith('--authority=')) { flagAuthority = a.slice('--authority='.length); continue; }
  // An unrecognised flag is refused wherever it appears. Leading, it must not be
  // promoted to the operation; trailing, it must not be demoted to a path argument —
  // `garden-io write --nope` used to create a file literally named `--nope`. The
  // leading half of this guard is not observable on its own (an unknown op exits 2 by
  // the same route), so only the trailing case is worth a test; see test/cli.test.js.
  if (a.startsWith('-') && a !== '-') usage();
  if (op === undefined) { op = a; continue; }
  args.push(a);
}

// The CLI is the harness here, so resolving the operator's grant is its job — the
// driver only enforces what it is handed (AUTONOMY.md §Two enforcement layers).
// This used to pass nothing at all, which meant the shipped CLI performed every write
// with the driver's write-policy skipped entirely.
//   1. --authority on the command line
//   2. GARDEN_AUTHORITY in the environment
//   3. the operator overlay at ./.overlay/autonomy.yml — which fails closed to R0
const nonEmpty = v => (v === undefined || v === '' ? undefined : v);
const authority = nonEmpty(flagAuthority)
  ?? nonEmpty(process.env.GARDEN_AUTHORITY)
  ?? loadAutonomy(process.env.GARDEN_OVERLAY_ROOT || process.cwd()).authorityFor('garden-io');

const io = new GardenIO();

function readStdin() {
  return new Promise((res) => { let d = ''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => res(d)); });
}

function bail(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(2);
}

// Hoisted: the argument loop above calls this before this point in source order.
function usage() {
  process.stderr.write(
    'usage: garden-io [--authority <observe|propose|act:contained|act:broad>] ' +
    '<read|write|list|index|resolve|sync> ...\n' +
    '       --authority may also be given after the operation.\n'
  );
  process.exit(2);
}

const ops = {
  read: () => {
    if (!args[0]) bail('read requires a path argument');
    const v = io.read(args[0]); if (v === null) process.exit(1); process.stdout.write(v);
  },
  write: async () => {
    if (!args[0]) bail('write requires a path argument');
    io.write(args[0], await readStdin(), { authority });
  },
  list: () => { process.stdout.write(io.list(args[0] || '').join('\n') + '\n'); },
  index: () => {
    if (!args[0]) bail('index requires a kind argument (board|handoffs)');
    try {
      process.stdout.write(JSON.stringify(io.index(args[0]), null, 2) + '\n');
    } catch (e) {
      bail(e.message || String(e));
    }
  },
  resolve: () => {
    if (!args[0]) bail('resolve requires a ref argument');
    const r = io.resolve(args[0]); if (!r) process.exit(1); process.stdout.write(JSON.stringify(r) + '\n');
  },
  sync: () => { process.stdout.write(JSON.stringify(io.sync()) + '\n'); },
};

try {
  const fn = ops[op];
  if (!fn) usage();
  await fn();
} catch (e) {
  bail(e.message || String(e));
}
