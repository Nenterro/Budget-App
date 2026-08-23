import * as db from '../src/store/db.js';
import { pb, syncAll } from '../src/store/sync.js';
import { SERVER } from './mocks/pocketbase.js';

let failed = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${cond ? '' : '  <-- ' + extra}`);
  if (!cond) failed++;
};

const localTxIds = async () => (await db.getTransactions()).map(t => t.id);
const serverTxIds = () => [...(SERVER.collections.transactions?.keys() || [])];

pb.authStore.__login({ id: 'user_abc123456789' });

console.log('\n--- Device A creates a transaction, then syncs ---');
await db.saveTransaction({ id: db.generateId(), amount: -500, category: 'Food', payee: 'Cafe', date: '2026-08-01T00:00:00.000Z', account: 'Cash' });
const createdId = (await localTxIds())[0];
await syncAll();

check('transaction survives its own sync (does not vanish until refresh)',
      (await localTxIds()).includes(createdId), `local now: ${JSON.stringify(await localTxIds())}`);
check('transaction reached the server', serverTxIds().includes(createdId));
check('record is no longer pending', (await db.transactionsStore.getItem(createdId)).pendingSync === false);

console.log('\n--- A second sync must not undo the first ---');
await syncAll();
check('still present locally after a second pass', (await localTxIds()).includes(createdId));
check('still present on the server', serverTxIds().includes(createdId));

console.log('\n--- Device B (empty local store) pulls it down ---');
await db.transactionsStore.clear();
check('device B starts empty', (await localTxIds()).length === 0);
await syncAll();
check('device B receives the transaction', (await localTxIds()).includes(createdId),
      `local now: ${JSON.stringify(await localTxIds())}`);

console.log('\n--- Device B edits it; device A picks the edit up ---');
const onB = await db.transactionsStore.getItem(createdId);
await db.saveTransaction({ ...onB, amount: -750 });
await syncAll();
check('edit reached the server', SERVER.collections.transactions.get(createdId).amount === -750);
await db.transactionsStore.clear();          // stand in for device A re-pulling
await syncAll();
check('other device sees the new amount',
      (await db.transactionsStore.getItem(createdId))?.amount === -750);

console.log('\n--- Concurrent syncs (a burst of saves) ---');
const burst = [];
for (let i = 0; i < 5; i++) {
  const id = db.generateId();
  burst.push(id);
  await db.saveTransaction({ id, amount: -(i + 1), category: 'Bulk', payee: 'X', date: '2026-08-02T00:00:00.000Z', account: 'Cash' });
}
await Promise.all([syncAll(), syncAll(), syncAll()]);
const after = await localTxIds();
check('all 5 survive overlapping syncs', burst.every(id => after.includes(id)),
      `missing: ${burst.filter(id => !after.includes(id))}`);
check('all 5 reached the server', burst.every(id => serverTxIds().includes(id)));

console.log('\n--- Delete propagates ---');
await db.deleteTransaction(createdId);
await syncAll();
check('gone from the server', !serverTxIds().includes(createdId));
check('gone locally', !(await localTxIds()).includes(createdId));
await db.transactionsStore.clear();
await syncAll();
check('stays gone on another device', !(await localTxIds()).includes(createdId));

console.log(failed === 0 ? '\nALL SYNC CHECKS PASSED\n' : `\n${failed} CHECK(S) FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
