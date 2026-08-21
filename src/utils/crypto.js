import * as db from '../store/db';
import { pb } from '../store/sync';

// AES-GCM 256 Encryption using Web Crypto API

// We use a constant salt so the same 4-digit PIN derives the same key across different devices.
const SALT = new TextEncoder().encode("BUDGET_APP_E2EE_SALT_V1");

let cryptoKey = null; // Stored in memory

// Where the PIN is cached between launches.
//
// Remembering it in localStorage is convenient — the app unlocks itself and
// syncs without asking — but it also means the key to the "end-to-end
// encrypted" data sits in plain text next to the data it protects. Anyone with
// the unlocked device, or any script running on the page, can read it.
//
// Remembering stays the default so existing devices keep working, but it is now
// a choice. With it off the PIN lives in sessionStorage only: unlocked once per
// tab/session, gone when the app is closed.
const REMEMBER_KEY = 'BUDGET_REMEMBER_PIN';
const PIN_KEY = 'BUDGET_E2EE_PIN';

export function isPinRemembered() {
  return localStorage.getItem(REMEMBER_KEY) !== '0';
}

export function setPinRemembered(remember) {
  localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
  const pin = localStorage.getItem(PIN_KEY) || sessionStorage.getItem(PIN_KEY);
  if (!pin) return;
  // Move the already-cached PIN to wherever it now belongs, so the switch takes
  // effect immediately rather than at the next unlock.
  sessionStorage.setItem(PIN_KEY, pin);
  if (remember) localStorage.setItem(PIN_KEY, pin);
  else localStorage.removeItem(PIN_KEY);
}

function cachePin(pin) {
  sessionStorage.setItem(PIN_KEY, pin);
  if (isPinRemembered()) localStorage.setItem(PIN_KEY, pin);
  else localStorage.removeItem(PIN_KEY);
}

// Derive AES-GCM key from PIN
export async function deriveKey(pin) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(pin),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
  
  cryptoKey = await window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: SALT,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  
  cachePin(pin);
}

export function isUnlocked() {
  return cryptoKey !== null;
}

// Check if a PIN is cached on this device (without deriving or verifying)
export function hasCachedPin() {
  return !!(localStorage.getItem(PIN_KEY) || sessionStorage.getItem(PIN_KEY));
}

// Restore session from cached PIN — just derives the key, no verification.
// Verification happens naturally when syncAll tries to decrypt records.
export async function tryRestoreSession() {
  const pin = localStorage.getItem(PIN_KEY) || sessionStorage.getItem(PIN_KEY);
  if (pin && !cryptoKey) {
    await deriveKey(pin);
    return true;
  }
  return cryptoKey !== null;
}

export function lockSession() {
  cryptoKey = null;
  localStorage.removeItem(PIN_KEY);
  sessionStorage.removeItem(PIN_KEY);
}

export async function encryptPayload(payload) {
  if (!cryptoKey) throw new Error("Database is locked");
  
  const jsonStr = JSON.stringify(payload);
  const enc = new TextEncoder();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  const cipherBuffer = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    cryptoKey,
    enc.encode(jsonStr)
  );
  
  const cipherBytes = new Uint8Array(cipherBuffer);
  const combined = new Uint8Array(iv.length + cipherBytes.length);
  combined.set(iv);
  combined.set(cipherBytes, iv.length);
  
  let binary = '';
  const len = combined.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(combined[i]);
  }
  
  return btoa(binary);
}

export async function decryptPayload(encryptedStr) {
  if (!cryptoKey) throw new Error("Database is locked");
  
  try {
    const binary = atob(encryptedStr);
    const combined = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      combined[i] = binary.charCodeAt(i);
    }
    
    const iv = combined.slice(0, 12);
    const cipherBytes = combined.slice(12);
    
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      cryptoKey,
      cipherBytes
    );
    
    const dec = new TextDecoder();
    return JSON.parse(dec.decode(decryptedBuffer));
  } catch (e) {
    console.error("Failed to decrypt payload:", e);
    throw new Error("Decryption failed. Incorrect PIN or corrupted data.");
  }
}

// Verify a PIN by attempting to decrypt real encrypted data.
// Derives the key from the given PIN, then tries to decrypt any
// encrypted record found locally or remotely.
export async function verifyPinWithData(pin) {
  await deriveKey(pin);
  
  // Try local stores first
  const stores = [
    db.settingsStore,
    db.transactionsStore,
    db.accountsStore,
    db.categoriesStore,
    db.payeesStore,
    db.budgetsStore
  ];
  
  for (const store of stores) {
    let testItem = null;
    await store.iterate((value) => {
      if (value && value.encrypted_payload) {
        testItem = value;
        return value; // stop iteration
      }
    });

    if (testItem && testItem.encrypted_payload) {
      try {
        await decryptPayload(testItem.encrypted_payload);
        return true;
      } catch (e) {
        lockSession();
        return false;
      }
    }
  }

  // Fallback: try remote PocketBase records
  if (pb.baseUrl && pb.authStore.isValid) {
    const collections = ['settings', 'transactions', 'accounts', 'categories', 'payees', 'budgets'];
    const usersId = pb.authStore.model?.id;
    for (const coll of collections) {
      try {
        const remoteItems = await pb.collection(coll).getFullList({ 
          filter: usersId ? `users = "${usersId}"` : '',
          sort: '-created'
        });
        for (const remote of remoteItems) {
          if (remote.encrypted_payload) {
            try {
              await decryptPayload(remote.encrypted_payload);
              return true;
            } catch (e) {
              lockSession();
              return false;
            }
          }
        }
      } catch (e) {
        // Skip network errors
      }
    }
  }

  // No encrypted data found anywhere — PIN is accepted (first-time setup)
  return true;
}
