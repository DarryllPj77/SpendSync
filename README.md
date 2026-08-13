# SpendSync

SpendSync is a responsive personal and small-business finance tracker built with modular HTML, CSS, and JavaScript. Accounts, sessions, and transaction records are stored in the browser's `localStorage`; no backend or database is required.

## Included features

- Simulated account registration and login with hashed local passwords
- Separate user-scoped deposit and expense histories with a merged chronological running balance
- Transaction search, filtering, deletion, and category summaries
- Settings workspace for username and email updates
- Verified password changes with automatic logout
- User-scoped transaction reset and manual logout controls
- CSV and Excel ledger export with chronological running balances
- CSV, XLSX, and XLS import with atomic row validation
- XLSX and CSV import directly from Google Drive
- Month-by-month income, expense, and net-balance reports
- Funding-source links between income deposits and expenses
- Responsive desktop, tablet, and mobile layouts

## Import and export

SpendSync uses the browser build of [SheetJS Community Edition](https://docs.sheetjs.com/) to process spreadsheet files without a backend. The app loads the pinned `0.20.3` standalone build from the authoritative SheetJS CDN.

Exports contain these columns in oldest-to-newest order:

```text
Date, Item, Category, Amount, Type, Payment / Deposit Method, Funding Source, Running Balance
```

Imports accept `.csv`, `.xlsx`, and `.xls` files up to 10 MB. The first worksheet containing transaction headers is used. These columns are required:

```text
Date, Item, Category, Amount, Type
```

`Payment / Deposit Method` is optional and defaults to `Imported File`. Header matching is case-insensitive, and common alternatives such as `Description`, `Transaction Type`, and `Payment Method` are supported. If any row is invalid, the complete import is stopped so existing data is never partially updated.

SpendSync also recognizes the legacy `Budget Pajaganas.xlsx` layout. When a workbook contains a sheet named **History Payments**, the importer reads the headers beginning at processed row index 2, maps expense columns A–E, detects the right-side `Date Added` through `Deposit Method` columns, skips blank rows, and appends both histories to the signed-in account. Imported records are normalized into the separate expense and deposit collections before every dependent view is refreshed.

## Google Drive import setup

Drive import is entirely browser-side. Google Picker grants access to the file the user selects, the app downloads its bytes with the Drive API, and those bytes enter the same SheetJS parser used by local uploads. No spreadsheet data is sent to a SpendSync server.

> Google does not define a `drive.readonly.file` OAuth scope. SpendSync uses `https://www.googleapis.com/auth/drive.file`, Google's recommended per-file scope for files selected through Google Picker. It does not request read access to every file in the user's Drive.

### 1. Create and configure a Google Cloud project

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. In **APIs & Services > Library**, enable both **Google Drive API** and **Google Picker API**.
3. Open **Google Auth Platform** and complete **Branding**, **Audience**, and **Data Access**.
4. Choose **External** for a public Render site (or **Internal** only for a Google Workspace organization).
5. Add `https://www.googleapis.com/auth/drive.file` under Data Access. While the app is in Testing, add the Google accounts that will test it as test users.

### 2. Create an OAuth web client

1. Open **Google Auth Platform > Clients** and create an **OAuth client ID**.
2. Choose **Web application**.
3. Add these exact **Authorized JavaScript origins** (origins have no trailing path):

   - `http://127.0.0.1:5500`
   - `https://YOUR-RENDER-SERVICE.onrender.com`

4. Copy the generated client ID.

### 3. Create and restrict an API key

1. Open **APIs & Services > Credentials**, create an **API key**, and edit its restrictions.
2. Under **Application restrictions**, choose **Websites** and allow:

   - `http://127.0.0.1:5500/*`
   - `https://YOUR-RENDER-SERVICE.onrender.com/*`

3. Under **API restrictions**, restrict the key to **Google Picker API**.
4. Copy the key.

### 4. Add the project configuration

Find the numeric **Project number** under **IAM & Admin > Settings**. In `index.html`, replace the three placeholders:

```html
<meta name="google-drive-client-id" content="YOUR_CLIENT_ID.apps.googleusercontent.com">
<meta name="google-drive-api-key" content="YOUR_API_KEY">
<meta name="google-drive-app-id" content="YOUR_PROJECT_NUMBER">
```

The OAuth client, API key, and project number must belong to the same Cloud project. Client-side API keys are visible in page source, so the website and API restrictions above are required. After Render assigns the final URL, add that exact origin to the OAuth client and its `/*` referrer pattern to the API key, then redeploy.

## Monthly reports and funding sources

The **Monthly Summary** tab groups every transaction by its `YYYY-MM` date. Its table shows monthly income, expenses, and net balance in newest-first order, followed by an all-time Grand Total row. The chart compares income and expenses for the latest 12 recorded months using Chart.js 4.5.1. If the chart CDN is unavailable, the summary table continues to work.

The Overview has separate expense and deposit forms on desktop, with a tab switcher on mobile. The expense form's optional Funding Source dropdown is populated from the 25 most recent deposits. Both the stable deposit ID and a readable funding snapshot are stored on the expense:

```json
{
  "funding_source_id": "deposit-id",
  "funding_source": "Parents (₱5,000.00)"
}
```

The **Funding Sources** tab groups linked expenses beneath each deposit and calculates the deposit amount, linked spending, and remaining funds. Existing transactions without `funding_source_id` remain valid. Deleting an income deposit automatically unlinks its expenses instead of deleting them.

## Project structure

```text
SpendSync/
├── index.html                 # Dashboard and application UI
├── login.html                 # Login and sign-up UI
├── package.json               # Static build scripts
├── css/
│   ├── main.css               # Variables and shared controls
│   ├── auth.css               # Authentication layout
│   └── dashboard.css          # Dashboard, reports, and settings
├── js/
│   ├── app.js                 # Initialization and event bindings
│   ├── utils/
│   │   ├── storage.js         # localStorage schemas and mutations
│   │   └── formatters.js      # Date and currency helpers
│   ├── components/
│   │   ├── auth.js            # Login, sign-up, and password visibility
│   │   ├── dashboard.js       # Top-level financial cards
│   │   ├── ledger.js          # Running balance and ledger rendering
│   │   └── summary.js         # Monthly, category, and funding summaries
│   └── services/
│       └── excelSync.js       # SheetJS import/export and legacy parser
├── assets/                    # Static visual assets
├── render.yaml    # Optional Render Blueprint configuration
├── .gitignore
└── README.md
```

## Run locally

No package installation or build step is needed. You can open `index.html` directly, or serve the folder locally so browser features use a normal HTTP origin:

```powershell
python -m http.server 5500
```

Then open `http://127.0.0.1:5500`. Use this exact host during OAuth testing because Google treats `localhost` and `127.0.0.1` as different origins.

## What is stored

SpendSync uses these `localStorage` records:

- `spendsync.users.v1` — registered user profiles and password hashes
- `spendsync.session.v1` — the active user ID
- `spendsync.expenses.<user-id>.v1` — expense history belonging to one user
- `spendsync.deposits.<user-id>.v1` — deposit history belonging to one user
- `spendsync.transactions.<user-id>.v1` — legacy transaction history retained only as a migration source

This is simulated client-side authentication. It keeps accounts separated inside the app, but it is not appropriate for sensitive production data because anyone with access to the browser profile can inspect or change local storage. Data also remains on one browser/device and is cleared if that site's browser data is deleted.

## Push to GitHub

Create an empty GitHub repository named `SpendSync`, then run these commands from this folder. Replace `YOUR-USERNAME` with your GitHub username:

```powershell
git init
git add .
git diff --cached --stat
git commit -m "Build SpendSync financial tracker"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/SpendSync.git
git push -u origin main
```

If this folder is already connected to the correct repository, omit `git init`, `git branch`, and `git remote add`.

## Deploy on Render

### Dashboard setup

1. Sign in to Render and select **New → Static Site**.
2. Connect the GitHub repository and select the `main` branch.
3. Use these settings:
   - **Build Command:** `npm run build`
   - **Publish Directory:** `.`
4. Select **Create Static Site**.

The included `render.yaml` can also be used as a Render Blueprint. Every push to the linked branch can trigger a new deployment when auto-deploy is enabled.

No environment variables, start command, server, or database are needed.
