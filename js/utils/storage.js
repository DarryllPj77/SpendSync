"use strict";

import { formatCurrency } from "./formatters.js";

export const STORAGE_KEYS = Object.freeze({
  users: "spendsync.users.v1",
  session: "spendsync.session.v1",
  transactions: (userId) => `spendsync.transactions.${userId}.v1`,
  expenses: (userId) => `spendsync.expenses.${userId}.v1`,
  deposits: (userId) => `spendsync.deposits.${userId}.v1`,
});

let currentUser = null;
let expenses = [];
let deposits = [];
let transactions = [];

export function getStoredArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function hashPassword(password) {
  if (!globalThis.crypto?.subtle) {
    let fallbackHash = 2166136261;
    for (let index = 0; index < password.length; index += 1) {
      fallbackHash ^= password.charCodeAt(index);
      fallbackHash = Math.imul(fallbackHash, 16777619);
    }
    return `fallback:${(fallbackHash >>> 0).toString(16)}`;
  }
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function getUsers() {
  return getStoredArray(STORAGE_KEYS.users);
}

export function saveUsers(users) {
  localStorage.setItem(STORAGE_KEYS.users, JSON.stringify(users));
}

export function getSessionUserId() {
  return localStorage.getItem(STORAGE_KEYS.session);
}

export function setSessionUserId(userId) {
  localStorage.setItem(STORAGE_KEYS.session, userId);
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEYS.session);
}

export function findSessionUser() {
  const sessionId = getSessionUserId();
  return sessionId ? getUsers().find((user) => user.id === sessionId) ?? null : null;
}

export function normalizeExpense(record) {
  const description = record.item || record.description || "Expense";
  return {
    id: record.id || createId(),
    type: "Expense",
    date: record.date,
    item: description,
    description,
    category: record.category || "Other",
    amount: Math.abs(Number(record.amount)),
    method: record.method || "Other",
    funding_source_id: record.funding_source_id || null,
    funding_source: record.funding_source || "",
    createdAt: record.createdAt || new Date().toISOString(),
    ...(record.importedFrom ? { importedFrom: record.importedFrom } : {}),
    ...(record.importedSheet ? { importedSheet: record.importedSheet } : {}),
  };
}

export function normalizeDeposit(record) {
  const description = record.source || record.item || record.description || "Deposit";
  return {
    id: record.id || createId(),
    type: "Income",
    date: record.date,
    source: description,
    description,
    amount: Math.abs(Number(record.amount)),
    method: record.method || "Other",
    createdAt: record.createdAt || new Date().toISOString(),
    ...(record.importedFrom ? { importedFrom: record.importedFrom } : {}),
    ...(record.importedSheet ? { importedSheet: record.importedSheet } : {}),
  };
}

export function depositFundingLabel(deposit) {
  return `${deposit.source} (${formatCurrency(deposit.amount)})`;
}

function refreshTransactions() {
  transactions = [
    ...deposits.map((deposit) => ({
      ...deposit,
      type: "income",
      item: deposit.source,
      category: "Deposit",
      funding_source_id: null,
      funding_source: "",
    })),
    ...expenses.map((expense) => ({ ...expense, type: "expense" })),
  ];
}

function persistFinancialData() {
  if (!currentUser) return;
  localStorage.setItem(STORAGE_KEYS.expenses(currentUser.id), JSON.stringify(expenses));
  localStorage.setItem(STORAGE_KEYS.deposits(currentUser.id), JSON.stringify(deposits));
  refreshTransactions();
}

function persistTransactions() {
  expenses = transactions.filter((transaction) => transaction.type === "expense").map(normalizeExpense);
  deposits = transactions.filter((transaction) => transaction.type === "income").map(normalizeDeposit);
  persistFinancialData();
}

function loadFinancialData(userId) {
  const expensesKey = STORAGE_KEYS.expenses(userId);
  const depositsKey = STORAGE_KEYS.deposits(userId);
  const hasSeparateCollections = localStorage.getItem(expensesKey) !== null || localStorage.getItem(depositsKey) !== null;

  if (hasSeparateCollections) {
    expenses = getStoredArray(expensesKey).map(normalizeExpense);
    deposits = getStoredArray(depositsKey).map(normalizeDeposit);
  } else {
    const legacyTransactions = getStoredArray(STORAGE_KEYS.transactions(userId));
    expenses = legacyTransactions.filter((transaction) => transaction.type === "expense").map(normalizeExpense);
    deposits = legacyTransactions.filter((transaction) => transaction.type === "income").map(normalizeDeposit);
  }

  expenses = expenses.map((expense) => {
    if (expense.funding_source || !expense.funding_source_id) return expense;
    const linkedDeposit = deposits.find((deposit) => deposit.id === expense.funding_source_id);
    return linkedDeposit ? { ...expense, funding_source: depositFundingLabel(linkedDeposit) } : expense;
  });
  localStorage.setItem(expensesKey, JSON.stringify(expenses));
  localStorage.setItem(depositsKey, JSON.stringify(deposits));
  refreshTransactions();
}

export function initializeCurrentUser(user) {
  currentUser = user;
  loadFinancialData(user.id);
}

export function setCurrentUser(user) {
  currentUser = user;
}

export function clearCurrentUser() {
  currentUser = null;
  expenses = [];
  deposits = [];
  transactions = [];
}

export function getCurrentUser() {
  return currentUser;
}

export function getExpenses() {
  return expenses;
}

export function getDeposits() {
  return deposits;
}

export function getTransactions() {
  return transactions;
}

export function getRecentDeposits(limit = 25) {
  return [...deposits]
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
    .slice(0, limit);
}

export function addExpense(record) {
  expenses.push(normalizeExpense(record));
  persistFinancialData();
}

export function addDeposit(record) {
  deposits.push(normalizeDeposit(record));
  persistFinancialData();
}

export function appendTransactions(records) {
  transactions.push(...records);
  persistTransactions();
}

export function deleteTransactionRecord(id) {
  const transaction = transactions.find((item) => item.id === id);
  if (!transaction) return null;
  if (transaction.type === "income") {
    transactions = transactions.map((item) =>
      item.funding_source_id === transaction.id ? { ...item, funding_source_id: null, funding_source: "" } : item
    );
  }
  transactions = transactions.filter((item) => item.id !== id);
  persistTransactions();
  return transaction;
}

export function resetFinancialData() {
  if (!currentUser) return;
  transactions = [];
  expenses = [];
  deposits = [];
  localStorage.removeItem(STORAGE_KEYS.transactions(currentUser.id));
  localStorage.removeItem(STORAGE_KEYS.expenses(currentUser.id));
  localStorage.removeItem(STORAGE_KEYS.deposits(currentUser.id));
}
