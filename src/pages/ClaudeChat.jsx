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
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Sparkles, SquarePen, PanelLeft, Trash2, AlertTriangle, ArrowDown, Paperclip, Receipt, PieChart, Inbox, Scale, X,
} from 'lucide-react';
import {
  canUseClaude, listConversations, getConversation, deleteConversation, sendMessage, stopConversation,
  answerApproval, streamConversation,
} from '../utils/claudeApi';
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
    if (ev.t === 'user') { cur = { key: ev.seq, user: ev, items: [] }; turns.push(cur); continue; }
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

function ConversationList({ items, activeId, onOpen, onDelete, onNew }) {
  return (
    <div className="cc-list">
      <button className="cc-new" onClick={onNew}><SquarePen size={16} /> New chat</button>
      <div className="cc-list-label">Recent</div>
      {items.length === 0 && <div className="cc-list-empty">Nothing yet.</div>}
      {items.map((c) => (
        <div key={c.id} className={`cc-list-item ${c.id === activeId ? 'active' : ''}`}>
          <button className="cc-list-open" onClick={() => onOpen(c.id)}>
            <span className="cc-list-title">{c.title}</span>
            <span className="cc-list-time">{c.running && <span className="cc-live-dot" />}{c.running ? 'working' : ago(c.updatedAt)}</span>
          </button>
          <button className="cc-list-del" title="Delete" disabled={c.running} onClick={() => onDelete(c.id)}><Trash2 size={14} /></button>
        </div>
      ))}
    </div>
  );
}

export default function ClaudeChat() {
  const [params, setParams] = useSearchParams();
  const conversationId = params.get('c');
  const [events, setEvents] = useState([]);
  const [liveText, setLiveText] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [dragging, setDragging] = useState(false);
  const streamRef = useRef(null);
  const lastSeq = useRef(-1);
  const composer = useRef(null);
  const endRef = useRef(null);

  const scroller = () => document.querySelector('.main-content');
  const scrollToEnd = (smooth = true) => endRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });

  const refreshList = useCallback(() => {
    listConversations().then((r) => setConversations(r.conversations)).catch(() => {});
  }, []);
  useEffect(() => { if (canUseClaude()) refreshList(); }, [refreshList]);

  const applyEvent = useCallback((ev) => {
    if (ev.t === 'delta') { setLiveText(ev.text); return; }
    if (ev.t === 'idle') { setRunning(false); setLiveText(''); refreshList(); return; }
    if (ev.t === 'patch') {
      setEvents((prev) => prev.map((e) => (e.seq === ev.target ? { ...e, ...ev.patch } : e)));
      return;
    }
    if (typeof ev.seq !== 'number') return;
    if (ev.t === 'assistant' || ev.t === 'tool') setLiveText('');
    lastSeq.current = Math.max(lastSeq.current, ev.seq);
    setEvents((prev) => (prev.some((e) => e.seq === ev.seq) ? prev : [...prev, ev]));
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

  // Open the conversation the URL names; pick up a turn that is still running.
  useEffect(() => {
    streamRef.current?.abort();
    lastSeq.current = -1;
    setEvents([]);
    setLiveText('');
    setRunning(false);
    setError(null);
    if (!conversationId) return undefined;
    let cancelled = false;
    getConversation(conversationId)
      .then((c) => {
        if (cancelled) return;
        c.events.forEach((ev) => { lastSeq.current = Math.max(lastSeq.current, ev.seq); });
        setEvents(c.events);
        requestAnimationFrame(() => scrollToEnd(false));
        if (c.running) follow(conversationId);
      })
      .catch((e) => !cancelled && setError(e.status === 404 ? 'That conversation no longer exists.' : e.message));
    return () => { cancelled = true; streamRef.current?.abort(); };
  }, [conversationId, follow]);

  // A phone suspends the page; catch up when it comes back.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !conversationId || streamRef.current) return;
      getConversation(conversationId).then((c) => {
        c.events.forEach(applyEvent);
        setEvents((prev) => prev.map((e) => c.events.find((x) => x.seq === e.seq) || e));
        if (c.running) follow(conversationId); else setRunning(false);
      }).catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [conversationId, follow, applyEvent]);

  // Follow new content only while the reader is at the bottom.
  useEffect(() => {
    const el = scroller();
    if (!el) return undefined;
    const onScroll = () => setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => { if (atBottom) scrollToEnd(); }, [events.length, liveText, running]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSend = async (text, files) => {
    setError(null);
    try {
      const { conversationId: id } = await sendMessage({ conversationId, text, files });
      setAtBottom(true);
      if (id !== conversationId) {
        lastSeq.current = -1;
        setParams({ c: id });
      } else {
        follow(id);
      }
      refreshList();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  };

  const onAnswer = async (approvalId, approve) => {
    try {
      await answerApproval(conversationId, approvalId, approve);
      if (!streamRef.current) follow(conversationId);
    } catch (e) {
      setError(e.message);
    }
  };

  const onDelete = async (id) => {
    try {
      await deleteConversation(id);
      setConversations((prev) => prev.filter((x) => x.id !== id));
      if (id === conversationId) setParams({});
    } catch (e) {
      setError(e.message);
    }
  };

  const open = (id) => { setParams(id ? { c: id } : {}); setSheetOpen(false); };

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
        <ConversationList items={conversations} activeId={conversationId} onOpen={open} onDelete={onDelete} onNew={() => open(null)} />
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
            const hasReply = turn.items.length > 0 || (last && (running || liveText));
            return (
              <Fragment key={turn.key}>
                {turn.user && (
                  <motion.div className="cc-user" {...fade}>
                    {turn.user.files?.length > 0 && (
                      <div className="cc-user-files">
                        {turn.user.files.map((f) => (
                          <span key={f.name} className="cc-user-file"><Paperclip size={12} />{f.name.replace(/^\d{8}-\d{6}-[a-f0-9]{6}-/, '')}</span>
                        ))}
                      </div>
                    )}
                    {turn.user.text && <div className="cc-user-text">{turn.user.text}</div>}
                  </motion.div>
                )}
                {hasReply && (
                  <motion.div className="cc-turn" {...fade}>
                    <div className="cc-avatar"><Sparkles size={14} /></div>
                    <div className="cc-turn-body">
                      {turn.items.map((it) => {
                        if (it.kind === 'text') return <Markdown key={it.key} text={it.ev.text} />;
                        if (it.kind === 'steps') return <StepGroup key={it.key} items={it.items} />;
                        if (it.kind === 'approval') return <ReviewCard key={it.key} ev={it.ev} onAnswer={onAnswer} />;
                        return <div key={it.key} className="cc-error"><AlertTriangle size={14} /> {it.ev.message}</div>;
                      })}
                      {last && liveText && <div className="cc-live"><Markdown text={liveText} /></div>}
                      {showDots && <div className="cc-dots"><span /><span /><span /></div>}
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

      <AnimatePresence>
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
              <ConversationList items={conversations} activeId={conversationId} onOpen={open} onDelete={onDelete} onNew={() => open(null)} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
