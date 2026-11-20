// Client for the Claude page's backend (budget-agent on the home server).
//
// Every request carries the app's own PocketBase session token; the server
// asks PocketBase whose it is and only lets the budget's owner in. Nothing
// here holds a separate secret.

import { pb } from '../store/sync';

const DEFAULT_URL = 'https://claude-api.huzaifa.page';

// A localStorage override makes local testing against another backend
// possible without a build.
export function claudeApiUrl() {
  try {
    return (localStorage.getItem('CLAUDE_API_URL') || DEFAULT_URL).replace(/\/$/, '');
  } catch {
    return DEFAULT_URL;
  }
}

export function canUseClaude() {
  return pb.authStore.isValid && !!pb.authStore.token;
}

async function request(method, path, { body, headers = {}, signal, raw = false } = {}) {
  const res = await fetch(claudeApiUrl() + path, {
    method,
    signal,
    headers: { Authorization: pb.authStore.token, ...(body && !(body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body instanceof Blob ? body : body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

export const listConversations = () => request('GET', '/api/conversations');
export const getConversation = (id) => request('GET', `/api/conversations/${id}`);
export const deleteConversation = (id) => request('DELETE', `/api/conversations/${id}`);
export const stopConversation = (id) => request('POST', `/api/conversations/${id}/stop`, { body: {} });

/** Start this conversation's Claude process ahead of the first message. Fire and forget. */
export function warmConversation(conversationId) {
  if (!conversationId || !canUseClaude()) return;
  request('POST', '/api/warm', { body: { conversationId } }).catch(() => {});
}

/**
 * Send a message and follow the reply on the same response. `conversationId`
 * is chosen by the page, new conversations included, so nothing has to wait
 * for the server to name one.
 */
export async function sendMessage({ conversationId, text, files, clientId }, onEvent, signal) {
  const res = await request('POST', '/api/chat?stream=1', {
    raw: true,
    signal,
    body: {
      conversationId,
      clientId,
      text,
      files: files.map((f) => f.name),
      types: Object.fromEntries(files.map((f) => [f.name, f.type])),
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  }
  await readStream(res, onEvent);
}

export const answerApproval = (conversationId, approvalId, approve) =>
  request('POST', `/api/conversations/${conversationId}/approvals/${approvalId}`, { body: { approve } });

export async function uploadFile(file) {
  return request('POST', '/api/upload', {
    body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
  });
}

// Images Claude looked at never change, so each is fetched once per session.
const imageUrls = new Map();

/** URL for an image Claude looked at (needs the auth header, so fetched as a blob). */
export function fetchImage(file, signal) {
  if (!imageUrls.has(file)) {
    const p = request('GET', `/api/images/${file}`, { raw: true, signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('image unavailable');
        return URL.createObjectURL(await res.blob());
      })
      .catch((e) => { imageUrls.delete(file); throw e; });
    imageUrls.set(file, p);
  }
  return imageUrls.get(file);
}

/**
 * Follow a conversation: every event after `after`, then live ones until the
 * turn ends. Calls onEvent per event; resolves when the server closes the
 * stream. Abort with `signal` (e.g. leaving the page); the turn itself keeps
 * running on the server and can be picked up again later.
 */
export async function streamConversation(id, after, onEvent, signal) {
  const res = await request('GET', `/api/conversations/${id}/stream?after=${after}`, { raw: true, signal });
  if (!res.ok || !res.body) throw new Error(`Stream failed (${res.status})`);
  await readStream(res, onEvent);
}

async function readStream(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.t !== 'ping') onEvent(ev);
      } catch {
        // a partial line can not happen here, but a bad one should not kill the stream
      }
    }
  }
}
