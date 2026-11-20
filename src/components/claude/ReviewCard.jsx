// The approval card: what Claude has staged, laid out so it can be checked
// at a glance, and the only place a change to the budget gets the go-ahead.
// The server waits on the answer given here before anything is written.

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, Plus, Pencil, Trash2, AlertTriangle, Check, X, Loader2, ChevronDown, MessageSquareText, Settings2, Terminal } from 'lucide-react';
import { formatSignedAmount } from '../../utils/accounts';

const OP = {
  create: { icon: Plus, label: 'New', tone: 'add' },
  update: { icon: Pencil, label: 'Edit', tone: 'edit' },
  delete: { icon: Trash2, label: 'Remove', tone: 'remove' },
};
const SINGULAR = { categories: 'Category', payees: 'Payee', accounts: 'Account', budgets: 'Budget' };
const FOLD_AT = 6;

const pretty = (raw) => {
  const v = raw.trim();
  if (v === 'null' || v === '""' || v === 'undefined') return '—';
  try {
    const parsed = JSON.parse(v);
    if (typeof parsed === 'string') return parsed;
    if (typeof parsed === 'number') return parsed.toLocaleString();
    if (typeof parsed === 'boolean') return parsed ? 'Yes' : 'No';
  } catch { /* not JSON: shown as written */ }
  return v;
};

const fieldName = (path) => {
  const rule = path.match(/^config\.automation\.(\w+)\.(.+)$/);
  if (rule) {
    const kinds = { payeeByMerchant: 'SMS payee rule', accountByLast4: 'Card rule', categoryByPayee: 'Category rule', selfLabels: 'Own-name rule' };
    return `${kinds[rule[1]] || rule[1]} “${rule[2]}”`;
  }
  const last = path.split('.').pop();
  return last.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
};

function DiffLine({ line }) {
  const m = line.match(/^(.+?): (.*) -> (.*)$/);
  if (!m) return <div className="ccr-diff">{line}</div>;
  const [, path, before, after] = m;
  const was = pretty(before);
  const now = pretty(after);
  return (
    <div className="ccr-diff" title={path}>
      <span className="ccr-diff-field">{fieldName(path)}</span>
      {was !== '—' && <span className="ccr-diff-old">{was}</span>}
      {was !== '—' && <span className="ccr-diff-arrow">→</span>}
      <span className={now === '—' ? 'ccr-diff-old' : 'ccr-diff-new'}>{now === '—' ? 'removed' : now}</span>
    </div>
  );
}

function Subject({ change }) {
  const d = change.detail || {};
  if (change.collection === 'transactions' && d.date) {
    const isTransfer = d.type === 'transfer';
    const title = isTransfer ? `${d.account} → ${d.transfer_to}` : (d.payee && d.payee !== 'Unspecified' ? d.payee : d.category || 'Transaction');
    const meta = isTransfer ? ['Transfer', d.date] : [d.category, d.account, d.date];
    return (
      <div className="ccr-subject">
        <div className="ccr-line1">
          <span className="ccr-title">{title}</span>
          <span className={`ccr-amount ${d.amount < 0 ? 'neg' : 'pos'}`}>{formatSignedAmount(d.amount, d.currency)}</span>
        </div>
        <div className="ccr-meta">{meta.filter(Boolean).join(' · ')}</div>
        {d.splits?.length > 0 && <div className="ccr-meta">Split: {d.splits.map((s) => `${s.category} ${formatSignedAmount(s.amount, d.currency)}`).join(', ')}</div>}
        {d.note && <div className="ccr-note">{d.note}</div>}
      </div>
    );
  }
  if (change.collection === 'inbox_messages') {
    const p = d.parsed || {};
    return (
      <div className="ccr-subject">
        <div className="ccr-line1">
          <span className="ccr-title"><MessageSquareText size={14} /> Detected {d.sender ? `${d.sender} ` : ''}message</span>
          {p.amount != null && <span className="ccr-amount">{formatSignedAmount(p.direction === 'debit' ? -p.amount : p.amount, p.currency)}</span>}
        </div>
        <div className="ccr-meta">{change.op === 'delete' ? 'Removed from the review queue' : 'Amount left to review changes'}{p.merchant ? ` · ${p.merchant}` : ''}</div>
      </div>
    );
  }
  if (change.collection === 'settings') {
    return <div className="ccr-subject"><div className="ccr-line1"><span className="ccr-title"><Settings2 size={14} /> App settings</span></div></div>;
  }
  return (
    <div className="ccr-subject">
      <div className="ccr-line1"><span className="ccr-title">{d.name || d.category || change.summary}</span></div>
      <div className="ccr-meta">{[SINGULAR[change.collection] || change.collection, d.month, d.currency].filter(Boolean).join(' · ')}</div>
    </div>
  );
}

function ChangeRow({ change }) {
  const op = OP[change.op] || OP.update;
  const Icon = op.icon;
  return (
    <div className="ccr-row">
      <div className={`ccr-op ccr-op-${op.tone}`} title={op.label}><Icon size={13} strokeWidth={2.5} /></div>
      <div className="ccr-body">
        <Subject change={change} />
        {change.diff?.length > 0 && <div className="ccr-diffs">{change.diff.map((d, j) => <DiffLine key={j} line={d} />)}</div>}
        {change.warnings?.map((w, j) => <div className="ccr-warn" key={j}><AlertTriangle size={12} /> {w}</div>)}
      </div>
    </div>
  );
}

function counts(groups) {
  const c = { create: 0, update: 0, delete: 0 };
  groups.forEach((g) => g.changes.forEach((ch) => { c[ch.op] = (c[ch.op] || 0) + 1; }));
  return [c.create && `${c.create} new`, c.update && `${c.update} edited`, c.delete && `${c.delete} removed`].filter(Boolean).join(' · ');
}

export default function ReviewCard({ ev, onAnswer }) {
  const [busy, setBusy] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const pending = ev.status === 'pending';
  const groups = ev.staged?.groups || [];
  const total = ev.staged?.count ?? groups.reduce((n, g) => n + g.changes.length, 0);

  const answer = async (approve) => {
    setBusy(approve ? 'approve' : 'deny');
    try { await onAnswer(ev.id, approve); } finally { setBusy(null); }
  };

  if (!pending) {
    const ok = ev.status === 'approved';
    return (
      <div className={`ccr-resolved ${ok ? 'ok' : 'no'}`}>
        {ok ? <Check size={14} /> : <X size={14} />}
        {ev.kind === 'apply'
          ? `${ok ? 'Approved' : 'Declined'} ${total} change${total === 1 ? '' : 's'}`
          : `${ok ? 'Allowed' : 'Declined'} ${ev.tool}`}
      </div>
    );
  }

  let shown = 0;
  return (
    <motion.div className="ccr" initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
      <div className="ccr-head">
        <div className="ccr-shield">{ev.kind === 'apply' ? <ShieldCheck size={18} /> : <Terminal size={18} />}</div>
        <div>
          <div className="ccr-heading">{ev.kind === 'apply' ? `Review ${total} change${total === 1 ? '' : 's'}` : 'Allow this step?'}</div>
          <div className="ccr-sub">{ev.kind === 'apply' ? counts(groups) : ev.tool}</div>
        </div>
      </div>

      {ev.kind === 'apply' && (
        <div className="ccr-list">
          {groups.map((g) => {
            if (!expanded && shown >= FOLD_AT) return null;
            const changes = expanded ? g.changes : g.changes.slice(0, Math.max(0, FOLD_AT - shown));
            shown += changes.length;
            return (
              <div className="ccr-group" key={g.id}>
                {(g.changes.length > 1 || String(g.id).match(/^\d+$/)) && <div className="ccr-group-title">{g.title}</div>}
                {changes.map((c) => <ChangeRow key={c.n} change={c} />)}
              </div>
            );
          })}
          {total > FOLD_AT && (
            <button className="ccr-more" onClick={() => setExpanded((v) => !v)}>
              <ChevronDown size={14} style={{ transform: expanded ? 'rotate(180deg)' : 'none' }} />
              {expanded ? 'Show less' : `Show all ${total}`}
            </button>
          )}
          {ev.staged?.error && <div className="ccr-warn"><AlertTriangle size={12} /> Could not load the changes: {ev.staged.error}</div>}
        </div>
      )}
      {ev.kind === 'tool' && <pre className="ccr-code">{JSON.stringify(ev.input, null, 1).slice(0, 1500)}</pre>}

      <div className="ccr-actions">
        <button className="ccr-btn ccr-deny" disabled={!!busy} onClick={() => answer(false)}>
          {busy === 'deny' ? <Loader2 size={16} className="cc-spin" /> : null} Decline
        </button>
        <button className="ccr-btn ccr-approve" disabled={!!busy} onClick={() => answer(true)}>
          {busy === 'approve' ? <Loader2 size={16} className="cc-spin" /> : <Check size={16} />}
          {ev.kind === 'apply' ? 'Approve' : 'Allow'}
        </button>
      </div>
    </motion.div>
  );
}
