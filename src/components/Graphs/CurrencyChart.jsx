import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useBaseMoney } from '../../hooks/useBaseMoney';
import { orderCurrencies, formatOne } from '../../utils/money';

// Bar charts whose rows hold money maps ({ PKR: 1200, USD: 30 }).
//
// Unified mode: one bar per row, converted, on one scale — as before.
// Native mode: one bar per currency per row. Currencies are scales apart
// (₨350,000 next to $760), so the first currency present takes the left axis
// and the others the right, each axis's numbers in its series' colour. Bar
// heights are therefore NOT comparable across currencies; the tooltip gives
// every figure. Built for two currencies: a third shares the right axis.

export const formatCompactNumber = (amount) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(amount);

export const formatCompactMoney = (amount, currency) => {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency, currencyDisplay: 'code', notation: 'compact', maximumFractionDigits: 1
    }).format(amount).replace(currency, currency + ' ');
  } catch {
    return `${currency} ${formatCompactNumber(amount)}`;
  }
};

/**
 * The series a set of money maps needs: [{ key, currency, axis }]. In unified
 * mode a single converted series; in native mode one per currency present.
 */
export function useCurrencySeries(maps) {
  const money = useBaseMoney();
  if (!money.native) return { money, series: [{ key: 'converted', currency: money.baseCurrency, axis: 'left' }] };
  const present = new Set();
  for (const m of maps) for (const [c, v] of Object.entries(m || {})) if (Math.abs(v) >= 0.005) present.add(c);
  const codes = orderCurrencies([...present], money.baseCurrency);
  if (codes.length === 0) codes.push(money.baseCurrency);
  return { money, series: codes.map((c, i) => ({ key: c, currency: c, axis: i === 0 ? 'left' : 'right' })) };
}

/** Recharts rows: each row's map flattened to one numeric field per series. */
export function seriesRows(rows, series, money) {
  return rows.map(r => {
    const out = { ...r };
    for (const s of series) {
      out[s.key] = s.key === 'converted' ? money.inBase(r.money || {}) : Math.abs((r.money || {})[s.currency] || 0);
    }
    return out;
  });
}

/** "● PKR  ● USD" under a two-scale chart. */
export function CurrencyKey({ series, colourOf }) {
  if (series.length < 2) return null;
  return (
    <div className="currency-key">
      {series.map(s => (
        <span key={s.key} className="currency-key-item">
          <span className="currency-key-dot" style={{ background: colourOf(s.currency) }} />
          {s.currency}{s.axis === 'right' ? ' (right scale)' : ''}
        </span>
      ))}
    </div>
  );
}

export function MoneyTooltip({ active, payload, label, series, labelOf }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload;
  return (
    <div className="custom-tooltip">
      <p className="label">{labelOf ? labelOf(row, label) : label}</p>
      {series.map(s => (
        <p key={s.key} className="intro" style={series.length > 1 ? { color: s.colour } : undefined}>
          {formatOne(row[s.key] || 0, s.currency)}
        </p>
      ))}
    </div>
  );
}

/**
 * A bar chart over rows of { [xKey], money }. `colour` is the unified (and
 * native base-currency) series colour; other currencies take theirs from
 * useBaseMoney().colourOf.
 */
export function CurrencyBarChart({ rows, xKey = 'name', colour = 'var(--accent-color)', idPrefix, fillOpacity = 0.15, barSize = 16, labelOf, xAxisProps = {}, margin }) {
  const { money, series } = useCurrencySeries(rows.map(r => r.money));
  const data = seriesRows(rows, series, money);
  const coloured = series.map(s => ({ ...s, colour: s.currency === money.baseCurrency || s.key === 'converted' ? colour : money.colourOf(s.currency) }));
  const twoScales = coloured.some(s => s.axis === 'right');
  const leftColour = twoScales ? coloured.find(s => s.axis === 'left').colour : 'var(--text-secondary)';
  const rightColour = twoScales ? coloured.find(s => s.axis === 'right').colour : undefined;
  const size = coloured.length > 1 ? Math.max(6, Math.round(barSize * 0.6)) : barSize;

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={margin}>
            <defs>
              {coloured.map(s => (
                <linearGradient key={s.key} id={`${idPrefix}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.colour} stopOpacity={1} />
                  <stop offset="100%" stopColor={s.colour} stopOpacity={0.5} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis dataKey={xKey} stroke="var(--text-secondary)" fontSize={12} tickLine={false} axisLine={false} {...xAxisProps} />
            <YAxis yAxisId="left" stroke={leftColour} tick={{ fill: leftColour }} fontSize={12} tickLine={false} axisLine={false} tickFormatter={formatCompactNumber} width={40} />
            {twoScales && (
              <YAxis yAxisId="right" orientation="right" stroke={rightColour} tick={{ fill: rightColour }} fontSize={12} tickLine={false} axisLine={false} tickFormatter={formatCompactNumber} width={40} />
            )}
            <Tooltip content={<MoneyTooltip series={coloured} labelOf={labelOf} />} cursor={false} />
            {coloured.map(s => (
              <Bar key={s.key} yAxisId={s.axis} dataKey={s.key} fill={`url(#${idPrefix}-${s.key})`}
                fillOpacity={fillOpacity} activeBar={{ fillOpacity: 1 }} barSize={size} radius={[4, 4, 0, 0]}
                style={{ transition: 'fill-opacity 0.3s ease' }} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <CurrencyKey series={coloured} colourOf={(c) => coloured.find(s => s.currency === c)?.colour} />
    </div>
  );
}
