// Settings sync regression suite.
//
// Appearance, the graphs you added, the stats you added and the detection
// rules all live in one settings record. When that record stops syncing, all
// four look like separate bugs — "my charts didn't save", "my theme reset" —
// and none of them point at the sync engine. These are the ways it lost them.

import * as db from '../src/store/db.js';
import { pb, syncAll, setupRealtimeSync } from '../src/store/sync.js';
import { SERVER, emit } from './mocks/pocketbase.js';

let failed = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${cond ? '' : '  <-- ' + extra}`);
  if (!cond) failed++;
};

const KEY = 'appsettings1234';
const local = () => db.settingsStore.getItem(KEY);
const remote = () => [...(SERVER.collections.settings?.values() || [])][0];

// What SettingsContext.updateSettings writes for any settings change.
async function saveSettings(config) {
  const existing = await local();
  await db.settingsStore.setItem(KEY, {
    ...(existing || {}),
    id: KEY,
    config,
    updatedAt: new Date().toISOString(),
    pendingSync: true
  });
}

const cfg = (over = {}) => ({
  appearance: { theme: 'purple', baseCurrency: 'PKR', displayMode: 'unified' },
  graphs: { active: [] },
  stats: { active: [] },
  automation: { accountByLast4: {}, payeeByMerchant: {}, categoryByPayee: {}, selfLabels: [] },
  security: { e2eeEnabled: false },
  ...over
});

pb.authStore.__login({ id: 'user_abc123456789' });

console.log('\n--- A settings change reaches the server ---');
await saveSettings(cfg({ appearance: { theme: 'ocean', baseCurrency: 'PKR', displayMode: 'unified' } }));
await syncAll();
check('theme change pushed', remote()?.config?.appearance?.theme === 'ocean',
      `remote: ${JSON.stringify(remote()?.config?.appearance)}`);
check('no longer pending', (await local()).pendingSync === false);

console.log('\n--- A second pass must not roll it back ---');
await syncAll();
check('theme still ocean locally', (await local()).config?.appearance?.theme === 'ocean',
      `local: ${JSON.stringify((await local()).config?.appearance)}`);
check('theme still ocean remotely', remote()?.config?.appearance?.theme === 'ocean');

console.log('\n--- An edit made while the previous push is echoing back ---');
// The realtime echo of push #1 arrives AFTER edit #2 has been saved. Without a
// guard it overwrote the new config and cleared pendingSync, so the queued
// sync found nothing to push and edit #2 was gone from both sides.
const stopRealtime = setupRealtimeSync(() => {});
await new Promise(r => setTimeout(r, 0));
const echoOfPush1 = remote();
await saveSettings(cfg({ appearance: { theme: 'forest', baseCurrency: 'PKR', displayMode: 'unified' } }));
await emit('settings', 'update', echoOfPush1);
check('a stale echo does not overwrite an unsaved edit',
      (await local()).config?.appearance?.theme === 'forest',
      `local: ${JSON.stringify((await local()).config?.appearance)}`);
check('a stale echo does not clear the pending flag', (await local()).pendingSync === true);
await syncAll();
check('the edit still reaches the server', remote()?.config?.appearance?.theme === 'forest',
      `remote: ${JSON.stringify(remote()?.config?.appearance)}`);
await stopRealtime();

console.log('\n--- Graphs, stats and detection rules survive the same race ---');
const rich = cfg({
  graphs: { active: [{ id: 'g1', type: 'balance_over_time' }] },
  stats: { active: [{ id: 's1', type: 'burn_rate' }] },
  automation: { accountByLast4: { '4321': 'Askari' }, payeeByMerchant: {}, categoryByPayee: {}, selfLabels: ['Huzaifa'] }
});
await saveSettings(rich);
await syncAll();
check('graphs pushed', remote()?.config?.graphs?.active?.length === 1);
check('stats pushed', remote()?.config?.stats?.active?.length === 1);
check('detection rules pushed', remote()?.config?.automation?.accountByLast4?.['4321'] === 'Askari');

console.log('\n--- Restarting the session keeps them ---');
// A fresh launch pulls before it pushes. Nothing is pending, so the pull is
// authoritative — and must return what was actually stored.
await db.settingsStore.clear();
await syncAll();
const reloaded = await local();
check('graphs came back', reloaded?.config?.graphs?.active?.length === 1,
      `local: ${JSON.stringify(reloaded?.config?.graphs)}`);
check('stats came back', reloaded?.config?.stats?.active?.length === 1);
check('detection rules came back', reloaded?.config?.automation?.accountByLast4?.['4321'] === 'Askari');
check('appearance came back', reloaded?.config?.appearance?.theme === 'purple');

console.log('\n--- A pull must not discard an edit that has not been pushed ---');
// The remote record is newer by the clock (the server stamped it on the last
// push), but the local one has changes nobody has sent yet. Data stores
// already got this right; settings did not.
await saveSettings(cfg({ appearance: { theme: 'crimson', baseCurrency: 'USD', displayMode: 'split' } }));
const rec = await local();
rec.updatedAt = '2000-01-01T00:00:00.000Z';   // older than the server's stamp
await db.settingsStore.setItem(KEY, rec);
await syncAll();
check('the unpushed edit won, not the older server copy',
      (await local()).config?.appearance?.theme === 'crimson',
      `local: ${JSON.stringify((await local()).config?.appearance)}`);
check('and it reached the server', remote()?.config?.appearance?.theme === 'crimson',
      `remote: ${JSON.stringify(remote()?.config?.appearance)}`);

console.log('\n--- An encrypted remote is never flattened into a blank local ---');
// A device that cannot decrypt yet used to copy the server's blanked plaintext
// fields over its own settings, which read back as "everything reset" — and
// then pushed those blanks up as plaintext, taking the real settings with them.
const encRemote = remote();
encRemote.encrypted_payload = 'BASE64CIPHERTEXT';
encRemote.config = '';                       // what a pushed E2EE record looks like
encRemote.updated = '2099-01-01T00:00:00Z';  // and it is unambiguously the newer one
SERVER.collections.settings.set(encRemote.id, encRemote);
const settled = await local();
await db.settingsStore.setItem(KEY, { ...settled, pendingSync: false, updatedAt: '2000-01-01T00:00:00.000Z' });
await syncAll();
const afterEncrypted = await local();
check('local settings were not blanked', !!afterEncrypted?.config?.appearance?.theme,
      `local config: ${JSON.stringify(afterEncrypted?.config)}`);
check('the server still holds its ciphertext',
      remote()?.encrypted_payload === 'BASE64CIPHERTEXT',
      `remote: ${JSON.stringify({ enc: remote()?.encrypted_payload, config: remote()?.config })}`);

console.log('\n--- A settings record that no longer exists on the server ---');
// The local->remote id mapping lives in localStorage. If the row it names is
// gone, every push 404s against an id that will never come back, and settings
// stop syncing for good while the app reports nothing wrong.
delete encRemote.encrypted_payload;
encRemote.config = cfg();
SERVER.collections.settings.set(encRemote.id, encRemote);
await db.settingsStore.clear();
await syncAll();                              // re-establish the mapping
SERVER.collections.settings.clear();          // ...and now the row is gone
await saveSettings(cfg({ appearance: { theme: 'slate', baseCurrency: 'PKR', displayMode: 'unified' } }));
await syncAll();
check('the record was recreated rather than retried forever',
      remote()?.config?.appearance?.theme === 'slate',
      `remote: ${JSON.stringify(remote() && { id: remote().id, theme: remote().config?.appearance?.theme })}`);
check('and it is no longer pending locally', (await local()).pendingSync === false);

console.log(failed === 0 ? '\nALL SETTINGS SYNC CHECKS PASSED\n' : `\n${failed} CHECK(S) FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
