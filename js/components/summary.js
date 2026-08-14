"use strict";

import { getCustomOrder, getTransactions, saveCustomOrder } from "../utils/storage.js";
import { categoryColor, formatCurrency, formatDate, formatMonthLabel } from "../utils/formatters.js";
import { buildCombinedFundingSources } from "../utils/funding.js";
import { recordState } from "../utils/history.js";
import { getFundingSourceLabel } from "./ledger.js";

let monthlySummaryChart = null;
const expandedIncomeHistoryIds = new Set();

export function getMonthlySummary() {
  const monthlyTotals = new Map();
  getTransactions().forEach((transaction) => {
    const monthKey = transaction.date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return;
    const current = monthlyTotals.get(monthKey) ?? { monthKey, income: 0, expenses: 0 };
    if (transaction.type === "income") current.income += transaction.amount;
    if (transaction.type === "expense") current.expenses += transaction.amount;
    monthlyTotals.set(monthKey, current);
  });

  return [...monthlyTotals.values()]
    .map((month) => ({ ...month, net: month.income - month.expenses }))
    .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
}

function appendMonthlyCell(row, text, className = "") {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) cell.className = className;
  row.append(cell);
}

export function renderMonthlySummary() {
  const summary = getMonthlySummary();
  const tbody = document.querySelector("#monthly-summary-rows");
  const tfoot = document.querySelector("#monthly-summary-footer");
  const table = document.querySelector(".monthly-table");
  const empty = document.querySelector("#monthly-summary-empty");
  tbody.replaceChildren();
  tfoot.replaceChildren();

  const totals = summary.reduce((result, month) => ({
    income: result.income + month.income,
    expenses: result.expenses + month.expenses,
  }), { income: 0, expenses: 0 });
  const net = totals.income - totals.expenses;

  document.querySelector("#report-total-income").textContent = formatCurrency(totals.income);
  document.querySelector("#report-total-expenses").textContent = formatCurrency(totals.expenses);
  document.querySelector("#report-total-net").textContent = formatCurrency(net);
  document.querySelector("#report-month-count").textContent = `${summary.length} month${summary.length === 1 ? "" : "s"} recorded`;
  table.hidden = summary.length === 0;
  empty.hidden = summary.length > 0;

  summary.forEach((month) => {
    const row = document.createElement("tr");
    appendMonthlyCell(row, formatMonthLabel(month.monthKey));
    appendMonthlyCell(row, formatCurrency(month.income), "number-cell monthly-income");
    appendMonthlyCell(row, formatCurrency(month.expenses), "number-cell monthly-expense");
    appendMonthlyCell(row, formatCurrency(month.net), `number-cell monthly-net${month.net < 0 ? " is-negative" : ""}`);
    tbody.append(row);
  });

  if (summary.length) {
    const totalRow = document.createElement("tr");
    appendMonthlyCell(totalRow, "Grand Total");
    appendMonthlyCell(totalRow, formatCurrency(totals.income), "number-cell");
    appendMonthlyCell(totalRow, formatCurrency(totals.expenses), "number-cell");
    appendMonthlyCell(totalRow, formatCurrency(net), `number-cell${net < 0 ? " monthly-net is-negative" : ""}`);
    tfoot.append(totalRow);
  }

  renderMonthlyChart(summary);
}

function renderMonthlyChart(summary) {
  const canvas = document.querySelector("#monthly-summary-chart");
  const empty = document.querySelector("#monthly-chart-empty");
  const emptyMessage = empty.querySelector("p");

  if (!summary.length) {
    canvas.hidden = true;
    emptyMessage.textContent = "Add transactions to see your monthly cash-flow chart.";
    empty.hidden = false;
    if (monthlySummaryChart) {
      monthlySummaryChart.destroy();
      monthlySummaryChart = null;
    }
    return;
  }
  if (!globalThis.Chart) {
    canvas.hidden = true;
    emptyMessage.textContent = "The chart library is unavailable. Your monthly totals remain available below.";
    empty.hidden = false;
    return;
  }
  if (document.querySelector("#monthly-summary-view").hidden) return;

  canvas.hidden = false;
  empty.hidden = true;
  const chartMonths = [...summary].reverse().slice(-12);
  const chartData = {
    labels: chartMonths.map((month) => formatMonthLabel(month.monthKey)),
    datasets: [
      {
        label: "Income",
        data: chartMonths.map((month) => month.income),
        backgroundColor: "rgba(13, 148, 136, 0.82)",
        borderColor: "#0f766e",
        borderWidth: 1,
        borderRadius: 6,
      },
      {
        label: "Expenses",
        data: chartMonths.map((month) => month.expenses),
        backgroundColor: "rgba(245, 158, 11, 0.78)",
        borderColor: "#b45309",
        borderWidth: 1,
        borderRadius: 6,
      },
    ],
  };

  if (monthlySummaryChart) {
    monthlySummaryChart.data = chartData;
    monthlySummaryChart.update();
    return;
  }

  monthlySummaryChart = new Chart(canvas, {
    type: "bar",
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "top",
          align: "end",
          labels: { usePointStyle: true, boxWidth: 8, color: "#455854", font: { family: "DM Sans", size: 11 } },
        },
        tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${formatCurrency(context.raw)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#71807c", font: { family: "DM Sans", size: 10 } } },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(113, 128, 124, 0.12)" },
          ticks: {
            color: "#71807c",
            font: { family: "DM Sans", size: 10 },
            callback: (value) => `₱${new Intl.NumberFormat("en-PH", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`,
          },
        },
      },
    },
  });
}

export function destroyMonthlyChart() {
  if (!monthlySummaryChart) return;
  monthlySummaryChart.destroy();
  monthlySummaryChart = null;
}

export function getFundingSourceSummary() {
  const transactions = getTransactions();
  const sources = buildCombinedFundingSources(transactions);
  const totalDeposits = sources.reduce((sum, source) => sum + source.newDeposits, 0);
  const totalAllocated = sources.reduce((sum, source) => sum + source.spent, 0);
  const latestSourceMonths = new Map();
  sources.forEach((source) => {
    const latest = latestSourceMonths.get(source.sourceKey);
    if (!latest || source.monthKey > latest.monthKey) latestSourceMonths.set(source.sourceKey, source);
  });
  const totalRemaining = [...latestSourceMonths.values()]
    .reduce((sum, source) => sum + source.remaining, 0);
  return { sources, totalDeposits, totalAllocated, totalRemaining };
}

export function renderFundingSources() {
  const fundingSummary = getFundingSourceSummary();
  document.querySelector("#funding-total-deposits").textContent = formatCurrency(fundingSummary.totalDeposits);
  document.querySelector("#funding-total-allocated").textContent = formatCurrency(fundingSummary.totalAllocated);
  document.querySelector("#funding-total-remaining").textContent = formatCurrency(fundingSummary.totalRemaining);

  const container = document.querySelector("#funding-source-list");
  const empty = document.querySelector("#funding-sources-empty");
  container.replaceChildren();
  container.hidden = fundingSummary.sources.length === 0;
  empty.hidden = fundingSummary.sources.length > 0;
  const sortMode = document.querySelector("#funding-source-sort")?.value ?? "latest";
  const sortedSources = sortFundingSources(fundingSummary.sources, sortMode, getCustomOrder("fundingSources"));
  sortedSources.forEach((source, index) => {
    container.append(createFundingSourceCard(source, index));
  });
}

export function sortFundingSources(sources, sortMode, customOrder = []) {
  const sorted = [...sources];
  const createdAt = (source) => String(source.createdAt ?? "");
  if (sortMode === "oldest") {
    return sorted.sort((a, b) => a.monthKey.localeCompare(b.monthKey) || a.source.localeCompare(b.source));
  }
  if (sortMode === "highest" || sortMode === "lowest") {
    const direction = sortMode === "highest" ? -1 : 1;
    return sorted.sort((a, b) => (
      direction * (a.available - b.available)
      || b.monthKey.localeCompare(a.monthKey)
      || createdAt(b).localeCompare(createdAt(a))
    ));
  }
  if (sortMode === "custom") {
    const positions = new Map(customOrder.map((id, index) => [id, index]));
    return sorted.sort((a, b) => (
      (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER)
      - (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER)
      || b.monthKey.localeCompare(a.monthKey)
      || createdAt(b).localeCompare(createdAt(a))
    ));
  }
  return sorted.sort((a, b) => b.monthKey.localeCompare(a.monthKey) || a.source.localeCompare(b.source));
}

function createIncomeHistoryPanel(source, panelId, isExpanded) {
  const panel = document.createElement("section");
  panel.className = "income-history-panel";
  panel.id = panelId;
  panel.setAttribute("aria-hidden", String(!isExpanded));
  panel.classList.toggle("is-open", isExpanded);

  const heading = document.createElement("div");
  heading.className = "income-history-panel__heading";
  const title = document.createElement("strong");
  title.textContent = "Income history";
  const count = document.createElement("span");
  count.textContent = `${source.originalDeposits.length} original deposit${source.originalDeposits.length === 1 ? "" : "s"}`;
  heading.append(title, count);
  panel.append(heading);

  if (!source.originalDeposits.length) {
    const empty = document.createElement("p");
    empty.className = "income-history-panel__empty";
    empty.textContent = "No new deposits were recorded for this month; the pool contains rollover funds only.";
    panel.append(empty);
    return panel;
  }

  const tableWrap = document.createElement("div");
  tableWrap.className = "income-history-table-wrap";
  const table = document.createElement("table");
  table.className = "income-history-table";
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["Date Added", "Source/Description", "Amount Added", "Deposit Method"].forEach((label) => {
    const cell = document.createElement("th");
    cell.textContent = label;
    headerRow.append(cell);
  });
  thead.append(headerRow);
  const tbody = document.createElement("tbody");
  source.originalDeposits.forEach((deposit) => {
    const row = document.createElement("tr");
    [
      formatDate(deposit.date),
      deposit.source,
      formatCurrency(deposit.amount),
      deposit.method,
    ].forEach((value, columnIndex) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (columnIndex === 2) cell.className = "number-cell";
      row.append(cell);
    });
    tbody.append(row);
  });
  table.append(thead, tbody);
  tableWrap.append(table);
  panel.append(tableWrap);
  return panel;
}

function createFundingSourceCard(source, index = 0) {
  const card = document.createElement("article");
  card.className = "funding-source-card";
  card.dataset.fundingSourceId = source.id;
  card.draggable = true;
  card.style.animationDelay = `${Math.min(index, 10) * 18}ms`;
  const summary = document.createElement("div");
  summary.className = "funding-source-card__summary";
  const deposit = document.createElement("div");
  deposit.className = "funding-deposit";
  const icon = document.createElement("span");
  icon.className = "funding-deposit__icon";
  icon.textContent = "+";
  const copy = document.createElement("span");
  copy.className = "funding-deposit__copy";
  const name = document.createElement("strong");
  name.textContent = source.label;
  const details = document.createElement("small");
  details.textContent = `Combined monthly pool • ${source.originalDeposits.length} new deposit${source.originalDeposits.length === 1 ? "" : "s"}`;
  copy.append(name, details);
  deposit.append(icon, copy);
  summary.append(deposit);
  summary.append(
    createFundingMetric("Total available", formatCurrency(source.available)),
    createFundingMetric("Linked expenses", formatCurrency(source.spent), "funding-metric--spent"),
    createFundingMetric("Remaining", formatCurrency(source.remaining), "funding-metric--remaining", source.remaining < 0),
  );
  card.append(summary);

  const breakdown = document.createElement("div");
  breakdown.className = "funding-pool-breakdown";
  breakdown.append(
    createFundingMetric("Rollover from Previous Month", formatCurrency(source.rollover), "funding-breakdown-metric"),
    createFundingMetric("New Deposits", formatCurrency(source.newDeposits), "funding-breakdown-metric"),
  );
  const panelId = `income-history-${source.id.replace(/[^a-z0-9_-]/gi, "-")}`;
  const isExpanded = expandedIncomeHistoryIds.has(source.id);
  const historyButton = document.createElement("button");
  historyButton.className = "income-history-toggle";
  historyButton.type = "button";
  historyButton.setAttribute("aria-controls", panelId);
  historyButton.setAttribute("aria-expanded", String(isExpanded));
  historyButton.innerHTML = `<span>${isExpanded ? "Hide" : "View"} Income History</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>`;
  breakdown.append(historyButton);
  card.append(breakdown);

  const historyPanel = createIncomeHistoryPanel(source, panelId, isExpanded);
  historyButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const nextExpanded = historyButton.getAttribute("aria-expanded") !== "true";
    historyButton.setAttribute("aria-expanded", String(nextExpanded));
    historyButton.querySelector("span").textContent = `${nextExpanded ? "Hide" : "View"} Income History`;
    historyPanel.classList.toggle("is-open", nextExpanded);
    historyPanel.setAttribute("aria-hidden", String(!nextExpanded));
    if (nextExpanded) expandedIncomeHistoryIds.add(source.id);
    else expandedIncomeHistoryIds.delete(source.id);
  });
  card.append(historyPanel);

  if (!source.expenses.length) {
    const noExpenses = document.createElement("p");
    noExpenses.className = "funding-expense-empty";
    noExpenses.textContent = "No expenses are linked to this monthly pool yet.";
    card.append(noExpenses);
    return card;
  }

  const list = document.createElement("div");
  list.className = "funding-expense-list";
  const header = document.createElement("div");
  header.className = "funding-expense-list__header";
  header.textContent = `${source.expenses.length} linked expense${source.expenses.length === 1 ? "" : "s"}`;
  list.append(header);
  source.expenses.forEach((expense) => {
    const row = document.createElement("div");
    row.className = "funding-expense-row";
    const rowCopy = document.createElement("span");
    rowCopy.className = "funding-expense-row__copy";
    const item = document.createElement("strong");
    item.textContent = expense.item;
    const detail = document.createElement("small");
    detail.textContent = `${formatDate(expense.date)} • ${expense.category} • ${expense.method}`;
    const value = document.createElement("strong");
    value.textContent = `−${formatCurrency(expense.amount)}`;
    rowCopy.append(item, detail);
    row.append(rowCopy, value);
    list.append(row);
  });
  card.append(list);
  return card;
}

function clearFundingDropFeedback(container) {
  container.querySelectorAll(".is-dragging, .drag-over-before, .drag-over-after").forEach((card) => {
    card.classList.remove("is-dragging", "drag-over-before", "drag-over-after");
  });
}

export function bindFundingSourceControls(onRender = renderFundingSources) {
  const select = document.querySelector("#funding-source-sort");
  const container = document.querySelector("#funding-source-list");
  if (!select || !container) return;
  let draggedCard = null;
  let dropCommitted = false;
  let originalSortMode = "latest";
  let dragBaseOrder = [];

  select.addEventListener("change", onRender);
  container.addEventListener("dragstart", (event) => {
    if (event.target.closest("button, .income-history-panel")) {
      event.preventDefault();
      return;
    }
    const card = event.target.closest("[data-funding-source-id]");
    if (!card) return;
    originalSortMode = select.value;
    if (select.value !== "custom") {
      dragBaseOrder = [...container.querySelectorAll("[data-funding-source-id]")]
        .map((item) => item.dataset.fundingSourceId);
      select.value = "custom";
    } else {
      dragBaseOrder = getCustomOrder("fundingSources");
    }
    draggedCard = card;
    dropCommitted = false;
    card.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", card.dataset.fundingSourceId);
  });

  container.addEventListener("dragover", (event) => {
    if (!draggedCard) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const target = event.target.closest("[data-funding-source-id]");
    container.querySelectorAll(".drag-over-before, .drag-over-after").forEach((card) => {
      card.classList.remove("drag-over-before", "drag-over-after");
    });
    if (!target || target === draggedCard) return;
    const isAfter = event.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2;
    target.classList.add(isAfter ? "drag-over-after" : "drag-over-before");
    container.insertBefore(draggedCard, isAfter ? target.nextSibling : target);
  });

  container.addEventListener("drop", (event) => {
    if (!draggedCard) return;
    event.preventDefault();
    const nextOrder = [...container.querySelectorAll("[data-funding-source-id]")]
      .map((card) => card.dataset.fundingSourceId);
    if (nextOrder.join("\u001f") !== dragBaseOrder.join("\u001f")) {
      recordState("funding source reorder");
      saveCustomOrder("fundingSources", nextOrder);
    }
    dropCommitted = true;
    clearFundingDropFeedback(container);
    draggedCard = null;
    requestAnimationFrame(onRender);
  });

  container.addEventListener("dragend", () => {
    clearFundingDropFeedback(container);
    draggedCard = null;
    if (!dropCommitted) {
      select.value = originalSortMode;
      requestAnimationFrame(onRender);
    }
  });
}

function createFundingMetric(label, value, className = "", isNegative = false) {
  const metric = document.createElement("span");
  metric.className = `funding-metric ${className}`.trim();
  const caption = document.createElement("span");
  caption.textContent = label;
  const amount = document.createElement("strong");
  amount.textContent = value;
  amount.classList.toggle("is-negative", isNegative);
  metric.append(caption, amount);
  return metric;
}

export function renderCategories(totalExpenses) {
  const categoryTotals = new Map();
  getTransactions()
    .filter((transaction) => transaction.type === "expense")
    .forEach((transaction) => {
      const summary = categoryTotals.get(transaction.category) ?? { total: 0, fundingSources: new Map() };
      summary.total += transaction.amount;
      const fundingSource = getFundingSourceLabel(transaction) || "Unassigned";
      summary.fundingSources.set(fundingSource, (summary.fundingSources.get(fundingSource) ?? 0) + transaction.amount);
      categoryTotals.set(transaction.category, summary);
    });

  const container = document.querySelector("#category-summaries");
  const empty = document.querySelector("#empty-categories");
  container.replaceChildren();
  const sortedCategories = [...categoryTotals.entries()].sort((a, b) => b[1].total - a[1].total);
  empty.hidden = sortedCategories.length > 0;
  container.hidden = sortedCategories.length === 0;

  sortedCategories.forEach(([category, summary]) => {
    const amount = summary.total;
    const percentage = totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0;
    const card = document.createElement("article");
    card.className = "category-card";
    card.style.setProperty("--category-color", categoryColor(category));
    const top = document.createElement("div");
    top.className = "category-card__top";
    const label = document.createElement("span");
    label.className = "category-card__label";
    const dot = document.createElement("i");
    dot.className = "category-card__dot";
    dot.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.textContent = category;
    label.append(dot, name);
    const percent = document.createElement("span");
    percent.className = "category-card__percent";
    percent.textContent = `${percentage.toFixed(0)}%`;
    top.append(label, percent);
    const value = document.createElement("strong");
    value.textContent = formatCurrency(amount);
    const bar = document.createElement("div");
    bar.className = "category-card__bar";
    const fill = document.createElement("span");
    fill.style.width = `${percentage}%`;
    bar.append(fill);

    const sources = document.createElement("div");
    sources.className = "category-card__sources";
    const sourcesTitle = document.createElement("small");
    sourcesTitle.textContent = "Funding breakdown";
    sources.append(sourcesTitle);
    [...summary.fundingSources.entries()].sort((a, b) => b[1] - a[1]).forEach(([source, sourceAmount]) => {
      const row = document.createElement("span");
      const sourceName = document.createElement("span");
      const sourceValue = document.createElement("strong");
      sourceName.textContent = source;
      sourceValue.textContent = formatCurrency(sourceAmount);
      row.append(sourceName, sourceValue);
      sources.append(row);
    });
    card.append(top, value, bar, sources);
    container.append(card);
  });
}
