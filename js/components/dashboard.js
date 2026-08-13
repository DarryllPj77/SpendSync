"use strict";

import { getTransactions } from "../utils/storage.js";
import { formatCurrency } from "../utils/formatters.js";

export function getDashboardTotals() {
  const transactions = getTransactions();
  const income = transactions
    .filter((transaction) => transaction.type === "income")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const expenses = transactions
    .filter((transaction) => transaction.type === "expense")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  return { income, expenses, balance: income - expenses };
}

export function renderDashboardCards() {
  const totals = getDashboardTotals();
  document.querySelector("#total-income").textContent = formatCurrency(totals.income);
  document.querySelector("#total-expenses").textContent = formatCurrency(totals.expenses);
  document.querySelector("#remaining-balance").textContent = formatCurrency(totals.balance);
  document.querySelector("#balance-status").textContent = totals.balance < 0
    ? "Expenses are above recorded income"
    : totals.income > 0
      ? `${Math.max(0, (totals.balance / totals.income) * 100).toFixed(0)}% of income remaining`
      : "Add income to get started";
  return totals;
}
