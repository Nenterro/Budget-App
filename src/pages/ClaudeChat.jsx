// The Claude page: chat with Claude about the budget, hand it receipts and
// statements, and approve the changes it prepares.
//
// Claude runs on the home server (budget-agent); this page sends messages,
// follows the conversation as a stream of events, and answers approval cards.
// Nothing Claude stages is written until Approve is pressed on its card: the
// server waits for that answer.
//
// The page scrolls with .main-content like every other page (an inner scroll
// area would turn every downward swipe into the app's pull-to-refresh), with
// the header and the composer sticky.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Sparkles, SquarePen, PanelLeft, Trash2, AlertTriangle, ArrowDown, Paperclip, Receipt, PieChart, Inbox, Scale, X, RotateCcw,
} from 'lucide-react';
import {
  canUseClaude, listConversations, getConversation, deleteConversation, sendMessage, stopConversation,
  answerApproval, streamConversation, warmConversation,
} from '../utils/claudeApi';
import * as cache from '../utils/claudeCache';
import Markdown from '../components/claude/Markdown';
import ReviewCard from '../components/claude/ReviewCard';
import StepGroup from '../components/claude/StepGroup';
import Composer from '../components/claude/Composer';
import './ClaudeChat.css';

const SUGGESTIONS = [
  { icon: PieChart, title: 'Where did my money go?', text: 'How much have I spent this month, and on what?' },
  { icon: Inbox, title: 'Detected transactions', text: 'Go through my detected transactions and suggest how to file them' },
  { icon: Receipt, title: 'Add a receipt', text: 'I am attaching a receipt, add it to the right account' },
  { icon: Scale, title: 'Reconcile a statement', text: 'Reconcile my Askari account against the statement I am attaching' },
];

const fade = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] } };

function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Events -> turns: a user message, then everything Claude did in reply. */
function buildTurns(events) {
  const turns = [];
  let cur = null;
  for (const ev of events) {
    if (ev.t === 'user') { cur = { key: ev.clientId || ev.seq, user: ev, items: [] }; turns.push(cur); continue; }
    if (!cur) { cur = { key: `t${ev.seq}`, user: null, items: [] }; turns.push(cur); }
    const last = cur.items[cur.items.length - 1];
    if (ev.t === 'tool' || ev.t === 'image') {
      if (last?.kind === 'steps') last.items.push(ev);
      else cur.items.push({ kind: 'steps', key: ev.seq, items: [ev] });
    } else if (ev.t === 'assistant') cur.items.push({ kind: 'text', key: ev.seq, ev });
    else if (ev.t === 'approval') cur.items.push({ kind: 'approval', key: ev.seq, ev });
    else if (ev.t === 'error') cur.items.push({ kind: 'error', key: ev.seq, ev });
  }
  return turns;
}

function ConversationList({ items, activeId, onOpen, onDelete, onNew, onPrefetch }) {
  return (
    <div className="cc-list">
      <button className="cc-new" onClick={onNew}><SquarePen size={16} /> New chat</button>
      <div className="cc-list-label">Recent</div>
      {items.length === 0 && <div className="cc-list-empty">Nothing yet.</div>}
      {items.map((c) => (
        <div key={c.id} className={`cc-list-item ${c.id === activeId ? 'active' : ''}`}>
          <button className="cc-list-open" onClick={() => onOpen(c.id)} onPointerDown={() => onPrefetch(c.id)} onPointerEnter={() => onPrefetch(c.id)}>
            <span className="cc-list-title">{c.title}</span>
            <span className="cc-list-time">{c.running && <span className="cc-live-dot" />}{c.running ? 'working' : ago(c.updatedAt)}</span>
          </button>
          <button className="cc-list-del" title="Delete" disabled={c.running} onClick={() => onDelete(c.id)}><Trash2 size={14} /></button>
        </div>
      ))}
    </div>
  );
}

const newId = () => crypto.randomUUID();
const maxSeq = (events) => events.reduce((m, e) => (typeof e.seq === 'number' && e.seq > m ? e.seq : m), -1);
const settled = (events) => events.filter((e) => !e.pending);

export default function ClaudeChat() {
  const [params, setParams] = useSearchParams();
  const conversationId = params.get('c');
  // A new chat already has its id: the server is told it when warming up and
  // when the first message goes, so starting a chat never waits on a reply.
  const [draftId, setDraftId] = useState(newId);
  const activeId = conversationId || draftId;

  const [events, setEvents] = useState(() => cache.getConvo(conversationId)?.events || []);
  const [liveText, setLiveText] = useState('');
  const [thinking, setThinking] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [conversations, setConversations] = useState(cache.getList);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [dragging, setDragging] = useState(false);
  const streamRef = useRef(null);
  const lastSeq = useRef(-1);
  const composer = useRef(null);
  const endRef = useRef(null);
  const freshRef = useRef(null);
  const baseSeq = useRef(Infinity); // events up to here were on screen already: no entrance animation // a conversation this page just created: nothing on the server to load yet

  const scroller = () => document.querySelector('.main-content');
  const scrollToEnd = (smooth = true) => endRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });

  const showList = useCallback((next) => { cache.setList(next); setConversations(next); }, []);
  const refreshList = useCallback(() => {
    listConversations().then((r) => showList(r.conversations)).catch(() => {});
  }, [showList]);

  // The list: the cached copy now (or once IndexedDB has loaded), the server's when it answers.
  useEffect(() => {
    if (!canUseClaude()) return;
    cache.ready.then(() => setConversations((prev) => (prev.length ? prev : cache.getList())));
    refreshList();
  }, [refreshList]);

  // Keep the on-device copy of the open conversation current.
  useEffect(() => {
    if (!conversationId) return;
    const real = settled(events);
    if (real.length) cache.setConvo(conversationId, { id: conversationId, events: real });
  }, [events, conversationId]);

  const applyEvent = useCallback((ev) => {
    switch (ev.t) {
      case 'thinking': setThinking(true); return;
      case 'delta': setThinking(false); setLiveText(ev.text); return;
      case 'idle':
        setRunning(false);
        setLiveText('');
        setThinking(false);
        refreshList();
        return;
      case 'patch':
        setEvents((prev) => prev.map((e) => (e.seq === ev.target ? { ...e, ...ev.patch } : e)));
        return;
      default:
    }
    if (typeof ev.seq !== 'number') return;
    if (ev.t === 'assistant' || ev.t === 'tool') { setLiveText(''); setThinking(false); }
    lastSeq.current = Math.max(lastSeq.current, ev.seq);
    setEvents((prev) => {
      if (prev.some((e) => e.seq === ev.seq)) return prev;
      // The server's copy of a message this page already showed replaces it.
      const rest = ev.t === 'user' && ev.clientId ? prev.filter((e) => e.clientId !== ev.clientId) : prev;
      return [...rest, ev];
    });
  }, [refreshList]);

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

  // Switching conversations: show the cached copy at once, warm Claude up,
  // then take the server's copy and pick up a turn that is still running.
  useEffect(() => {
    setLiveText('');
    setThinking(false);
    setError(null);
    warmConversation(activeId);
    if (freshRef.current === activeId) return undefined; // just created here and already on screen
    streamRef.current?.abort();
    const show = (evs) => {
      lastSeq.current = maxSeq(evs);
      baseSeq.current = maxSeq(evs);
      setEvents(evs);
      requestAnimationFrame(() => scrollToEnd(false));
    };
    show(cache.getConvo(conversationId)?.events || []);
    setRunning(false);
    if (!conversationId) return undefined;
    let cancelled = false;
    let fromServer = false;
    cache.ready.then(() => {
      const cached = cache.getConvo(conversationId);
      if (!cancelled && !fromServer && cached) show(cached.events);
    });
    getConversation(conversationId)
      .then((c) => {
        if (cancelled) return;
        fromServer = true;
        show(c.events);
        if (c.running) follow(conversationId);
      })
      .catch((e) => !cancelled && e.status === 404 && setError('That conversation no longer exists.'));
    return () => { cancelled = true; };
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => streamRef.current?.abort(), []);

  // A phone suspends the page; catch up when it comes back.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !conversationId || streamRef.current) return;
      warmConversation(conversationId);
      getConversation(conversationId).then((c) => {
        lastSeq.current = maxSeq(c.events);
        setEvents((prev) => [...c.events, ...prev.filter((e) => e.pending)]);
        if (c.running) follow(conversationId); else setRunning(false);
      }).catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [conversationId, follow]);

  // Follow new content only while the reader is at the bottom.
  useEffect(() => {
    const el = scroller();
    if (!el) return undefined;
    const onScroll = () => setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => { if (atBottom) scrollToEnd(); }, [events.length, liveText, running, thinking]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sending: the message is on screen and the box is clear before the
  // request leaves; the reply streams back on the same request.
  const onSend = (text, files) => {
    setError(null);
    const id = activeId;
    const clientId = newId();
    const mine = { t: 'user', seq: `pending-${clientId}`, pending: true, clientId, text,
      files: files.map((f) => ({ name: f.name, type: f.type })) };
    setEvents((prev) => [...prev.filter((e) => !e.failed), mine]);
    setRunning(true);
    setThinking(false);
    setAtBottom(true);
    setConversations(cache.touchInList(id, { title: (text || files[0]?.label || 'Files').slice(0, 60), running: true }));
    if (!conversationId) {
      freshRef.current = id;
      setParams({ c: id });
    }

    streamRef.current?.abort();
    const ctl = new AbortController();
    streamRef.current = ctl;
    sendMessage({ conversationId: id, text, files, clientId }, applyEvent, ctl.signal)
      .catch((e) => {
        if (ctl.signal.aborted) return;
        setRunning(false);
        setEvents((prev) => prev.map((ev) => (ev.clientId === clientId && ev.pending ? { ...ev, failed: e.message } : ev)));
      })
      .finally(() => { if (streamRef.current === ctl) streamRef.current = null; });
    return true;
  };

  const retry = (ev) => {
    setEvents((prev) => prev.filter((e) => e !== ev));
    onSend(ev.text || '', []);
  };

  // Answering a card shows the answer at once; it goes back if the server refuses.
  const onAnswer = async (approvalId, approve) => {
    const patch = (status) => setEvents((prev) => prev.map((e) => (e.t === 'approval' && e.id === approvalId ? { ...e, status } : e)));
    patch(approve ? 'approved' : 'denied');
    try {
      await answerApproval(conversationId, approvalId, approve);
      if (!streamRef.current) follow(conversationId);
    } catch (e) {
      patch('pending');
      setError(e.status === 409 ? 'That request had already ended.' : e.message);
    }
  };

  const onDelete = async (id) => {
    const before = conversations;
    cache.removeConvo(id);
    setConversations(cache.getList());
    if (id === conversationId) open(null);
    try {
      await deleteConversation(id);
    } catch (e) {
      showList(before);
      setError(e.message);
    }
  };

  // Fetch a conversation as soon as a finger or pointer lands on it in the
  // list, so it is usually cached before the tap completes.
  const prefetch = (id) => {
    if (id === conversationId) return;
    getConversation(id).then((c) => cache.setConvo(id, { id, events: c.events })).catch(() => {});
  };

  function open(id) {
    freshRef.current = null;
    if (!id) setDraftId(newId());
    setParams(id ? { c: id } : {});
    setSheetOpen(false);
  }

  // A bottom sheet on a phone, a side panel on anything wider.
  const sheetFrom = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches ? { x: '-100%' } : { y: '100%' };
  const turns = useMemo(() => buildTurns(events), [events]);
  const title = conversations.find((c) => c.id === conversationId)?.title;
  const waitingOnYou = events.some((e) => e.t === 'approval' && e.status === 'pending');

  if (!canUseClaude()) {
    return (
      <div className="page-container claude-page">
        <div className="cc-welcome"><div className="cc-orb"><Sparkles size={26} /></div><h2>Sign in to use Claude</h2></div>
      </div>
    );
  }

  return (
    <div
      className="page-container claude-page"
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); composer.current?.addFiles([...e.dataTransfer.files]); }}
    >
      <aside className="cc-sidebar">
        <ConversationList items={conversations} activeId={conversationId} onOpen={open} onDelete={onDelete} onNew={() => open(null)} onPrefetch={prefetch} />
      </aside>

      <section className="cc-main">
        <header className="cc-header">
          <button className="cc-icon cc-sheet-btn" title="Conversations" onClick={() => { refreshList(); setSheetOpen(true); }}>
            <PanelLeft size={18} />
          </button>
          <div className="cc-header-title">
            <Sparkles size={16} className="cc-header-mark" />
            <span>{title || 'Claude'}</span>
          </div>
          <button className="cc-icon" title="New chat" onClick={() => open(null)}><SquarePen size={18} /></button>
        </header>

        <div className="cc-thread">
          {!conversationId && events.length === 0 && (
            <motion.div className="cc-welcome" {...fade}>
              <div className="cc-orb"><Sparkles size={26} /></div>
              <h2>What can I help with?</h2>
              <p>I can read everything in your budget, look at any page, and prepare changes. Nothing changes until you approve it.</p>
              <div className="cc-suggest">
                {SUGGESTIONS.map(({ icon: Icon, title: t, text }) => (
                  <button key={t} className="cc-suggest-card" onClick={() => composer.current?.setText(text)}>
                    <Icon size={18} />
                    <span className="cc-suggest-title">{t}</span>
                    <span className="cc-suggest-text">{text}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {turns.map((turn, ti) => {
            const last = ti === turns.length - 1;
            const lastItem = turn.items[turn.items.length - 1];
            const stepRunning = lastItem?.kind === 'steps' && lastItem.items.some((x) => x.status === 'running');
            const showDots = last && running && !liveText && !waitingOnYou && !stepRunning;
            const hasReply = turn.items.length > 0 || (last && running && !turn.user?.failed);
            const anim = typeof turn.key === 'number' && turn.key <= baseSeq.current ? { initial: false } : fade;
            return (
              <Fragment key={turn.key}>
                {turn.user && (
                  <motion.div className={`cc-user ${turn.user.pending ? 'pending' : ''} ${turn.user.failed ? 'failed' : ''}`} {...anim}>
                    {turn.user.files?.length > 0 && (
                      <div className="cc-user-files">
                        {turn.user.files.map((f) => (
                          <span key={f.name} className="cc-user-file"><Paperclip size={12} />{f.name.replace(/^\d{8}-\d{6}-[a-f0-9]{6}-/, '')}</span>
                        ))}
                      </div>
                    )}
                    {turn.user.text && <div className="cc-user-text">{turn.user.text}</div>}
                    {turn.user.failed && (
                      <button className="cc-retry" onClick={() => retry(turn.user)} title={turn.user.failed}>
                        <AlertTriangle size={12} /> Not sent · <RotateCcw size={12} /> Retry
                      </button>
                    )}
                  </motion.div>
                )}
                {hasReply && (
                  <motion.div className="cc-turn" {...anim}>
                    <div className="cc-avatar"><Sparkles size={14} /></div>
                    <div className="cc-turn-body">
                      {turn.items.map((it) => {
                        if (it.kind === 'text') return <Markdown key={it.key} text={it.ev.text} />;
                        if (it.kind === 'steps') return <StepGroup key={it.key} items={it.items} />;
                        if (it.kind === 'approval') return <ReviewCard key={it.key} ev={it.ev} onAnswer={onAnswer} />;
                        return <div key={it.key} className="cc-error"><AlertTriangle size={14} /> {it.ev.message}</div>;
                      })}
                      {last && liveText && <div className="cc-live"><Markdown text={liveText} /></div>}
                      {showDots && (thinking
                        ? <div className="cc-thinking"><span>Thinking</span></div>
                        : <div className="cc-dots"><span /><span /><span /></div>)}
                    </div>
                  </motion.div>
                )}
              </Fragment>
            );
          })}

          {error && <div className="cc-error cc-error-global"><AlertTriangle size={14} /> {error}</div>}
          <div ref={endRef} className="cc-end" />
        </div>

        <div className="cc-dock">
          <AnimatePresence>
            {!atBottom && events.length > 0 && (
              <motion.button className="cc-jump" onClick={() => scrollToEnd()} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
                <ArrowDown size={16} />
              </motion.button>
            )}
          </AnimatePresence>
          <Composer
            ref={composer}
            running={running}
            onSend={onSend}
            onStop={() => stopConversation(conversationId).catch(() => {})}
            placeholder={waitingOnYou ? 'Waiting for your approval above' : running ? 'Claude is working…' : 'Ask about your budget…'}
          />
        </div>
      </section>

      {/* Portalled: the page's fade-in transform would otherwise trap these
          fixed overlays inside it, under the bottom nav. */}
      {createPortal(<AnimatePresence>
        {dragging && (
          <motion.div className="cc-drop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Paperclip size={28} /><span>Drop to attach</span>
          </motion.div>
        )}
        {sheetOpen && (
          <motion.div className="cc-sheet-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSheetOpen(false)}>
            <motion.div
              className="cc-sheet"
              initial={sheetFrom} animate={{ x: 0, y: 0 }} exit={sheetFrom}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="cc-sheet-head">
                <span>Conversations</span>
                <button className="cc-icon" onClick={() => setSheetOpen(false)}><X size={18} /></button>
              </div>
              <ConversationList items={conversations} activeId={conversationId} onOpen={open} onDelete={onDelete} onNew={() => open(null)} onPrefetch={prefetch} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </div>
  );
}
