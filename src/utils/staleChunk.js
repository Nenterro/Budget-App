// Recovering from a deploy that happened while the app was open.
//
// Every build gives its code-split chunks new hashed names and drops the old
// ones. The service worker updates itself in the background (autoUpdate), and
// as it activates it clears the previous build's precache. A page still
// running the previous build then asks for, say, DashboardWidgets-<oldhash>.js
// the first time it needs it: gone from the cache, gone from Vercel, and the
// lazy import fails. That was the "error loading dynamically imported module"
// crash — always just after a push, always cured by restarting.
//
// Restarting works because the new build is already installed. So the fix is
// to do that restart automatically: a lazy chunk that fails to load reloads
// the page once, which picks up the current build. A guard stops a chunk that
// is genuinely broken from reloading forever; the second failure surfaces.

import { lazy } from 'react';

const RELOAD_KEY = 'budget_stale_chunk_reload_at';
const RELOAD_WINDOW_MS = 10_000;

// Chrome, Firefox and Safari word this differently.
const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|Unable to preload CSS|error loading dynamically/i;

export function isChunkLoadError(err) {
  return CHUNK_ERROR.test(String(err?.message || err || ''));
}

/** Reload onto the current build, unless that was just tried. */
export function reloadForNewVersion() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // No sessionStorage: reload anyway rather than crash.
  }
  window.location.reload();
  return true;
}

/** React.lazy, but a chunk from a superseded build reloads the page instead of crashing it. */
export function lazyWithReload(factory) {
  return lazy(() => factory().catch(err => {
    if (isChunkLoadError(err) && reloadForNewVersion()) {
      // The page is going away; keep Suspense on its fallback until it does.
      return new Promise(() => {});
    }
    throw err;
  }));
}
