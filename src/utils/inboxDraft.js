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
  categoryByPayee: {},
  // Names that mean "me" when they turn up as the counterparty. Wallets label
  // a transfer between your own accounts with the account holder's name on
  // both sides, so the counterparty says nothing about where the money went.
  selfLabels: []
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

// --- Fuzzy name matching --------------------------------------------------
//
// The sender string on a message ("Askari Bank", "SadaPay") is rarely the
// account name the user chose ("Askari Current", "SadaPay Card"). These match
// the two up without needing a rule to have been taught first.

function normaliseName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Words that say nothing about *which* account this is. Without excluding
// them, "Bank Alfalah" and "Askari Bank" share a token and score as a match.
const GENERIC_NAME_WORDS = new Set([
  'bank', 'account', 'acc', 'card', 'current', 'savings', 'saving',
  'limited', 'ltd', 'my', 'the', 'pk', 'pakistan', 'debit', 'credit', 'wallet'
]);

function bigrams(value) {
  const set = new Set();
  for (let i = 0; i < value.length - 1; i++) set.add(value.slice(i, i + 2));
  return set;
}

/**
 * One name's words wholly contained in the other's: "SadaPay" in "SadaPay
 * Card", "Khunsa" in "Syeda Khunsa Usmani".
 *
 * Matched on whole words rather than raw substring, because a plain
 * `includes` also matches "Ali" inside "Alibaba" — which is how a short payee
 * name ends up attached to an unrelated merchant.
 */
function tokenContainment(x, y) {
  const wordsX = x.split(' ').filter(Boolean);
  const wordsY = y.split(' ').filter(Boolean);
  const [shorter, longer] = wordsX.length <= wordsY.length
    ? [wordsX, wordsY]
    : [wordsY, wordsX];

  if (shorter.length === 0) return 0;
  const longerSet = new Set(longer);
  if (!shorter.every(word => longerSet.has(word))) return 0;

  // The shared part has to actually identify something. Without this, "Bank"
  // is contained in every bank name there is.
  const distinctive = shorter.some(
    word => word.length >= 3 && !GENERIC_NAME_WORDS.has(word)
  );
  return distinctive ? 0.9 : 0;
}

// Below this length a despaced hit stops meaning anything: short names and
// acronyms start finding each other inside longer unrelated ones.
const DESPACED_MIN_LENGTH = 6;

/**
 * The same containment test with the spaces taken out: "Ali Express" against
 * "Aliexpress.com Luxembourg Lu".
 *
 * Word-level containment cannot see through a split word, because `ali` and
 * `express` are not tokens of `aliexpress`, and the character fallback is
 * dragged under the threshold by whatever corporate tail the bank appends —
 * that pair scored 0.457 against a 0.62 bar. Local brands are written both
 * ways constantly: SadaPay / Sada Pay, JazzCash / Jazz Cash.
 */
function despacedContainment(x, y) {
  const a = x.replace(/ /g, '');
  const b = y.replace(/ /g, '');
  const xIsShorter = a.length <= b.length;
  const [shorter, longer] = xIsShorter ? [a, b] : [b, a];

  if (shorter.length < DESPACED_MIN_LENGTH) return 0;
  if (!longer.includes(shorter)) return 0;

  // Long enough to clear the bar but made only of words every bank shares -
  // "credit card" inside "credit card account" identifies nothing.
  const words = (xIsShorter ? x : y).split(' ').filter(Boolean);
  if (words.every(word => GENERIC_NAME_WORDS.has(word))) return 0;

  return 0.9;
}

/** 0..1 similarity between two names. Exported for testing. */
export function similarity(a, b) {
  const x = normaliseName(a);
  const y = normaliseName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;

  const contained = tokenContainment(x, y);
  if (contained) return contained;

  // Then the same test ignoring word boundaries, which the two names may
  // simply disagree about.
  const despaced = despacedContainment(x, y);
  if (despaced) return despaced;

  // A shared distinctive word is strong evidence — "Askari Bank" against
  // "Askari Current" — provided it is not a word every bank name contains.
  const tokensOf = (value) => new Set(
    value.split(' ').filter(t => t.length >= 3 && !GENERIC_NAME_WORDS.has(t))
  );
  const sharedTokens = [...tokensOf(x)].filter(t => tokensOf(y).has(t));
  if (sharedTokens.length > 0) return Math.min(0.9, 0.6 + 0.1 * sharedTokens.length);

  // Otherwise fall back to character-level overlap, which catches spelling
  // drift ("Meezan" / "Meezaan") without matching unrelated names.
  const setX = bigrams(x);
  const setY = bigrams(y);
  if (setX.size === 0 || setY.size === 0) return 0;
  let shared = 0;
  for (const gram of setX) if (setY.has(gram)) shared++;
  return (2 * shared) / (setX.size + setY.size);
}

// Below this, "no idea" is the more useful answer than a wrong account.
const ACCOUNT_MATCH_THRESHOLD = 0.55;

/** Closest account to a free-text name, or null if nothing is close enough. */
export function fuzzyFindAccount(name, accounts, threshold = ACCOUNT_MATCH_THRESHOLD) {
  if (!name) return null;
  let best = null;
  let bestScore = 0;
  let tied = false;

  for (const account of accounts) {
    const score = similarity(name, account.name);
    if (score > bestScore) {
      bestScore = score;
      best = account;
      tied = false;
    } else if (score === bestScore && score > 0) {
      tied = true;
    }
  }

  // Two accounts equally close is not a match, it is a question for the user.
  if (tied || bestScore < threshold) return null;
  return best;
}

/**
 * How often each payee name appears in the history.
 *
 * Used to break ties when several payees match a merchant equally well: the
 * one already used twenty times is the likelier answer than the one used once.
 */
export function payeeUsage(transactions) {
  const counts = new Map();
  const record = (payee) => {
    if (!payee) return;
    const name = String(payee);
    if (name.toLowerCase() === 'unspecified') return;
    counts.set(name, (counts.get(name) || 0) + 1);
  };

  for (const tx of transactions || []) {
    if (tx.deleted) continue;
    record(tx.payee);
    if (Array.isArray(tx.splits)) {
      for (const split of tx.splits) record(split.payee);
    }
  }
  return counts;
}

// Payees are freer-form than account names, so the bar is set a little higher:
// a shared whole word or containment clears it, coincidental character overlap
// does not.
const PAYEE_MATCH_THRESHOLD = 0.62;

/**
 * The closest payee already in use, or null.
 *
 * Merchant strings are the bank's idea of a name; payees are the user's. They
 * routinely differ — a transfer from "SYEDA KHUNSA USMANI" belongs to the
 * payee filed as "Khunsa". Candidates come from both the payee list and the
 * transaction history, since a payee used long ago may since have been removed
 * from the list.
 *
 * Unlike accounts, a tie is resolved rather than refused: the more-used payee
 * wins. A misfiled payee is visible on the review card and one tap to change,
 * where a wrong account silently lands money in the wrong balance.
 */
export function fuzzyFindPayee(merchant, payees, transactions, threshold = PAYEE_MATCH_THRESHOLD) {
  if (!merchant) return null;

  const usage = payeeUsage(transactions);
  const candidates = new Map();
  for (const payee of payees || []) {
    if (payee?.name) candidates.set(payee.name, usage.get(payee.name) || 0);
  }
  for (const [name, count] of usage) {
    if (!candidates.has(name)) candidates.set(name, count);
  }

  let best = null;
  let bestScore = 0;
  let bestCount = -1;

  for (const [name, count] of candidates) {
    const score = similarity(merchant, name);
    if (score > bestScore || (score === bestScore && score > 0 && count > bestCount)) {
      bestScore = score;
      bestCount = count;
      best = name;
    }
  }

  return bestScore >= threshold ? best : null;
}

/**
 * The category this payee has most often been filed under before.
 *
 * The rules table only knows what has been approved through the review queue.
 * The transaction history knows everything the user has ever categorised by
 * hand, which on an established budget is far more.
 */
export function categoryFromHistory(payeeName, transactions) {
  if (!payeeName || !transactions?.length) return '';
  const target = String(payeeName).toLowerCase();
  const counts = new Map();

  const record = (payee, category) => {
    if (!payee || !category) return;
    if (String(payee).toLowerCase() !== target) return;
    // "Unspecified" is the absence of a decision, not a decision.
    if (String(category).toLowerCase() === 'unspecified') return;
    counts.set(category, (counts.get(category) || 0) + 1);
  };

  for (const tx of transactions) {
    if (tx.deleted) continue;
    record(tx.payee, tx.category);
    if (Array.isArray(tx.splits)) {
      for (const split of tx.splits) record(split.payee, split.category);
    }
  }

  let best = '';
  let bestCount = 0;
  for (const [category, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = category;
    }
  }
  return best;
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

  // Card digits are the strongest signal, but most messages from a wallet
  // carry none. The sender name usually resembles the account name closely
  // enough to match on: "SadaPay" -> "SadaPay Card".
  const senderName = draft?.parsed?.bank || draft?.sender;
  const fuzzy = fuzzyFindAccount(senderName, accounts);
  if (fuzzy) return fuzzy.name;

  // A single-account budget has only one sensible answer.
  if (accounts.length === 1) return accounts[0].name;
  return '';
}

/** Payee: a learned mapping, then an existing payee, then the tidied string. */
export function suggestPayee(draft, payees, rules, transactions) {
  const merchant = draft?.parsed?.merchant;
  if (!merchant) return '';

  const key = normaliseMerchant(merchant);
  const learned = rules?.payeeByMerchant?.[key];
  if (learned) return learned;

  // An existing payee that already matches, however it was capitalised.
  const existing = payees.find(payee => normaliseMerchant(payee.name) === key);
  if (existing) return existing.name;

  // Then the closest payee already in use. The bank writes names in full;
  // people do not.
  const fuzzy = fuzzyFindPayee(merchant, payees, transactions);
  if (fuzzy) return fuzzy;

  return prettifyMerchant(merchant);
}

/** Category comes from the payee, which is the association people actually
 *  think in — "Careem is Transport" — rather than from the raw merchant. */
export function suggestCategory(payeeName, categories, rules, transactions) {
  if (!payeeName) return '';

  // An explicit decision made in the review queue outranks the aggregate,
  // being both more specific and more recent.
  const learned = rules?.categoryByPayee?.[payeeName];
  if (learned && findByName(categories, learned)) return learned;

  const historic = categoryFromHistory(payeeName, transactions);
  if (historic && findByName(categories, historic)) return historic;

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
export function draftToSuggestion(
  draft,
  { accounts = [], categories = [], payees = [], transactions = [], rules } = {}
) {
  const parsed = draft?.parsed || {};
  const effectiveRules = rules || DEFAULT_AUTOMATION_RULES;

  const payee = suggestPayee(draft, payees, effectiveRules, transactions);
  const account = suggestAccount(draft, accounts, effectiveRules);
  const accountRecord = findByName(accounts, account);

  return {
    type: parsed.direction === 'credit' ? 1 : 0,
    amount: parsed.amount != null ? String(parsed.amount) : '',
    // The form wants a plain yyyy-mm-dd, and occurredAt is a full ISO stamp.
    date: toDateInput(parsed.occurredAt || draft?.receivedAt),
    account,
    payee,
    category: suggestCategory(payee, categories, effectiveRules, transactions),
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

// --- Transfers between your own accounts ----------------------------------
//
// Moving money from one of your own accounts to another produces two
// messages, not one: a debit from the sending app and a credit from the
// receiving one. Approved separately they become an expense and an income,
// which double-counts the movement and leaves both balances wrong.
//
// Neither message can be recognised as a transfer on its own. SadaPay and
// NayaPay both label the counterparty with the account holder's name — the
// same name on both sides — so nothing in either message says where the money
// went. What identifies it is the pair: two messages, equal amounts, opposite
// directions, seconds apart, on different accounts.

const TRANSFER_AMOUNT_EPSILON = 0.01;
const SELF_NAME_THRESHOLD = 0.8;

/** Has the user declared this counterparty to be themselves? */
export function isSelfLabel(name, rules) {
  if (!name) return false;
  const labels = rules?.selfLabels || [];
  if (labels.length === 0) return false;
  const target = normaliseName(name);
  return labels.some(label => {
    const candidate = normaliseName(label);
    return candidate === target || similarity(name, label) >= SELF_NAME_THRESHOLD;
  });
}

/**
 * Do these two drafts name the same counterparty, or someone declared to be
 * the user?
 *
 * The name-on-both-sides check is what makes this work with no configuration:
 * a wallet-to-wallet transfer carries the account holder's name on both
 * messages, so the two sides recognise each other. Self labels are the escape
 * hatch for when the two apps write that name differently.
 */
function looksLikeSelfTransfer(debit, credit, rules) {
  const a = debit?.parsed?.merchant;
  const b = credit?.parsed?.merchant;
  if (isSelfLabel(a, rules) || isSelfLabel(b, rules)) return true;
  if (a && b && similarity(a, b) >= SELF_NAME_THRESHOLD) return true;
  return false;
}

function draftAmount(draft) {
  const value = Number(draft?.parsed?.amount);
  return Number.isFinite(value) ? Math.abs(value) : 0;
}

// Arrival time, not the date the message states. A bank SMS quoting only a
// date parses to midnight, which would sit hours away from the partner
// message even though both landed within seconds of each other.
function draftTime(draft) {
  const value = draft?.receivedAt || draft?.parsed?.occurredAt;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

/**
 * Pair up drafts that are two halves of one transfer.
 *
 * Greedy and deterministic: debits oldest first, each taking the closest
 * unclaimed credit inside the window. A draft is only ever in one pair.
 */
export function findTransferPairs(drafts, options = {}) {
  const { accounts = [], rules, windowMinutes = 10 } = options;
  const windowMs = windowMinutes * 60 * 1000;

  const debits = [];
  const credits = [];
  for (const draft of drafts || []) {
    if (!draftAmount(draft)) continue;
    const direction = draft?.parsed?.direction;
    if (direction === 'debit') debits.push(draft);
    else if (direction === 'credit') credits.push(draft);
  }

  const claimed = new Set();
  const pairs = [];

  for (const debit of [...debits].sort((a, b) => draftTime(a) - draftTime(b))) {
    let best = null;
    let bestGap = Infinity;

    for (const credit of credits) {
      if (claimed.has(credit.id)) continue;
      if (Math.abs(draftAmount(debit) - draftAmount(credit)) > TRANSFER_AMOUNT_EPSILON) continue;

      const gap = Math.abs(draftTime(debit) - draftTime(credit));
      if (gap > windowMs) continue;
      if (!looksLikeSelfTransfer(debit, credit, rules)) continue;

      // Money leaving and arriving in the same account is not a transfer;
      // it is two unrelated transactions that happen to match.
      const from = suggestAccount(debit, accounts, rules);
      const to = suggestAccount(credit, accounts, rules);
      if (from && to && from === to) continue;

      if (gap < bestGap) {
        bestGap = gap;
        best = credit;
      }
    }

    if (best) {
      claimed.add(best.id);
      claimed.add(debit.id);
      pairs.push({
        id: `${debit.id}:${best.id}`,
        debit,
        credit: best,
        gapMs: bestGap
      });
    }
  }

  return pairs;
}

/**
 * Every transfer in the queue, whether both halves arrived or only one.
 *
 * A matched pair corroborates itself: two messages agreeing on the amount and
 * the moment. A lone message has nothing backing it up, so it is only ever
 * treated as a transfer when the counterparty is a name the user has
 * explicitly declared to be themselves. Inferring that from the name alone
 * would turn every payment to a namesake into a transfer, and a transfer
 * booked as one leg of a movement that never happened is hard to spot later.
 *
 * This matters in practice because not every app reports both sides — SadaPay
 * currently sends nothing at all for an outgoing transfer.
 */
export function findTransfers(drafts, options = {}) {
  const { rules } = options;
  const pairs = findTransferPairs(drafts, options);
  const claimed = new Set(pairs.flatMap(p => [p.debit.id, p.credit.id]));

  const oneSided = [];
  for (const draft of drafts || []) {
    if (claimed.has(draft.id)) continue;
    if (!draftAmount(draft)) continue;

    const direction = draft?.parsed?.direction;
    if (direction !== 'debit' && direction !== 'credit') continue;

    // The deliberate asymmetry: no self label, no one-sided transfer.
    if (!isSelfLabel(draft?.parsed?.merchant, rules)) continue;

    oneSided.push({
      id: draft.id,
      debit: direction === 'debit' ? draft : null,
      credit: direction === 'credit' ? draft : null,
      oneSided: true
    });
  }

  return [...pairs, ...oneSided];
}

/**
 * The transfer form's starting values.
 *
 * Either side may be missing. The account the message came from is known; the
 * one at the other end is not named anywhere, so it is left blank for the user
 * to pick rather than guessed.
 */
export function pairToTransferSuggestion(pair, options = {}) {
  const { accounts = [], rules } = options;
  const { debit, credit } = pair;
  const known = debit || credit;

  const from = debit ? suggestAccount(debit, accounts, rules) : '';
  const to = credit ? suggestAccount(credit, accounts, rules) : '';
  const currencySource = findByName(accounts, from || to);

  return {
    type: 2,
    amount: String(draftAmount(known) || ''),
    date: toDateInput(known?.parsed?.occurredAt || known?.receivedAt),
    from,
    to,
    currency: currencySource?.currency || known?.parsed?.currency || 'PKR',
    note: `Auto-added transfer from ${known?.parsed?.bank || known?.sender || 'SMS'}`
  };
}

/**
 * Does this merchant string look like an account identifier rather than a name?
 *
 * Banks write the counterparty however it appears on the account, which for a
 * Raast or IBFT transfer is often something like "PK*SADA5107". There is no
 * way to turn that into a person's name from the text alone — but it is worth
 * pointing out, because naming it once is what stops every future transfer
 * from the same person arriving anonymous.
 */
export function looksLikeIdentifier(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;

  // A masked account number.
  if (raw.includes('*')) return true;

  // A token welding letters to a run of digits: SADA5107, AC0462.
  if (/[A-Za-z]{2,}\d{3,}|\d{3,}[A-Za-z]{2,}/.test(raw)) return true;

  // Mostly digits.
  const compact = raw.replace(/\s/g, '');
  const digits = (compact.match(/\d/g) || []).length;
  return digits >= 4 && digits / compact.length > 0.4;
}

/** Confidence, as something a person can read. */
export function confidenceLabel(confidence) {
  if (confidence >= 0.85) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}
