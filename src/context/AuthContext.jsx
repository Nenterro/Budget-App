import React, { createContext, useContext, useState, useEffect } from 'react';
import { pb, connectPocketBase, getAuthSessionState, reportAuthState, ensureFreshAuth, onSyncStateChange, countPendingChanges } from '../store/sync';
import localforage from 'localforage';
import * as db from '../store/db';
import { lockSession } from '../utils/crypto';

// localforage.clear() only empties the *default* instance. Every store this app
// actually writes to is a named instance, so clearing the default one left the
// previous account's records on the device — they then either resurfaced or got
// pushed up under the new account's user id.
async function clearAllLocalData() {
  const stores = [
    db.transactionsStore,
    db.accountsStore,
    db.categoriesStore,
    db.payeesStore,
    db.settingsStore,
    db.budgetsStore
  ];
  await Promise.all(stores.map(store => store.clear().catch(() => {})));
  await localforage.clear().catch(() => {});
  // Drop the settings-record mapping too, or the next account would keep
  // updating the previous account's remote settings row.
  localStorage.removeItem('BUDGET_SETTINGS_PB_ID');
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    if (pb.authStore.model) return pb.authStore.model;
    // A guest session lives only in localStorage; without this a refresh threw
    // the guest back to the login screen.
    if (localStorage.getItem('BUDGET_GUEST_SESSION') === '1') {
      return { id: 'guest', email: 'Guest User', isGuest: true };
    }
    return null;
  });
  const [isInitializing, setIsInitializing] = useState(true);
  // 'active' | 'expired' | 'guest' | 'none'. An expired session is the one the
  // app used to hide: the stored token is past its expiry (or the server has
  // rejected it), so nothing syncs, yet `authStore.model` is still populated
  // and every screen carries on as though the device were signed in.
  const [sessionState, setSessionState] = useState(() => getAuthSessionState());

  useEffect(() => {
    // Work out which PocketBase URL is reachable before anything tries to use
    // it. Without this the client keeps its default base URL (the page origin)
    // and the very first login request 404s against the app's own host.
    connectPocketBase()
      // Renew a token that is still valid but nearing its expiry, so a device
      // in regular use never lapses in the first place.
      .then(() => ensureFreshAuth())
      .catch(console.warn)
      .finally(() => setSessionState(reportAuthState()));

    // Listen for auth changes
    const unsubscribe = pb.authStore.onChange((token, model) => {
      setUser(model);
      setSessionState(getAuthSessionState());
    });

    // The sync engine is what actually discovers a rejected or lapsed token,
    // so the session shown here follows what it reports.
    const offSyncState = onSyncStateChange(state => {
      if (state.session && state.session !== 'unknown') setSessionState(state.session);
    });

    setIsInitializing(false);

    return () => {
      unsubscribe();
      offSyncState();
    };
  }, []);

  // Remembered so signing in as a *different* account wipes the previous
  // account's local records instead of pushing them up under the new user id —
  // and so signing back into the same account after an expiry keeps everything
  // that has not been pushed yet.
  const rememberSignedInUser = async (authData) => {
    const newId = authData?.record?.id || pb.authStore.model?.id || null;
    const previousId = localStorage.getItem('BUDGET_LAST_USER_ID');
    if (newId && previousId && previousId !== newId) {
      await clearAllLocalData();
      lockSession();
    }
    if (newId) localStorage.setItem('BUDGET_LAST_USER_ID', newId);
    // A leftover guest flag would later make an expired session look like a
    // deliberate local-only one.
    localStorage.removeItem('BUDGET_GUEST_SESSION');
    setSessionState(reportAuthState());
  };

  const loginWithOAuth = async (providerName) => {
    try {
      const authData = await pb.collection('users').authWithOAuth2({ provider: providerName });
      await rememberSignedInUser(authData);
      return authData;
    } catch (err) {
      console.error(`OAuth login failed for ${providerName}:`, err);
      throw err;
    }
  };

  const loginWithPassword = async (email, password) => {
    try {
      const authData = await pb.collection('users').authWithPassword(email, password);
      await rememberSignedInUser(authData);
      return authData;
    } catch (err) {
      console.error('Password login failed:', err);
      throw err;
    }
  };

  const signup = async (email, password, passwordConfirm) => {
    try {
      await pb.collection('users').create({
        email,
        password,
        passwordConfirm
      });
      // Automatically log in after signup
      return await loginWithPassword(email, password);
    } catch (err) {
      console.error('Signup failed:', err);
      throw err;
    }
  };

  const loginAsGuest = async () => {
    // Clear any previous local data for the guest session
    await clearAllLocalData();
    lockSession();
    // Recorded so the rest of the app can tell "local by choice" apart from
    // "the session did not carry over", which otherwise look identical.
    localStorage.setItem('BUDGET_GUEST_SESSION', '1');
    setUser({ id: 'guest', email: 'Guest User', isGuest: true });
  };

  // `options` may be a click event (the Settings row passes `logout` straight
  // to onClick), so only an explicit flag counts.
  const logout = async (options) => {
    const keepLocalData = options?.keepLocalData === true;
    pb.authStore.clear();
    localStorage.removeItem('BUDGET_GUEST_SESSION');
    if (keepLocalData) {
      // Used when a session has expired: the point is to get back to the login
      // screen with everything that has not been pushed yet still on the
      // device, so signing back in can finish the job.
      lockSession();
      setUser(null);
      setSessionState('none');
      window.location.href = '/login';
      return;
    }
    // Forget the cached PIN, otherwise the next account signing in on this
    // device silently inherits the previous account's encryption key.
    lockSession();
    setUser(null);
    // Wipe local databases to prevent data leakage between users
    try {
      await clearAllLocalData();
    } catch (err) {
      console.error('Failed to clear local data on logout:', err);
    } finally {
      // Reload the page to reset all states globally
      window.location.href = '/login';
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      isInitializing,
      sessionState,
      // The state worth acting on: signed in as far as the app is concerned,
      // but nothing this device records is reaching the server.
      sessionExpired: sessionState === 'expired',
      countPendingChanges,
      loginWithOAuth,
      loginWithPassword,
      signup,
      loginAsGuest,
      logout
    }}>
      {!isInitializing && children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};
