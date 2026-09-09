// Draft -> transaction mapping.
//
// This is the layer the server cannot do, because account, payee and category
// names are encrypted. It is also the layer where a mistake is expensive: a
// draft mapped to the wrong account posts a real transaction to the wrong
// balance, and nobody looks at it again.

import {
  normaliseMerchant,
  prettifyMerchant,
  suggestAccount,
  suggestPayee,
  suggestCategory,
  draftToSuggestion,
  learnFromApproval,
  confidenceLabel,
  similarity,
  fuzzyFindAccount,
  fuzzyFindPayee,
  payeeUsage,
  looksLikeIdentifier,
  categoryFromHistory,
  findTransferPairs,
  pairToTransferSuggestion,
  isSelfLabel,
  DEFAULT_AUTOMATION_RULES
} from '../src/utils/inboxDraft.js';

let failed = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${cond ? '' : '  <-- ' + extra}`);
  if (!cond) failed++;
};
const eq = (name, actual, expected) =>
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const ACCOUNTS = [
  { name: 'HBL Current', currency: 'PKR' },
  { name: 'Meezan 4321', currency: 'PKR' },
  { name: 'Wise USD', currency: 'USD' }
];
const CATEGORIES = [{ name: 'Transport' }, { name: 'Groceries' }];
const PAYEES = [{ name: 'Careem' }, { name: 'K-Electric' }];

const draft = (parsed, extra = {}) => ({
  id: 'd1',
  source: 'sms',
  sender: 'HBL',
  rawText: 'raw',
  receivedAt: '2026-09-09T10:00:00Z',
  confidence: 0.8,
  parsed,
  ...extra
});

console.log('\n--- Merchant normalisation ---');
{
  eq('punctuation and case collapse', normaliseMerchant('CAREEM*RIDE  #123'), 'careem ride 123');
  eq('empty stays empty', normaliseMerchant(null), '');
  eq('all caps is title cased', prettifyMerchant('METRO CASH CARRY'), 'Metro Cash Carry');
  eq('short words stay upper', prettifyMerchant('KFC ISB'), 'KFC ISB');
  // Something deliberately mixed-case is left exactly as written.
  eq('mixed case untouched', prettifyMerchant('eBay Marketplace'), 'eBay Marketplace');
}

console.log('\n--- Fuzzy name matching ---');
{
  check('identical', similarity('SadaPay', 'sadapay') === 1);
  check('contained', similarity('SadaPay', 'SadaPay Card') >= 0.85);
  check('shared distinctive word', similarity('Askari Bank', 'Askari Current') >= 0.6);

  // The one that matters: two different banks both containing "Bank" must not
  // match on that word alone.
  check('generic word is not evidence',
    similarity('Bank Alfalah', 'Askari Bank') < 0.55,
    String(similarity('Bank Alfalah', 'Askari Bank')));
  check('unrelated names score low',
    similarity('Meezan Bank', 'Wise USD') < 0.55,
    String(similarity('Meezan Bank', 'Wise USD')));
}

console.log('\n--- Fuzzy account lookup ---');
{
  const accounts = [
    { name: 'Askari Current' },
    { name: 'SadaPay Card' },
    { name: 'Wise USD' }
  ];
  check('sender to account',
    fuzzyFindAccount('SadaPay', accounts)?.name === 'SadaPay Card');
  check('bank name to account',
    fuzzyFindAccount('Askari Bank', accounts)?.name === 'Askari Current');
  check('no plausible match returns null',
    fuzzyFindAccount('Meezan Bank', accounts) === null);
  check('empty name returns null', fuzzyFindAccount('', accounts) === null);

  // An ambiguous name is a question for the user, not a coin flip.
  const ambiguous = [{ name: 'Askari One' }, { name: 'Askari Two' }];
  check('a tie is not a match', fuzzyFindAccount('Askari', ambiguous) === null);
}

console.log('\n--- Fuzzy payee matching ---');
{
  // The motivating case: the bank writes the full legal name, the payee was
  // filed under a short form.
  const people = [{ name: 'Khunsa' }, { name: 'Careem' }];
  eq('full name finds short payee',
    fuzzyFindPayee('SYEDA KHUNSA USMANI', people, []), 'Khunsa');
  eq('reversed works too',
    fuzzyFindPayee('Khunsa', [{ name: 'Syeda Khunsa Usmani' }], []),
    'Syeda Khunsa Usmani');

  // The false match the word-aware containment exists to prevent: "Ali" is a
  // substring of "Alibaba", but not a word in it.
  check('short name not matched inside a longer word',
    fuzzyFindPayee('Alibaba Group', [{ name: 'Ali' }], []) === null,
    String(similarity('Alibaba Group', 'Ali')));

  eq('unrelated merchant matches nothing',
    fuzzyFindPayee('METRO CASH CARRY', people, []), null);
  eq('no merchant, no match', fuzzyFindPayee('', people, []), null);

  // Payees seen only in history still count — one may have been removed from
  // the payee list but still be the right answer.
  const history = [{ payee: 'Khunsa', category: 'Gifts' }];
  eq('historical payee is a candidate',
    fuzzyFindPayee('SYEDA KHUNSA USMANI', [], history), 'Khunsa');

  // Two candidates matching equally well: the more-used one wins, rather than
  // whichever happened to be enumerated first.
  const tiedPayees = [{ name: 'Khunsa Work' }, { name: 'Khunsa Home' }];
  const usageHistory = [
    { payee: 'Khunsa Home' },
    { payee: 'Khunsa Home' },
    { payee: 'Khunsa Work' }
  ];
  eq('more-used payee wins a tie',
    fuzzyFindPayee('KHUNSA', tiedPayees, usageHistory), 'Khunsa Home');

  // Usage counts skip deleted rows and Unspecified.
  const counts = payeeUsage([
    { payee: 'Careem' },
    { payee: 'Careem' },
    { payee: 'Gone', deleted: true },
    { payee: 'Unspecified' },
    { payee: 'Parent', splits: [{ payee: 'Shell' }] }
  ]);
  eq('counted twice', counts.get('Careem'), 2);
  eq('deleted not counted', counts.get('Gone'), undefined);
  eq('Unspecified not counted', counts.get('Unspecified'), undefined);
  eq('split payee counted', counts.get('Shell'), 1);
}

console.log('\n--- Payee suggestion uses the fuzzy match ---');
{
  const d = draft({ merchant: 'SYEDA KHUNSA USMANI' });
  eq('suggestPayee finds the short form',
    suggestPayee(d, [{ name: 'Khunsa' }], DEFAULT_AUTOMATION_RULES, []), 'Khunsa');

  // A learned rule still outranks the fuzzy match.
  const rules = {
    ...DEFAULT_AUTOMATION_RULES,
    payeeByMerchant: { 'syeda khunsa usmani': 'Khunsa Usmani' }
  };
  eq('learned rule still wins',
    suggestPayee(d, [{ name: 'Khunsa' }], rules, []), 'Khunsa Usmani');

  // Nothing close: fall back to tidying the merchant string.
  eq('falls back to prettified merchant',
    suggestPayee(draft({ merchant: 'METRO CASH CARRY' }), [{ name: 'Khunsa' }],
      DEFAULT_AUTOMATION_RULES, []),
    'Metro Cash Carry');
}

console.log('\n--- Category from transaction history ---');
{
  const history = [
    { payee: 'Careem', category: 'Transport' },
    { payee: 'Careem', category: 'Transport' },
    { payee: 'Careem', category: 'Travel' },
    { payee: 'careem', category: 'Transport' },
    { payee: 'K-Electric', category: 'Utilities' },
    // Deleted rows and "Unspecified" are not evidence of anything.
    { payee: 'Careem', category: 'Groceries', deleted: true },
    { payee: 'Foodpanda', category: 'Unspecified' }
  ];

  eq('most common wins', categoryFromHistory('Careem', history), 'Transport');
  eq('case-insensitive match', categoryFromHistory('CAREEM', history), 'Transport');
  eq('single occurrence', categoryFromHistory('K-Electric', history), 'Utilities');
  eq('Unspecified is ignored', categoryFromHistory('Foodpanda', history), '');
  eq('unknown payee', categoryFromHistory('Nobody', history), '');
  eq('no history at all', categoryFromHistory('Careem', []), '');

  // Split rows carry their own payee and category and must count too.
  const withSplits = [
    { payee: 'Parent', category: 'Misc', splits: [{ payee: 'Shell', category: 'Fuel' }] }
  ];
  eq('splits are counted', categoryFromHistory('Shell', withSplits), 'Fuel');
}

console.log('\n--- Account suggestion ---');
{
  const rules = { ...DEFAULT_AUTOMATION_RULES, accountByLast4: { '1234': 'HBL Current' } };
  eq('learned mapping wins',
    suggestAccount(draft({ last4: '1234' }), ACCOUNTS, rules), 'HBL Current');

  // No rule, but an account name carries the digits.
  eq('digits in account name',
    suggestAccount(draft({ last4: '4321' }), ACCOUNTS, DEFAULT_AUTOMATION_RULES), 'Meezan 4321');

  // With no card match, the sender name is the next best signal: the default
  // draft sender is "HBL", which resolves to "HBL Current".
  eq('falls back to fuzzy sender match',
    suggestAccount(draft({ last4: '9999' }), ACCOUNTS, DEFAULT_AUTOMATION_RULES), 'HBL Current');
  eq('fuzzy match works with no card at all',
    suggestAccount(draft({}), ACCOUNTS, DEFAULT_AUTOMATION_RULES), 'HBL Current');

  // parsed.bank is preferred over the raw sender, being the cleaned-up name.
  eq('parsed bank beats sender',
    suggestAccount(
      { ...draft({ bank: 'Wise' }), sender: 'HBL' }, ACCOUNTS, DEFAULT_AUTOMATION_RULES),
    'Wise USD');

  // The important one: when nothing resembles a known account, it must NOT be
  // guessed onto an arbitrary one. Blank forces the user to choose.
  eq('nothing plausible stays blank',
    suggestAccount(
      { ...draft({ last4: '9999' }), sender: 'Faysal Bank' },
      ACCOUNTS, DEFAULT_AUTOMATION_RULES),
    '');

  // A single-account budget has only one possible answer.
  eq('single account is unambiguous',
    suggestAccount(
      { ...draft({ last4: '9999' }), sender: 'Faysal Bank' },
      [ACCOUNTS[1]], DEFAULT_AUTOMATION_RULES),
    'Meezan 4321');

  // A rule pointing at an account that has since been deleted must not be
  // used — it falls through to the fuzzy match instead.
  const stale = { ...DEFAULT_AUTOMATION_RULES, accountByLast4: { '1234': 'Deleted Account' } };
  eq('stale rule ignored',
    suggestAccount(draft({ last4: '1234' }), ACCOUNTS, stale), 'HBL Current');
}

console.log('\n--- Payee suggestion ---');
{
  const rules = { ...DEFAULT_AUTOMATION_RULES, payeeByMerchant: { 'careem ride': 'Careem' } };
  eq('learned merchant mapping',
    suggestPayee(draft({ merchant: 'CAREEM*RIDE' }), PAYEES, rules), 'Careem');

  // An existing payee matches however the message capitalised it.
  eq('existing payee matched case-insensitively',
    suggestPayee(draft({ merchant: 'careem' }), PAYEES, DEFAULT_AUTOMATION_RULES), 'Careem');

  eq('unknown merchant is tidied',
    suggestPayee(draft({ merchant: 'METRO CASH CARRY' }), PAYEES, DEFAULT_AUTOMATION_RULES),
    'Metro Cash Carry');

  eq('no merchant, no payee',
    suggestPayee(draft({}), PAYEES, DEFAULT_AUTOMATION_RULES), '');
}

console.log('\n--- Category suggestion ---');
{
  const rules = { ...DEFAULT_AUTOMATION_RULES, categoryByPayee: { Careem: 'Transport' } };
  eq('learned category', suggestCategory('Careem', CATEGORIES, rules), 'Transport');
  eq('unknown payee has none', suggestCategory('Someone', CATEGORIES, rules), '');
  // A category the user has since deleted must not be reapplied.
  const stale = { ...DEFAULT_AUTOMATION_RULES, categoryByPayee: { Careem: 'Gone' } };
  eq('stale category ignored', suggestCategory('Careem', CATEGORIES, stale), '');

  // With no rule, history fills the gap.
  const history = [
    { payee: 'Careem', category: 'Transport' },
    { payee: 'Careem', category: 'Transport' }
  ];
  eq('history used when no rule',
    suggestCategory('Careem', CATEGORIES, DEFAULT_AUTOMATION_RULES, history), 'Transport');

  // An explicit review-queue decision is more specific and more recent than
  // the aggregate, so it outranks it.
  const conflicting = { ...DEFAULT_AUTOMATION_RULES, categoryByPayee: { Careem: 'Groceries' } };
  eq('rule beats history',
    suggestCategory('Careem', CATEGORIES, conflicting, history), 'Groceries');

  // History naming a category that no longer exists must not be applied.
  const goneHistory = [{ payee: 'Careem', category: 'Vanished' }];
  eq('deleted category from history ignored',
    suggestCategory('Careem', CATEGORIES, DEFAULT_AUTOMATION_RULES, goneHistory), '');
}

console.log('\n--- Full suggestion ---');
{
  const rules = {
    accountByLast4: { '1234': 'HBL Current' },
    payeeByMerchant: { 'careem ride': 'Careem' },
    categoryByPayee: { Careem: 'Transport' }
  };
  const s = draftToSuggestion(
    draft({
      amount: 450.5, currency: 'PKR', direction: 'debit',
      merchant: 'CAREEM*RIDE', last4: '1234', bank: 'HBL',
      occurredAt: '2026-09-08T14:30:00Z'
    }),
    { accounts: ACCOUNTS, categories: CATEGORIES, payees: PAYEES, rules }
  );

  eq('debit becomes expense', s.type, 0);
  eq('amount as string', s.amount, '450.5');
  eq('date from occurredAt', s.date, '2026-09-08');
  eq('account from rule', s.account, 'HBL Current');
  eq('payee from rule', s.payee, 'Careem');
  eq('category from payee', s.category, 'Transport');
  eq('direction was known', s.directionKnown, true);
  check('note records provenance', s.note.includes('HBL'), s.note);
}

console.log('\n--- Direction and currency edge cases ---');
{
  const credit = draftToSuggestion(
    draft({ amount: 1000, direction: 'credit', currency: 'PKR' }),
    { accounts: ACCOUNTS, categories: CATEGORIES, payees: PAYEES }
  );
  eq('credit becomes income', credit.type, 1);

  // An unreadable direction must fall back to expense AND say so, so the UI
  // can warn rather than silently booking it the wrong way.
  const unknown = draftToSuggestion(
    draft({ amount: 1000, direction: null }),
    { accounts: ACCOUNTS, categories: CATEGORIES, payees: PAYEES }
  );
  eq('unknown direction defaults to expense', unknown.type, 0);
  eq('and is flagged', unknown.directionKnown, false);

  // The account's own currency wins: a USD purchase on a PKR card still posts
  // in the account's currency.
  const rules = { ...DEFAULT_AUTOMATION_RULES, accountByLast4: { '1234': 'Wise USD' } };
  const cross = draftToSuggestion(
    draft({ amount: 20, currency: 'PKR', direction: 'debit', last4: '1234' }),
    { accounts: ACCOUNTS, categories: CATEGORIES, payees: PAYEES, rules }
  );
  eq('account currency wins', cross.currency, 'USD');

  // No amount parsed at all must not become NaN or "null" in the input.
  const empty = draftToSuggestion(draft({}), { accounts: ACCOUNTS });
  eq('missing amount is blank', empty.amount, '');
}

console.log('\n--- Learning from an approval ---');
{
  const d = draft({ last4: '1234', merchant: 'CAREEM*RIDE' });
  const learned = learnFromApproval(DEFAULT_AUTOMATION_RULES, d, {
    account: 'HBL Current', payee: 'Careem', category: 'Transport'
  });

  eq('card mapped', learned.accountByLast4['1234'], 'HBL Current');
  eq('merchant mapped', learned.payeeByMerchant['careem ride'], 'Careem');
  eq('category mapped', learned.categoryByPayee['Careem'], 'Transport');

  // Nothing new: the same object comes back, so the caller can skip a settings
  // write and the sync round trip it triggers.
  const again = learnFromApproval(learned, d, {
    account: 'HBL Current', payee: 'Careem', category: 'Transport'
  });
  check('no-op returns the same object', again === learned);

  // A correction overwrites the old rule rather than accumulating.
  const corrected = learnFromApproval(learned, d, {
    account: 'Meezan 4321', payee: 'Careem', category: 'Transport'
  });
  eq('correction overwrites', corrected.accountByLast4['1234'], 'Meezan 4321');
  check('original not mutated', learned.accountByLast4['1234'] === 'HBL Current');

  // Partial information must not write junk rules.
  const noMerchant = learnFromApproval(DEFAULT_AUTOMATION_RULES, draft({ last4: '5555' }), {
    account: 'HBL Current', payee: 'Unspecified', category: ''
  });
  eq('no merchant, no payee rule', Object.keys(noMerchant.payeeByMerchant).length, 0);
  eq('but card still learned', noMerchant.accountByLast4['5555'], 'HBL Current');
}

console.log('\n--- Transfers between your own accounts ---');
{
  const TRANSFER_ACCOUNTS = [{ name: 'SadaPay Card' }, { name: 'NayaPay' }];

  const half = (id, sender, direction, amount, minutesAgo, merchant = 'Huzaifa Sadeem') => ({
    id,
    sender,
    source: 'notification',
    rawText: 'raw',
    receivedAt: new Date(Date.UTC(2026, 8, 9, 12, 0) - minutesAgo * 60000).toISOString(),
    confidence: 0.9,
    parsed: { amount, direction, merchant, bank: sender, currency: 'PKR', last4: null }
  });

  // The motivating case: same amount, opposite directions, seconds apart, the
  // account holder's own name on both sides. No configuration needed.
  const pairs = findTransferPairs(
    [half('a', 'SadaPay', 'debit', 100, 0), half('b', 'NayaPay', 'credit', 100, 0)],
    { accounts: TRANSFER_ACCOUNTS, rules: DEFAULT_AUTOMATION_RULES }
  );
  eq('one pair found', pairs.length, 1);
  eq('debit side', pairs[0]?.debit.id, 'a');
  eq('credit side', pairs[0]?.credit.id, 'b');

  const suggestion = pairToTransferSuggestion(pairs[0], {
    accounts: TRANSFER_ACCOUNTS, rules: DEFAULT_AUTOMATION_RULES
  });
  eq('is a transfer', suggestion.type, 2);
  eq('from the debited account', suggestion.from, 'SadaPay Card');
  eq('to the credited account', suggestion.to, 'NayaPay');
  eq('transfer amount', suggestion.amount, '100');

  // Things that must NOT pair up.
  eq('different amounts',
    findTransferPairs(
      [half('a', 'SadaPay', 'debit', 100, 0), half('b', 'NayaPay', 'credit', 101, 0)],
      { accounts: TRANSFER_ACCOUNTS }).length, 0);

  eq('too far apart in time',
    findTransferPairs(
      [half('a', 'SadaPay', 'debit', 100, 0), half('b', 'NayaPay', 'credit', 100, 45)],
      { accounts: TRANSFER_ACCOUNTS }).length, 0);

  eq('same direction',
    findTransferPairs(
      [half('a', 'SadaPay', 'debit', 100, 0), half('b', 'NayaPay', 'debit', 100, 0)],
      { accounts: TRANSFER_ACCOUNTS }).length, 0);

  // A genuine coincidence: paying someone 100 while someone else pays you 100.
  eq('different counterparties do not pair',
    findTransferPairs(
      [half('a', 'SadaPay', 'debit', 100, 0, 'METRO'),
       half('b', 'NayaPay', 'credit', 100, 0, 'Naveera Seerat')],
      { accounts: TRANSFER_ACCOUNTS }).length, 0);

  // Money leaving and arriving in the same account is two transactions that
  // happen to match, not a transfer.
  eq('same account on both sides',
    findTransferPairs(
      [half('a', 'SadaPay', 'debit', 100, 0), half('b', 'SadaPay', 'credit', 100, 0)],
      { accounts: TRANSFER_ACCOUNTS }).length, 0);

  // Self labels are the escape hatch when the two apps write the name
  // differently enough not to match each other.
  const labelled = { ...DEFAULT_AUTOMATION_RULES, selfLabels: ['Huzaifa Sadeem'] };
  eq('self label bridges differing names',
    findTransferPairs(
      [half('a', 'SadaPay', 'debit', 100, 0, 'H SADEEM'),
       half('b', 'NayaPay', 'credit', 100, 0, 'HUZAIFA SADEEM')],
      { accounts: TRANSFER_ACCOUNTS, rules: labelled }).length, 1);

  check('isSelfLabel matches a declared name',
    isSelfLabel('HUZAIFA SADEEM', labelled) === true);
  check('isSelfLabel rejects someone else',
    isSelfLabel('Naveera Seerat', labelled) === false);
  check('no labels configured, no match',
    isSelfLabel('Huzaifa Sadeem', DEFAULT_AUTOMATION_RULES) === false);

  // Each draft belongs to at most one pair, and the closest partner wins.
  const many = findTransferPairs(
    [
      half('d1', 'SadaPay', 'debit', 100, 0),
      half('c1', 'NayaPay', 'credit', 100, 0),
      half('c2', 'NayaPay', 'credit', 100, 5)
    ],
    { accounts: TRANSFER_ACCOUNTS }
  );
  eq('only one pair from three halves', many.length, 1);
  eq('closest partner chosen', many[0]?.credit.id, 'c1');
}

console.log('\n--- Account identifiers vs real names ---');
{
  // Real counterparty strings from Askari messages.
  check('masked identifier', looksLikeIdentifier('PK*SADA5107') === true);
  check('account marker', looksLikeIdentifier('A C *8940') === true);
  check('letters welded to digits', looksLikeIdentifier('PKASCM5664') === true);

  // These are names and must not be flagged, or the hint cries wolf on every
  // ordinary transfer.
  check('person name', looksLikeIdentifier('NAVEERA SEERAT') === false);
  check('company name', looksLikeIdentifier('PREMIER CHOICE') === false);
  check('merchant', looksLikeIdentifier('LUMS') === false);
  check('ticker', looksLikeIdentifier('FFC') === false);
  check('merchant with one digit', looksLikeIdentifier('7-ELEVEN') === false);
  check('empty', looksLikeIdentifier('') === false);
  check('null', looksLikeIdentifier(null) === false);
}

console.log('\n--- Confidence labels ---');
{
  eq('high', confidenceLabel(0.95), 'high');
  eq('medium', confidenceLabel(0.6), 'medium');
  eq('low', confidenceLabel(0.3), 'low');
}

console.log(failed === 0 ? '\nALL INBOX CHECKS PASSED\n' : `\n${failed} CHECK(S) FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
