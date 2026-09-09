// Turning a parsed message into something the user can approve in one tap.
//
// The ingest service stops at what the raw text says: an amount, a direction,
// a merchant string, four card digits. It cannot go further, because account,
// payee and category names are encrypted and the server has no key. This
// module does the rest, on the device, and remembers each decision so the same
// message next month needs no decision at all.

export const DEFAULT_AUTOMATION_RULES = {
  // "1234" -> account name
  accountByLast4: {},
  // normalised merchant text -> payee name
  payeeByMerchant: {},
  // payee name -> category name
  categoryByPayee: {}
};

/** Lowercased, punctuation-stripped, collapsed. Merchant strings arrive with
 *  wildly inconsistent spacing, casing and trailing terminal ids. */
export function normaliseMerchant(value) {
  if (!value) return '';
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const JOINING_WORDS = new Set(['of', 'and', 'the', 'for', 'at', 'in', 'to', 'on']);

/** Title Case, for turning "METRO CASH CARRY" into a readable payee name. */
export function prettifyMerchant(value) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  // Something already mixed-case was written deliberately — leave it alone.
  if (cleaned !== cleaned.toUpperCase() && cleaned !== cleaned.toLowerCase()) {
    return cleaned;
  }
  return cleaned
    .toLowerCase()
    .split(' ')
    .map(word => {
      // Joining words read wrong shouted: "BANK OF PUNJAB" is not "Bank OF
      // Punjab".
      if (JOINING_WORDS.has(word)) return word;
      // Anything this short in an all-caps merchant string is an acronym or a
      // city code - KFC, MCB, ISB - and title-casing it produces "Kfc".
      if (word.length <= 3) return word.toUpperCase();
      return word[0].toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function findByName(items, name) {
  if (!name) return null;
  const target = String(name).toLowerCase();
  return items.find(item => String(item.name).toLowerCase() === target) || null;
}

/**
 * Guess the account a draft belongs to.
 *
 * In order: a rule the user taught us, an account whose own name carries the
 * card digits, then nothing. Guessing an arbitrary account would be worse than
 * leaving it blank — a transaction on the wrong account is harder to notice
 * than one the user was asked about.
 */
export function suggestAccount(draft, accounts, rules) {
  const last4 = draft?.parsed?.last4;

  if (last4) {
    const learned = findByName(accounts, rules?.accountByLast4?.[last4]);
    if (learned) return learned.name;

    const byDigits = accounts.find(account => String(account.name).includes(last4));
    if (byDigits) return byDigits.name;
  }

  // A single-account budget has only one sensible answer.
  if (accounts.length === 1) return accounts[0].name;
  return '';
}

/** Payee: a learned mapping first, then the merchant string tidied up. */
export function suggestPayee(draft, payees, rules) {
  const merchant = draft?.parsed?.merchant;
  if (!merchant) return '';

  const key = normaliseMerchant(merchant);
  const learned = rules?.payeeByMerchant?.[key];
  if (learned) return learned;

  // An existing payee that already matches, however it was capitalised.
  const existing = payees.find(payee => normaliseMerchant(payee.name) === key);
  if (existing) return existing.name;

  return prettifyMerchant(merchant);
}

/** Category comes from the payee, which is the association people actually
 *  think in — "Careem is Transport" — rather than from the raw merchant. */
export function suggestCategory(payeeName, categories, rules) {
  if (!payeeName) return '';
  const learned = rules?.categoryByPayee?.[payeeName];
  if (learned && findByName(categories, learned)) return learned;
  return '';
}

/**
 * Everything the review row needs, pre-filled.
 *
 * `type` follows the app's convention: 0 expense, 1 income, 2 transfer. A
 * draft is never a transfer — no single message describes both sides — so an
 * unreadable direction falls back to expense, which is what the overwhelming
 * majority of card messages are.
 */
export function draftToSuggestion(draft, { accounts = [], categories = [], payees = [], rules } = {}) {
  const parsed = draft?.parsed || {};
  const effectiveRules = rules || DEFAULT_AUTOMATION_RULES;

  const payee = suggestPayee(draft, payees, effectiveRules);
  const account = suggestAccount(draft, accounts, effectiveRules);
  const accountRecord = findByName(accounts, account);

  return {
    type: parsed.direction === 'credit' ? 1 : 0,
    amount: parsed.amount != null ? String(parsed.amount) : '',
    // The form wants a plain yyyy-mm-dd, and occurredAt is a full ISO stamp.
    date: toDateInput(parsed.occurredAt || draft?.receivedAt),
    account,
    payee,
    category: suggestCategory(payee, categories, effectiveRules),
    // The account's own currency wins over the one in the message: a PKR card
    // billed for a USD purchase still posts to a PKR account.
    currency: accountRecord?.currency || parsed.currency || 'PKR',
    note: buildNote(draft),
    directionKnown: parsed.direction === 'credit' || parsed.direction === 'debit'
  };
}

function toDateInput(value) {
  if (!value) return new Date().toISOString().substring(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().substring(0, 10);
  return date.toISOString().substring(0, 10);
}

/** A short provenance line, so a transaction added this way can be recognised
 *  as such months later. */
function buildNote(draft) {
  const bank = draft?.parsed?.bank || draft?.sender;
  const source = draft?.source === 'notification' ? 'notification' : 'SMS';
  return bank ? `Auto-added from ${bank} ${source}` : `Auto-added from ${source}`;
}

/**
 * Fold an approved review into the rule set.
 *
 * Only genuine signal is recorded: a card mapping needs card digits, a payee
 * mapping needs a merchant string, and a category mapping needs both a payee
 * and a category. Returns the same object when nothing was learned, so callers
 * can skip a settings write and the sync round trip it triggers.
 */
export function learnFromApproval(rules, draft, chosen) {
  const current = rules || DEFAULT_AUTOMATION_RULES;
  const parsed = draft?.parsed || {};
  const next = {
    accountByLast4: { ...current.accountByLast4 },
    payeeByMerchant: { ...current.payeeByMerchant },
    categoryByPayee: { ...current.categoryByPayee }
  };

  let changed = false;

  if (parsed.last4 && chosen.account && next.accountByLast4[parsed.last4] !== chosen.account) {
    next.accountByLast4[parsed.last4] = chosen.account;
    changed = true;
  }

  const merchantKey = normaliseMerchant(parsed.merchant);
  if (merchantKey && chosen.payee && next.payeeByMerchant[merchantKey] !== chosen.payee) {
    next.payeeByMerchant[merchantKey] = chosen.payee;
    changed = true;
  }

  if (chosen.payee && chosen.category && next.categoryByPayee[chosen.payee] !== chosen.category) {
    next.categoryByPayee[chosen.payee] = chosen.category;
    changed = true;
  }

  return changed ? next : current;
}

/** Confidence, as something a person can read. */
export function confidenceLabel(confidence) {
  if (confidence >= 0.85) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}
