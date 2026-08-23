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
global.window = makeTarget({ crypto: { subtle: {} }, localStorage: global.localStorage });
