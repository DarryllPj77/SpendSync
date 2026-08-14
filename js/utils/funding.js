"use strict";

import { formatMonthLabel } from "./formatters.js";

const COMBINED_FUNDING_PREFIX = "funding-pool:";

export function normalizeFundingSourceKey(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-PH");
}

export function getFundingMonthKey(date) {
  const monthKey = String(date ?? "").slice(0, 7);
  return /^\d{4}-\d{2}$/.test(monthKey) ? monthKey : "";
}

export function createCombinedFundingSourceId(source, monthKey) {
  const sourceKey = normalizeFundingSourceKey(source);
  if (!sourceKey || !/^\d{4}-\d{2}$/.test(monthKey)) return "";
  return `${COMBINED_FUNDING_PREFIX}${monthKey}:${encodeURIComponent(sourceKey)}`;
}

export function parseCombinedFundingSourceId(value) {
  const text = String(value ?? "");
  if (!text.startsWith(COMBINED_FUNDING_PREFIX)) return null;
  const payload = text.slice(COMBINED_FUNDING_PREFIX.length);
  const separatorIndex = payload.indexOf(":");
  if (separatorIndex < 0) return null;
  const monthKey = payload.slice(0, separatorIndex);
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return null;
  try {
    const sourceKey = decodeURIComponent(payload.slice(separatorIndex + 1));
    return sourceKey ? { monthKey, sourceKey } : null;
  } catch {
    return null;
  }
}

export function formatCombinedFundingSourceLabel(source, monthKey) {
  return `${String(source ?? "").trim()} - ${formatMonthLabel(monthKey)}`;
}

export function extractFundingSourceName(label) {
  const text = String(label ?? "").trim();
  if (!text) return "";
  const combinedMatch = text.match(/^(.*?)\s+-\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}$/i);
  if (combinedMatch) return combinedMatch[1].trim();
  const depositMatch = text.match(/^(.*?)\s*\([^()]*\)\s*$/);
  return (depositMatch?.[1] ?? text).trim();
}

function transactionSource(transaction) {
  return String(transaction.source ?? transaction.item ?? transaction.description ?? "").trim();
}

function createEmptyGroup(source, sourceKey, monthKey) {
  return {
    id: createCombinedFundingSourceId(source, monthKey),
    source,
    sourceKey,
    monthKey,
    label: formatCombinedFundingSourceLabel(source, monthKey),
    date: `${monthKey}-01`,
    createdAt: "",
    originalDeposits: [],
    expenses: [],
    newDeposits: 0,
    rollover: 0,
    available: 0,
    spent: 0,
    remaining: 0,
  };
}

export function buildCombinedFundingSources(transactions) {
  const records = Array.isArray(transactions) ? transactions : [];
  const deposits = records.filter((transaction) => String(transaction.type).toLowerCase() === "income");
  const expenses = records.filter((transaction) => String(transaction.type).toLowerCase() === "expense");
  const groups = new Map();
  const canonicalSources = new Map();
  const depositSourcesById = new Map();

  const ensureGroup = (source, monthKey) => {
    const sourceKey = normalizeFundingSourceKey(source);
    if (!sourceKey || !monthKey) return null;
    const canonicalSource = canonicalSources.get(sourceKey) ?? String(source).trim();
    canonicalSources.set(sourceKey, canonicalSource);
    const id = createCombinedFundingSourceId(canonicalSource, monthKey);
    if (!groups.has(id)) groups.set(id, createEmptyGroup(canonicalSource, sourceKey, monthKey));
    return groups.get(id);
  };

  deposits.forEach((deposit) => {
    const source = transactionSource(deposit);
    const monthKey = getFundingMonthKey(deposit.date);
    const group = ensureGroup(source, monthKey);
    if (!group) return;
    const amount = Math.abs(Number(deposit.amount));
    group.originalDeposits.push({ ...deposit, source });
    if (Number.isFinite(amount)) group.newDeposits += amount;
    if (!group.createdAt || String(deposit.createdAt ?? "") < group.createdAt) {
      group.createdAt = String(deposit.createdAt ?? "");
    }
    if (deposit.id) depositSourcesById.set(deposit.id, source);
  });

  expenses.forEach((expense) => {
    if (!expense.funding_source_id && !expense.funding_source) return;
    const parsedPool = parseCombinedFundingSourceId(expense.funding_source_id);
    const depositSource = depositSourcesById.get(expense.funding_source_id);
    const labelSource = extractFundingSourceName(expense.funding_source);
    const sourceKey = parsedPool?.sourceKey
      ?? normalizeFundingSourceKey(depositSource || labelSource);
    if (!sourceKey) return;
    const source = canonicalSources.get(sourceKey) || depositSource || labelSource;
    const monthKey = getFundingMonthKey(expense.date);
    const group = ensureGroup(source, monthKey);
    if (group) group.expenses.push(expense);
  });

  const groupsBySource = new Map();
  groups.forEach((group) => {
    if (!groupsBySource.has(group.sourceKey)) groupsBySource.set(group.sourceKey, []);
    groupsBySource.get(group.sourceKey).push(group);
  });

  const finalGroups = [];
  groupsBySource.forEach((sourceGroups) => {
    let rollover = 0;
    sourceGroups.sort((a, b) => a.monthKey.localeCompare(b.monthKey));
    sourceGroups.forEach((group) => {
      group.originalDeposits.sort((a, b) => (
        a.date.localeCompare(b.date)
        || String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""))
      ));
      group.expenses.sort((a, b) => (
        b.date.localeCompare(a.date)
        || String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))
      ));
      group.rollover = rollover;
      group.available = group.newDeposits + group.rollover;
      group.spent = group.expenses.reduce((sum, expense) => sum + Math.abs(Number(expense.amount) || 0), 0);
      group.remaining = group.available - group.spent;
      rollover = Math.max(group.remaining, 0);
      finalGroups.push(group);
    });
  });

  return finalGroups;
}
