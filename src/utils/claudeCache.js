// On-device copy of the Claude page's conversations, so the page opens with
// everything already there and only checks the server for what changed.
//
// Kept in memory for instant reads and persisted to IndexedDB (the same
// localforage database as the budget's own local data) so it survives a
// reload. The server stays the source of truth: anything shown from here is
// replaced by what the server says as soon as it answers.

import localforage from 'localforage';

const store = localforage.createInstance({ name: 'BudgetApp', storeName: 'claude' });
const LIST_KEY = '__list__';
const MAX_CACHED = 30;

let list = [];
const convos = new Map(); // id -> { id, title, running, events }
const timers = new Map();

export const ready = (async () => {
  try {
    list = (await store.getItem(LIST_KEY)) || [];
    await store.iterate((value, key) => { if (key !== LIST_KEY && value?.id) convos.set(key, value); });
  } catch {
    // storage unavailable (private mode): the page simply starts empty
  }
})();

function persist(key, value) {
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    (value === undefined ? store.removeItem(key) : store.setItem(key, value)).catch(() => {});
  }, 250));
}

export const getList = () => list;

export function setList(next) {
  list = next;
  persist(LIST_KEY, next);
  // Drop cached conversations that are no longer listed or are long past.
  const keep = new Set(next.slice(0, MAX_CACHED).map((c) => c.id));
  for (const id of convos.keys()) {
    if (!keep.has(id) && !next.some((c) => c.id === id)) { convos.delete(id); persist(id, undefined); }
  }
}

export const getConvo = (id) => (id ? convos.get(id) : null);

export function setConvo(id, value) {
  if (!id) return;
  convos.set(id, value);
  persist(id, value);
}

export function removeConvo(id) {
  convos.delete(id);
  persist(id, undefined);
  setList(list.filter((c) => c.id !== id));
}

/** Put a conversation at the top of the list (new message, new chat). */
export function touchInList(id, patch) {
  const now = new Date().toISOString();
  const existing = list.find((c) => c.id === id);
  const entry = { ...(existing || { id, createdAt: now }), ...patch, updatedAt: now };
  setList([entry, ...list.filter((c) => c.id !== id)]);
  return getList();
}
