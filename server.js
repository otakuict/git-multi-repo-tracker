const path = require("path");
const fs = require("fs");
const express = require("express");
const morgan = require("morgan");
const ExcelJS = require("exceljs");
const simpleGit = require("simple-git");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(morgan("dev"));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/public", express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

function isGitRepo(dir) {
  try {
    return fs.existsSync(path.join(dir, ".git"));
  } catch {
    return false;
  }
}

function normalizeWindowsPath(p) {
  // Trim quotes, whitespace, and normalize backslashes
  return p
    .replace(/^\s*["']?|["']?\s*$/g, "")
    .replace(/\\+/g, "\\")
    .trim();
}

// Recursively discover repos under a folder (up to maxDepth)
function discoverRepos(root, maxDepth, repos, depth = 0, forceTraverse = false) {
  if (depth > maxDepth) return;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  // If this folder itself contains .git, it's a repo
  const hasGitDir = entries.some((e) => e.isDirectory() && e.name === ".git");
  if (hasGitDir) {
    repos.add(root);
    if (!forceTraverse) return;
  }

  const SKIP = new Set([
    ".git",
    "node_modules",
    ".next",
    "dist",
    "build",
    "out",
    "vendor",
    ".cache",
  ]);
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const nameLower = e.name.toLowerCase();
    if (SKIP.has(nameLower)) continue;
    discoverRepos(path.join(root, e.name), maxDepth, repos, depth + 1, false);
  }
}

async function expandToGitRepos(paths, scanSubdirs, maxDepth = 3) {
  const repos = new Set();
  for (const raw of paths) {
    if (!raw) continue;
    const p = normalizeWindowsPath(raw);
    if (!fs.existsSync(p)) continue;
    const rootIsRepo = isGitRepo(p);
    if (rootIsRepo) {
      repos.add(p);
    }
    if (scanSubdirs) {
      discoverRepos(p, maxDepth, repos, 0, true);
    }
  }
  return Array.from(repos);
}

function labelFromMessage(msg) {
  const m = (msg || "").toLowerCase();
  const cleaned = m
    .replace(/#[0-9a-f]{6,}/g, "")
    .replace(/\b([A-Z]{2,}-\d+)\b/g, "")
    .replace(/[\[\](){}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const buckets = [
    {
      re: /refactor|cleanup|restructure|reorganize|tidy/,
      label: "Refactor code",
    },
    { re: /fix|hotfix|bug|issue|repair/, label: "Fix bugs" },
    {
      re: /feat|feature|add|implement|introduce/,
      label: "Add/implement features",
    },
    { re: /docs|readme|documentation|comment/, label: "Update docs/comments" },
    { re: /test|spec|unit|e2e|jest|mocha/, label: "Add/update tests" },
    {
      re: /chore|deps|dependency|bump|upgrade|update/,
      label: "Maintain dependencies",
    },
    { re: /style|lint|prettier|format/, label: "Code style & lint" },
    { re: /merge|rebase/, label: "Merge/rebase branches" },
  ];
  for (const b of buckets) if (b.re.test(cleaned)) return b.label;

  const words = cleaned.split(" ").filter(Boolean).slice(0, 6).join(" ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Misc work";
}

function formatLocalDay(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function collectCommits(repoDirs, since, until, author) {
  const rows = [];
  for (const dir of repoDirs) {
    const git = simpleGit({ baseDir: dir, maxConcurrentProcesses: 1 });

    // Skip repos with no commits
    try {
      await git.raw(["rev-parse", "--verify", "HEAD"]);
    } catch {
      continue;
    }

    const args = [
      "--all",
      "--date=iso",
      `--since=${since}`,
      `--until=${until}`,
      "--regexp-ignore-case",
    ];
    if (author && author.trim()) args.push(`--author=${author.trim()}`);

    let log;
    try {
      log = await git.log(args);
    } catch (e) {
      if (String(e.message || e).includes("does not have any commits yet"))
        continue;
      console.error("git log failed for", dir, e.message || e);
      continue;
    }

    const project = path.basename(dir);
    for (const c of log.all) {
      const dt = new Date(c.date);
      const day = formatLocalDay(dt);
      rows.push({
        date: day,
        project,
        path: dir,
        author_name: c.author_name,
        author_email: c.author_email,
        hash: c.hash,
        message: c.message,
        label: labelFromMessage(c.message),
      });
    }
  }
  rows.sort((a, b) =>
    a.date === b.date
      ? a.project.localeCompare(b.project)
      : a.date < b.date
      ? 1
      : -1
  );
  return rows;
}

function buildDailySummaries(rows) {
  const byDay = new Map();
  for (const r of rows) {
    if (!byDay.has(r.date)) byDay.set(r.date, []);
    byDay.get(r.date).push(r);
  }
  const summaries = [];
  for (const [date, items] of Array.from(byDay.entries()).sort((a, b) =>
    a[0] < b[0] ? 1 : -1
  )) {
    const counts = items.reduce((acc, it) => {
      acc[it.label] = (acc[it.label] || 0) + 1;
      return acc;
    }, {});
    const top = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    const parts = top.map(([label, n]) => (n > 1 ? `${label} (x${n})` : label));
    const msg = parts.length ? parts.join("; ") : "General work";
    summaries.push({ date, message: msg, commits: items.length });
  }
  return summaries;
}

app.post("/api/scan", async (req, res) => {
  try {
    const { paths, startDate, endDate, author, scanSubdirs } = req.body;
    if (!Array.isArray(paths) || !startDate || !endDate) {
      return res
        .status(400)
        .json({ error: "paths[], startDate, endDate are required" });
    }

    const since = new Date(startDate);
    const until = new Date(endDate);
    if (isNaN(since) || isNaN(until))
      return res.status(400).json({ error: "Invalid dates" });
    until.setHours(23, 59, 59, 999);

    const sinceStr = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`;
    const untilStr = `${until.getFullYear()}-${String(until.getMonth() + 1).padStart(2, "0")}-${String(until.getDate()).padStart(2, "0")} 23:59:59`;

    const repoDirs = await expandToGitRepos(paths, !!scanSubdirs, 3);
    const authorFilter = (author && author.trim()) || undefined; // e.g. "pattho49"

    const rows = await collectCommits(repoDirs, sinceStr, untilStr, authorFilter);
    const summaries = buildDailySummaries(rows);
    res.json({ rows, summaries, scannedRepos: repoDirs });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal error" });
  }
});

app.post("/api/export", async (req, res) => {
  try {
    const { paths, startDate, endDate, author, scanSubdirs } = req.body;
    if (!Array.isArray(paths) || !startDate || !endDate) {
      return res
        .status(400)
        .json({ error: "paths[], startDate, endDate are required" });
    }

    const since = new Date(startDate);
    const until = new Date(endDate);
    until.setHours(23, 59, 59, 999);

    const sinceStr = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`;
    const untilStr = `${until.getFullYear()}-${String(until.getMonth() + 1).padStart(2, "0")}-${String(until.getDate()).padStart(2, "0")} 23:59:59`;

    const repoDirs = await expandToGitRepos(paths, !!scanSubdirs, 3);
    const authorFilter = (author && author.trim()) || undefined;

    const rows = await collectCommits(repoDirs, sinceStr, untilStr, authorFilter);
    const summaries = buildDailySummaries(rows);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Commits");
    ws.columns = [
      { header: "Date", key: "date", width: 12 },
      { header: "Project", key: "project", width: 24 },
      { header: "Path", key: "path", width: 40 },
      { header: "Author", key: "author_name", width: 20 },
      { header: "Email", key: "author_email", width: 30 },
      { header: "Hash", key: "hash", width: 12 },
      { header: "Message", key: "message", width: 60 },
      { header: "Label", key: "label", width: 24 },
    ];
    ws.addRows(rows);

    const ws2 = wb.addWorksheet("Daily Summary");
    ws2.columns = [
      { header: "Date", key: "date", width: 12 },
      { header: "Summary", key: "message", width: 60 },
      { header: "Commits", key: "commits", width: 10 },
    ];
    ws2.addRows(summaries);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="git-work.xlsx"'
    );
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal error" });
  }
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
}

module.exports = {
  app,
  expandToGitRepos,
  collectCommits,
  buildDailySummaries,
};
