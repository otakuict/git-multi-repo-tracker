const form = document.getElementById("scan-form");
const tbody = document.querySelector("#results-table tbody");
const commitCount = document.getElementById("commitCount");
const summaryDiv = document.getElementById("summary");
const exportBtn = document.getElementById("exportBtn");
const scanBtn = document.getElementById("scanBtn");
const loadingOverlay = document.getElementById("loadingOverlay");

function getPaths() {
  const raw = document.getElementById("paths").value || "";
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function renderRows(rows) {
  tbody.innerHTML = "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.date}</td>
      <td title="${
        r.path
      }"><span class="badge rounded-pill text-bg-primary label-pill">${
      r.project
    }</span></td>
      <td>${r.author_name}</td>
      <td><span class="badge rounded-pill text-bg-info label-pill">${
        r.label
      }</span></td>
      <td>${escapeHtml(r.message)}</td>
      <td class="hash"><a href="#" onclick="navigator.clipboard.writeText('${
        r.hash
      }'); return false;">${r.hash.slice(0, 7)}</a></td>
    `;
    tbody.appendChild(tr);
  }
  commitCount.textContent = rows.length;
}

function renderSummary(summaries) {
  if (!summaries.length) {
    summaryDiv.innerHTML = "";
    return;
  }
  const cards = summaries
    .map(
      (s) => `
    <div class="col">
      <div class="card h-100 shadow-sm">
        <div class="card-body">
          <h6 class="card-subtitle mb-2 text-muted">${s.date}</h6>
          <p class="card-text">${escapeHtml(s.message)}</p>
          <span class="badge text-bg-secondary">${s.commits} commit(s)</span>
        </div>
      </div>
    </div>`
    )
    .join("");
  summaryDiv.innerHTML = `<div class="row row-cols-1 row-cols-md-2 row-cols-lg-3 g-3">${cards}</div>`;
}

function escapeHtml(str) {
  return (str || "").replace(
    /[&<>\"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ])
  );
}

function buildPayload() {
  return {
    paths: getPaths(),
    startDate: document.getElementById("startDate").value,
    endDate: document.getElementById("endDate").value,
    author: (document.getElementById("author")?.value || "").trim(),
    scanSubdirs: document.getElementById("scanSubdirs")?.checked ?? false,
  };
}

function setLoading(isLoading) {
  if (!loadingOverlay) return;
  if (isLoading) {
    loadingOverlay.classList.remove("d-none");
  } else {
    loadingOverlay.classList.add("d-none");
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  exportBtn.disabled = true;
  if (scanBtn) scanBtn.disabled = true;
  setLoading(true);

  const payload = buildPayload();

  try {
    const res = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const { error } = await res
        .json()
        .catch(() => ({ error: "Request failed" }));
      alert(error || "Failed");
      return;
    }
    const data = await res.json();
    renderRows(data.rows);
    renderSummary(data.summaries);
    exportBtn.disabled = false;
  } catch (err) {
    console.error(err);
    alert("Scan failed. Please try again.");
  } finally {
    setLoading(false);
    if (scanBtn) scanBtn.disabled = false;
  }
});

exportBtn.addEventListener("click", async () => {
  const payload = buildPayload();
  setLoading(true);
  exportBtn.disabled = true;
  if (scanBtn) scanBtn.disabled = true;

  try {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const { error } = await res
        .json()
        .catch(() => ({ error: "Export failed" }));
      alert(error || "Export failed");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "git-work.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error(err);
    alert("Export failed. Please try again.");
  } finally {
    setLoading(false);
    exportBtn.disabled = false;
    if (scanBtn) scanBtn.disabled = false;
  }
});
