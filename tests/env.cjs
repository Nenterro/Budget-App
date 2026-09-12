// Minimal DOM event plumbing so the auto-sync listeners are real.
function makeTarget(base) {
  const listeners = {};
  return Object.assign(base, {
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener(t, fn) { listeners[t] = (listeners[t] || []).filter(f => f !== fn); },
    __fire(t) { (listeners[t] || []).forEach(fn => fn({ type: t })); },
    __count(t) { return (listeners[t] || []).length; },
  });
}
const store = () => ({ _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } });
global.localStorage = store();
global.sessionStorage = store();
global.document = makeTarget({ visibilityState: 'visible' });
// Node's WebCrypto is the same API the app uses, so the E2EE paths — deriving
// a key from a PIN, encrypting a payload, decrypting one back — run for real
// rather than against a stub. Settings sync behaves quite differently when the
// session is locked, and that difference is where its worst bug lived.
const { webcrypto } = require('node:crypto');
global.window = makeTarget({ crypto: webcrypto, localStorage: global.localStorage });
global.crypto = webcrypto;
