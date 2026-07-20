import { useMemo, useState, useRef, useEffect, useLayoutEffect } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, Sector,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { format, subMonths, isAfter, parseISO, addDays, startOfDay, differenceInDays } from 'date-fns';
import { formatCurrency } from '../../utils/format';
import { useAppearanceSettings } from '../../context/SettingsContext';
import { useData } from '../../context/DataContext';
import { convertAmount } from '../../utils/exchange';

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

const CustomTooltip = ({ active, payload, label, formatter, labelFormatter }) => {
  if (active && payload && payload.length) {
    const displayLabel = labelFormatter ? labelFormatter(label) : label;
    return (
      <div className="custom-tooltip">
        <p className="label">{displayLabel}</p>
        <p className="intro">
          {formatter ? formatter(payload[0].value) : payload[0].value}
        </p>
      </div>
    );
  }
  return null;
};

import { AreaChart, Area } from 'recharts'; // Make sure AreaChart and Area are available

// 1. Balance Over Time (Area Chart)
export function BalanceOverTime({ transactions, accounts, dateRange }) {
  const { baseCurrency } = useAppearanceSettings();
  const { exchangeRates } = useData();
  
  const { data, ticks } = useMemo(() => {
    if (!transactions || transactions.length === 0) return { data: [], ticks: [] };
    
    const sorted = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Start with the sum of all initial balances from accounts
    let currentBalance = 0;
    if (accounts) {
      accounts.forEach(acc => {
        let initBal = Number(acc.initialBalance) || 0;
        const cur = acc.currency || 'USD';
        if (cur !== baseCurrency) {
          initBal = convertAmount(initBal, cur, baseCurrency, exchangeRates);
        }
        currentBalance += initBal;
      });
    }
    
    // Calculate net change per day
    const dailyChanges = {};
    sorted.forEach(tx => {
      if (tx.type === 2) return; 
      const dayKey = format(parseISO(tx.date), 'yyyy-MM-dd');
      let txCurrency = tx.currency;
      if (!txCurrency) {
        const acc = accounts && accounts.find(a => a.id === tx.account || a.name === tx.account);
        txCurrency = acc ? (acc.currency || 'USD') : baseCurrency;
      }
      let amt = tx.amount;
      if (txCurrency !== baseCurrency) {
        amt = convertAmount(amt, txCurrency, baseCurrency, exchangeRates);
      }
      dailyChanges[dayKey] = (dailyChanges[dayKey] || 0) + amt;
    });

    // Start with the earliest transaction
    const firstDate = startOfDay(parseISO(sorted[0].date));
    const today = startOfDay(new Date());
    const totalDays = differenceInDays(today, firstDate);

    let result = [];
    for (let i = 0; i <= totalDays; i++) {
      const currDate = addDays(firstDate, i);
      const dayKey = format(currDate, 'yyyy-MM-dd');
      
      if (dailyChanges[dayKey]) {
        currentBalance += dailyChanges[dayKey];
      }
      
      result.push({
        name: format(currDate, 'MMM dd'),
        timestamp: currDate.getTime(),
        balance: currentBalance
      });
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
    
    return { data: result, ticks: generatedTicks };
  }, [transactions, accounts, dateRange]);

  if (data.length === 0) return <div style={{ color: 'var(--text-secondary)', textAlign: 'center', marginTop: '40px' }}>No data</div>;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--accent-color)" stopOpacity={0.15}/>
            <stop offset="95%" stopColor="var(--accent-color)" stopOpacity={0}/>
          </linearGradient>
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
          stroke="var(--text-secondary)" 
          fontSize={12} 
          tickLine={false} 
          axisLine={false} 
          tickFormatter={(val) => formatCompactNumber(val)} 
          width={40} 
        />
        <Tooltip 
          content={
            <CustomTooltip 
              formatter={(val) => formatCompactCurrency(val, baseCurrency)} 
              labelFormatter={(label) => format(new Date(label), 'dd MMM')} 
            />
          } 
          animationDuration={200} // Smooth interpolation of tooltip value
          animationEasing="ease-out"
        />
        <Area 
          type="monotone" 
          dataKey="balance" 
          stroke="var(--accent-color)" 
          strokeWidth={3} 
          fillOpacity={1} 
          fill="url(#colorBalance)" 
          activeDot={{ r: 6, fill: 'var(--accent-color)', stroke: '#fff', strokeWidth: 2 }}
          animationDuration={1500}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// Helper for monthly bar charts
const useMonthlyData = (transactions, filterFn, baseCurrency, exchangeRates, accounts) => {
  return useMemo(() => {
    const twelveMonthsAgo = subMonths(new Date(), 12);
    
    // Initialize last 12 months with 0
    const months = {};
    for (let i = 11; i >= 0; i--) {
      months[format(subMonths(new Date(), i), 'MMM')] = 0;
    }

    transactions.forEach(tx => {
      const date = parseISO(tx.date);
      if (isAfter(date, twelveMonthsAgo) && filterFn(tx)) {
        const monthKey = format(date, 'MMM');
        if (months[monthKey] !== undefined) {
          let txCurrency = tx.currency;
          if (!txCurrency) {
            const acc = accounts && accounts.find(a => a.id === tx.account || a.name === tx.account);
            txCurrency = acc ? (acc.currency || 'USD') : baseCurrency;
          }
          let amt = Math.abs(tx.amount);
          if (txCurrency !== baseCurrency && exchangeRates) {
            amt = convertAmount(amt, txCurrency, baseCurrency, exchangeRates);
          }
          months[monthKey] += amt;
        }
      }
    });

    return Object.keys(months).map(key => ({
      name: key,
      amount: months[key]
    }));
  }, [transactions, filterFn, baseCurrency, exchangeRates, accounts]);
};

// 2. Spending Per Month
export function SpendingPerMonth({ transactions, accounts }) {
  const { baseCurrency } = useAppearanceSettings();
  const { exchangeRates } = useData();
  const data = useMonthlyData(transactions, tx => tx.type === 0, baseCurrency, exchangeRates, accounts);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <defs>
          <linearGradient id="colorAccentBar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-color)" stopOpacity={1}/>
            <stop offset="100%" stopColor="var(--accent-color)" stopOpacity={0.5}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis stroke="var(--text-secondary)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => formatCompactNumber(val)} width={40} />
        <Tooltip content={<CustomTooltip formatter={(val) => formatCompactCurrency(val, baseCurrency)} />} cursor={false} />
        <Bar dataKey="amount" fill="url(#colorAccentBar)" fillOpacity={0.15} activeBar={{ fillOpacity: 1 }} barSize={16} radius={[4, 4, 0, 0]} style={{ transition: 'fill-opacity 0.3s ease' }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// 3. Income Per Month
export function IncomePerMonth({ transactions, accounts }) {
  const { baseCurrency } = useAppearanceSettings();
  const { exchangeRates } = useData();
  const data = useMonthlyData(transactions, tx => tx.type === 1, baseCurrency, exchangeRates, accounts);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <defs>
          <linearGradient id="colorAccentBar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-color)" stopOpacity={1}/>
            <stop offset="100%" stopColor="var(--accent-color)" stopOpacity={0.5}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis stroke="var(--text-secondary)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => formatCompactNumber(val)} width={40} />
        <Tooltip content={<CustomTooltip formatter={(val) => formatCompactCurrency(val, baseCurrency)} />} cursor={false} />
        <Bar dataKey="amount" fill="url(#colorAccentBar)" fillOpacity={0.15} activeBar={{ fillOpacity: 1 }} barSize={16} radius={[4, 4, 0, 0]} style={{ transition: 'fill-opacity 0.3s ease' }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// 4. Investment Per Month
export function InvestmentPerMonth({ transactions, accounts }) {
  const { baseCurrency } = useAppearanceSettings();
  const { exchangeRates } = useData();
  // Assuming "Investment" is a category
  const data = useMonthlyData(transactions, tx => tx.type === 0 && tx.category && tx.category.toLowerCase().includes('invest'), baseCurrency, exchangeRates, accounts);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <defs>
          <linearGradient id="colorAccentBar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-color)" stopOpacity={1}/>
            <stop offset="100%" stopColor="var(--accent-color)" stopOpacity={0.5}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis stroke="var(--text-secondary)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => formatCompactNumber(val)} width={40} />
        <Tooltip content={<CustomTooltip formatter={(val) => formatCompactCurrency(val, baseCurrency)} />} cursor={false} />
        <Bar dataKey="amount" fill="url(#colorAccentBar)" fillOpacity={0.15} activeBar={{ fillOpacity: 1 }} barSize={16} radius={[4, 4, 0, 0]} style={{ transition: 'fill-opacity 0.3s ease' }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// Helper for pie charts
const usePieData = (transactions, filterFn, groupKey, baseCurrency, exchangeRates, accounts) => {
  return useMemo(() => {
    const grouped = {};
    transactions.forEach(tx => {
      if (filterFn(tx)) {
        const key = tx[groupKey] || 'Uncategorized';
        
        let txCurrency = tx.currency;
        if (!txCurrency) {
          const acc = accounts && accounts.find(a => a.id === tx.account || a.name === tx.account);
          txCurrency = acc ? (acc.currency || 'USD') : baseCurrency;
        }
        let amt = Math.abs(tx.amount);
        if (txCurrency !== baseCurrency && exchangeRates) {
          amt = convertAmount(amt, txCurrency, baseCurrency, exchangeRates);
        }
        
        grouped[key] = (grouped[key] || 0) + amt;
      }
    });

    return Object.keys(grouped)
      .map(key => ({ name: key, value: grouped[key] }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10); // Top 10 only
  }, [transactions, filterFn, groupKey, baseCurrency, exchangeRates, accounts]);
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

function CustomPieChartWidget({ data, baseCurrency, isIncome = false }) {
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
              <div className="pie-legend-amount" style={{ color: isHighlighted ? '#fff' : 'var(--text-secondary)' }}>
                {formatCompactCurrency(entry.value, baseCurrency)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 5. Spending By Category
export function SpendingByCategory({ transactions, accounts }) {
  const { baseCurrency } = useAppearanceSettings();
  const { exchangeRates } = useData();
  const data = usePieData(transactions, tx => tx.type === 0, 'category', baseCurrency, exchangeRates, accounts);
  return <CustomPieChartWidget data={data} baseCurrency={baseCurrency} />;
}

// 6. Spending By Payee
export function SpendingByPayee({ transactions, accounts }) {
  const { baseCurrency } = useAppearanceSettings();
  const { exchangeRates } = useData();
  const data = usePieData(transactions, tx => tx.type === 0, 'payee', baseCurrency, exchangeRates, accounts);
  return <CustomPieChartWidget data={data} baseCurrency={baseCurrency} />;
}

// 7. Income By Payee
export function IncomeByPayee({ transactions, accounts }) {
  const { baseCurrency } = useAppearanceSettings();
  const { exchangeRates } = useData();
  const data = usePieData(transactions, tx => tx.type === 1, 'payee', baseCurrency, exchangeRates, accounts);
  return <CustomPieChartWidget data={data} baseCurrency={baseCurrency} isIncome={true} />;
}
