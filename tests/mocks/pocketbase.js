// Fake PocketBase: one shared in-memory "server" across all client instances,
// so two clients in the same process behave like two devices.
export const SERVER = { collections: {}, seq: 0, log: [] };

function coll(name) {
  if (!SERVER.collections[name]) SERVER.collections[name] = new Map();
  return SERVER.collections[name];
}
function stamp() {
  SERVER.seq += 1;
  return new Date(Date.UTC(2026, 0, 1, 0, 0, SERVER.seq)).toISOString();
}
function genId() {
  return Math.random().toString(36).slice(2).padEnd(15, '0').slice(0, 15);
}

class NotFound extends Error {
  constructor() { super('not found'); this.status = 404; }
}

export default class PocketBase {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
    const cbs = [];
    this.authStore = {
      model: null,
      token: '',
      get isValid() { return !!this.model; },
      onChange(cb) { cbs.push(cb); return () => { const i = cbs.indexOf(cb); if (i >= 0) cbs.splice(i, 1); }; },
      __login(model) { this.model = model; this.token = 't'; cbs.forEach(c => c(this.token, model)); },
      clear() { this.model = null; this.token = ''; cbs.forEach(c => c('', null)); },
    };
  }

  collection(name) {
    const store = coll(name);
    return {
      async getFullList({ filter } = {}) {
        SERVER.log.push(['getFullList', name, filter]);
        let items = [...store.values()];
        const m = filter && filter.match(/users = "([^"]+)"/);
        if (m) items = items.filter(r => r.users === m[1]);
        return JSON.parse(JSON.stringify(items));
      },
      async getList(_p, _n, { filter } = {}) {
        let items = [...store.values()];
        const m = filter && filter.match(/users = "([^"]+)"/);
        if (m) items = items.filter(r => r.users === m[1]);
        if (filter && filter.includes('encrypted_payload != ""')) {
          items = items.filter(r => r.encrypted_payload);
        }
        return { totalItems: items.length, items };
      },
      async getOne(id) {
        if (!store.has(id)) throw new NotFound();
        return JSON.parse(JSON.stringify(store.get(id)));
      },
      async create(data) {
        const id = data.id || genId();
        if (store.has(id)) { const e = new Error('exists'); e.status = 400; throw e; }
        const rec = { ...data, id, created: stamp(), updated: stamp() };
        store.set(id, rec);
        SERVER.log.push(['create', name, id]);
        return JSON.parse(JSON.stringify(rec));
      },
      async update(id, data) {
        if (!store.has(id)) throw new NotFound();
        const rec = { ...store.get(id), ...data, id, updated: stamp() };
        store.set(id, rec);
        SERVER.log.push(['update', name, id]);
        return JSON.parse(JSON.stringify(rec));
      },
      async delete(id) {
        if (!store.has(id)) throw new NotFound();
        store.delete(id);
        SERVER.log.push(['delete', name, id]);
        return true;
      },
      async subscribe() { return async () => {}; },
      async unsubscribe() {},
    };
  }
}
