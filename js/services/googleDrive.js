"use strict";

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_SHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PICKER_MIME_TYPES = Object.freeze([
  GOOGLE_SHEET_MIME_TYPE,
  XLSX_MIME_TYPE,
  "text/csv",
]);
const ALLOWED_FILE_NAME = /\.(xlsx|csv)$/i;
const LIBRARY_TIMEOUT_MS = 15000;

let accessToken = "";
let accessTokenExpiresAt = 0;
let tokenClient = null;
let pendingTokenRequest = null;
let pickerReadyPromise = null;
let googleApisReady = false;

function readGoogleConfig() {
  return {
    clientId: document.querySelector('meta[name="google-drive-client-id"]')?.content.trim() || "",
    apiKey: document.querySelector('meta[name="google-drive-api-key"]')?.content.trim() || "",
    appId: document.querySelector('meta[name="google-drive-app-id"]')?.content.trim() || "",
  };
}

function isPlaceholder(value) {
  return !value || /^YOUR_/i.test(value);
}

function validateGoogleConfig(config) {
  const missing = [];
  if (isPlaceholder(config.clientId)) missing.push("OAuth Client ID");
  if (isPlaceholder(config.apiKey)) missing.push("API key");
  if (isPlaceholder(config.appId)) missing.push("project number");

  if (missing.length) {
    throw new Error(`Google Drive import is not configured. Add your ${missing.join(", ")} to index.html.`);
  }
}

function waitFor(check, label) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (check()) {
        window.clearInterval(timer);
        resolve();
      } else if (Date.now() - startedAt >= LIBRARY_TIMEOUT_MS) {
        window.clearInterval(timer);
        reject(new Error(`${label} did not load. Check your connection, content blocker, and API configuration.`));
      }
    }, 50);
  });
}

function loadPickerLibrary() {
  if (globalThis.google?.picker) return Promise.resolve();
  if (pickerReadyPromise) return pickerReadyPromise;

  pickerReadyPromise = waitFor(() => globalThis.gapi?.load, "Google Picker").then(() => (
    new Promise((resolve, reject) => {
      globalThis.gapi.load("picker", {
        callback: resolve,
        onerror: () => reject(new Error("Google Picker could not be initialized.")),
        timeout: LIBRARY_TIMEOUT_MS,
        ontimeout: () => reject(new Error("Google Picker took too long to initialize.")),
      });
    })
  ));

  return pickerReadyPromise;
}

function initializeTokenClient(clientId) {
  if (tokenClient) return tokenClient;
  if (!globalThis.google?.accounts?.oauth2) {
    throw new Error("Google Identity Services has not loaded yet.");
  }

  tokenClient = globalThis.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: DRIVE_FILE_SCOPE,
    callback: (response) => {
      if (!pendingTokenRequest) return;
      const { resolve, reject } = pendingTokenRequest;
      pendingTokenRequest = null;

      if (response.error) {
        reject(new Error(response.error_description || response.error));
        return;
      }

      accessToken = response.access_token;
      const expiresInSeconds = Number(response.expires_in) || 3600;
      accessTokenExpiresAt = Date.now() + Math.max(0, expiresInSeconds - 60) * 1000;
      resolve(accessToken);
    },
    error_callback: (error) => {
      if (!pendingTokenRequest) return;
      const { reject } = pendingTokenRequest;
      pendingTokenRequest = null;
      reject(new Error(error?.message || error?.type || "Google authorization was canceled."));
    },
  });

  return tokenClient;
}

function requestDriveAccess(clientId) {
  if (accessToken && Date.now() < accessTokenExpiresAt) {
    return Promise.resolve(accessToken);
  }

  const client = initializeTokenClient(clientId);
  return new Promise((resolve, reject) => {
    pendingTokenRequest = { resolve, reject };
    client.requestAccessToken({ prompt: accessToken ? "" : "consent" });
  });
}

function pickSpreadsheet({ apiKey, appId }, oauthToken) {
  return new Promise((resolve, reject) => {
    const picker = globalThis.google.picker;
    const view = new picker.DocsView(picker.ViewId.DOCS)
      .setMode(picker.DocsViewMode.LIST)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false)
      .setMimeTypes(PICKER_MIME_TYPES.join(","));

    const instance = new picker.PickerBuilder()
      .setDeveloperKey(apiKey)
      .setAppId(appId)
      .setOAuthToken(oauthToken)
      .setOrigin(window.location.origin)
      .setTitle("Select a Google Sheet, XLSX, or CSV file")
      .addView(view)
      .setCallback((data) => {
        const action = data[picker.Response.ACTION];
        if (action === picker.Action.CANCEL) {
          resolve(null);
          return;
        }
        if (action !== picker.Action.PICKED) return;

        const documentData = data[picker.Response.DOCUMENTS]?.[0];
        const selectedFile = documentData ? {
          id: documentData[picker.Document.ID],
          name: documentData[picker.Document.NAME],
          mimeType: documentData[picker.Document.MIME_TYPE],
        } : null;

        if (!selectedFile?.id || !selectedFile.name) {
          reject(new Error("Google Picker did not return a valid file."));
          return;
        }
        const isNativeGoogleSheet = selectedFile.mimeType === GOOGLE_SHEET_MIME_TYPE;
        if (!isNativeGoogleSheet && !ALLOWED_FILE_NAME.test(selectedFile.name)) {
          reject(new Error("Choose a Google Sheet, .xlsx, or .csv file from Google Drive."));
          return;
        }
        resolve(selectedFile);
      })
      .build();

    instance.setVisible(true);
  });
}

export function getDriveDownloadUrl(selectedFile) {
  const fileUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(selectedFile.id)}`;
  if (selectedFile.mimeType === GOOGLE_SHEET_MIME_TYPE) {
    return `${fileUrl}/export?mimeType=${encodeURIComponent(XLSX_MIME_TYPE)}`;
  }
  return `${fileUrl}?alt=media`;
}

export function getParserFileName(selectedFile) {
  if (selectedFile.mimeType !== GOOGLE_SHEET_MIME_TYPE) return selectedFile.name;
  const baseName = selectedFile.name.trim().replace(/\.(xlsx|csv)$/i, "") || "Google Sheet";
  return `${baseName}.xlsx`;
}

export async function downloadDriveFile(selectedFile, oauthToken) {
  const response = await fetch(getDriveDownloadUrl(selectedFile), {
    method: "GET",
    headers: { Authorization: `Bearer ${oauthToken}` },
  });

  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = payload?.error?.message || "";
    } catch {
      detail = "";
    }
    if (response.status === 401) {
      accessToken = "";
      accessTokenExpiresAt = 0;
    }
    const operation = selectedFile.mimeType === GOOGLE_SHEET_MIME_TYPE ? "export" : "download";
    throw new Error(detail || `Google Drive ${operation} failed (HTTP ${response.status}).`);
  }

  return response.arrayBuffer();
}

export function initializeGoogleDriveImport({
  importBuffer,
  setStatus = () => {},
  notify = () => {},
}) {
  const button = document.querySelector("#google-drive-import-button");
  if (!button) return;

  button.disabled = true;
  button.title = "Loading Google Drive integration...";

  Promise.all([
    waitFor(() => globalThis.google?.accounts?.oauth2, "Google Identity Services"),
    loadPickerLibrary(),
  ]).then(() => {
    googleApisReady = true;
    button.disabled = false;
    button.removeAttribute("title");
  }).catch((error) => {
    button.disabled = false;
    button.title = error.message;
  });

  button.addEventListener("click", async () => {
    const config = readGoogleConfig();

    try {
      validateGoogleConfig(config);
      if (!googleApisReady) {
        throw new Error("Google Drive tools are still loading. Please try again in a moment.");
      }
      button.disabled = true;
      setStatus("Authorizing access to the selected Google Drive file...");

      const oauthToken = await requestDriveAccess(config.clientId);
      const selectedFile = await pickSpreadsheet(config, oauthToken);

      if (!selectedFile) {
        setStatus("Google Drive selection canceled.");
        return;
      }

      const isNativeGoogleSheet = selectedFile.mimeType === GOOGLE_SHEET_MIME_TYPE;
      const parserFileName = getParserFileName(selectedFile);
      setStatus(`${isNativeGoogleSheet ? "Exporting" : "Downloading"} ${selectedFile.name} from Google Drive...`);
      const arrayBuffer = await downloadDriveFile(selectedFile, oauthToken);
      await importBuffer(arrayBuffer, parserFileName);
    } catch (error) {
      console.error("SpendSync Google Drive import failed:", error);
      setStatus(error.message || "Google Drive import could not be completed.", true);
      notify(error.message || "Unable to import from Google Drive.", true);
    } finally {
      button.disabled = false;
    }
  });
}
