// Sync regression suite.
//
// The sync engine is the part of this app that has broken repeatedly and is the
// hardest to check by hand — it needs two devices, a server, and patience. These
// tests stand a fake PocketBase server and an in-memory localforage up in
// Node, then drive the *real* src/store/sync.js against them.
//
//   npm test
//
// esbuild bundles each test with `localforage` and `pocketbase` aliased to the
// mocks in tests/mocks, so the modules under test are imported unmodified.

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'budget-tests-'));

const TESTS = ['sync.test.mjs', 'triggers.test.mjs', 'expenseShares.test.mjs'];

let failed = 0;

try {
  for (const test of TESTS) {
    const outfile = join(outDir, test.replace('.mjs', '.bundle.mjs'));

    await build({
      entryPoints: [join(here, test)],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile,
      logLevel: 'warning',
      alias: {
        localforage: join(here, 'mocks', 'localforage.js'),
        pocketbase: join(here, 'mocks', 'pocketbase.js')
      }
    });

    console.log(`\n=== ${test} ===`);
    try {
      execFileSync(process.execPath, ['--require', join(here, 'env.cjs'), outfile], { stdio: 'inherit' });
    } catch (e) {
      failed += 1;
    }
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failed) {
  console.error(`\n${failed} test file(s) failed.`);
  process.exit(1);
}
console.log('\nAll test files passed.');
