Git Work Tracker

Collect Git activity from multiple local repositories over a date range, view results in a web UI, and export to XLSX.

**Requirements**
- Node.js 18+ (recommended)
- Git installed and available on your PATH
- Access permissions to the folders you want to scan

**Install**
- Install dependencies: `npm install`
- (Optional) Set a custom port via `PORT` env var

**Run**
- Dev (auto-restart): `npm start`
- Without nodemon: `node server.js`
- Open `http://localhost:3000`

**Using the App**
- Paths: one path per line (repo or parent folder). Example (Windows):
  C:\Users\you\Projects\repo-one
  D:\work\parent-folder
- Scan subfolders: searches for Git repos up to 3 levels deep
- Date range: select start and end dates (end includes the entire day)
- Author (optional): filter by name or email (e.g. `jane` or `jane@company.com`)
- Click Scan to fetch commits and see a daily summary. Click Export XLSX to download `git-work.xlsx` with two sheets:
  - Commits: date, project, path, author, hash, message, label
  - Daily Summary: top categories per day and commit counts

Notes:
- Windows paths with quotes/whitespace are normalized; macOS/Linux paths work too
- Large folders or many repos can take time

**How It Works**
- Discovers repos from each provided path (optionally scans subfolders to depth 3)
- Runs `git log --all` for the date range and optional author filter
- Categorizes messages (e.g., Fix bugs, Refactor code, Maintain dependencies)
- Exports an Excel file via `exceljs` with Commits and Daily Summary sheets

**Configuration**
- `PORT`: port to listen on (default `3000`)

**API**
- `POST /api/scan` body:
  {"paths":["D:\\work\\repo-a","D:\\work\\parent"],"startDate":"2024-01-01","endDate":"2024-01-31","author":"optional","scanSubdirs":true}
  Returns: `{ rows: CommitRow[], summaries: DailySummary[], scannedRepos: string[] }`
- `POST /api/export` body: same as `/api/scan`; returns XLSX

**Troubleshooting**
- No results: check date range/author filter; ensure paths contain Git repos with commits
- Git not found: install Git and ensure it’s on PATH
- Port in use: set a different `PORT`
- Export fails: scan first and allow file downloads

**Scripts**
- `npm start`: runs `nodemon server.js`

**Structure**
- `server.js`: Express server and Git/XLSX logic
- `views/index.html`: UI (Bootstrap)
- `public/app.js`: front-end logic
- `public/style.css`: styles
