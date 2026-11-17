// The two amounts of a transfer between accounts in different currencies.
//
// What leaves one account and what lands in the other differ by more than the
// market rate: the bank's spread and its fees sit in between, so neither side
// can be worked out from the other. Both are entered. The rate only gives a
// starting figure for whichever side has not been typed yet.
//
// The rule, shared by the transaction form and the detected-transaction form:
// a side the user typed — or that a bank message stated — is kept exactly as
// it is. A side that was not is filled from the other. Once both are known
// neither moves, so changing one does not quietly rewrite the other.

import { evalMath } from './math.js';
import { formatAmountInput } from './format.js';

/**
 * Convert an amount string between currencies at the cached rates.
 *
 * Returns '' rather than a number in the wrong currency when it cannot: an
 * unparseable amount, or rates that do not cover both currencies.
 * (`convertAmount` hands the input back unchanged in that case, which as a
 * pre-filled figure would look like a real conversion.)
 */
export function convertAmountString(value, from, to, rates) {
  const n = evalMath(value);
  if (n === null || n === 0) return '';
  if (from === to) return formatAmountInput(String(Math.abs(n)));
  if (!rates || !rates[from] || !rates[to]) return '';
  const converted = Math.abs(n) / rates[from] * rates[to];
  if (!Number.isFinite(converted)) return '';
  return formatAmountInput(converted.toFixed(2).replace(/\.?0+$/, ''));
}

/**
 * Both sides of a cross-currency transfer, given what is known of each.
 *
 * `sent` / `received` are the strings held for each side; `sentFixed` /
 * `receivedFixed` say whether that string is a real figure (typed, or from a
 * message) or merely what was there. A side that is not fixed is derived.
 */
export function resolveTransferAmounts({
  sent = '', received = '', sentFixed, receivedFixed, from, to, rates
}) {
  const hasSent = sentFixed ?? String(sent).trim() !== '';
  const hasReceived = receivedFixed ?? String(received).trim() !== '';

  if (hasSent && hasReceived) return { sent, received };
  if (hasSent) return { sent, received: convertAmountString(sent, from, to, rates) };
  if (hasReceived) return { sent: convertAmountString(received, to, from, rates), received };
  return { sent, received: convertAmountString(sent, from, to, rates) };
}
