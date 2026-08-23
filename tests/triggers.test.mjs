import * as db from '../src/store/db.js';
import { pb, syncAll, startAutoSync, getSyncState } from '../src/store/sync.js';
import { SERVER } from './mocks/pocketbase.js';

let failed = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${cond ? '' : '  <-- ' + extra}`);
  if (!cond) failed++;
};
const tick = () => new Promise(r => setTimeout(r, 30));
const localIds = async () => (await db.getTransactions()).map(t => t.id);

// Seed the server as if another device had already created something.
const seededId = 'seeded000000001';
SERVER.collections.transactions = new Map([[seededId, {
  id: seededId, amount: -1200, category: 'Rent', payee: 'Landlord',
  date: '2026-08-01T00:00:00.000Z', account: 'Cash', users: 'user_abc123456789',
  encrypted_payload: '', created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z'
}]]);

console.log('\n--- Signed out: sync must not run, and must say so ---');
await syncAll();
check('reports signed-out', getSyncState().mode === 'signed-out', JSON.stringify(getSyncState()));
check('pulled nothing while signed out', (await localIds()).length === 0);

console.log('\n--- startAutoSync then LOGIN: data must arrive with no refresh ---');
let reloads = 0;
const stopAuto = startAutoSync({ intervalMs: 100000, onSynced: async () => { reloads++; } });

pb.authStore.__login({ id: 'user_abc123456789' });   // exactly what a login does
await tick(); await tick(); await tick();

check('login alone triggered a sync', reloads > 0, `onSynced fired ${reloads}x`);
check('the seeded transaction is now local', (await localIds()).includes(seededId),
      `local: ${JSON.stringify(await localIds())}`);
check('state reports synced', getSyncState().mode === 'synced', JSON.stringify(getSyncState()));

console.log('\n--- Another device adds something while we sit idle ---');
const laterId = 'later0000000002';
SERVER.collections.transactions.set(laterId, {
  id: laterId, amount: -60, category: 'Coffee', payee: 'Cafe',
  date: '2026-08-03T00:00:00.000Z', account: 'Cash', users: 'user_abc123456789',
  encrypted_payload: '', created: '2026-02-01T00:00:00.000Z', updated: '2026-02-01T00:00:00.000Z'
});
check('not local yet (nothing has triggered)', !(await localIds()).includes(laterId));

console.log('\n--- Returning to the app (visibilitychange) pulls it in ---');
const before = reloads;
global.document.__fire('visibilitychange');
await tick(); await tick(); await tick();
check('visibility change triggered a sync', reloads > before);
check('the other device\'s change is now here', (await localIds()).includes(laterId),
      `local: ${JSON.stringify(await localIds())}`);

console.log('\n--- Regaining network (online) also triggers ---');
const beforeOnline = reloads;
global.window.__fire('online');
await tick(); await tick();
check('online event triggered a sync', reloads > beforeOnline);

console.log('\n--- Stopping auto-sync detaches every listener ---');
stopAuto();
const afterStop = reloads;
global.document.__fire('visibilitychange');
global.window.__fire('focus');
global.window.__fire('online');
pb.authStore.__login({ id: 'user_abc123456789' });
await tick(); await tick();
check('no syncs after stop', reloads === afterStop, `fired ${reloads - afterStop} extra`);

console.log(failed === 0 ? '\nALL TRIGGER CHECKS PASSED\n' : `\n${failed} CHECK(S) FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
