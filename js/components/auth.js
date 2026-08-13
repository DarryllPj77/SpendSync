"use strict";

import {
  createId,
  getSessionUserId,
  getUsers,
  hashPassword,
  saveUsers,
  setSessionUserId,
} from "../utils/storage.js";

const loginPanel = document.querySelector("#login-panel");
const signupPanel = document.querySelector("#signup-panel");
const loginForm = document.querySelector("#login-form");
const signupForm = document.querySelector("#signup-form");

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

function clearAuthErrors(formName) {
  document.querySelectorAll(`#${formName}-form [aria-invalid]`).forEach((input) => input.removeAttribute("aria-invalid"));
  document.querySelectorAll(`#${formName}-form .field__error`).forEach((error) => { error.textContent = ""; });
  setAlert(document.getElementById(`${formName}-alert`));
}

function showAuthPanel(panel) {
  const showSignup = panel === "signup";
  loginPanel.hidden = showSignup;
  signupPanel.hidden = !showSignup;
  clearAuthErrors(showSignup ? "signup" : "login");
  document.getElementById(showSignup ? "signup-username" : "login-identifier").focus();
}

function redirectToDashboard() {
  window.location.replace("index.html");
}

document.querySelectorAll("[data-show-auth]").forEach((button) => {
  button.addEventListener("click", () => showAuthPanel(button.dataset.showAuth));
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

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearAuthErrors("signup");
  const data = new FormData(signupForm);
  const username = data.get("username").trim();
  const email = data.get("email").trim().toLowerCase();
  const password = data.get("password");
  const confirmPassword = data.get("confirmPassword");
  let isValid = true;

  if (username.length < 3) { setFieldError("signup-username", "Use at least 3 characters."); isValid = false; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setFieldError("signup-email", "Enter a valid email address."); isValid = false; }
  if (password.length < 8) { setFieldError("signup-password", "Password must contain at least 8 characters."); isValid = false; }
  if (password !== confirmPassword) { setFieldError("signup-confirm-password", "The passwords do not match."); isValid = false; }

  const users = getUsers();
  if (users.some((user) => user.email.toLowerCase() === email || user.username.toLowerCase() === username.toLowerCase())) {
    setAlert(document.querySelector("#signup-alert"), "That email or username is already registered.");
    isValid = false;
  }
  if (!isValid) return;

  const submitButton = signupForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  try {
    const user = { id: createId(), username, email, passwordHash: await hashPassword(password), createdAt: new Date().toISOString() };
    users.push(user);
    saveUsers(users);
    setSessionUserId(user.id);
    sessionStorage.setItem("spendsync.dashboardMessage", "Account created. Welcome to SpendSync!");
    redirectToDashboard();
  } finally {
    submitButton.disabled = false;
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearAuthErrors("login");
  const data = new FormData(loginForm);
  const identifier = data.get("identifier").trim().toLowerCase();
  const password = data.get("password");
  let isValid = true;

  if (!identifier) { setFieldError("login-identifier", "Enter your email or username."); isValid = false; }
  if (!password) { setFieldError("login-password", "Enter your password."); isValid = false; }
  if (!isValid) return;

  const user = getUsers().find((candidate) => candidate.email.toLowerCase() === identifier || candidate.username.toLowerCase() === identifier);
  if (!user || user.passwordHash !== await hashPassword(password)) {
    setAlert(document.querySelector("#login-alert"), "We couldn't match those credentials. Please try again.");
    return;
  }

  setSessionUserId(user.id);
  sessionStorage.setItem("spendsync.dashboardMessage", `Welcome back, ${user.username}.`);
  redirectToDashboard();
});

if (getSessionUserId()) {
  redirectToDashboard();
} else {
  const loginMessage = sessionStorage.getItem("spendsync.loginMessage");
  if (loginMessage) {
    sessionStorage.removeItem("spendsync.loginMessage");
    setAlert(document.querySelector("#login-alert"), loginMessage, "success");
  }
}
