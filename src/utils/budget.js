import { startOfMonth, format, parseISO } from 'date-fns';
import { convertAmount } from './exchange';

export function getMonthString(date = new Date()) {
  return format(startOfMonth(date), 'yyyy-MM');
}

export function calculateBudgets(transactions, accounts, categories, budgets, exchangeRates, baseCurrency, targetMonthStr) {
  // 1. Group transactions by month and category
  const activityByMonthCat = {}; // { '2026-07': { 'Groceries': -150 } }
  
  transactions.forEach(tx => {
    if (tx.type === 0 || tx.type === 'expense') {
      const cat = tx.category || 'Uncategorized';
      const monthStr = format(startOfMonth(parseISO(tx.date)), 'yyyy-MM');
      
      let txCurrency = tx.currency;
      if (!txCurrency) {
        const acc = accounts?.find(a => a.id === tx.account || a.name === tx.account);
        txCurrency = acc ? (acc.currency || 'USD') : baseCurrency;
      }
      
      let amt = Math.abs(tx.amount);
      if (txCurrency !== baseCurrency && exchangeRates) {
        amt = convertAmount(amt, txCurrency, baseCurrency, exchangeRates);
      }
      
      if (!activityByMonthCat[monthStr]) activityByMonthCat[monthStr] = {};
      activityByMonthCat[monthStr][cat] = (activityByMonthCat[monthStr][cat] || 0) - amt;
    }
  });

  // 2. Map budgets
  const budgetsByMonthCat = {};
  budgets.forEach(b => {
    if (!budgetsByMonthCat[b.month]) budgetsByMonthCat[b.month] = {};
    budgetsByMonthCat[b.month][b.category] = b;
  });

  // 3. Get list of all months from earliest to targetMonthStr
  let allMonths = new Set([...Object.keys(activityByMonthCat), ...Object.keys(budgetsByMonthCat)]);
  allMonths.add(targetMonthStr);
  let sortedMonths = Array.from(allMonths).sort();
  // only keep up to targetMonthStr
  sortedMonths = sortedMonths.filter(m => m <= targetMonthStr);

  // 4. Calculate month by month
  const categoryBalances = {}; // Tracks running balance
  
  // We want to return data for the targetMonthStr
  const targetMonthData = {
    categories: [],
    totalBudgeted: 0
  };

  sortedMonths.forEach(month => {
    const isTarget = month === targetMonthStr;
    
    categories.forEach(catObj => {
      const cat = catObj.name;
      const budgetRecord = budgetsByMonthCat[month]?.[cat] || {};
      const assigned = budgetRecord.amount || 0;
      const activity = activityByMonthCat[month]?.[cat] || 0;
      const rollover = budgetRecord.rollover !== undefined ? budgetRecord.rollover : true; // Default true
      
      const startingBalance = categoryBalances[cat] || 0;
      const available = startingBalance + assigned + activity;
      
      if (isTarget) {
        targetMonthData.categories.push({
          name: cat,
          assigned,
          activity,
          available,
          rollover,
          target: catObj.target || 0
        });
        targetMonthData.totalBudgeted += assigned;
      }
      
      // Setup next month's starting balance
      if (rollover) {
        categoryBalances[cat] = available;
      } else {
        categoryBalances[cat] = 0;
      }
    });
  });

  return targetMonthData;
}

export function calculateTotalBalance(transactions, accounts, exchangeRates, baseCurrency, endDate) {
  let total = 0;
  
  if (accounts) {
    accounts.forEach(acc => {
      const cur = acc.currency || 'USD';
      const initBal = Number(acc.initialBalance) || 0;
      const rate = exchangeRates?.[cur] || 1;
      const baseRate = exchangeRates?.[baseCurrency] || 1;
      total += (initBal / rate) * baseRate;
    });
  }

  const endT = endDate ? endDate.getTime() : null;

  transactions.forEach(tx => {
    const txTime = parseISO(tx.date).getTime();
    if (!endT || txTime <= endT) {
      const acc = accounts?.find(a => a.name === tx.account);
      const cur = acc ? (acc.currency || 'USD') : 'USD';
      
      if (tx.type !== 2) {
        const rate = exchangeRates?.[cur] || 1;
        const baseRate = exchangeRates?.[baseCurrency] || 1;
        total += (tx.amount / rate) * baseRate;
      } else if (tx.type === 2) {
        const destAcc = accounts?.find(a => a.name === tx.transferTo);
        const destCur = destAcc ? (destAcc.currency || 'USD') : 'USD';
        const destAmt = tx.receivedAmount || Math.abs(tx.amount);
        
        const srcRate = exchangeRates?.[cur] || 1;
        const destRate = exchangeRates?.[destCur] || 1;
        const baseRate = exchangeRates?.[baseCurrency] || 1;
        
        total += (tx.amount / srcRate) * baseRate; 
        total += (destAmt / destRate) * baseRate; 
      }
    }
  });

  return total;
}
