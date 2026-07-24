// AES-GCM 256 Encryption using Web Crypto API

// We use a constant salt so the same 4-digit PIN derives the same key across different devices.
const SALT = new TextEncoder().encode("BUDGET_APP_E2EE_SALT_V1");

let cryptoKey = null; // Stored in memory

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
    false, // Do not allow extracting the key material
    ["encrypt", "decrypt"]
  );
  
  // Save an indicator to session storage so we know it's unlocked for this session,
  // but we can't save the CryptoKey object easily. Instead, we can just save the PIN in sessionStorage
  // so it persists across page reloads in the same tab, restoring the key automatically.
  sessionStorage.setItem('BUDGET_E2EE_PIN', pin);
}

export function isUnlocked() {
  return cryptoKey !== null;
}

export async function tryRestoreSession() {
  const pin = sessionStorage.getItem('BUDGET_E2EE_PIN');
  if (pin && !cryptoKey) {
    await deriveKey(pin);
    return true;
  }
  return false;
}

export function lockSession() {
  cryptoKey = null;
  sessionStorage.removeItem('BUDGET_E2EE_PIN');
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
  
  // Convert to Base64
  const cipherBytes = new Uint8Array(cipherBuffer);
  const combined = new Uint8Array(iv.length + cipherBytes.length);
  combined.set(iv);
  combined.set(cipherBytes, iv.length);
  
  // Quick base64 encode
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
