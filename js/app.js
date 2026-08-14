"use strict";

import {
  addDeposit,
  addExpense,
  addCustomOption,
  clearCurrentUser,
  clearSession,
  createId,
  deleteTransactionRecord,
  deleteCustomOption,
  findSessionUser,
  getCurrentUser,
  getCustomOptions,
  getTransactions,
  getUsers,
  hashPassword,
  initializeCurrentUser,
  resetFinancialData,
  saveUsers,
  setCurrentUser,
} from "./utils/storage.js";
import {
  CATEGORY_OPTIONS,
  DEPOSIT_METHOD_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  formatCurrency,
  toDateInputValue,
} from "./utils/formatters.js";
import {
  buildCombinedFundingSources,
  createCombinedFundingSourceId,
  formatCombinedFundingSourceLabel,
  getFundingMonthKey,
} from "./utils/funding.js";
import { renderDashboardCards } from "./components/dashboard.js";
import { bindLedgerControls, renderLedger } from "./components/ledger.js";
import {
  bindFundingSourceControls,
  destroyMonthlyChart,
  renderCategories,
  renderFundingSources,
  renderMonthlySummary,
} from "./components/summary.js";
import {
  importTransactionBuffer,
  initializeExcelSync,
  setTransferStatus,
} from "./services/excelSync.js";
import { initializeGoogleDriveImport } from "./services/googleDrive.js";
import {
  canUndo,
  clearHistory,
  configureHistory,
  recordState,
  subscribeHistory,
  undo,
} from "./utils/history.js";

const transactionForm = document.querySelector("#transaction-form");
const depositForm = document.querySelector("#deposit-form");
const dashboardView = document.querySelector("#dashboard");
const monthlySummaryView = document.querySelector("#monthly-summary-view");
const fundingSourcesView = document.querySelector("#funding-sources-view");
const settingsView = document.querySelector("#settings-view");
const profileForm = document.querySelector("#profile-form");
const passwordChangeForm = document.querySelector("#password-change-form");
const sidebar = document.querySelector("#sidebar");
const sidebarScrim = document.querySelector("#sidebar-scrim");
let toastTimer = null;
const ADD_NEW_OPTION_VALUE = "__add_new__";
const OPTION_CONFIG = Object.freeze({
  categories: {
    selectId: "transaction-category",
    title: "Custom categories",
    singular: "category",
    plural: "categories",
    placeholder: "Select category",
    defaults: CATEGORY_OPTIONS.expense,
  },
  paymentMethods: {
    selectId: "transaction-method",
    title: "Custom payment methods",
    singular: "payment method",
    plural: "payment methods",
    placeholder: "Select method",
    defaults: PAYMENT_METHOD_OPTIONS,
  },
  depositMethods: {
    selectId: "deposit-method",
    title: "Custom deposit methods",
    singular: "deposit method",
    plural: "deposit methods",
    placeholder: "Select method",
    defaults: DEPOSIT_METHOD_OPTIONS,
  },
});
let activeOptionKind = "categories";

function setAlert(element, message = "", type = "error") {
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle("is-success", Boolean(message) && type === "success");
}

function setFieldError(inputId, message = "") {
  const input = document.getElementById(inputId);
  const error = document.getElementById(`${inputId}-error`);
  if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
  if (error) error.textContent = message;
}

function clearFormErrors(form, alertElement) {
  form.querySelectorAll("[aria-invalid]").forEach((input) => input.removeAttribute("aria-invalid"));
  form.querySelectorAll(".field__error").forEach((error) => { error.textContent = ""; });
  setAlert(alertElement);
}

function showToast(message, isError = false) {
  const toast = document.querySelector("#toast");
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
}

function updateUndoButtons({ canUndo: enabled, count, latestLabel }) {
  document.querySelectorAll("[data-undo-button]").forEach((button) => {
    button.disabled = !enabled;
    const description = enabled
      ? `Undo ${latestLabel} (${count} ${count === 1 ? "change" : "changes"} available)`
      : "No changes to undo";
    button.title = description;
    button.setAttribute("aria-label", description);
  });
}

function performUndo() {
  const entry = undo();
  if (entry) showToast(`Undid ${entry.label}.`);
}

function isTypingTarget(target) {
  return target instanceof HTMLElement
    && (target.matches("input, textarea, select") || target.isContentEditable);
}

function bindUndoControls() {
  subscribeHistory(updateUndoButtons);
  document.querySelectorAll("[data-undo-button]").forEach((button) => {
    button.addEventListener("click", performUndo);
  });
  document.addEventListener("keydown", (event) => {
    const isUndoShortcut = (event.ctrlKey || event.metaKey)
      && !event.altKey
      && !event.shiftKey
      && event.key.toLowerCase() === "z";
    if (!isUndoShortcut || isTypingTarget(event.target) || !canUndo()) return;
    event.preventDefault();
    performUndo();
  });
}

function updateAccountIdentity() {
  const currentUser = getCurrentUser();
  if (!currentUser) return;
  document.querySelector("#sidebar-username").textContent = currentUser.username;
  document.querySelector("#sidebar-email").textContent = currentUser.email;
  document.querySelector("#sidebar-avatar").textContent = currentUser.username.charAt(0).toUpperCase();
  document.querySelector("#welcome-name").textContent = currentUser.username.split(/\s+/)[0];
  document.querySelector("#settings-avatar").textContent = currentUser.username.charAt(0).toUpperCase();
  document.querySelector("#settings-display-name").textContent = currentUser.username;
  document.querySelector("#settings-display-email").textContent = currentUser.email;
  document.querySelector("#today-label").textContent = new Intl.DateTimeFormat("en-PH", {
    weekday: "long", month: "long", day: "numeric",
  }).format(new Date());
}

function updateSettingsSummary() {
  const currentUser = getCurrentUser();
  if (!currentUser) return;
  document.querySelector("#settings-transaction-count").textContent = String(getTransactions().length);
  const createdAt = new Date(currentUser.createdAt);
  document.querySelector("#settings-member-since").textContent = Number.isNaN(createdAt.getTime())
    ? "Unknown"
    : new Intl.DateTimeFormat("en-PH", { month: "short", year: "numeric" }).format(createdAt);
}

function populateSettings() {
  const currentUser = getCurrentUser();
  if (!currentUser) return;
  profileForm.elements.username.value = currentUser.username;
  profileForm.elements.email.value = currentUser.email;
  updateSettingsSummary();
}

function resetPasswordVisibility(form) {
  form.querySelectorAll("input[type='text'][autocomplete*='password']").forEach((input) => { input.type = "password"; });
  form.querySelectorAll("[data-password-target]").forEach((button) => {
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", "Show password");
  });
}

function logout(loginMessage = "") {
  if (loginMessage) sessionStorage.setItem("spendsync.loginMessage", loginMessage);
  clearHistory();
  clearSession();
  clearCurrentUser();
  destroyMonthlyChart();
  window.location.replace("login.html");
}

function optionExists(options, value) {
  const key = value.toLocaleLowerCase("en-PH");
  return options.some((option) => option.toLocaleLowerCase("en-PH") === key);
}

function updateCustomizableSelect(kind, preferredValue) {
  const config = OPTION_CONFIG[kind];
  const select = document.getElementById(config.selectId);
  const previousValue = preferredValue ?? select.value;
  const customOptions = getCustomOptions(kind);
  select.replaceChildren(new Option(config.placeholder, ""));

  const defaultGroup = document.createElement("optgroup");
  defaultGroup.label = "Default options";
  config.defaults.forEach((option) => defaultGroup.append(new Option(option, option)));
  select.append(defaultGroup);

  if (customOptions.length) {
    const customGroup = document.createElement("optgroup");
    customGroup.label = "Custom options";
    customOptions.forEach((option) => customGroup.append(new Option(option, option)));
    select.append(customGroup);
  }

  select.add(new Option("+ Add new…", ADD_NEW_OPTION_VALUE));
  const allOptions = [...config.defaults, ...customOptions];
  select.value = optionExists(allOptions, previousValue) ? previousValue : "";
}

function updateAllCustomizableSelects(preferredValues = {}) {
  Object.keys(OPTION_CONFIG).forEach((kind) => updateCustomizableSelect(kind, preferredValues[kind]));
}

function updateCategoryOptions(preferredValue) {
  updateCustomizableSelect("categories", preferredValue);
}

function setOptionManagerAlert(message = "", isSuccess = false) {
  const alert = document.querySelector("#option-manager-alert");
  alert.textContent = message;
  alert.hidden = !message;
  alert.classList.toggle("is-success", Boolean(message) && isSuccess);
}

function renderOptionManager() {
  const config = OPTION_CONFIG[activeOptionKind];
  const customOptions = getCustomOptions(activeOptionKind);
  document.querySelector("#option-manager-title").textContent = config.title;
  document.querySelector("#option-manager-input").placeholder = `New ${config.singular}`;
  const list = document.querySelector("#option-manager-list");
  list.replaceChildren();

  if (!customOptions.length) {
    const empty = document.createElement("p");
    empty.className = "option-manager__empty";
    empty.textContent = `No custom ${config.plural} yet.`;
    list.append(empty);
    return;
  }

  customOptions.forEach((option) => {
    const row = document.createElement("div");
    row.className = "option-manager__item";
    const name = document.createElement("span");
    name.textContent = option;
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.title = `Delete ${option}`;
    removeButton.setAttribute("aria-label", `Delete custom ${config.singular} ${option}`);
    removeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m3 0-1 14H7L6 7"/></svg>';
    removeButton.addEventListener("click", () => {
      recordState("custom option deletion");
      deleteCustomOption(activeOptionKind, option);
      updateCustomizableSelect(activeOptionKind);
      renderOptionManager();
      showToast(`${option} removed from custom options.`);
    });
    row.append(name, removeButton);
    list.append(row);
  });
}

function openOptionManager(kind) {
  activeOptionKind = kind;
  setOptionManagerAlert();
  renderOptionManager();
  const dialog = document.querySelector("#option-manager-dialog");
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => document.querySelector("#option-manager-input").focus());
}

function bindCustomOptionControls() {
  document.querySelectorAll("[data-manage-options]").forEach((button) => {
    button.addEventListener("click", () => openOptionManager(button.dataset.manageOptions));
  });
  Object.entries(OPTION_CONFIG).forEach(([kind, config]) => {
    document.getElementById(config.selectId).addEventListener("change", (event) => {
      if (event.target.value !== ADD_NEW_OPTION_VALUE) return;
      event.target.value = "";
      openOptionManager(kind);
    });
  });
  document.querySelector("#option-manager-close").addEventListener("click", () => {
    document.querySelector("#option-manager-dialog").close();
  });
  document.querySelector("#option-manager-dialog").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  document.querySelector("#option-manager-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#option-manager-input");
    const value = input.value.trim().replace(/\s+/g, " ");
    const config = OPTION_CONFIG[activeOptionKind];
    const allOptions = [...config.defaults, ...getCustomOptions(activeOptionKind)];
    if (value.length < 2) {
      setOptionManagerAlert("Enter at least 2 characters.");
      return;
    }
    if (optionExists(allOptions, value)) {
      setOptionManagerAlert("That option already exists.");
      return;
    }

    recordState("custom option addition");
    addCustomOption(activeOptionKind, value);
    updateCustomizableSelect(activeOptionKind, value);
    input.value = "";
    setOptionManagerAlert(`${value} added.`, true);
    renderOptionManager();
    showToast(`${value} saved as a custom ${config.singular}.`);
  });
}

function updateFundingSourceOptions() {
  const select = document.querySelector("#transaction-funding-source");
  const previousValue = select.value;
  select.replaceChildren(new Option("Not linked to a funding pool", ""));
  const latestPools = new Map();
  buildCombinedFundingSources(getTransactions()).forEach((pool) => {
    const latest = latestPools.get(pool.sourceKey);
    if (!latest || pool.monthKey > latest.monthKey) latestPools.set(pool.sourceKey, pool);
  });
  const availableSources = [...latestPools.values()].sort((a, b) => a.source.localeCompare(b.source));
  availableSources.forEach((pool) => {
    select.add(new Option(`${pool.source} (latest available ${formatCurrency(pool.remaining)})`, pool.sourceKey));
  });
  if (availableSources.some((pool) => pool.sourceKey === previousValue)) select.value = previousValue;
}

function renderDashboard() {
  const totals = renderDashboardCards();
  renderLedger(deleteTransaction);
  renderCategories(totals.expenses);
  renderMonthlySummary();
  renderFundingSources();
  updateFundingSourceOptions();
  updateSettingsSummary();
}

function deleteTransaction(id, row = null) {
  const transaction = getTransactions().find((item) => item.id === id);
  if (!transaction || !window.confirm(`Delete “${transaction.item}”? You can undo this change afterward.`)) return;
  recordState("transaction deletion");
  deleteTransactionRecord(id);
  const finishDeletion = () => {
    renderDashboard();
    if (!getTransactions().some((item) => item.id === id)) showToast("Transaction deleted.");
  };
  if (!row) {
    finishDeletion();
    return;
  }
  row.classList.add("is-leaving");
  row.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  window.setTimeout(finishDeletion, 180);
}

profileForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const alert = document.querySelector("#profile-alert");
  clearFormErrors(profileForm, alert);
  const data = new FormData(profileForm);
  const username = data.get("username").trim();
  const email = data.get("email").trim().toLowerCase();
  const currentUser = getCurrentUser();
  let isValid = true;

  if (username.length < 3) { setFieldError("profile-username", "Use at least 3 characters."); isValid = false; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setFieldError("profile-email", "Enter a valid email address."); isValid = false; }
  const users = getUsers();
  if (users.some((user) => user.id !== currentUser.id && (user.email.toLowerCase() === email || user.username.toLowerCase() === username.toLowerCase()))) {
    setAlert(alert, "That email or username belongs to another account.");
    isValid = false;
  }
  if (!isValid) return;

  const userIndex = users.findIndex((user) => user.id === currentUser.id);
  if (userIndex < 0) { setAlert(alert, "Your account record could not be found. Please log in again."); return; }
  const updatedUser = { ...users[userIndex], username, email, updatedAt: new Date().toISOString() };
  users[userIndex] = updatedUser;
  saveUsers(users);
  setCurrentUser(updatedUser);
  updateAccountIdentity();
  populateSettings();
  setAlert(alert, "Your profile was updated successfully.", "success");
  showToast("Profile changes saved.");
});

passwordChangeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const alert = document.querySelector("#password-change-alert");
  clearFormErrors(passwordChangeForm, alert);
  const data = new FormData(passwordChangeForm);
  const currentPassword = data.get("currentPassword");
  const newPassword = data.get("newPassword");
  const confirmNewPassword = data.get("confirmNewPassword");
  const currentUser = getCurrentUser();
  let isValid = true;

  if (!currentPassword) { setFieldError("current-password", "Enter your current password."); isValid = false; }
  if (newPassword.length < 8) { setFieldError("new-password", "Use at least 8 characters."); isValid = false; }
  if (newPassword !== confirmNewPassword) { setFieldError("confirm-new-password", "The new passwords do not match."); isValid = false; }
  if (!isValid) return;
  if (await hashPassword(currentPassword) !== currentUser.passwordHash) { setFieldError("current-password", "Your current password is incorrect."); return; }
  if (await hashPassword(newPassword) === currentUser.passwordHash) { setFieldError("new-password", "Choose a password different from your current one."); return; }

  const users = getUsers();
  const userIndex = users.findIndex((user) => user.id === currentUser.id);
  if (userIndex < 0) { setAlert(alert, "Your account record could not be found. Please log in again."); return; }
  const submitButton = passwordChangeForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  try {
    users[userIndex] = { ...users[userIndex], passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date().toISOString() };
    saveUsers(users);
    logout("Password changed successfully. Sign in with your new password.");
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelectorAll("[data-password-target]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.passwordTarget);
    const isVisible = input.type === "text";
    input.type = isVisible ? "password" : "text";
    button.setAttribute("aria-pressed", String(!isVisible));
    button.setAttribute("aria-label", isVisible ? "Show password" : "Hide password");
  });
});

transactionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const alert = document.querySelector("#transaction-alert");
  setAlert(alert);
  const data = new FormData(transactionForm);
  const fundingSourceKey = data.get("fundingSourceId") || null;
  const selectedSource = fundingSourceKey
    ? buildCombinedFundingSources(getTransactions()).find((pool) => pool.sourceKey === fundingSourceKey)
    : null;
  const date = data.get("date");
  const fundingMonthKey = getFundingMonthKey(date);
  const hasFundingSource = Boolean(selectedSource && fundingMonthKey);
  const expense = {
    id: createId(),
    date,
    item: data.get("item").trim(),
    category: data.get("category"),
    amount: Number(data.get("amount")),
    method: data.get("method"),
    funding_source_id: hasFundingSource
      ? createCombinedFundingSourceId(selectedSource.source, fundingMonthKey)
      : null,
    funding_source: hasFundingSource
      ? formatCombinedFundingSourceLabel(selectedSource.source, fundingMonthKey)
      : "",
    createdAt: new Date().toISOString(),
  };

  if (!expense.date || !expense.item || !expense.category || !expense.method || !Number.isFinite(expense.amount) || expense.amount <= 0) {
    setAlert(alert, "Complete every field and enter an amount greater than zero.");
    return;
  }
  if (fundingSourceKey && !selectedSource) {
    setAlert(alert, "The selected funding source is no longer available. Choose another funding pool.");
    updateFundingSourceOptions();
    return;
  }

  recordState("expense creation");
  addExpense(expense);
  transactionForm.reset();
  document.querySelector("#transaction-date").value = toDateInputValue(new Date());
  updateCategoryOptions();
  updateFundingSourceOptions();
  renderDashboard();
  showToast("Expense saved successfully.");
});

depositForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const alert = document.querySelector("#deposit-alert");
  setAlert(alert);
  const data = new FormData(depositForm);
  const deposit = {
    id: createId(),
    date: data.get("date"),
    source: data.get("source").trim(),
    amount: Number(data.get("amount")),
    method: data.get("method"),
    createdAt: new Date().toISOString(),
  };
  if (!deposit.date || !deposit.source || !deposit.method || !Number.isFinite(deposit.amount) || deposit.amount <= 0) {
    setAlert(alert, "Complete every field and enter an amount greater than zero.");
    return;
  }
  recordState("deposit creation");
  addDeposit(deposit);
  depositForm.reset();
  document.querySelector("#deposit-date").value = toDateInputValue(new Date());
  renderDashboard();
  showToast("Deposit saved successfully.");
});

function resetAccountData() {
  if (!getTransactions().length) { showToast("There are no transactions to clear."); return; }
  if (!window.confirm("Reset this account's transaction history? Every income and expense record will be cleared, but you can undo this change until you log out or reload the app.")) return;
  recordState("account data reset");
  resetFinancialData();
  renderDashboard();
  showToast("Account transaction data was reset.");
}

function selectEntryTab(tabName) {
  document.querySelectorAll("[data-entry-tab]").forEach((button) => {
    const isActive = button.dataset.entryTab === tabName;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  document.querySelectorAll("[data-entry-panel]").forEach((panel) => {
    panel.classList.toggle("is-mobile-hidden", panel.dataset.entryPanel !== tabName);
  });
}

function setActiveNavigation(activeLink) {
  document.querySelectorAll(".nav-link").forEach((navLink) => navLink.classList.toggle("is-active", navLink === activeLink));
}

function showDashboardView(activeLink = document.querySelector('[data-scroll-to="dashboard"]')) {
  dashboardView.hidden = false;
  monthlySummaryView.hidden = true;
  fundingSourcesView.hidden = true;
  settingsView.hidden = true;
  document.title = "Dashboard | SpendSync";
  setActiveNavigation(activeLink);
}

function showMonthlySummaryView() {
  dashboardView.hidden = true;
  monthlySummaryView.hidden = false;
  fundingSourcesView.hidden = true;
  settingsView.hidden = true;
  document.title = "Monthly Summary | SpendSync";
  setActiveNavigation(document.querySelector('[data-show-view="monthly-summary"]'));
  closeSidebar();
  window.scrollTo({ top: 0, behavior: "smooth" });
  renderMonthlySummary();
}

function showFundingSourcesView() {
  dashboardView.hidden = true;
  monthlySummaryView.hidden = true;
  fundingSourcesView.hidden = false;
  settingsView.hidden = true;
  document.title = "Funding Sources | SpendSync";
  setActiveNavigation(document.querySelector('[data-show-view="funding-sources"]'));
  closeSidebar();
  window.scrollTo({ top: 0, behavior: "smooth" });
  renderFundingSources();
}

function showSettingsView() {
  populateSettings();
  clearFormErrors(profileForm, document.querySelector("#profile-alert"));
  clearFormErrors(passwordChangeForm, document.querySelector("#password-change-alert"));
  dashboardView.hidden = true;
  monthlySummaryView.hidden = true;
  fundingSourcesView.hidden = true;
  settingsView.hidden = false;
  document.title = "Settings | SpendSync";
  setActiveNavigation(document.querySelector("[data-show-settings]"));
  closeSidebar();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openSidebar() {
  sidebar.classList.add("is-open");
  sidebarScrim.hidden = false;
}

function closeSidebar() {
  sidebar.classList.remove("is-open");
  sidebarScrim.hidden = true;
}

function focusTransactionForm() {
  showDashboardView(document.querySelector('[data-scroll-to="transactions"]'));
  selectEntryTab("expense");
  requestAnimationFrame(() => {
    document.querySelector("#new-transaction").scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => document.querySelector("#transaction-amount").focus(), 350);
  });
  closeSidebar();
}

function bindNavigation() {
  document.querySelectorAll("[data-entry-tab]").forEach((button) => button.addEventListener("click", () => selectEntryTab(button.dataset.entryTab)));
  document.querySelectorAll("[data-focus-form]").forEach((button) => button.addEventListener("click", focusTransactionForm));
  document.querySelector("#focus-transaction-button").addEventListener("click", focusTransactionForm);
  document.querySelectorAll("[data-scroll-to]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showDashboardView(link);
      requestAnimationFrame(() => document.getElementById(link.dataset.scrollTo).scrollIntoView({ behavior: "smooth", block: "start" }));
      closeSidebar();
    });
  });
  document.querySelector("[data-show-settings]").addEventListener("click", (event) => { event.preventDefault(); showSettingsView(); });
  document.querySelectorAll("[data-show-view]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      if (link.dataset.showView === "monthly-summary") showMonthlySummaryView();
      if (link.dataset.showView === "funding-sources") showFundingSourcesView();
    });
  });
  document.querySelectorAll(".view-back-button").forEach((button) => button.addEventListener("click", () => { showDashboardView(); window.scrollTo({ top: 0, behavior: "smooth" }); }));
  document.querySelector("#settings-back-button").addEventListener("click", () => { showDashboardView(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  document.querySelector("#menu-button").addEventListener("click", openSidebar);
  document.querySelector("#settings-menu-button").addEventListener("click", openSidebar);
  document.querySelectorAll(".view-menu-button").forEach((button) => button.addEventListener("click", openSidebar));
  document.querySelector("#sidebar-close").addEventListener("click", closeSidebar);
  sidebarScrim.addEventListener("click", closeSidebar);
}

function initialize() {
  const user = findSessionUser();
  if (!user) {
    clearSession();
    window.location.replace("login.html");
    return;
  }

  initializeCurrentUser(user);
  clearHistory();
  configureHistory({
    onRestore: () => {
      updateAllCustomizableSelects();
      renderDashboard();
      const optionManager = document.querySelector("#option-manager-dialog");
      if (optionManager.open) renderOptionManager();
    },
  });
  updateAccountIdentity();
  populateSettings();
  showDashboardView();
  const today = toDateInputValue(new Date());
  document.querySelector("#transaction-date").value = today;
  document.querySelector("#deposit-date").value = today;
  updateAllCustomizableSelects();
  updateFundingSourceOptions();
  selectEntryTab("expense");
  bindNavigation();
  bindUndoControls();
  bindCustomOptionControls();
  bindLedgerControls(() => renderLedger(deleteTransaction));
  bindFundingSourceControls(renderFundingSources);
  initializeExcelSync({ onDataChanged: renderDashboard, notify: showToast });
  initializeGoogleDriveImport({
    importBuffer: importTransactionBuffer,
    setStatus: setTransferStatus,
    notify: showToast,
  });
  document.querySelector("#logout-button").addEventListener("click", () => logout());
  document.querySelector("#settings-logout-button").addEventListener("click", () => logout());
  document.querySelector("#clear-transactions-button").addEventListener("click", resetAccountData);
  document.querySelector("#reset-account-data-button").addEventListener("click", resetAccountData);
  renderDashboard();
  const dashboardMessage = sessionStorage.getItem("spendsync.dashboardMessage");
  if (dashboardMessage) {
    sessionStorage.removeItem("spendsync.dashboardMessage");
    showToast(dashboardMessage);
  }
  window.scrollTo(0, 0);
}

initialize();
