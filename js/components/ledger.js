"use strict";

import { getDeposits, getTransactions, depositFundingLabel } from "../utils/storage.js";
import { formatCurrency, formatDate } from "../utils/formatters.js";

export function sortedTransactions() {
  return [...getTransactions()].sort((a, b) =>
    a.date.localeCompare(b.date) || String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""))
  );
}

export function calculateLedger() {
  let balance = 0;
  return sortedTransactions().map((transaction) => {
    balance += transaction.type === "income" ? transaction.amount : -transaction.amount;
    return { ...transaction, runningBalance: balance };
  });
}

export function getFundingSourceLabel(transaction) {
  if (transaction.type !== "expense") return "";
  if (transaction.funding_source) return transaction.funding_source;
  if (!transaction.funding_source_id) return "";
  const deposit = getDeposits().find((candidate) => candidate.id === transaction.funding_source_id);
  return deposit ? depositFundingLabel(deposit) : "";
}

export function getDistinctCategories(transactions = getTransactions()) {
  return [...new Set(transactions.map((transaction) => transaction.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "en-PH"));
}

function updateCategoryFilterOptions(transactions) {
  const select = document.querySelector("#transaction-category-filter");
  const selectedCategory = select.value || "all";
  const categories = getDistinctCategories(transactions);
  select.replaceChildren(new Option("All categories", "all"));
  categories.forEach((category) => select.add(new Option(category, category)));
  select.value = categories.includes(selectedCategory) ? selectedCategory : "all";
}

export function filterLedgerTransactions(ledger, filters) {
  const query = filters.query.trim().toLowerCase();
  return ledger.filter((transaction) => {
    const matchesSearch = !query || `${transaction.item} ${transaction.category} ${transaction.method} ${transaction.date}`
      .toLowerCase()
      .includes(query);
    const matchesType = filters.type === "all" || transaction.type === filters.type;
    const matchesCategory = filters.category === "all" || transaction.category === filters.category;
    const matchesStartDate = !filters.startDate || transaction.date >= filters.startDate;
    const matchesEndDate = !filters.endDate || transaction.date <= filters.endDate;
    return matchesSearch && matchesType && matchesCategory && matchesStartDate && matchesEndDate;
  });
}

function createTransactionRow(transaction, onDelete) {
  const row = document.createElement("tr");
  const values = [
    formatDate(transaction.date),
    null,
    transaction.type === "income" ? formatCurrency(transaction.amount) : "—",
    transaction.type === "expense" ? formatCurrency(transaction.amount) : "—",
    formatCurrency(transaction.runningBalance),
  ];

  values.forEach((value, index) => {
    const cell = document.createElement("td");
    if (index === 1) {
      const wrapper = document.createElement("span");
      wrapper.className = "transaction-item";
      const strong = document.createElement("strong");
      strong.textContent = transaction.item;
      const small = document.createElement("small");
      const fundingSource = getFundingSourceLabel(transaction);
      const details = transaction.type === "expense"
        ? `${transaction.category} • ${transaction.method}`
        : `Deposit • ${transaction.method}`;
      small.textContent = fundingSource ? `${details} • Funded by ${fundingSource}` : details;
      wrapper.append(strong, small);
      cell.append(wrapper);
    } else {
      cell.textContent = value;
    }
    if (index >= 2) cell.classList.add("number-cell");
    if (index === 2 && transaction.type === "income") cell.classList.add("amount-in");
    if (index === 3 && transaction.type === "expense") cell.classList.add("amount-out");
    if (index === 4) cell.classList.add("running-balance");
    row.append(cell);
  });

  const actionCell = document.createElement("td");
  const deleteButton = document.createElement("button");
  deleteButton.className = "delete-row";
  deleteButton.type = "button";
  deleteButton.title = "Delete transaction";
  deleteButton.setAttribute("aria-label", `Delete ${transaction.item}`);
  deleteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m3 0-1 14H7L6 7"/></svg>';
  deleteButton.addEventListener("click", () => onDelete(transaction.id));
  actionCell.append(deleteButton);
  row.append(actionCell);
  return row;
}

export function renderLedger(onDelete) {
  const transactions = getTransactions();
  updateCategoryFilterOptions(transactions);
  const ledger = calculateLedger();
  const filtered = filterLedgerTransactions(ledger, {
    query: document.querySelector("#transaction-search").value,
    type: document.querySelector("#transaction-filter").value,
    category: document.querySelector("#transaction-category-filter").value,
    startDate: document.querySelector("#transaction-start-date").value,
    endDate: document.querySelector("#transaction-end-date").value,
  });

  const tbody = document.querySelector("#transaction-rows");
  const emptyState = document.querySelector("#empty-transactions");
  const table = document.querySelector(".ledger-table");
  tbody.replaceChildren();

  if (!transactions.length) {
    table.hidden = true;
    emptyState.hidden = false;
  } else {
    table.hidden = false;
    emptyState.hidden = true;
    filtered.forEach((transaction) => tbody.append(createTransactionRow(transaction, onDelete)));
  }

  const footer = document.querySelector("#ledger-footer");
  if (!transactions.length) footer.textContent = "No transactions recorded yet";
  else if (!filtered.length) footer.textContent = "No transactions match your current filters";
  else footer.textContent = `Showing ${filtered.length} of ${transactions.length} transaction${transactions.length === 1 ? "" : "s"} • Oldest to newest`;
}

export function bindLedgerControls(onRender) {
  document.querySelector("#transaction-search").addEventListener("input", onRender);
  document.querySelector("#transaction-filter").addEventListener("change", onRender);
  document.querySelector("#transaction-category-filter").addEventListener("change", onRender);
  document.querySelector("#transaction-start-date").addEventListener("change", onRender);
  document.querySelector("#transaction-end-date").addEventListener("change", onRender);
}
