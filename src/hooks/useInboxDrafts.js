import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchPendingDrafts, subscribeInbox } from '../store/inbox';
import { pb } from '../store/sync';

/**
 * The pending review queue, kept fresh.
 *
 * Realtime is the fast path but not a guarantee — the same reasons documented
 * in sync.js apply here, and more so on a phone: an EventSource does not
 * survive a backgrounded PWA or a switch from wifi to cellular. Since a bank
 * SMS arrives precisely when the phone has just woken up, the visibility and
 * focus refreshes are what actually make the badge appear.
 */
export function useInboxDrafts() {
  const [drafts, setDrafts] = useState([]);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!pb.authStore.isValid) {
      setDrafts([]);
      return [];
    }
    const items = await fetchPendingDrafts();
    if (mountedRef.current) setDrafts(items);
    return items;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let unsubscribeRealtime = null;
    let disposed = false;

    refresh();

    subscribeInbox(() => refresh()).then(unsubscribe => {
      // A teardown that ran while the subscribe was still in flight still has
      // to win, or the subscription outlives the component.
      if (disposed) unsubscribe();
      else unsubscribeRealtime = unsubscribe;
    });

    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const offAuthChange = pb.authStore.onChange(() => refresh());

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);

    return () => {
      mountedRef.current = false;
      disposed = true;
      if (unsubscribeRealtime) unsubscribeRealtime();
      if (offAuthChange) offAuthChange();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [refresh]);

  return { drafts, refresh, count: drafts.length };
}
