"use strict";

import {
  captureApplicationState,
  restoreApplicationState,
} from "./storage.js";

const MAX_HISTORY_ACTIONS = 50;
export const stateHistory = [];

const historyListeners = new Set();
let renderAfterRestore = () => {};

function deepCopy(value) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function notifyHistoryListeners() {
  const status = {
    canUndo: stateHistory.length > 0,
    count: stateHistory.length,
    latestLabel: stateHistory.at(-1)?.label ?? "",
  };
  historyListeners.forEach((listener) => listener(status));
}

export function configureHistory({ onRestore } = {}) {
  renderAfterRestore = typeof onRestore === "function" ? onRestore : () => {};
  notifyHistoryListeners();
}

export function subscribeHistory(listener) {
  historyListeners.add(listener);
  notifyHistoryListeners();
  return () => historyListeners.delete(listener);
}

export function recordState(label = "change") {
  stateHistory.push({
    label,
    state: deepCopy(captureApplicationState()),
  });
  if (stateHistory.length > MAX_HISTORY_ACTIONS) stateHistory.shift();
  notifyHistoryListeners();
  return stateHistory.length;
}

export function canUndo() {
  return stateHistory.length > 0;
}

export function undo() {
  if (!stateHistory.length) return null;
  const entry = stateHistory.pop();

  try {
    restoreApplicationState(deepCopy(entry.state));
    renderAfterRestore(entry);
    notifyHistoryListeners();
    return entry;
  } catch (error) {
    stateHistory.push(entry);
    notifyHistoryListeners();
    throw error;
  }
}

export function clearHistory() {
  stateHistory.length = 0;
  notifyHistoryListeners();
}
