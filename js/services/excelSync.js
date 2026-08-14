"use strict";

import {
  appendTransactions,
  createId,
  depositFundingLabel,
  getCurrentUser,
  getDeposits,
  getTransactions,
} from "../utils/storage.js";
import { toDateInputValue } from "../utils/formatters.js";
import {
  createCombinedFundingSourceId,
  formatCombinedFundingSourceLabel,
  getFundingMonthKey,
  normalizeFundingSourceKey,
} from "../utils/funding.js";
import { calculateLedger } from "../components/ledger.js";
import { recordState } from "../utils/history.js";

const IMPORT_COLUMN_ALIASES = Object.freeze({
  date: ["date", "transactiondate"],
  item: ["item", "description", "itemdescription", "transaction", "details"],
  category: ["category", "classification"],
  amount: ["amount", "value", "transactionamount"],
  type: ["type", "transactiontype", "incomeexpense", "inout"],
  method: ["paymentdepositmethod", "paymentmethod", "depositmethod", "method"],
});
export const DEFAULT_IMPORT_LABEL = "Choose a .csv, .xlsx, or .xls file";
const LEGACY_HISTORY_SHEET = "History Payments";
const CATEGORY_TRACKER_SHEETS = Object.freeze([
  "Category Expense Tracker",
  "Category Tracking",
]);
const LEGACY_HISTORY_HEADER_INDEX = 3;
const LEGACY_EXPENSE_HEADERS = Object.freeze({
  date: "date",
  description: "itemdescription",
  category: "category",
  amount: "amountspent",
  method: "paymentmethod",
});
const LEGACY_DEPOSIT_HEADERS = Object.freeze({
  date: "dateadded",
  description: "sourcedescription",
  amount: "amountadded",
  method: "depositmethod",
});
const CATEGORY_TRACKER_HEADERS = Object.freeze({
  category: "category",
  date: "date",
  description: "itemdescription",
  amount: "amountspent",
  fundingSource: "fundingsourcerecentdeposit",
});

const exportFormatSelect = document.querySelector("#export-format");
const importDataInput = document.querySelector("#import-data-input");
const importDropzone = document.querySelector("#import-dropzone");
let showToast = () => {};
let renderDashboard = () => {};

function getSpreadsheetLibrary() {
  if (globalThis.XLSX) return globalThis.XLSX;
  const message = "The spreadsheet tools could not load. Check your internet connection and refresh the page.";
  setTransferStatus(message, true);
  showToast(message, true);
  return null;
}

export function setTransferStatus(message = "", isError = false) {
  const status = document.querySelector("#import-status");
  status.textContent = message;
  status.classList.toggle("is-error", Boolean(message) && isError);
  status.hidden = !message;
}

function safeCsvText(value) {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
}

function getFundingSourceLabel(transaction) {
  if (transaction.type !== "expense") return "";
  if (transaction.funding_source) return transaction.funding_source;
  if (!transaction.funding_source_id) return "";
  const deposit = getDeposits().find((candidate) => candidate.id === transaction.funding_source_id);
  return deposit ? depositFundingLabel(deposit) : "";
}

function createExportRows(useDateObjects = false) {
  return calculateLedger().map((transaction) => {
    const fundingSource = getFundingSourceLabel(transaction);
    return {
      Date: useDateObjects ? dateFromInputValue(transaction.date) : transaction.date,
      Item: useDateObjects ? transaction.item : safeCsvText(transaction.item),
      Category: useDateObjects ? transaction.category : safeCsvText(transaction.category),
      Amount: transaction.amount,
      Type: transaction.type === "income" ? "Income" : "Expense",
      "Payment / Deposit Method": useDateObjects ? transaction.method : safeCsvText(transaction.method),
      "Funding Source": useDateObjects ? fundingSource : safeCsvText(fundingSource),
      "Running Balance": transaction.runningBalance,
    };
  });
}

function styleExportWorksheet(worksheet, rowCount, applyExcelFormats = true) {
  worksheet["!cols"] = [
    { wch: 13 }, { wch: 28 }, { wch: 20 }, { wch: 15 },
    { wch: 12 }, { wch: 24 }, { wch: 26 }, { wch: 18 },
  ];
  if (worksheet["!ref"]) worksheet["!autofilter"] = { ref: worksheet["!ref"] };
  if (applyExcelFormats) {
    for (let row = 2; row <= rowCount + 1; row += 1) {
      if (worksheet[`A${row}`]) worksheet[`A${row}`].z = "yyyy-mm-dd";
      if (worksheet[`D${row}`]) worksheet[`D${row}`].z = '"₱"#,##0.00';
      if (worksheet[`H${row}`]) worksheet[`H${row}`].z = '"₱"#,##0.00';
    }
  }
}

function dateFromInputValue(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function downloadTextFile(content, filename, mimeType) {
  const blob = new Blob(["\uFEFF", content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportFilename(extension) {
  const username = getCurrentUser().username
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "account";
  return `spendsync-${username}-${toDateInputValue(new Date())}.${extension}`;
}

export function exportTransactions(format = "xlsx") {
  if (!getTransactions().length) {
    const message = "Add at least one transaction before exporting data.";
    setTransferStatus(message, true);
    showToast(message, true);
    return;
  }

  const XLSX = getSpreadsheetLibrary();
  if (!XLSX) return;
  const normalizedFormat = format === "csv" ? "csv" : "xlsx";

  try {
    const exportRows = createExportRows(normalizedFormat === "xlsx");
    const worksheet = XLSX.utils.json_to_sheet(exportRows, {
      cellDates: normalizedFormat === "xlsx",
      dateNF: "yyyy-mm-dd",
    });
    styleExportWorksheet(worksheet, exportRows.length, normalizedFormat === "xlsx");

    if (normalizedFormat === "csv") {
      const csv = XLSX.utils.sheet_to_csv(worksheet, { FS: ",", RS: "\r\n" });
      downloadTextFile(csv, exportFilename("csv"), "text/csv;charset=utf-8");
    } else {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Transactions");
      workbook.Props = {
        Title: "SpendSync Transaction Ledger",
        Subject: `Chronological ledger for ${getCurrentUser().username}`,
        Author: "SpendSync",
        CreatedDate: new Date(),
      };
      XLSX.writeFile(workbook, exportFilename("xlsx"), { compression: true });
    }

    setTransferStatus(`${getTransactions().length} transaction${getTransactions().length === 1 ? "" : "s"} exported as ${normalizedFormat.toUpperCase()}.`);
    showToast(`Ledger exported as ${normalizedFormat.toUpperCase()}.`);
  } catch (error) {
    console.error("SpendSync export failed:", error);
    setTransferStatus("The export could not be created. Please try again.", true);
    showToast("Unable to export transaction data.", true);
  }
}


function normalizeImportHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function mapImportColumns(headerRow) {
  const normalizedHeaders = headerRow.map(normalizeImportHeader);
  const columns = {};
  Object.entries(IMPORT_COLUMN_ALIASES).forEach(([field, aliases]) => {
    columns[field] = normalizedHeaders.findIndex((header) => aliases.includes(header));
  });
  return columns;
}

function findImportHeaderRow(rows) {
  return rows.findIndex((row) => {
    const normalized = row.map(normalizeImportHeader);
    return ["date", "item", "category", "amount", "type"].filter((field) =>
      IMPORT_COLUMN_ALIASES[field].some((alias) => normalized.includes(alias))
    ).length >= 3;
  });
}

function mapLegacyHistoryColumns(headerRow) {
  const normalizedHeaders = headerRow.map(normalizeImportHeader);
  return {
    expense: Object.values(LEGACY_EXPENSE_HEADERS).map((header) => normalizedHeaders.indexOf(header)),
    deposit: Object.values(LEGACY_DEPOSIT_HEADERS).map((header) => normalizedHeaders.indexOf(header)),
  };
}

function hasLegacyHistoryHeaders(headerRow) {
  const columns = mapLegacyHistoryColumns(headerRow);
  return [...columns.expense, ...columns.deposit].every((columnIndex) => columnIndex >= 0);
}

function findLegacyHistoryHeaderRow(rows) {
  if (hasLegacyHistoryHeaders(rows[LEGACY_HISTORY_HEADER_INDEX] ?? [])) return LEGACY_HISTORY_HEADER_INDEX;
  return rows.slice(0, 10).findIndex(hasLegacyHistoryHeaders);
}

function normalizedCalendarDate(year, month, day) {
  const candidate = new Date(year, month - 1, day);
  if (
    !Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)
    || candidate.getFullYear() !== year
    || candidate.getMonth() !== month - 1
    || candidate.getDate() !== day
  ) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeImportedDate(value, XLSX) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return toDateInputValue(value);

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? normalizedCalendarDate(parsed.y, parsed.m, parsed.d) : "";
  }

  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^\d{5}(?:\.\d+)?$/.test(text)) {
    const parsed = XLSX.SSF.parse_date_code(Number(text));
    return parsed ? normalizedCalendarDate(parsed.y, parsed.m, parsed.d) : "";
  }

  const yearFirst = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (yearFirst) return normalizedCalendarDate(Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3]));

  const shortDate = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (shortDate) {
    const first = Number(shortDate[1]);
    const second = Number(shortDate[2]);
    const year = Number(shortDate[3]);
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    return normalizedCalendarDate(year, month, day);
  }

  const parsedDate = new Date(text);
  return Number.isNaN(parsedDate.getTime()) ? "" : toDateInputValue(parsedDate);
}

function normalizeImportedAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.abs(value) : NaN;
  let text = String(value ?? "").trim();
  if (!text) return NaN;
  const isParenthesized = /^\(.*\)$/.test(text);
  text = text
    .replace(/^\((.*)\)$/, "$1")
    .replace(/php/gi, "")
    .replace(/₱/g, "")
    .replace(/,/g, "")
    .replace(/[$€£\s]/g, "");
  const amount = Number.parseFloat(text);
  if (!Number.isFinite(amount)) return NaN;
  return Math.abs(isParenthesized ? -amount : amount);
}

function normalizeMatchText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-PH");
}

function amountToCents(value) {
  return Math.round(Number(value) * 100);
}

export function parseFundingSourceReference(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (!match) return null;

  const source = match[1].trim();
  const amount = normalizeImportedAmount(match[2]);
  if (!source || !Number.isFinite(amount) || amount <= 0) return null;

  return {
    source,
    amount,
    sourceKey: normalizeMatchText(source),
    amountCents: amountToCents(amount),
  };
}

function normalizeImportedType(value) {
  const type = String(value ?? "").trim().toLowerCase().replace(/[^a-z+\-]/g, "");
  if (type.startsWith("income") || ["in", "credit", "deposit", "revenue", "+"].includes(type)) return "income";
  if (type.startsWith("expense") || ["out", "debit", "withdrawal", "spending", "-"].includes(type)) return "expense";
  return "";
}

function parseLegacyExpenseRows(rows, headerRowIndex, columnIndexes, fileName, XLSX, importedAt) {
  const importedTransactions = [];
  const errors = [];

  rows.slice(headerRowIndex + 1).forEach((row, index) => {
    const rowNumber = headerRowIndex + index + 2;
    const values = columnIndexes.map((columnIndex) => row[columnIndex]);
    if (values.every((value) => String(value ?? "").trim() === "")) return;

    const [rawDate, rawItem, rawCategory, rawAmount, rawMethod] = values;
    const date = normalizeImportedDate(rawDate, XLSX);
    const item = String(rawItem ?? "").trim();
    const category = String(rawCategory ?? "").trim();
    const amount = normalizeImportedAmount(rawAmount);
    const method = String(rawMethod ?? "").trim();
    const rowErrors = [];

    if (!date) rowErrors.push("invalid expense date");
    if (!item) rowErrors.push("missing expense description");
    if (!category) rowErrors.push("missing expense category");
    if (!Number.isFinite(amount) || amount <= 0) rowErrors.push("invalid expense amount");
    if (!method) rowErrors.push("missing payment method");

    if (rowErrors.length) {
      errors.push(`Expense row ${rowNumber}: ${rowErrors.join(", ")}`);

      return;
    }

    importedTransactions.push({
      id: createId(),
      type: "expense",
      date,
      item,
      description: item,
      category,
      amount,
      method,
      funding_source_id: null,
      funding_source: "",
      createdAt: new Date(importedAt + index * 2 + 1).toISOString(),
      importedFrom: fileName,
      importedSheet: LEGACY_HISTORY_SHEET,
    });
  });

  return { importedTransactions, errors };
}

function parseLegacyDepositRows(rows, headerRowIndex, columnIndexes, fileName, XLSX, importedAt) {
  const importedTransactions = [];
  const errors = [];

  rows.slice(headerRowIndex + 1).forEach((row, index) => {
    const rowNumber = headerRowIndex + index + 2;
    const values = columnIndexes.map((columnIndex) => row[columnIndex]);
    if (values.every((value) => String(value ?? "").trim() === "")) return;

    const [rawDate, rawSource, rawAmount, rawMethod] = values;
    const date = normalizeImportedDate(rawDate, XLSX);
    const source = String(rawSource ?? "").trim();
    const amount = normalizeImportedAmount(rawAmount);
    const method = String(rawMethod ?? "").trim();
    const rowErrors = [];

    if (!date) rowErrors.push("invalid deposit date");
    if (!source) rowErrors.push("missing deposit source");
    if (!Number.isFinite(amount) || amount <= 0) rowErrors.push("invalid deposit amount");
    if (!method) rowErrors.push("missing deposit method");

    if (rowErrors.length) {
      errors.push(`Deposit row ${rowNumber}: ${rowErrors.join(", ")}`);
      return;
    }

    importedTransactions.push({
      id: createId(),
      type: "income",
      date,
      item: source,
      description: source,
      category: "Deposit",
      amount,
      method,
      funding_source_id: null,
      funding_source: "",
      createdAt: new Date(importedAt + index * 2).toISOString(),
      importedFrom: fileName,
      importedSheet: LEGACY_HISTORY_SHEET,
    });
  });

  return { importedTransactions, errors };
}

export function parseLegacyHistoryPayments(rows, fileName, XLSX) {
  const headerRowIndex = findLegacyHistoryHeaderRow(rows);
  if (headerRowIndex < 0) {
    throw new Error('The "History Payments" sheet does not contain the expected expense and deposit headers.');
  }

  const columns = mapLegacyHistoryColumns(rows[headerRowIndex]);
  const importedAt = Date.now();
  const expenseResult = parseLegacyExpenseRows(rows, headerRowIndex, columns.expense, fileName, XLSX, importedAt);
  const depositResult = parseLegacyDepositRows(rows, headerRowIndex, columns.deposit, fileName, XLSX, importedAt);

  return {
    importedTransactions: [...expenseResult.importedTransactions, ...depositResult.importedTransactions],
    errors: [...expenseResult.errors, ...depositResult.errors],
    importKind: "legacy-history-payments",
    counts: {
      expenses: expenseResult.importedTransactions.length,
      deposits: depositResult.importedTransactions.length,
    },
  };
}

function mapCategoryTrackerColumns(headerRow) {
  const normalizedHeaders = headerRow.map(normalizeImportHeader);
  return Object.fromEntries(
    Object.entries(CATEGORY_TRACKER_HEADERS)
      .map(([field, header]) => [field, normalizedHeaders.indexOf(header)]),
  );
}

function findCategoryTrackerHeaderRow(rows) {
  const hasRequiredHeaders = (row) => (
    Object.values(mapCategoryTrackerColumns(row)).every((columnIndex) => columnIndex >= 0)
  );
  if (hasRequiredHeaders(rows[LEGACY_HISTORY_HEADER_INDEX] ?? [])) return LEGACY_HISTORY_HEADER_INDEX;
  return rows.slice(0, 15).findIndex(hasRequiredHeaders);
}

function expenseMatchKey({ date, item, category, amount }) {
  return [
    date,
    normalizeMatchText(item),
    normalizeMatchText(category),
    amountToCents(amount),
  ].join("\u001f");
}

export function parseCategoryExpenseTracker(rows, XLSX) {
  const headerRowIndex = findCategoryTrackerHeaderRow(rows);
  if (headerRowIndex < 0) {
    return {
      references: [],
      warnings: ['The category tracker does not contain the expected "Funding Source (Recent Deposit)" column.'],
    };
  }

  const columns = mapCategoryTrackerColumns(rows[headerRowIndex]);
  const references = [];
  const warnings = [];

  rows.slice(headerRowIndex + 1).forEach((row, index) => {
    const rowNumber = headerRowIndex + index + 2;
    const category = String(row[columns.category] ?? "").trim();
    const date = normalizeImportedDate(row[columns.date], XLSX);
    const item = String(row[columns.description] ?? "").trim();
    const amount = normalizeImportedAmount(row[columns.amount]);
    const fundingLabel = String(row[columns.fundingSource] ?? "").trim();

    if (![category, date, item, fundingLabel].some(Boolean) && !Number.isFinite(amount)) return;
    if (!fundingLabel) return;

    const fundingReference = parseFundingSourceReference(fundingLabel);
    if (!category || !date || !item || !Number.isFinite(amount) || amount <= 0) {
      warnings.push(`Tracker row ${rowNumber} could not be matched to an expense.`);
      return;
    }
    if (!fundingReference) {
      warnings.push(`Tracker row ${rowNumber} has an invalid funding source reference.`);
      return;
    }

    references.push({
      rowNumber,
      expenseKey: expenseMatchKey({ date, item, category, amount }),
      fundingLabel,
      fundingReference,
    });
  });

  return { references, warnings };
}

export function attachCategoryFundingLinks(
  importedTransactions,
  trackerRows,
  XLSX,
  existingDeposits = getDeposits(),
) {
  const { references, warnings } = parseCategoryExpenseTracker(trackerRows, XLSX);
  const expenseQueues = new Map();

  importedTransactions
    .filter((transaction) => transaction.type === "expense")
    .forEach((expense) => {
      const key = expenseMatchKey(expense);
      if (!expenseQueues.has(key)) expenseQueues.set(key, []);
      expenseQueues.get(key).push(expense);
    });

  const depositCandidates = [
    ...importedTransactions.filter((transaction) => transaction.type === "income"),
    ...existingDeposits,
  ].filter((deposit, index, deposits) => (
    deposit?.id && deposits.findIndex((candidate) => candidate?.id === deposit.id) === index
  ));
  const depositsBySource = new Map();
  depositCandidates.forEach((deposit) => {
    const source = String(deposit.source ?? deposit.item ?? deposit.description ?? "").trim();
    const sourceKey = normalizeFundingSourceKey(source);
    if (sourceKey && !depositsBySource.has(sourceKey)) depositsBySource.set(sourceKey, source);
  });

  let linkedExpenses = 0;
  let unmatchedExpenses = 0;
  let unmatchedDeposits = 0;

  references.forEach(({ expenseKey, fundingReference }) => {
    const expense = expenseQueues.get(expenseKey)?.shift();
    if (!expense) {
      unmatchedExpenses += 1;
      return;
    }

    const source = depositsBySource.get(fundingReference.sourceKey);
    const monthKey = getFundingMonthKey(expense.date);
    if (!source || !monthKey) {
      unmatchedDeposits += 1;
      return;
    }

    expense.funding_source_id = createCombinedFundingSourceId(source, monthKey);
    expense.funding_source = formatCombinedFundingSourceLabel(source, monthKey);
    linkedExpenses += 1;
  });

  return {
    linkedExpenses,
    unmatchedExpenses,
    unmatchedDeposits,
    invalidReferences: warnings.length,
    references: references.length,
    warnings,
  };
}

function parseImportedRows(rows, headerRowIndex, fileName, XLSX) {
  const columns = mapImportColumns(rows[headerRowIndex]);
  const requiredFields = ["date", "item", "category", "amount", "type"];
  const missingFields = requiredFields.filter((field) => columns[field] < 0);
  if (missingFields.length) {
    throw new Error(`Missing required column${missingFields.length === 1 ? "" : "s"}: ${missingFields.map((field) => field[0].toUpperCase() + field.slice(1)).join(", ")}.`);
  }

  const importedTransactions = [];
  const errors = [];
  rows.slice(headerRowIndex + 1).forEach((row, index) => {
    const rowNumber = headerRowIndex + index + 2;
    const values = requiredFields.map((field) => row[columns[field]]);
    if (values.every((value) => String(value ?? "").trim() === "")) return;

    const date = normalizeImportedDate(row[columns.date], XLSX);
    const item = String(row[columns.item] ?? "").trim();
    const category = String(row[columns.category] ?? "").trim();
    const amount = normalizeImportedAmount(row[columns.amount]);
    const type = normalizeImportedType(row[columns.type]);
    const method = columns.method >= 0 ? String(row[columns.method] ?? "").trim() : "";
    const rowErrors = [];

    if (!date) rowErrors.push("invalid date");
    if (!item) rowErrors.push("missing item");
    if (!category) rowErrors.push("missing category");
    if (!Number.isFinite(amount) || amount <= 0) rowErrors.push("invalid amount");
    if (!type) rowErrors.push("type must be Income or Expense");

    if (rowErrors.length) {
      errors.push(`Row ${rowNumber}: ${rowErrors.join(", ")}`);
      return;
    }

    importedTransactions.push({
      id: createId(),
      type,
      date,
      item,

      category,
      amount,
      method: method || "Imported File",
      funding_source_id: null,
      funding_source: "",
      createdAt: new Date(Date.now() + index).toISOString(),
      importedFrom: fileName,
    });
  });

  return { importedTransactions, errors };
}

function validateImportFileName(fileName) {
  if (!/\.(csv|xlsx|xls)$/i.test(fileName)) {
    throw new Error("Choose a CSV, XLSX, or XLS file.");
  }
}

function findCategoryTrackerSheetName(sheetNames) {
  const acceptedNames = CATEGORY_TRACKER_SHEETS.map(normalizeMatchText);
  return sheetNames.find((sheetName) => acceptedNames.includes(normalizeMatchText(sheetName))) ?? "";
}

export function readImportBuffer(arrayBuffer, fileName) {
  const XLSX = getSpreadsheetLibrary();
  if (!XLSX) throw new Error("Spreadsheet tools are unavailable.");
  validateImportFileName(fileName);

  const workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  if (workbook.SheetNames.includes(LEGACY_HISTORY_SHEET)) {
    const legacyRows = XLSX.utils.sheet_to_json(workbook.Sheets[LEGACY_HISTORY_SHEET], {
      header: 1,
      defval: "",
      raw: true,
      // Keep physical row positions so spreadsheet Row 4 remains array index 3.
      blankrows: true,
    });
    const legacyResult = parseLegacyHistoryPayments(legacyRows, fileName, XLSX);
    const trackerSheetName = findCategoryTrackerSheetName(workbook.SheetNames);
    if (!trackerSheetName) return legacyResult;

    const trackerRows = XLSX.utils.sheet_to_json(workbook.Sheets[trackerSheetName], {
      header: 1,
      defval: "",
      raw: true,
      blankrows: true,
    });
    const linking = attachCategoryFundingLinks(
      legacyResult.importedTransactions,
      trackerRows,
      XLSX,
    );

    return {
      ...legacyResult,
      counts: {
        ...legacyResult.counts,
        linkedExpenses: linking.linkedExpenses,
        unmatchedFundingReferences: linking.unmatchedExpenses
          + linking.unmatchedDeposits
          + linking.invalidReferences,
      },
      linkingWarnings: linking.warnings,
      trackerSheet: trackerSheetName,
    };
  }

  let selectedRows = null;
  let headerRowIndex = -1;

  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: "",
      raw: true,
      blankrows: false,
    });
    const candidateHeader = findImportHeaderRow(rows);
    if (candidateHeader >= 0) {
      selectedRows = rows;
      headerRowIndex = candidateHeader;
      break;
    }
  }

  if (!selectedRows) throw new Error("No worksheet contains the required transaction columns.");
  return { ...parseImportedRows(selectedRows, headerRowIndex, fileName, XLSX), importKind: "standard", counts: null };
}

export async function readImportFile(file) {
  validateImportFileName(file.name);
  if (file.size > 10 * 1024 * 1024) throw new Error("The selected file is larger than the 10 MB limit.");
  return readImportBuffer(await file.arrayBuffer(), file.name);
}

async function importTransactionFile(file) {
  if (!file) return;
  const importButton = document.querySelector("#import-data-button");
  document.querySelector("#import-file-name").textContent = file.name;
  setTransferStatus("Reading and validating your file…");
  importButton.disabled = true;

  try {
    const { importedTransactions, errors, importKind, counts } = await readImportFile(file);
    if (errors.length) {
      const preview = errors.slice(0, 3).join(" • ");
      const remainder = errors.length > 3 ? ` • Plus ${errors.length - 3} more error${errors.length - 3 === 1 ? "" : "s"}.` : "";
      setTransferStatus(`Nothing was imported. ${preview}${remainder}`, true);
      showToast(`Import stopped: ${errors.length} invalid row${errors.length === 1 ? "" : "s"}.`, true);
      return;
    }
    if (!importedTransactions.length) {
      setTransferStatus("The file contains headers but no transaction rows.", true);
      showToast("No transactions were found to import.", true);
      return;
    }

    recordState("spreadsheet import");
    appendTransactions(importedTransactions);
    renderDashboard();
    const linkedSummary = Number.isInteger(counts?.linkedExpenses)
      ? `, including ${counts.linkedExpenses} linked expense${counts.linkedExpenses === 1 ? "" : "s"}`
      : "";
    const importSummary = importKind === "legacy-history-payments"
      ? `${counts.expenses} expense${counts.expenses === 1 ? "" : "s"} and ${counts.deposits} deposit${counts.deposits === 1 ? "" : "s"}${linkedSummary}`
      : `${importedTransactions.length} transaction${importedTransactions.length === 1 ? "" : "s"}`;
    const fundingWarning = counts?.unmatchedFundingReferences
      ? ` ${counts.unmatchedFundingReferences} funding reference${counts.unmatchedFundingReferences === 1 ? "" : "s"} could not be matched.`
      : "";
    setTransferStatus(`${importSummary} imported from ${file.name}. Your dashboard and running balance are up to date.${fundingWarning}`);
    showToast(`${importSummary} imported successfully.`);
  } catch (error) {
    console.error("SpendSync import failed:", error);
    setTransferStatus(error.message || "The selected file could not be imported.", true);
    showToast("Unable to import that file.", true);
  } finally {
    importButton.disabled = false;
    importDataInput.value = "";
  }
}

export async function importTransactionBuffer(arrayBuffer, fileName) {
  if (!(arrayBuffer instanceof ArrayBuffer)) {
    throw new TypeError("The downloaded spreadsheet is not a valid ArrayBuffer.");
  }
  validateImportFileName(fileName);
  if (arrayBuffer.byteLength > 10 * 1024 * 1024) {
    throw new Error("The selected file is larger than the 10 MB limit.");
  }

  return importTransactionFile({
    name: fileName,
    size: arrayBuffer.byteLength,
    arrayBuffer: async () => arrayBuffer,
  });
}

export function initializeExcelSync({ onDataChanged, notify }) {
  renderDashboard = onDataChanged;
  showToast = notify;
  document.querySelector("#dashboard-export-button").addEventListener("click", () => exportTransactions("xlsx"));
  document.querySelector("#export-data-button").addEventListener("click", () => exportTransactions(exportFormatSelect.value));
  document.querySelector("#import-data-button").addEventListener("click", () => importDataInput.click());
  importDropzone.addEventListener("click", () => importDataInput.click());
  importDataInput.addEventListener("click", (event) => event.stopPropagation());
  importDataInput.addEventListener("change", () => importTransactionFile(importDataInput.files?.[0]));
  importDropzone.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    importDataInput.click();
  });
  ["dragenter", "dragover"].forEach((eventName) => {
    importDropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      importDropzone.classList.add("is-dragging");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    importDropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      importDropzone.classList.remove("is-dragging");
    });
  });
  importDropzone.addEventListener("drop", (event) => importTransactionFile(event.dataTransfer?.files?.[0]));
}
