// Calendar dates, handled as calendar dates.
//
// A transaction's `date` is a *floating* calendar day — "I bought coffee on
// the 12th" — not an instant. It has always been stored as the UTC midnight of
// that day (`YYYY-MM-DDT00:00:00.000Z`), which reads back as 05:00 local in
// PKT and as the *previous evening* anywhere behind UTC. Every bug below came
// from treating that stored instant as though it were the day itself:
//
//   - `new Date().toISOString().slice(0, 10)` is today's date *in UTC*. Between
//     midnight and 05:00 in Karachi that is yesterday, which is why the Add
//     Transaction calendar opened on the 11th while marking the 12th as today.
//   - A range whose end was `new Date()` ended at the current *moment*. A
//     transaction dated today sits at 05:00 local, so at 00:30 it fell outside
//     "This Month" — the 12th was missing until 5am.
//
// So: read a day out of a date-ish value by its digits, and rebuild it at local
// midnight. That is stable in every timezone and matches the data already
// stored, because the first ten characters were the intended day all along.

const pad = (n) => String(n).padStart(2, '0');

// Local calendar day of a Date, as YYYY-MM-DD. The counterpart to
// `toISOString().slice(0, 10)` that does not jump a day either side of UTC.
export function toDayString(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Today, where the user is.
export function todayString() {
  return toDayString(new Date());
}

// The day part of anything a transaction's `date` might hold: a
// `YYYY-MM-DD...` string (taken by its digits, never re-interpreted through a
// timezone), or a Date.
export function dayStringOf(value) {
  if (!value) return '';
  if (value instanceof Date) return toDayString(value);
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  return toDayString(new Date(value));
}

// That same day as a Date pinned to local midnight, so two days can be
// compared — or bounded by a range — without the clock ever mattering.
export function parseDayLocal(value) {
  const day = dayStringOf(value);
  if (!day) return null;
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Start of the given day, local. `endOfDayLocal` is the inclusive upper bound
// a range needs: without it "up to the 12th" stops at whatever time it is now.
export function startOfDayLocal(value) {
  return parseDayLocal(value);
}

export function endOfDayLocal(value) {
  const d = parseDayLocal(value);
  if (!d) return null;
  d.setHours(23, 59, 59, 999);
  return d;
}

// How a calendar day is written into a transaction. Unchanged from what the
// app has always stored, so existing records and new ones stay comparable.
export function dayToStoredDate(value) {
  const day = dayStringOf(value);
  return day ? `${day}T00:00:00.000Z` : new Date().toISOString();
}
