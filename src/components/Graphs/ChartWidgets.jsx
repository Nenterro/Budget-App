import { useMemo, useState, useRef, useEffect, useLayoutEffect } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, Sector,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { format, subMonths, isAfter, parseISO, addDays, startOfDay, differenceInDays } from 'date-fns';
import { useBaseMoney } from '../../hooks/useBaseMoney';
import { addMoney, mapMoney, orderCurrencies } from '../../utils/money';
import { CurrencyBarChart, CurrencyKey, MoneyTooltip } from './CurrencyChart';
import { getEffectiveReportingItems } from '../../utils/txAdjustments';
import { parseDayLocal, dayStringOf } from '../../utils/date';
import { balanceChangesByDay, balanceChangesByDayPerCurrency } from '../../utils/balances';

const formatCompactCurrency = (amount, currencyCode) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode || 'PKR',
    currencyDisplay: 'code',
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(amount).replace(currencyCode, currencyCode + ' ');
};

const formatCompactNumber = (amount) => {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(amount);
};

// Measures a string the way the browser will actually paint it, so the legend
// can pick a font size that is guaranteed to fit on one line. One shared
// canvas: creating one per measurement is what makes this pattern slow.
let measureCanvasCtx = null;
const measureTextWidth = (text, font) => {
  if (typeof document === 'undefined') return 0;
  if (!measureCanvasCtx) {
    measureCanvasCtx = document.createElement('canvas').getContext('2d');
  }
  if (!measureCanvasCtx) return 0;
  measureCanvasCtx.font = font;
  return measureCanvasCtx.measureText(text).width;
};

const generateGoldenHueColor = (index) => {
  const h = (index * 222.5) % 360;
  const s = 55 + (index % 10);
  const l = 55 + (index % 10);
  return `hsl(${h}, ${s}%, ${l}%)`;
};

const COLORS = [
  '#a855f7', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', 
  '#ec4899', '#8b5cf6', '#14b8a6', '#f43f5e', '#6366f1'
];

import { AreaChart, Area } from 'recharts'; // Make sure AreaChart and Area are available

// 1. Balance Over Time (Area Chart)
// Takes every transaction, never the filtered list: a balance is the money in
// the accounts, and leaving out a category, payee or amount band would only
// make it wrong. An excluded account is honoured the one way that makes
// sense for a balance: that account's money is left out (see
// balanceChangesByDay), while transfers it made into other accounts still
// arrive there.
export function BalanceOverTime({ transactions: rawTxs, accounts, dateRange, excludedAccounts }) {
  const money = useBaseMoney();
  const { baseCurrency, rates: exchangeRates, native } = money;

  const { data, ticks, series } = useMemo(() => {
    // Balances are money in the accounts, not a reporting figure: no netting
    // of shared expenses, transfers counted, cards left out — exactly as the
    // Home page total does it, so the two agree.
    const transactions = rawTxs || [];
    if (transactions.length === 0) return { data: [], ticks: [], series: [] };

    const sorted = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
    const excluded = excludedAccounts ? [...excludedAccounts] : [];

    // Unified: one converted line. Native: one line per currency, in that
    // currency, from the same legs (balanceChangesByDayPerCurrency).
    let opening, dailyChanges, keys;
    if (native) {
      const per = balanceChangesByDayPerCurrency({ transactions, accounts, dayOf: dayStringOf, excludedAccounts: excluded });
      opening = per.opening;
      dailyChanges = per.daily;
      const present = new Set(Object.keys(opening));
      Object.values(dailyChanges).forEach(d => Object.keys(d).forEach(c => present.add(c)));
      keys = orderCurrencies([...present], baseCurrency);
      if (keys.length === 0) keys = [baseCurrency];
    } else {
      const one = balanceChangesByDay({ transactions, accounts, baseCurrency, exchangeRates, dayOf: dayStringOf, excludedAccounts: excluded });
      opening = { balance: one.opening };
      dailyChanges = Object.fromEntries(Object.entries(one.daily).map(([k, v]) => [k, { balance: v }]));
      keys = ['balance'];
    }
    const current = Object.fromEntries(keys.map(k => [k, opening[k] || 0]));

    // From the earliest transaction to today, or to the latest one if it is
    // dated ahead: the Home total counts those, so the line has to reach them.
    const firstDate = parseDayLocal(sorted[0].date);
    const lastDate = parseDayLocal(sorted[sorted.length - 1].date);
    const today = startOfDay(new Date());
    const totalDays = differenceInDays(isAfter(lastDate, today) ? lastDate : today, firstDate);

    let result = [];
    for (let i = 0; i <= totalDays; i++) {
      const currDate = addDays(firstDate, i);
      const dayKey = format(currDate, 'yyyy-MM-dd');
      const change = dailyChanges[dayKey];
      if (change) for (const k of keys) current[k] += change[k] || 0;
      result.push({ name: format(currDate, 'MMM dd'), timestamp: currDate.getTime(), ...current });
    }

    if (dateRange && dateRange.start && dateRange.end) {
      const startT = startOfDay(dateRange.start).getTime();
      const endT = startOfDay(dateRange.end).getTime();
      result = result.filter(d => d.timestamp >= startT && d.timestamp <= endT);
    }

    // Generate exact ticks that perfectly align with midnight timestamps
    const generatedTicks = [];
    if (result.length > 0) {
      const displayFirstDate = new Date(result[0].timestamp);
      const displayTotalDays = differenceInDays(new Date(result[result.length - 1].timestamp), displayFirstDate);

      if (displayTotalDays === 0) {
        generatedTicks.push(displayFirstDate.getTime());
      } else {
        // Find the largest number of intervals (between 1 and 7, which gives 2 to 8 ticks) that perfectly divides totalDays
        let intervals = 1;
        for (let i = 7; i >= 1; i--) {
          if (displayTotalDays % i === 0) {
            intervals = i;
            break;
          }
        }

        const step = displayTotalDays / intervals;
        for (let i = 0; i <= intervals; i++) {
          generatedTicks.push(addDays(displayFirstDate, i * step).getTime());
        }
      }
    }

    const builtSeries = keys.map((k, i) => ({
      key: k,
      currency: k === 'balance' ? baseCurrency : k,
      axis: i === 0 ? 'left' : 'right',
      colour: k === 'balance' || k === baseCurrency ? 'var(--accent-color)' : money.colourOf(k)
    }));
    return { data: result, ticks: generatedTicks, series: builtSeries };
  }, [rawTxs, accounts, dateRange, baseCurrency, exchangeRates, excludedAccounts, native, money]);

  if (data.length === 0) return <div style={{ color: 'var(--text-secondary)', textAlign: 'center', marginTop: '40px' }}>No data</div>;

  const twoScales = series.some(s => s.axis === 'right');
  const leftColour = twoScales ? series[0].colour : 'var(--text-secondary)';
  const rightColour = twoScales ? series.find(s => s.axis === 'right').colour : undefined;

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              {series.map(s => (
                <linearGradient key={s.key} id={`colorBalance-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={s.colour} stopOpacity={s.axis === 'left' ? 0.15 : 0.08}/>
                  <stop offset="95%" stopColor={s.colour} stopOpacity={0}/>
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            {/* We use the continuous timestamp for smooth X spacing, but hide the raw numbers */}
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={['dataMin', 'dataMax']}
              ticks={ticks}
              tickFormatter={(tick, index) => index === 0 ? '' : format(new Date(tick), 'dd/MM/yy')}
              stroke="var(--text-secondary)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              yAxisId="left"
              stroke={leftColour}
              tick={{ fill: leftColour }}
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(val) => formatCompactNumber(val)}
              width={40}
            />
            {twoScales && (
              <YAxis yAxisId="right" orientation="right" stroke={rightColour} tick={{ fill: rightColour }}
                fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => formatCompactNumber(val)} width={40} />
            )}
            <Tooltip
              content={
                <MoneyTooltip
                  series={series}
                  labelOf={(row) => format(new Date(row.timestamp), 'dd MMM')}
                />
              }
              animationDuration={200} // Smooth interpolation of tooltip value
              animationEasing="ease-out"
            />
            {series.map(s => (
              <Area
                key={s.key}
                yAxisId={s.axis}
                type="monotone"
                dataKey={s.key}
                stroke={s.colour}
                strokeWidth={s.axis === 'left' ? 3 : 2}
                fillOpacity={1}
                fill={`url(#colorBalance-${s.key})`}
                activeDot={{ r: 6, fill: s.colour, stroke: '#fff', strokeWidth: 2 }}
                animationDuration={1500}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <CurrencyKey series={series} colourOf={(c) => series.find(s => s.currency === c)?.colour} />
    </div>
  );
}

// Monthly totals as money maps, last 12 months.
const useMonthlyData = (rawTransactions, filterFn) => {
  const money = useBaseMoney();
  return useMemo(() => {
    const transactions = getEffectiveReportingItems(rawTransactions);
    const twelveMonthsAgo = subMonths(new Date(), 12);

    const months = {};
    for (let i = 11; i >= 0; i--) {
      months[format(subMonths(new Date(), i), 'MMM')] = {};
    }

    transactions.forEach(tx => {
      const date = parseISO(tx.date);
      if (isAfter(date, twelveMonthsAgo) && filterFn(tx)) {
        const monthKey = format(date, 'MMM');
        if (months[monthKey] !== undefined) {
          addMoney(months[monthKey], money.currencyOf(tx), Math.abs(Number(tx.amount) || 0));
        }
      }
    });

    return Object.keys(months).map(key => ({ name: key, money: months[key] }));
  }, [rawTransactions, filterFn, money]);
};

const isSpending = tx => tx.type === 0;
const isEarning = tx => tx.type === 1;
const isInvesting = tx => tx.type === 0 && tx.category && tx.category.toLowerCase().includes('invest');

// 2. Spending Per Month
export function SpendingPerMonth({ transactions }) {
  const rows = useMonthlyData(transactions, isSpending);
  return <CurrencyBarChart rows={rows} idPrefix="spendingBar" />;
}

// 3. Income Per Month
export function IncomePerMonth({ transactions }) {
  const rows = useMonthlyData(transactions, isEarning);
  return <CurrencyBarChart rows={rows} idPrefix="incomeBar" />;
}

// 4. Investment Per Month
export function InvestmentPerMonth({ transactions }) {
  // Assuming "Investment" is a category
  const rows = useMonthlyData(transactions, isInvesting);
  return <CurrencyBarChart rows={rows} idPrefix="investmentBar" />;
}

// Helper for pie charts. Each slice is sized by its converted total, so the
// pie answers "where did the money go" in every mode; `parts` keeps what it
// was made of per currency (native amounts) and `partsBase` the same parts
// converted, which is what the native-mode outer ring is drawn from.
const usePieData = (rawTransactions, filterFn, groupKey) => {
  const money = useBaseMoney();
  return useMemo(() => {
    const transactions = getEffectiveReportingItems(rawTransactions);
    const grouped = {};
    transactions.forEach(tx => {
      if (filterFn(tx)) {
        const key = tx[groupKey] || 'Uncategorized';
        if (!grouped[key]) grouped[key] = {};
        addMoney(grouped[key], money.currencyOf(tx), Math.abs(Number(tx.amount) || 0));
      }
    });

    return Object.keys(grouped)
      .map(key => {
        const parts = grouped[key];
        const partsBase = mapMoney(parts, (a, c) => money.toBase(a, c));
        const value = Object.values(partsBase).reduce((s, v) => s + v, 0);
        return { name: key, value, parts, partsBase };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 10); // Top 10 only
  }, [rawTransactions, filterFn, groupKey, money]);
};

const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
  // Replaced by custom interactive legend, label kept for reference but unused in new pie chart
  return null;
};

const PieOverlay = ({ activeIndex, data, total, chartSize, baseRadius }) => {
  const [renderState, setRenderState] = useState({ index: -1, radiusOffset: 0, opacity: 0 });
  const animRef = useRef(null);
  const prevActiveRef = useRef(-1);

  useEffect(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current);

    if (activeIndex !== -1) {
      // Animate IN — spring expand
      const start = Date.now();
      const animate = () => {
        const progress = Math.min((Date.now() - start) / 300, 1);
        const ease = 1 + 2.70158 * Math.pow(progress - 1, 3) + 1.70158 * Math.pow(progress - 1, 2);
        setRenderState({ index: activeIndex, radiusOffset: Math.max(0, ease) * 10, opacity: 1 });
        if (progress < 1) animRef.current = requestAnimationFrame(animate);
      };
      animRef.current = requestAnimationFrame(animate);
    } else if (prevActiveRef.current !== -1) {
      // Animate OUT — smooth shrink + fade
      const outIndex = prevActiveRef.current;
      const start = Date.now();
      const animate = () => {
        const progress = Math.min((Date.now() - start) / 250, 1);
        const ease = progress * progress;
        setRenderState({ index: outIndex, radiusOffset: 10 * (1 - ease), opacity: 1 - ease });
        if (progress < 1) {
          animRef.current = requestAnimationFrame(animate);
        } else {
          setRenderState({ index: -1, radiusOffset: 0, opacity: 0 });
        }
      };
      animRef.current = requestAnimationFrame(animate);
    }

    prevActiveRef.current = activeIndex;
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [activeIndex]);

  if (renderState.index === -1 || chartSize.w === 0 || total === 0) return null;

  let startAngle = 0;
  for (let i = 0; i < renderState.index; i++) {
    startAngle += (data[i].value / total) * 360;
  }
  const endAngle = startAngle + (data[renderState.index].value / total) * 360;
  const cx = chartSize.w / 2;
  const cy = chartSize.h / 2;

  return (
    <svg
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 10 }}
      viewBox={`0 0 ${chartSize.w} ${chartSize.h}`}
    >
      <defs>
        <radialGradient id="pieGradient-accent-overlay" cx={cx} cy={cy} r={baseRadius + 10} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--accent-color)" stopOpacity={0.5} />
          <stop offset="100%" stopColor="var(--accent-color)" stopOpacity={0.95} />
        </radialGradient>
      </defs>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={2}
        outerRadius={baseRadius + renderState.radiusOffset}
        startAngle={startAngle}
        endAngle={endAngle}
        fill="url(#pieGradient-accent-overlay)"
        stroke="var(--bg-dark)"
        strokeWidth={3}
        style={{ outline: 'none', opacity: renderState.opacity }}
      />
    </svg>
  );
};

function CustomPieChartWidget({ data, isIncome = false }) {
  const money = useBaseMoney();
  const { baseCurrency } = money;
  const [lockedIndex, setLockedIndex] = useState(-1);
  const [hoveredIndex, setHoveredIndex] = useState(-1);
  const activeIndex = lockedIndex !== -1 ? lockedIndex : hoveredIndex;
  
  const containerRef = useRef(null);
  const listRef = useRef(null);

  const total = data.reduce((sum, item) => sum + item.value, 0);

  useEffect(() => {
    if (activeIndex !== -1 && listRef.current) {
      const activeEl = listRef.current.children[activeIndex];
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [activeIndex]);

  useEffect(() => {
    function handleGlobalClick(e) {
      if (lockedIndex !== -1 && containerRef.current && !containerRef.current.contains(e.target)) {
        setLockedIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleGlobalClick);
    return () => document.removeEventListener("mousedown", handleGlobalClick);
  }, [lockedIndex]);

  // Track chart area dimensions for overlay and dynamic sizing
  const chartAreaRef = useRef(null);
  const [chartSize, setChartSize] = useState({ w: 0, h: 0 });

  // Synchronous initial measurement — guarantees dimensions before first paint
  useLayoutEffect(() => {
    const el = chartAreaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setChartSize({ w: rect.width, h: rect.height });
    }
  }, [data.length > 0]);

  // Ongoing observation for layout changes (resize, orientation change, etc.)
  useEffect(() => {
    const el = chartAreaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      const h = entry.contentRect.height;
      if (w > 0 && h > 0) {
        setChartSize(prev => (prev.w === w && prev.h === h) ? prev : { w, h });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [data.length > 0]);

  // ─── Legend amount sizing ────────────────────────────────────────────────
  // The amount column used to be a fixed 80px, so "PKR 30.1K" wrapped onto a
  // second line the moment the currency code and a five-character figure did
  // not fit. It is now sized to its own content, and the font shrinks only
  // once the legend is genuinely too narrow to hold it at full size.
  // Native mode lists what each slice was made of ("PKR 30.1K + USD 25"),
  // unified mode the one converted figure.
  const legendLabels = useMemo(
    () => data.map(entry => money.native
      ? orderCurrencies(Object.keys(entry.parts), baseCurrency)
          .filter(c => Math.abs(entry.parts[c]) >= 0.005)
          .map(c => formatCompactCurrency(entry.parts[c], c)).join(' + ') || formatCompactCurrency(0, baseCurrency)
      : formatCompactCurrency(entry.value, baseCurrency)),
    [data, baseCurrency, money.native]
  );

  // Native mode: an outer ring splits every slice by currency, sized by the
  // converted parts so its segments line up with the slice beneath. Only
  // drawn when more than one currency appears at all.
  const ring = useMemo(() => {
    if (!money.native) return null;
    const segments = data.flatMap((entry, index) =>
      orderCurrencies(Object.keys(entry.partsBase), baseCurrency)
        .filter(c => entry.partsBase[c] > 0)
        .map(c => ({ key: `${index}-${c}`, index, currency: c, value: entry.partsBase[c] }))
    );
    const currencies = orderCurrencies([...new Set(segments.map(s => s.currency))], baseCurrency);
    return currencies.length > 1 ? { segments, currencies } : null;
  }, [data, baseCurrency, money.native]);

  const [legendWidth, setLegendWidth] = useState(0);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const apply = (w) => setLegendWidth(prev => (Math.abs(prev - w) < 0.5 ? prev : w));
    apply(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => apply(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [data.length > 0]);

  const amountFit = useMemo(() => {
    // Everything in a legend row that is not the amount: the row's horizontal
    // padding, the colour dot and its gap, the percentage column and its gap,
    // and the smallest the (ellipsised) category name is allowed to get.
    const RESERVED = 20 + 10 + 12 + 48 + 12;
    const MIN_NAME = 56;
    const MAX_FONT = 13;
    const MIN_FONT = 9;

    if (!legendWidth || legendLabels.length === 0) {
      return { fontSize: MAX_FONT, width: null };
    }

    const fontFamily = (listRef.current && getComputedStyle(listRef.current).fontFamily) || 'sans-serif';
    // The width the amount can have before the name is squeezed below what is
    // worth reading. Past that the font shrinks instead; past MIN_FONT the name
    // gives up the rest of its room, because the amount keeps whatever width it
    // measured — it is the one column that must stay whole.
    const available = Math.max(32, legendWidth - RESERVED - MIN_NAME);

    let fontSize = MAX_FONT;
    let widest = 0;
    while (true) {
      widest = legendLabels.reduce(
        (max, label) => Math.max(max, measureTextWidth(label, `700 ${fontSize}px ${fontFamily}`)),
        0
      );
      if (widest <= available || fontSize <= MIN_FONT) break;
      fontSize -= 0.5;
    }

    return { fontSize, width: Math.ceil(widest) + 2 };
  }, [legendLabels, legendWidth]);

  const handlePieMouseEnter = (_, index) => {
    if (lockedIndex === -1) {
      setHoveredIndex(index);
    }
  };
  const handlePieMouseLeave = () => {
    if (lockedIndex === -1) {
      setHoveredIndex(-1);
    }
  };

  const handleLegendClick = (index) => {
    setLockedIndex(prev => prev === index ? -1 : index);
    setHoveredIndex(-1);
  };

  if (data.length === 0) return <div style={{ color: 'var(--text-secondary)', textAlign: 'center', marginTop: '40px' }}>No data</div>;

  // Dynamically calculate pie radius based on container size
  // Leaves padding (0.7 factor) for the expansion animation overshoot
  const baseRadius = chartSize.w > 0 && chartSize.h > 0 
    ? Math.min(chartSize.w, chartSize.h) / 2 * 0.7 
    : 100;

  return (
    <div className="custom-pie-container" ref={containerRef}>
      <div className="custom-pie-chart-area" ref={chartAreaRef} style={{ position: 'relative' }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <defs>
              <filter id="pieShadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="8" stdDeviation="12" floodColor="#000" floodOpacity="0.5" />
              </filter>
              <radialGradient id="pieGradient-translucent" cx="50%" cy="50%" r={baseRadius} gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="var(--accent-color)" stopOpacity={0.05} />
                <stop offset="100%" stopColor="var(--accent-color)" stopOpacity={0.15} />
              </radialGradient>
            </defs>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={2}
              outerRadius={baseRadius}
              paddingAngle={0}
              dataKey="value"
              stroke="var(--bg-dark)"
              strokeWidth={2}
              style={{ outline: 'none' }}
              onMouseEnter={handlePieMouseEnter}
              onMouseLeave={handlePieMouseLeave}
              isAnimationActive={!ring}
            >
              {data.map((entry, index) => {
                const isHighlighted = activeIndex === index;
                return (
                  <Cell 
                    key={`cell-${index}`} 
                    fill="url(#pieGradient-translucent)" 
                    style={{ 
                      outline: 'none',
                      opacity: isHighlighted ? 0 : 1,
                      transition: 'opacity 0.3s ease'
                    }} 
                  />
                );
              })}
            </Pie>
            {ring && (
              // Clear of the hover overlay, which grows the slice by 10px.
              <Pie
                data={ring.segments}
                cx="50%"
                cy="50%"
                innerRadius={baseRadius + 13}
                outerRadius={baseRadius + 19}
                paddingAngle={0}
                dataKey="value"
                stroke="var(--bg-dark)"
                strokeWidth={1}
                isAnimationActive={false}
                style={{ outline: 'none', pointerEvents: 'none' }}
              >
                {ring.segments.map(seg => (
                  <Cell
                    key={seg.key}
                    fill={money.colourOf(seg.currency)}
                    style={{ outline: 'none', opacity: activeIndex === -1 || activeIndex === seg.index ? 0.9 : 0.35, transition: 'opacity 0.3s ease' }}
                  />
                ))}
              </Pie>
            )}
          </PieChart>
        </ResponsiveContainer>

        {/* Overlay for animated expansion — works for both hover and list click */}
        <PieOverlay
          activeIndex={activeIndex}
          data={data}
          total={total}
          chartSize={chartSize}
          baseRadius={baseRadius}
        />
        {ring && (
          <div className="currency-key" style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
            {ring.currencies.map(c => (
              <span key={c} className="currency-key-item">
                <span className="currency-key-dot" style={{ background: money.colourOf(c) }} />{c}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="custom-pie-legend" ref={listRef}>
        {data.map((entry, index) => {
          const isHighlighted = activeIndex === index;
          const percent = total > 0 ? ((entry.value / total) * 100).toFixed(1) : "0.0";
          
          return (
            <div 
              key={entry.name}
              className={`pie-legend-item ${isHighlighted ? 'active' : ''}`}
              onClick={() => handleLegendClick(index)}
              style={{ backgroundColor: isHighlighted ? 'var(--accent-glow)' : 'transparent' }}
            >
              <div 
                className="pie-legend-dot" 
                style={{ 
                  backgroundColor: isHighlighted ? 'var(--accent-color)' : 'var(--accent-glow)', 
                  transform: isHighlighted ? 'scale(1.3)' : 'scale(1)' 
                }}>
              </div>
              <div className="pie-legend-name">{entry.name}</div>
              <div className="pie-legend-percent">{percent}%</div>
              <div
                className="pie-legend-amount"
                style={{
                  color: isHighlighted ? '#fff' : 'var(--text-secondary)',
                  fontSize: `${amountFit.fontSize}px`,
                  ...(amountFit.width !== null ? { width: `${amountFit.width}px` } : {})
                }}
              >
                {legendLabels[index]}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 5. Spending By Category
export function SpendingByCategory({ transactions }) {
  const data = usePieData(transactions, isSpending, 'category');
  return <CustomPieChartWidget data={data} />;
}

// 6. Spending By Payee
export function SpendingByPayee({ transactions }) {
  const data = usePieData(transactions, isSpending, 'payee');
  return <CustomPieChartWidget data={data} />;
}

// 7. Income By Category
export function IncomeByCategory({ transactions }) {
  const data = usePieData(transactions, isEarning, 'category');
  return <CustomPieChartWidget data={data} isIncome={true} />;
}

// 8. Income By Payee
export function IncomeByPayee({ transactions }) {
  const data = usePieData(transactions, isEarning, 'payee');
  return <CustomPieChartWidget data={data} isIncome={true} />;
}
