import { startOfMonth, subMonths, endOfMonth, subDays, startOfYear } from 'date-fns';
import { startOfDayLocal, endOfDayLocal, parseDayLocal } from './date';

// The period picker's ranges, in one place.
//
// Dashboard, Graphs, Stats and Transactions each had their own copy of this
// block, and each copy ended an open-ended period at `new Date()` — the
// current *moment*. A transaction dated today is stored at UTC midnight, which
// is 05:00 local in Karachi, so between midnight and 5am "This Month" ended
// before today's transactions began and the 12th simply wasn't there.
//
// Ranges are inclusive on both ends and land on local day boundaries, so a
// period always means whole days.

export const PERIODS = ['All Time', 'This Month', 'Last Month', 'Last 3 Months', 'This Year', 'Custom Range'];

export function resolvePeriodRange(period, customRange, now = new Date()) {
  if (period === 'All Time') return { start: null, end: null };

  let start = null;
  let end = now;

  if (period === 'This Month') start = startOfMonth(now);
  else if (period === 'Last Month') {
    start = startOfMonth(subMonths(now, 1));
    end = endOfMonth(subMonths(now, 1));
  }
  else if (period === 'Last 3 Months') start = subDays(now, 90);
  else if (period === 'This Year') start = startOfYear(now);
  else if (period === 'Custom Range' && customRange?.start && customRange?.end) {
    start = parseDayLocal(customRange.start);
    end = parseDayLocal(customRange.end);
  }

  // A Custom Range with nothing picked yet leaves `start` null; the caller must
  // then filter nothing rather than filter everything away.
  if (!start) return { start: null, end: null };

  return { start: startOfDayLocal(start), end: endOfDayLocal(end) };
}

// Whether a transaction's calendar day falls inside a resolved range. The day
// is read from the stored value's digits, so this answers the same way in
// every timezone.
export function isWithinRange(txDate, range) {
  if (!range?.start) return true;
  const day = parseDayLocal(txDate);
  if (!day) return false;
  return day >= range.start && day <= range.end;
}
