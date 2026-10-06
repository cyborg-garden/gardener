// lib/garden-io.js
import { GitDriver } from './drivers/git.js';

const DRIVERS = { git: GitDriver };

export class GardenIO {
  // `authority` is an optional standing declaration forwarded to the driver's
  // write-policy. Omitting it does not disable the policy — see GitDriver#write.
  constructor({ driver = process.env.GARDEN_DRIVER || 'git',
                root = process.env.GARDEN_ROOT || 'garden',
                sync = process.env.GARDEN_SYNC !== 'off',
                authority } = {}) {
    const D = DRIVERS[driver];
    if (!D) throw new Error(`unknown garden driver: ${driver}`);
    this.driver = new D({ root, sync, ...(authority !== undefined ? { authority } : {}) });
  }
  read(p) { return this.driver.read(p); }
  write(p, c, opts) { return this.driver.write(p, c, opts); }
  list(prefix) { return this.driver.list(prefix); }
  index(kind) { return this.driver.index(kind); }
  resolve(ref) { return this.driver.resolve(ref); }
  sync() { return this.driver.sync(); }
}
