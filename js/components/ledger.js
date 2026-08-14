"use strict";

import {
  depositFundingLabel,
  getCustomOrder,
  getDeposits,
  getTransactions,
  saveCustomOrder,
} from "../utils/storage.js";
import { recordState } from "../utils/history.js";
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

export function sortLedgerTransactions(transactions, sortMode, customOrder = []) {
  const sorted = [...transactions];
  const createdAt = (transaction) => String(transaction.createdAt ?? "");
  if (sortMode === "oldest") {
    return sorted.sort((a, b) => a.date.localeCompare(b.date) || createdAt(a).localeCompare(createdAt(b)));
  }
  if (sortMode === "highest" || sortMode === "lowest") {
    const direction = sortMode === "highest" ? -1 : 1;
    return sorted.sort((a, b) => (
      direction * (a.amount - b.amount)
      || b.date.localeCompare(a.date)
      || createdAt(b).localeCompare(createdAt(a))
    ));
  }
  if (sortMode === "custom") {
    const positions = new Map(customOrder.map((id, index) => [id, index]));
    return sorted.sort((a, b) => (
      (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER)
      || b.date.localeCompare(a.date)
      || createdAt(b).localeCompare(createdAt(a))
    ));
  }
  return sorted.sort((a, b) => b.date.localeCompare(a.date) || createdAt(b).localeCompare(createdAt(a)));
}

function createTransactionRow(transaction, onDelete, index = 0) {
  const row = document.createElement("tr");
  row.dataset.transactionId = transaction.id;
  row.draggable = true;
  row.classList.add("list-item-enter");
  row.style.animationDelay = `${Math.min(index, 10) * 18}ms`;
  const values = [
    formatDate(transaction.date),
    null,
    transaction.type === "income" ? formatCurrency(transaction.amount) : "—",
    transaction.type === "expense" ? formatCurrency(transaction.amount) : "—",
    formatCurrency(transaction.runningBalance),
  ];

  values.forEach((value, index) => {
    const cell = document.createElement("td");
    if (index === 0) {
      const date = document.createElement("span");
      date.className = "transaction-date";
      const handle = document.createElement("span");
      handle.className = "drag-handle";
      handle.title = "Drag to reorder";
      handle.setAttribute("aria-hidden", "true");
      handle.textContent = "⋮⋮";
      const label = document.createElement("span");
      label.textContent = value;
      date.append(handle, label);
      cell.append(date);
    } else if (index === 1) {
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
  deleteButton.draggable = false;
  deleteButton.addEventListener("click", () => onDelete(transaction.id, row));
  actionCell.append(deleteButton);
  row.append(actionCell);
  return row;
}

function mergeVisibleOrder(baseOrder, visibleIds) {
  const currentIds = getTransactions().map((transaction) => transaction.id);
  const currentIdSet = new Set(currentIds);
  const visibleSet = new Set(visibleIds);
  const normalizedBase = baseOrder.filter((id) => currentIdSet.has(id));
  currentIds.forEach((id) => {
    if (!normalizedBase.includes(id)) normalizedBase.push(id);
  });

  let visibleIndex = 0;
  return normalizedBase.map((id) => (
    visibleSet.has(id) ? visibleIds[visibleIndex++] : id
  ));
}

function clearLedgerDropFeedback(tbody) {
  tbody.querySelectorAll(".is-dragging, .drag-over-before, .drag-over-after").forEach((row) => {
    row.classList.remove("is-dragging", "drag-over-before", "drag-over-after");
  });
}

function bindLedgerDragAndDrop(onRender) {
  const tbody = document.querySelector("#transaction-rows");
  let draggedRow = null;
  let dropCommitted = false;
  let originalSortMode = "latest";
  let dragBaseOrder = [];

  tbody.addEventListener("dragstart", (event) => {
    const row = event.target.closest("tr[data-transaction-id]");
    if (!row) return;
    const sortSelect = document.querySelector("#transaction-sort");
    originalSortMode = sortSelect.value;
    if (sortSelect.value !== "custom") {
      dragBaseOrder = sortLedgerTransactions(
        calculateLedger(),
        sortSelect.value,
        getCustomOrder("ledger"),
      ).map((transaction) => transaction.id);
      sortSelect.value = "custom";
    } else {
      dragBaseOrder = getCustomOrder("ledger");
    }

    draggedRow = row;
    dropCommitted = false;
    row.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", row.dataset.transactionId);
  });

  tbody.addEventListener("dragover", (event) => {
    if (!draggedRow) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const target = event.target.closest("tr[data-transaction-id]");
    tbody.querySelectorAll(".drag-over-before, .drag-over-after").forEach((row) => {
      row.classList.remove("drag-over-before", "drag-over-after");
    });
    if (!target || target === draggedRow) return;

    const isAfter = event.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2;
    target.classList.add(isAfter ? "drag-over-after" : "drag-over-before");
    tbody.insertBefore(draggedRow, isAfter ? target.nextSibling : target);
  });

  tbody.addEventListener("drop", (event) => {
    if (!draggedRow) return;
    event.preventDefault();
    const visibleIds = [...tbody.querySelectorAll("tr[data-transaction-id]")]
      .map((row) => row.dataset.transactionId);
    const nextOrder = mergeVisibleOrder(dragBaseOrder, visibleIds);
    if (nextOrder.join("\u001f") !== dragBaseOrder.join("\u001f")) {
      recordState("transaction reorder");
      saveCustomOrder("ledger", nextOrder);
    }
    dropCommitted = true;
    clearLedgerDropFeedback(tbody);
    draggedRow = null;
    requestAnimationFrame(onRender);
  });

  tbody.addEventListener("dragend", () => {
    clearLedgerDropFeedback(tbody);
    draggedRow = null;
    if (!dropCommitted) {
      document.querySelector("#transaction-sort").value = originalSortMode;
      requestAnimationFrame(onRender);
    }
  });
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
  const sortMode = document.querySelector("#transaction-sort").value;
  const visibleTransactions = sortLedgerTransactions(filtered, sortMode, getCustomOrder("ledger"));

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
    visibleTransactions.forEach((transaction, index) => {
      tbody.append(createTransactionRow(transaction, onDelete, index));
    });
  }

  const footer = document.querySelector("#ledger-footer");
  if (!transactions.length) footer.textContent = "No transactions recorded yet";
  else if (!visibleTransactions.length) footer.textContent = "No transactions match your current filters";
  else {
    const sortLabels = {
      latest: "Latest first",
      oldest: "Oldest first",
      highest: "Highest amount first",
      lowest: "Lowest amount first",
      custom: "Custom order",
    };
    footer.textContent = `Showing ${visibleTransactions.length} of ${transactions.length} transaction${transactions.length === 1 ? "" : "s"} • ${sortLabels[sortMode]}`;
  }
}

export function bindLedgerControls(onRender) {
  document.querySelector("#transaction-search").addEventListener("input", onRender);
  document.querySelector("#transaction-filter").addEventListener("change", onRender);
  document.querySelector("#transaction-category-filter").addEventListener("change", onRender);
  document.querySelector("#transaction-start-date").addEventListener("change", onRender);
  document.querySelector("#transaction-end-date").addEventListener("change", onRender);
  document.querySelector("#transaction-sort").addEventListener("change", onRender);
  bindLedgerDragAndDrop(onRender);
}
