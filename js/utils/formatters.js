"use strict";

export const CATEGORY_OPTIONS = Object.freeze({
  income: ["Salary", "Business Income", "Freelance", "Sales", "Allowance", "Other Income"],
  expense: ["Business", "Groceries", "Ulam", "Transportation", "Utilities", "Rent", "Dining", "Health", "Education", "Entertainment", "Other"],
});
export const PAYMENT_METHOD_OPTIONS = Object.freeze([
  "Cash", "GCash", "Maya", "Bank Transfer", "Debit Card", "Credit Card", "Cheque", "Other",
]);
export const DEPOSIT_METHOD_OPTIONS = Object.freeze([
  "Cash", "GCash", "Maya", "Bank Transfer", "Cheque", "Other",
]);

const CATEGORY_COLORS = Object.freeze([
  "#0d9488", "#f59e0b", "#6366f1", "#ec4899", "#0ea5e9", "#84cc16",
  "#f97316", "#8b5cf6", "#14b8a6", "#ef4444", "#64748b",
]);

export function formatCurrency(value) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
}

export function formatDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" })
    .format(new Date(year, month - 1, day));
}

export function toDateInputValue(date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function dateFromInputValue(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function categoryColor(category) {
  const categories = [...CATEGORY_OPTIONS.income, ...CATEGORY_OPTIONS.expense];
  return CATEGORY_COLORS[Math.max(0, categories.indexOf(category)) % CATEGORY_COLORS.length];
}

export function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-PH", { month: "short", year: "numeric" }).format(new Date(year, month - 1, 1));
}
