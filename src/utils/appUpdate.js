// Moving onto a new build without pulling files out from under the old one.
//
// The service worker used to be in `autoUpdate` mode: a new build's worker
// activated the moment it installed and deleted the previous build's precache,
// but nothing reloaded the page. The open app kept running the old code, and
// the first time it lazily needed a screen or stylesheet it asked for a hashed
// file that no longer existed anywhere — "Unable to preload CSS for
// /assets/FieldPopover-…css", App Crashed. On a phone an installed PWA is
// resumed rather than reloaded, so it could sit on an old build for days.
//
// Now the new worker waits. While it waits the old one keeps serving every
// file of the build the page is running, so nothing can go missing. The switch
// happens at a moment when reloading costs nothing:
//
//   - the app goes to the background with no form open, or
//   - it was just opened or brought back (and nothing has been opened since).
//
// A form left open stays intact — switching to the SMS app to copy an amount
// must not wipe a half-entered transaction. The update then waits for the next
// safe moment, and the old build carries on working in the meantime.
//
// Because nothing checks for a new worker except a navigation, a resumed PWA
// would never notice a deploy; so this also checks whenever the app returns to
// the foreground, and every half hour while it stays open.

import { registerSW } from 'virtual:pwa-register';
import { reloadForNewVersion } from './staleChunk';

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const MIN_CHECK_GAP_MS = 60 * 1000;
// An update found this soon after opening or resuming is applied at once: the
// user has only just arrived and has nothing in progress to lose.
const FRESH_START_MS = 15 * 1000;

let freshSince = Date.now();
let updateWaiting = false;
let applyUpdate = null;
let lastCheck = 0;

// Anything that could hold unsaved input. Every modal renders through
// ModalWrapper's `.modal-overlay`; a focused field covers the rest.
function userIsBusy() {
  if (document.querySelector('.modal-overlay')) return true;
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

function applyIfSafe() {
  if (!updateWaiting || !applyUpdate || userIsBusy()) return;
  const hidden = document.visibilityState === 'hidden';
  const fresh = Date.now() - freshSince < FRESH_START_MS;
  if (!hidden && !fresh) return;
  updateWaiting = false;
  // Tells the waiting worker to take over; the register helper reloads the
  // page as soon as it is in control.
  applyUpdate();
}

export function startAppUpdates() {
  if (!('serviceWorker' in navigator)) return;

  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateWaiting = true;
      applyIfSafe();
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        if (Date.now() - lastCheck < MIN_CHECK_GAP_MS) return;
        lastCheck = Date.now();
        registration.update().catch(() => {});
      };
      setInterval(() => {
        if (document.visibilityState === 'visible') check();
      }, CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          freshSince = Date.now();
          check();
        }
      });
    }
  });

  document.addEventListener('visibilitychange', applyIfSafe);

  // Opening something ends the "just arrived" window: from then on the update
  // waits for the app to be backgrounded rather than reloading mid-use.
  document.addEventListener('pointerdown', () => { freshSince = 0; }, { capture: true, passive: true });

  // Vite's own signal that a dynamic import or its CSS failed to load. The
  // lazy-component wrapper already handles screens; this covers every other
  // dynamic import, and fires before the error reaches React.
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForNewVersion()) event.preventDefault();
  });
}
