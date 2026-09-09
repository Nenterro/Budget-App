import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Wallet, User, Tag, Check, X, ArrowRightLeft } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useAutomationSettings } from '../context/SettingsContext';
import UnifiedDropdown from '../components/UnifiedDropdown';
import { normaliseMerchant } from '../utils/inboxDraft';
import './ManageData.css';
import './AutomationSettings.css';

/**
 * The rules the review queue has learned, laid out so they can be corrected
 * and pre-loaded by hand.
 *
 * These are the same three maps that approving a detected transaction writes
 * to. The reason this page exists is that some of them cannot reasonably be
 * learned by approval alone: a bank identifier like "PK*SADA5107" says nothing
 * about who it is, and waiting for the transfer to arrive before naming them
 * means the first one is always filed wrong.
 */

function MappingRow({ entryKey, value, options, placeholder, onCommit, onDelete }) {
  const [draftValue, setDraftValue] = useState(value);

  // Free-text edits commit on blur rather than per keystroke: every commit is
  // a settings write and a sync round trip.
  const commitText = () => {
    const trimmed = draftValue.trim();
    if (trimmed && trimmed !== value) onCommit(trimmed);
    else if (!trimmed) setDraftValue(value);
  };

  return (
    <div className="am-row">
      <code className="am-key" title={entryKey}>{entryKey}</code>
      <div className="am-value">
        {options ? (
          <UnifiedDropdown
            value={value}
            options={options}
            onChange={onCommit}
            placeholder={placeholder}
          />
        ) : (
          <input
            type="text"
            value={draftValue}
            onChange={e => setDraftValue(e.target.value)}
            onBlur={commitText}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            placeholder={placeholder}
          />
        )}
      </div>
      <button className="am-delete" onClick={onDelete} title="Remove mapping" type="button">
        <Trash2 size={16} />
      </button>
    </div>
  );
}

function AddRow({ keyPlaceholder, valuePlaceholder, options, onAdd, onCancel }) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const submit = () => {
    const key = newKey.trim();
    const value = newValue.trim();
    if (!key || !value) return;
    onAdd(key, value);
  };

  return (
    <div className="am-row am-row-new">
      <input
        className="am-key-input"
        type="text"
        value={newKey}
        onChange={e => setNewKey(e.target.value)}
        placeholder={keyPlaceholder}
        autoFocus
      />
      <div className="am-value">
        {options ? (
          <UnifiedDropdown
            value={newValue}
            options={options}
            onChange={setNewValue}
            placeholder={valuePlaceholder}
          />
        ) : (
          <input
            type="text"
            value={newValue}
            onChange={e => setNewValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            placeholder={valuePlaceholder}
          />
        )}
      </div>
      <button
        className="am-confirm"
        onClick={submit}
        disabled={!newKey.trim() || !newValue.trim()}
        title="Save mapping"
        type="button"
      >
        <Check size={16} />
      </button>
      <button className="am-delete" onClick={onCancel} title="Cancel" type="button">
        <X size={16} />
      </button>
    </div>
  );
}

function MappingSection({
  icon: Icon, title, description, emptyText,
  map, options, keyPlaceholder, valuePlaceholder,
  normaliseKey, onChange
}) {
  const [isAdding, setIsAdding] = useState(false);
  const entries = useMemo(
    () => Object.entries(map || {}).sort(([a], [b]) => a.localeCompare(b)),
    [map]
  );

  const setEntry = (key, value) => onChange({ ...map, [key]: value });

  const removeEntry = (key) => {
    const next = { ...map };
    delete next[key];
    onChange(next);
  };

  const addEntry = (rawKey, value) => {
    const key = normaliseKey ? normaliseKey(rawKey) : rawKey;
    if (!key) return;
    onChange({ ...map, [key]: value });
    setIsAdding(false);
  };

  return (
    <div className="am-section glass-panel">
      <div className="am-section-head">
        <div className="am-section-icon"><Icon size={16} /></div>
        <div className="am-section-titles">
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>

      {entries.length === 0 && !isAdding ? (
        <div className="am-empty">{emptyText}</div>
      ) : (
        <div className="am-rows">
          {entries.map(([key, value]) => (
            <MappingRow
              key={key}
              entryKey={key}
              value={value}
              options={options}
              placeholder={valuePlaceholder}
              onCommit={(next) => setEntry(key, next)}
              onDelete={() => removeEntry(key)}
            />
          ))}
        </div>
      )}

      {isAdding ? (
        <AddRow
          keyPlaceholder={keyPlaceholder}
          valuePlaceholder={valuePlaceholder}
          options={options}
          onAdd={addEntry}
          onCancel={() => setIsAdding(false)}
        />
      ) : (
        <button className="am-add-btn" onClick={() => setIsAdding(true)} type="button">
          <Plus size={16} /> Add mapping
        </button>
      )}
    </div>
  );
}

/**
 * A plain list rather than a mapping: these names have no target, they simply
 * mean "this is me".
 */
function SelfLabelsSection({ labels, onChange }) {
  const [isAdding, setIsAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');

  const add = () => {
    const value = newLabel.trim();
    if (!value) return;
    if (!labels.some(l => l.toLowerCase() === value.toLowerCase())) {
      onChange([...labels, value]);
    }
    setNewLabel('');
    setIsAdding(false);
  };

  return (
    <div className="am-section glass-panel">
      <div className="am-section-head">
        <div className="am-section-icon"><ArrowRightLeft size={16} /></div>
        <div className="am-section-titles">
          <h2>Names that mean you</h2>
          <p>
            Wallets label a transfer between your own accounts with the account
            holder's name on both sides, so neither message says where the money
            went. Two messages naming the same counterparty are already matched
            automatically — add a name here only when the two apps write it
            differently.
          </p>
        </div>
      </div>

      {labels.length === 0 && !isAdding ? (
        <div className="am-empty">
          No names added. Matching still works whenever both messages spell the
          counterparty the same way.
        </div>
      ) : (
        <div className="am-rows">
          {labels.map(label => (
            <div className="am-row" key={label}>
              <div className="am-value">
                <input type="text" value={label} readOnly />
              </div>
              <button
                className="am-delete"
                onClick={() => onChange(labels.filter(l => l !== label))}
                title="Remove name"
                type="button"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {isAdding ? (
        <div className="am-row am-row-new">
          <div className="am-value">
            <input
              type="text"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') add(); }}
              placeholder="Huzaifa Sadeem"
              autoFocus
            />
          </div>
          <button className="am-confirm" onClick={add} disabled={!newLabel.trim()} type="button">
            <Check size={16} />
          </button>
          <button className="am-delete" onClick={() => { setIsAdding(false); setNewLabel(''); }} type="button">
            <X size={16} />
          </button>
        </div>
      ) : (
        <button className="am-add-btn" onClick={() => setIsAdding(true)} type="button">
          <Plus size={16} /> Add name
        </button>
      )}
    </div>
  );
}

export default function AutomationSettings() {
  const navigate = useNavigate();
  const { accounts, categories, payees } = useData();
  const { automationRules, setAutomationRules } = useAutomationSettings();

  const accountOptions = accounts.map(a => ({ value: a.name, label: a.name }));
  const categoryOptions = categories.map(c => ({ value: c.name, label: c.name }));

  const update = (patch) => setAutomationRules({ ...automationRules, ...patch });

  const total =
    Object.keys(automationRules.accountByLast4).length +
    Object.keys(automationRules.payeeByMerchant).length +
    Object.keys(automationRules.categoryByPayee).length +
    (automationRules.selfLabels?.length || 0);

  return (
    <div className="page-container manage-data-page">
      <div className="manage-header">
        <button className="back-btn" onClick={() => navigate('/settings')} title="Go Back">
          <ArrowLeft size={24} />
        </button>
        <h1>Detection Rules</h1>
      </div>

      <div className="manage-content">
        <p className="am-intro">
          How transactions detected from your bank SMS get filled in. Every time
          you confirm one, what you chose is remembered here — so the next
          message from the same card or merchant needs no edits.
          {total > 0 && ` ${total} rule${total === 1 ? '' : 's'} so far.`}
        </p>

        <MappingSection
          icon={User}
          title="Senders and merchants to payees"
          description="Banks write the counterparty as it appears on the account — often an identifier like PK*SADA5107 rather than a name. Map it once and it is recognised from then on."
          emptyText="No payee mappings yet. Confirm a detected transaction, or add one here so the first message from someone is already named."
          map={automationRules.payeeByMerchant}
          keyPlaceholder="PK*SADA5107"
          valuePlaceholder="Payee name"
          // Matching ignores case and punctuation, so the key is stored in the
          // same normalised form the parser produces.
          normaliseKey={normaliseMerchant}
          onChange={(next) => update({ payeeByMerchant: next })}
        />

        <MappingSection
          icon={Wallet}
          title="Card digits to accounts"
          description="The last four digits a message quotes, and which of your accounts they belong to."
          emptyText="No card mappings yet. Until one exists, the account is guessed from the sender name."
          map={automationRules.accountByLast4}
          options={accountOptions}
          keyPlaceholder="5664"
          valuePlaceholder="Choose account"
          normaliseKey={(raw) => raw.replace(/\D/g, '').slice(-4)}
          onChange={(next) => update({ accountByLast4: next })}
        />

        <MappingSection
          icon={Tag}
          title="Payees to categories"
          description="Which category a payee usually belongs to. Where there is no rule, your past transactions are used instead."
          emptyText="No category rules yet. Your existing transaction history is used until one is set."
          map={automationRules.categoryByPayee}
          options={categoryOptions}
          keyPlaceholder={payees[0]?.name || 'Payee name'}
          valuePlaceholder="Choose category"
          onChange={(next) => update({ categoryByPayee: next })}
        />

        <SelfLabelsSection
          labels={automationRules.selfLabels || []}
          onChange={(next) => update({ selfLabels: next })}
        />
      </div>
    </div>
  );
}
