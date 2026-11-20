// The Claude page: chat with Claude about the budget, hand it receipts and
// statements, and approve the changes it prepares.
//
// Claude itself runs on the home server (budget-agent), not here. This page
// sends messages, follows the conversation as a stream of events, and answers
// approval cards. Nothing Claude stages is written to the budget until the
// Approve button on its card is pressed; the server waits for that answer.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Sparkles, Send, Paperclip, Square, X, Check, Loader2, AlertTriangle, MessageSquarePlus,
  History, Trash2, FileText, Image as ImageIcon, ShieldCheck,
} from 'lucide-react';
import {
  canUseClaude, listConversations, getConversation, deleteConversation, sendMessage, stopConversation,
  answerApproval, uploadFile, fetchImage, streamConversation,
} from '../utils/claudeApi';
import './ClaudeChat.css';

const SUGGESTIONS = [
  'How much have I spent this month, and on what?',
  'Review my detected transactions',
  'Here is a receipt, add it',
  'Reconcile my Askari statement',
];

// ─── a small, safe Markdown renderer (React elements, never HTML) ─────────

function inline(text, keyBase) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith('**')) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Markdown({ text }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      const body = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i++]);
      i += 1;
      blocks.push(<pre key={blocks.length}><code>{body.join('\n')}</code></pre>);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (c.endsWith(':') ? 'right' : 'left'));
      const rows = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div className="cc-table-wrap" key={blocks.length}>
          <table>
            <thead><tr>{head.map((h, j) => <th key={j} style={{ textAlign: align[j] }}>{inline(h, `h${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => (
              <tr key={ri}>{r.map((c, j) => <td key={j} style={{ textAlign: align[j] }}>{inline(c, `c${ri}${j}`)}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      );
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push(<p className="cc-heading" key={blocks.length}>{inline(heading[2], `hd${i}`)}</p>);
      i += 1;
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''));
        i += 1;
      }
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(<Tag key={blocks.length}>{items.map((it, j) => <li key={j}>{inline(it, `li${i}${j}`)}</li>)}</Tag>);
      continue;
    }
    if (!line.trim()) { i += 1; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^\s*([-*]|\d+\.)\s+|^#{1,4}\s|^\s*\||^\s*```/.test(lines[i])) {
      para.push(lines[i++]);
    }
    if (!para.length) { para.push(lines[i++]); }
    blocks.push(<p key={blocks.length}>{inline(para.join('\n'), `p${i}`)}</p>);
  }
  return <div className="cc-md">{blocks}</div>;
}

// ─── event views ─────────────────────────────────────────────────────────

function ToolRow({ ev }) {
  return (
    <div className={`cc-tool cc-tool-${ev.status}`}>
      {ev.status === 'running' ? <Loader2 size={14} className="cc-spin" />
        : ev.status === 'error' ? <X size={14} /> : <Check size={14} />}
      <span>{ev.label}</span>
    </div>
  );
}

function ToolImage({ file }) {
  const [src, setSrc] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const ctl = new AbortController();
    let url;
    fetchImage(file, ctl.signal).then((u) => { url = u; setSrc(u); }).catch(() => {});
    return () => { ctl.abort(); if (url) URL.revokeObjectURL(url); };
  }, [file]);
  if (!src) return <div className="cc-image cc-image-loading"><ImageIcon size={18} /></div>;
  return (
    <>
      <button className="cc-image" onClick={() => setOpen(true)} title="What Claude looked at">
        <img src={src} alt="What Claude looked at" />
      </button>
      {open && (
        <div className="cc-lightbox" onClick={() => setOpen(false)}>
          <img src={src} alt="What Claude looked at" />
        </div>
      )}
    </>
  );
}

const OP_LABEL = { create: 'Add', update: 'Change', delete: 'Remove' };

function ApprovalCard({ ev, onAnswer }) {
  const [busy, setBusy] = useState(false);
  const pending = ev.status === 'pending';
  const answer = async (approve) => {
    setBusy(true);
    try { await onAnswer(ev.id, approve); } finally { setBusy(false); }
  };
  return (
    <div className={`cc-approval cc-approval-${ev.status}`}>
      <div className="cc-approval-head">
        <ShieldCheck size={18} />
        <span>{ev.kind === 'apply' ? 'Approve these changes?' : 'Allow this step?'}</span>
      </div>

      {ev.kind === 'apply' && ev.staged?.groups && (
        <div className="cc-approval-body">
          {ev.staged.groups.map((g) => (
            <div className="cc-group" key={g.id}>
              {g.changes.length > 1 && <div className="cc-group-title">{g.title}</div>}
              {g.changes.map((c) => (
                <div className="cc-change" key={c.n}>
                  <div className="cc-change-line">
                    <span className={`cc-op cc-op-${c.op}`}>{OP_LABEL[c.op] || c.op}</span>
                    <span className="cc-change-summary">{c.summary}</span>
                  </div>
                  {c.was && <div className="cc-diff">was: {c.was}</div>}
                  {c.diff.map((d, j) => <div className="cc-diff" key={j}>{d}</div>)}
                  {c.warnings.map((w, j) => <div className="cc-warn" key={j}><AlertTriangle size={12} /> {w}</div>)}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {ev.kind === 'apply' && ev.staged?.error && <div className="cc-warn">Could not load the changes: {ev.staged.error}</div>}
      {ev.kind === 'tool' && (
        <div className="cc-approval-body">
          <div className="cc-change-summary">{ev.tool}</div>
          <pre className="cc-tool-input">{JSON.stringify(ev.input, null, 1).slice(0, 1200)}</pre>
        </div>
      )}

      {pending ? (
        <div className="cc-approval-actions">
          <button className="btn-secondary" disabled={busy} onClick={() => answer(false)}>Deny</button>
          <button className="btn-primary" disabled={busy} onClick={() => answer(true)}>
            {busy ? <Loader2 size={16} className="cc-spin" /> : <Check size={16} />} Approve
          </button>
        </div>
      ) : (
        <div className={`cc-approval-status cc-status-${ev.status}`}>
          {ev.status === 'approved' ? 'Approved' : 'Denied'}
        </div>
      )}
    </div>
  );
}

function Event({ ev, onAnswer }) {
  switch (ev.t) {
    case 'user':
      return (
        <div className="cc-user">
          {ev.files?.length > 0 && (
            <div className="cc-files">{ev.files.map((f) => (
              <span className="cc-file-chip" key={f.name}><FileText size={12} /> {f.name.replace(/^\d{8}-\d{6}-[a-f0-9]{6}-/, '')}</span>
            ))}</div>
          )}
          {ev.text && <div className="cc-user-text">{ev.text}</div>}
        </div>
      );
    case 'assistant': return <div className="cc-assistant"><Markdown text={ev.text} /></div>;
    case 'tool': return <ToolRow ev={ev} />;
    case 'image': return <ToolImage file={ev.file} />;
    case 'approval': return <ApprovalCard ev={ev} onAnswer={onAnswer} />;
    case 'error': return <div className="cc-error"><AlertTriangle size={14} /> {ev.message}</div>;
    default: return null;
  }
}

// ─── the page ────────────────────────────────────────────────────────────

export default function ClaudeChat() {
  const [params, setParams] = useSearchParams();
  const conversationId = params.get('c');
  const [events, setEvents] = useState([]);
  const [running, setRunning] = useState(false);
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [error, setError] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const streamRef = useRef(null);
  const lastSeq = useRef(-1);
  const bottomRef = useRef(null);
  const fileInput = useRef(null);

  const applyEvent = useCallback((ev) => {
    if (ev.t === 'idle') { setRunning(false); return; }
    if (ev.t === 'patch') {
      setEvents((prev) => prev.map((e) => (e.seq === ev.target ? { ...e, ...ev.patch } : e)));
      return;
    }
    if (typeof ev.seq !== 'number') return;
    lastSeq.current = Math.max(lastSeq.current, ev.seq);
    setEvents((prev) => (prev.some((e) => e.seq === ev.seq) ? prev : [...prev, ev]));
  }, []);

  const follow = useCallback(async (id) => {
    streamRef.current?.abort();
    const ctl = new AbortController();
    streamRef.current = ctl;
    setRunning(true);
    try {
      await streamConversation(id, lastSeq.current, applyEvent, ctl.signal);
    } catch (e) {
      if (!ctl.signal.aborted) setError(e.message);
    } finally {
      if (streamRef.current === ctl) streamRef.current = null;
    }
  }, [applyEvent]);

  // Load a conversation when the URL names one; pick up a turn still running.
  useEffect(() => {
    streamRef.current?.abort();
    lastSeq.current = -1;
    setEvents([]);
    setRunning(false);
    setError(null);
    if (!conversationId) return undefined;
    let cancelled = false;
    getConversation(conversationId)
      .then((c) => {
        if (cancelled) return;
        c.events.forEach((ev) => { lastSeq.current = Math.max(lastSeq.current, ev.seq); });
        setEvents(c.events);
        if (c.running) follow(conversationId);
      })
      .catch((e) => !cancelled && setError(e.status === 404 ? 'That conversation no longer exists.' : e.message));
    return () => { cancelled = true; streamRef.current?.abort(); };
  }, [conversationId, follow]);

  // A phone suspends the page; when it comes back, catch up on what happened.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !conversationId || streamRef.current) return;
      getConversation(conversationId).then((c) => {
        c.events.forEach(applyEvent);
        if (c.running) follow(conversationId); else setRunning(false);
      }).catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [conversationId, follow, applyEvent]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [events.length, running]);

  const addFiles = (files) => {
    for (const file of files) {
      const key = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
      setAttachments((prev) => [...prev, { key, label: file.name, status: 'uploading' }]);
      uploadFile(file)
        .then((r) => setAttachments((prev) => prev.map((a) => (a.key === key ? { ...a, status: 'ready', name: r.name, type: r.type } : a))))
        .catch((e) => setAttachments((prev) => prev.map((a) => (a.key === key ? { ...a, status: 'error', error: e.message } : a))));
    }
  };

  const ready = attachments.filter((a) => a.status === 'ready');
  const uploading = attachments.some((a) => a.status === 'uploading');
  const canSend = !running && !uploading && (text.trim() || ready.length);

  const send = async (override) => {
    const message = (override ?? text).trim();
    if (running || uploading || (!message && !ready.length)) return;
    setError(null);
    try {
      const { conversationId: id } = await sendMessage({ conversationId, text: message, files: ready });
      setText('');
      setAttachments([]);
      if (id !== conversationId) {
        lastSeq.current = -1;
        setParams({ c: id });
      } else {
        follow(id);
      }
    } catch (e) {
      setError(e.message);
    }
  };

  // A new conversation's turn starts as soon as the URL effect loads it.
  const onAnswer = async (approvalId, approve) => {
    try {
      await answerApproval(conversationId, approvalId, approve);
    } catch (e) {
      setError(e.message);
    }
  };

  const openHistory = async () => {
    setHistoryOpen(true);
    try { setHistory((await listConversations()).conversations); } catch (e) { setError(e.message); }
  };

  if (!canUseClaude()) {
    return (
      <div className="page-container claude-page">
        <div className="cc-empty"><Sparkles size={32} /><p>Sign in to talk to Claude about your budget.</p></div>
      </div>
    );
  }

  return (
    <div className="page-container claude-page">
      <div className="cc-header">
        <h1 className="page-title"><Sparkles size={22} /> Claude</h1>
        <div className="cc-header-actions">
          <button className="glass-icon-btn" title="Past conversations" onClick={openHistory}><History size={18} /></button>
          <button className="glass-icon-btn" title="New conversation" onClick={() => setParams({})}><MessageSquarePlus size={18} /></button>
        </div>
      </div>

      <div className="cc-thread">
        {!conversationId && events.length === 0 && (
          <div className="cc-empty">
            <Sparkles size={32} />
            <p>Ask about your money, attach a receipt or statement, or have Claude tidy things up. It asks before it changes anything.</p>
            <div className="cc-suggestions">
              {SUGGESTIONS.map((s) => <button key={s} className="cc-suggestion" onClick={() => setText(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {events.map((ev) => <Event key={ev.seq} ev={ev} onAnswer={onAnswer} />)}
        {running && !events.some((e) => e.t === 'approval' && e.status === 'pending') && (
          <div className="cc-thinking"><Loader2 size={14} className="cc-spin" /> Working…</div>
        )}
        {error && <div className="cc-error"><AlertTriangle size={14} /> {error}</div>}
        <div ref={bottomRef} />
      </div>

      <div className="cc-composer glass-panel">
        {attachments.length > 0 && (
          <div className="cc-attachments">
            {attachments.map((a) => (
              <span key={a.key} className={`cc-file-chip cc-file-${a.status}`} title={a.error || ''}>
                {a.status === 'uploading' ? <Loader2 size={12} className="cc-spin" /> : a.status === 'error' ? <AlertTriangle size={12} /> : <FileText size={12} />}
                {a.label}
                <button onClick={() => setAttachments((prev) => prev.filter((x) => x.key !== a.key))} title="Remove"><X size={12} /></button>
              </span>
            ))}
          </div>
        )}
        <div className="cc-input-row">
          <button className="cc-icon-btn" title="Attach a receipt or statement" onClick={() => fileInput.current?.click()}>
            <Paperclip size={18} />
          </button>
          <input
            ref={fileInput} type="file" multiple hidden
            accept="image/*,application/pdf,.pdf,.csv,text/csv,.xlsx,.txt"
            onChange={(e) => { addFiles([...e.target.files]); e.target.value = ''; }}
          />
          <textarea
            rows={1}
            value={text}
            placeholder={running ? 'Claude is working…' : 'Message Claude'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 768px)').matches) {
                e.preventDefault();
                send();
              }
            }}
          />
          {running ? (
            <button className="cc-icon-btn cc-stop" title="Stop" onClick={() => stopConversation(conversationId).catch(() => {})}>
              <Square size={16} />
            </button>
          ) : (
            <button className="cc-icon-btn cc-send" title="Send" disabled={!canSend} onClick={() => send()}>
              <Send size={18} />
            </button>
          )}
        </div>
      </div>

      {historyOpen && (
        <div className="modal-overlay" onClick={() => setHistoryOpen(false)}>
          <div className="modal-content cc-history" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Conversations</h2>
              <button className="close-btn" onClick={() => setHistoryOpen(false)}><X size={20} /></button>
            </div>
            <div className="cc-history-list">
              {history.length === 0 && <p className="cc-muted">No conversations yet.</p>}
              {history.map((c) => (
                <div key={c.id} className={`cc-history-item ${c.id === conversationId ? 'active' : ''}`}>
                  <button className="cc-history-open" onClick={() => { setParams({ c: c.id }); setHistoryOpen(false); }}>
                    <span className="cc-history-title">{c.title}</span>
                    <span className="cc-muted">{new Date(c.updatedAt).toLocaleString()}{c.running ? ' · working' : ''}</span>
                  </button>
                  <button className="cc-icon-btn" title="Delete" disabled={c.running} onClick={async () => {
                    await deleteConversation(c.id).catch((e) => setError(e.message));
                    setHistory((prev) => prev.filter((x) => x.id !== c.id));
                    if (c.id === conversationId) setParams({});
                  }}><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
