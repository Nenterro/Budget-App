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

console.log('\n--- Account suggestion ---');
{
  const rules = { ...DEFAULT_AUTOMATION_RULES, accountByLast4: { '1234': 'HBL Current' } };
  eq('learned mapping wins',
    suggestAccount(draft({ last4: '1234' }), ACCOUNTS, rules), 'HBL Current');

  // No rule, but an account name carries the digits.
  eq('digits in account name',
    suggestAccount(draft({ last4: '4321' }), ACCOUNTS, DEFAULT_AUTOMATION_RULES), 'Meezan 4321');

  // The important one: an unknown card must NOT be guessed onto some
  // arbitrary account. Blank forces the user to choose.
  eq('unknown card stays blank',
    suggestAccount(draft({ last4: '9999' }), ACCOUNTS, DEFAULT_AUTOMATION_RULES), '');
  eq('no card at all stays blank',
    suggestAccount(draft({}), ACCOUNTS, DEFAULT_AUTOMATION_RULES), '');

  // A single-account budget has only one possible answer.
  eq('single account is unambiguous',
    suggestAccount(draft({ last4: '9999' }), [ACCOUNTS[0]], DEFAULT_AUTOMATION_RULES), 'HBL Current');

  // A rule pointing at an account that has since been deleted must not be used.
  const stale = { ...DEFAULT_AUTOMATION_RULES, accountByLast4: { '1234': 'Deleted Account' } };
  eq('stale rule ignored',
    suggestAccount(draft({ last4: '1234' }), ACCOUNTS, stale), '');
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

console.log('\n--- Confidence labels ---');
{
  eq('high', confidenceLabel(0.95), 'high');
  eq('medium', confidenceLabel(0.6), 'medium');
  eq('low', confidenceLabel(0.3), 'low');
}

console.log(failed === 0 ? '\nALL INBOX CHECKS PASSED\n' : `\n${failed} CHECK(S) FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
