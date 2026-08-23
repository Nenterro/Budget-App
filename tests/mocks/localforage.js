// In-memory stand-in for localforage, good enough for the sync engine.
function createInstance() {
  const map = new Map();
  return {
    async getItem(k) { return map.has(k) ? JSON.parse(JSON.stringify(map.get(k))) : null; },
    async setItem(k, v) { map.set(k, JSON.parse(JSON.stringify(v))); return v; },
    async removeItem(k) { map.delete(k); },
    async keys() { return [...map.keys()]; },
    async clear() { map.clear(); },
    async iterate(fn) {
      for (const [k, v] of [...map.entries()]) {
        const r = fn(JSON.parse(JSON.stringify(v)), k);
        if (r !== undefined) return r;
      }
    },
    __dump() { return [...map.values()]; },
    __map: map,
  };
}
export default { createInstance, async clear() {} };
