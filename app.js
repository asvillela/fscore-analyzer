/* ============================================
   F-Score Analyzer — Application Logic
   ============================================ */

const API = window.location.origin;  // uses same host as the page (default: http://localhost:8000)

// --- State ---
let allResults = [];
let currentFilter = "all";
let currentSort = { key: "fscore", dir: "desc" };

// --- DOM refs ---
const tickerInput = document.getElementById("ticker-input");
const analyzeBtn = document.getElementById("analyze-btn");
const clearBtn = document.getElementById("clear-btn");
const statusBar = document.getElementById("status-bar");
const statusText = document.getElementById("status-text");
const errorBar = document.getElementById("error-bar");
const errorText = document.getElementById("error-text");
const resultsSection = document.getElementById("results-section");
const resultsTbody = document.getElementById("results-tbody");
const modalOverlay = document.getElementById("modal-overlay");
const modalContent = document.getElementById("modal-content");
const modalClose = document.getElementById("modal-close");
const metadataBar = document.getElementById("metadata-bar");
const exportBtn = document.getElementById("export-btn");

// --- Init ---
lucide.createIcons();

// --- Event Listeners ---
analyzeBtn.addEventListener("click", runAnalysis);
tickerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runAnalysis();
});
tickerInput.addEventListener("input", () => {
  clearBtn.style.display = tickerInput.value ? "flex" : "none";
});
clearBtn.addEventListener("click", () => {
  tickerInput.value = "";
  clearBtn.style.display = "none";
  tickerInput.focus();
});

// Quick pick buttons
document.querySelectorAll(".quick-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    tickerInput.value = btn.dataset.tickers;
    clearBtn.style.display = "flex";
    runAnalysis();
  });
});

// Filter buttons
document.querySelectorAll(".filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    renderTable();
  });
});

// Sort headers
document.querySelectorAll("th.sortable").forEach((th) => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (currentSort.key === key) {
      currentSort.dir = currentSort.dir === "asc" ? "desc" : "asc";
    } else {
      currentSort.key = key;
      currentSort.dir = th.classList.contains("num") ? "desc" : "asc";
    }
    renderTable();
  });
});

// Modal
modalClose.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

// Export
exportBtn.addEventListener("click", exportCSV);

// --- Core ---
async function runAnalysis() {
  const raw = tickerInput.value.trim();
  if (!raw) return;

  const tickers = raw
    .split(/[,\s\n]+/)
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t.length > 0 && t.length <= 10);

  if (tickers.length === 0) return;

  showStatus(`Analyzing ${tickers.length} ticker${tickers.length > 1 ? "s" : ""}...`);
  hideError();
  resultsSection.style.display = "none";
  analyzeBtn.disabled = true;

  try {
    const res = await fetch(`${API}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers }),
    });

    if (!res.ok) throw new Error(`Server error: ${res.status}`);

    const data = await res.json();
    allResults = data.results;

    if (data.errors && data.errors.length > 0) {
      const errTickers = data.errors.map((e) => e.ticker).join(", ");
      showError(`Could not analyze: ${errTickers}`);
    }

    if (allResults.length > 0) {
      renderKPIs(allResults);
      renderChart(allResults);
      renderTable();
      renderMetadata(data.metadata);
      resultsSection.style.display = "block";
    } else {
      showError("No valid results returned. Check your tickers.");
    }
  } catch (err) {
    showError(`Analysis failed: ${err.message}`);
  } finally {
    hideStatus();
    analyzeBtn.disabled = false;
  }
}

// --- UI Helpers ---
function showStatus(msg) {
  statusBar.style.display = "block";
  statusText.textContent = msg;
}

function hideStatus() {
  statusBar.style.display = "none";
}

function showError(msg) {
  errorBar.style.display = "flex";
  errorText.textContent = msg;
  lucide.createIcons();
}

function hideError() {
  errorBar.style.display = "none";
}

// --- KPIs ---
function renderKPIs(results) {
  const count = results.length;
  const avgFs = (results.reduce((s, r) => s + r.fscore, 0) / count).toFixed(1);
  const pbs = results.filter((r) => r.pb_ratio !== null).map((r) => r.pb_ratio).sort((a, b) => a - b);
  const medianPb = pbs.length > 0 ? pbs[Math.floor(pbs.length / 2)].toFixed(1) : "N/A";
  const undervalued = results.filter(
    (r) => r.classification === "incongruent" && r.pb_ratio !== null && r.pb_ratio < 3.0
  ).length;
  const overvalued = results.filter(
    (r) => r.classification === "incongruent" && (r.pb_ratio === null || r.pb_ratio >= 3.0) && !r.negative_book_value
  ).length;

  document.getElementById("kpi-total").textContent = count;
  document.getElementById("kpi-avg-fscore").textContent = avgFs;
  document.getElementById("kpi-median-pb").textContent = medianPb;
  document.getElementById("kpi-undervalued").textContent = undervalued;
  document.getElementById("kpi-overvalued").textContent = overvalued;
}

// --- Chart ---
function renderChart(results) {
  const chartable = results.filter((r) => r.pb_ratio !== null && r.pb_ratio > 0);
  if (chartable.length === 0) return;

  // Determine P/B threshold (median or 3.0)
  const pbValues = chartable.map((r) => r.pb_ratio).sort((a, b) => a - b);
  const pbThreshold = 3.0;
  const maxPb = Math.max(...pbValues, pbThreshold * 2);
  const minPb = Math.min(...pbValues, 0.3);

  // Color by quadrant
  const colors = chartable.map((r) => {
    if (r.classification === "incongruent" && r.pb_ratio < pbThreshold) return "#34d399"; // green
    if (r.classification === "incongruent" && r.pb_ratio >= pbThreshold) return "#f87171"; // red
    return "#8b8d95"; // gray
  });

  // Size by market cap (normalized)
  const mcaps = chartable.map((r) => r.market_cap || 1e9);
  const maxMcap = Math.max(...mcaps);
  const sizes = mcaps.map((m) => 12 + (m / maxMcap) * 30);

  const trace = {
    x: chartable.map((r) => r.pb_ratio),
    y: chartable.map((r) => r.fscore),
    text: chartable.map((r) => r.ticker),
    customdata: chartable.map((r) => [
      r.name,
      r.sector,
      r.fscore + "/" + r.fscore_max,
      r.pb_ratio,
      formatMcap(r.market_cap),
      r.quadrant,
    ]),
    hovertemplate:
      "<b>%{text}</b> — %{customdata[0]}<br>" +
      "Sector: %{customdata[1]}<br>" +
      "F-Score: %{customdata[2]}<br>" +
      "P/B: %{customdata[3]}<br>" +
      "MCap: %{customdata[4]}<br>" +
      "%{customdata[5]}" +
      "<extra></extra>",
    mode: "markers+text",
    type: "scatter",
    textposition: "top center",
    textfont: {
      family: "Inter, sans-serif",
      size: 10,
      color: "#8b8d95",
    },
    marker: {
      size: sizes,
      color: colors,
      opacity: 0.85,
      line: { color: colors, width: 1 },
    },
  };

  const layout = {
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    font: { family: "Inter, sans-serif", color: "#8b8d95", size: 12 },
    margin: { t: 30, r: 30, b: 60, l: 50 },
    xaxis: {
      title: { text: "Price-to-Book Ratio", font: { size: 12 } },
      type: "log",
      gridcolor: "rgba(42, 45, 54, 0.6)",
      linecolor: "#2a2d36",
      zerolinecolor: "#2a2d36",
      range: [Math.log10(Math.max(minPb * 0.7, 0.1)), Math.log10(maxPb * 1.5)],
      dtick: "D1",
    },
    yaxis: {
      title: { text: "Piotroski F-Score", font: { size: 12 } },
      gridcolor: "rgba(42, 45, 54, 0.6)",
      linecolor: "#2a2d36",
      range: [-0.5, 9.5],
      dtick: 1,
    },
    shapes: [
      // Vertical line at P/B = 3.0
      {
        type: "line",
        x0: pbThreshold, x1: pbThreshold,
        y0: -0.5, y1: 9.5,
        xref: "x", yref: "y",
        line: { color: "#3a3e49", width: 1, dash: "dash" },
      },
      // Horizontal line at F-Score = 5.5
      {
        type: "line",
        x0: Math.max(minPb * 0.7, 0.1), x1: maxPb * 1.5,
        y0: 5.5, y1: 5.5,
        xref: "x", yref: "y",
        line: { color: "#3a3e49", width: 1, dash: "dash" },
      },
      // Top-left quadrant (green bg)
      {
        type: "rect",
        x0: Math.max(minPb * 0.7, 0.1), x1: pbThreshold,
        y0: 5.5, y1: 9.5,
        xref: "x", yref: "y",
        fillcolor: "rgba(52, 211, 153, 0.04)",
        line: { width: 0 },
        layer: "below",
      },
      // Bottom-right quadrant (red bg)
      {
        type: "rect",
        x0: pbThreshold, x1: maxPb * 1.5,
        y0: -0.5, y1: 5.5,
        xref: "x", yref: "y",
        fillcolor: "rgba(248, 113, 113, 0.04)",
        line: { width: 0 },
        layer: "below",
      },
    ],
    annotations: [
      {
        x: Math.log10(Math.max(minPb * 0.8, 0.15)),
        y: 9.2,
        xref: "x", yref: "y",
        text: "POTENTIALLY<br>UNDERVALUED",
        showarrow: false,
        font: { size: 10, color: "rgba(52, 211, 153, 0.5)" },
        xanchor: "left",
      },
      {
        x: Math.log10(maxPb * 1.2),
        y: 0.2,
        xref: "x", yref: "y",
        text: "POTENTIALLY<br>OVERVALUED",
        showarrow: false,
        font: { size: 10, color: "rgba(248, 113, 113, 0.5)" },
        xanchor: "right",
      },
      {
        x: Math.log10(maxPb * 1.2),
        y: 9.2,
        xref: "x", yref: "y",
        text: "CONGRUENT",
        showarrow: false,
        font: { size: 10, color: "rgba(139, 141, 149, 0.4)" },
        xanchor: "right",
      },
      {
        x: Math.log10(Math.max(minPb * 0.8, 0.15)),
        y: 0.2,
        xref: "x", yref: "y",
        text: "CONGRUENT",
        showarrow: false,
        font: { size: 10, color: "rgba(139, 141, 149, 0.4)" },
        xanchor: "left",
      },
    ],
    hoverlabel: {
      bgcolor: "#1a1c22",
      bordercolor: "#2a2d36",
      font: { family: "Inter, sans-serif", size: 12, color: "#e1e2e5" },
    },
  };

  const config = {
    displayModeBar: false,
    responsive: true,
  };

  Plotly.newPlot("scatter-chart", [trace], layout, config);

  // Click handler
  const chartEl = document.getElementById("scatter-chart");
  chartEl.on("plotly_click", (data) => {
    const idx = data.points[0].pointIndex;
    const company = chartable[idx];
    openModal(company);
  });
}

// --- Table ---
function renderTable() {
  let data = [...allResults];

  // Filter
  if (currentFilter !== "all") {
    data = data.filter((r) => r.classification === currentFilter);
  }

  // Sort
  data.sort((a, b) => {
    let va = a[currentSort.key];
    let vb = b[currentSort.key];
    if (va == null) va = currentSort.dir === "asc" ? Infinity : -Infinity;
    if (vb == null) vb = currentSort.dir === "asc" ? Infinity : -Infinity;
    if (typeof va === "string") va = va.toLowerCase();
    if (typeof vb === "string") vb = vb.toLowerCase();
    if (va < vb) return currentSort.dir === "asc" ? -1 : 1;
    if (va > vb) return currentSort.dir === "asc" ? 1 : -1;
    return 0;
  });

  // Update sort indicators
  document.querySelectorAll("th.sortable").forEach((th) => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.sort === currentSort.key) {
      th.classList.add(currentSort.dir === "asc" ? "sort-asc" : "sort-desc");
    }
  });

  resultsTbody.innerHTML = data
    .map(
      (r) => `
    <tr data-ticker="${r.ticker}">
      <td class="td-ticker">${r.ticker}</td>
      <td class="td-name">${r.name}</td>
      <td class="td-sector">${r.sector}</td>
      <td class="td-num">${r.pb_display || "N/A"}</td>
      <td class="td-num">${renderFScoreBar(r.fscore, r.fscore_max)}</td>
      <td>${renderBadge(r)}</td>
      <td class="td-num mcap">${formatMcap(r.market_cap)}</td>
    </tr>
  `
    )
    .join("");

  // Row click
  resultsTbody.querySelectorAll("tr").forEach((tr) => {
    tr.addEventListener("click", () => {
      const ticker = tr.dataset.ticker;
      const company = allResults.find((r) => r.ticker === ticker);
      if (company) openModal(company);
    });
  });
}

function renderFScoreBar(score, max) {
  let html = '<div class="fscore-bar">';
  const cls = score >= 6 ? "filled-high" : score <= 3 ? "filled-low" : "filled";
  for (let i = 0; i < 9; i++) {
    html += `<div class="fscore-dot ${i < score ? cls : ""}"></div>`;
  }
  html += `<span style="margin-left:6px;font-family:var(--font-mono);font-size:11px;">${score}/${max}</span></div>`;
  return html;
}

function renderBadge(r) {
  if (r.classification === "n/a") {
    return `<span class="badge badge-na">N/A</span>`;
  }
  if (r.classification === "incongruent") {
    if (r.pb_ratio !== null && r.pb_ratio < 3.0) {
      return `<span class="badge badge-incongruent-green">Underval</span>`;
    }
    return `<span class="badge badge-incongruent-red">Overval</span>`;
  }
  return `<span class="badge badge-congruent">Congruent</span>`;
}

// --- Modal ---
function openModal(company) {
  const r = company;
  const signals = [
    ["ROA > 0", r.fscore_details.roa_positive, "Company is profitable"],
    ["CFO > 0", r.fscore_details.cfo_positive, "Positive operating cash flow"],
    ["ΔROA > 0", r.fscore_details.delta_roa, "Improving profitability"],
    ["Accruals", r.fscore_details.accruals, "Cash flow exceeds net income"],
    ["ΔLeverage", r.fscore_details.delta_leverage, "Decreasing debt ratio"],
    ["ΔLiquidity", r.fscore_details.delta_liquidity, "Improving current ratio"],
    ["No Dilution", r.fscore_details.no_dilution, "No new shares issued"],
    ["ΔGross Margin", r.fscore_details.delta_gross_margin, "Improving margin"],
    ["ΔAsset Turnover", r.fscore_details.delta_asset_turnover, "More efficient asset use"],
  ];

  let verdictClass = "verdict-neutral";
  let verdictText = `${r.name} is classified as Congruent — market expectations are aligned with fundamentals. No predictable mispricing according to the Piotroski & So framework.`;

  if (r.classification === "incongruent") {
    if (r.pb_ratio !== null && r.pb_ratio < 3.0) {
      verdictClass = "verdict-green";
      verdictText = `${r.name} is a Value stock with strong fundamentals (F-Score ${r.fscore}/${r.fscore_max}). This is an Incongruent portfolio — the market may be overly pessimistic. Historically, such firms have delivered the highest returns.`;
    } else {
      verdictClass = "verdict-red";
      verdictText = `${r.name} is a Glamour stock with weak fundamentals (F-Score ${r.fscore}/${r.fscore_max}). This is an Incongruent portfolio — the market may be overly optimistic. Historically, such firms have underperformed.`;
    }
  }
  if (r.classification === "n/a") {
    verdictText = `${r.name} has a negative book value, so P/B classification is not applicable. This often occurs with companies that have large accumulated buybacks (e.g., McDonald's, Starbucks).`;
  }

  const sectorWarning =
    r.sector === "Financial Services"
      ? `<div class="modal-verdict verdict-neutral" style="margin-bottom:var(--space-4);">⚠ F-Score was not designed for financial companies. Interpret with caution.</div>`
      : "";

  modalContent.innerHTML = `
    <div class="modal-title">${r.name}</div>
    <div class="modal-ticker">${r.ticker}</div>
    <div class="modal-meta">${r.sector} · ${r.industry}</div>
    ${sectorWarning}
    <div class="modal-grid">
      <div class="modal-stat">
        <div class="modal-stat-label">Price</div>
        <div class="modal-stat-value">${r.price ? "$" + r.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "N/A"}</div>
      </div>
      <div class="modal-stat">
        <div class="modal-stat-label">Market Cap</div>
        <div class="modal-stat-value">${formatMcap(r.market_cap)}</div>
      </div>
      <div class="modal-stat">
        <div class="modal-stat-label">Price-to-Book</div>
        <div class="modal-stat-value">${r.pb_display || "N/A"}</div>
      </div>
      <div class="modal-stat">
        <div class="modal-stat-label">F-Score</div>
        <div class="modal-stat-value" style="color: ${r.fscore >= 6 ? "var(--color-green)" : r.fscore <= 3 ? "var(--color-red)" : "var(--color-text)"};">${r.fscore} / ${r.fscore_max}</div>
      </div>
    </div>
    <div class="modal-section-title">F-Score Breakdown</div>
    <ul class="signal-list">
      ${signals
        .map(
          ([name, val, desc]) => `
        <li class="signal-item">
          <span class="signal-name" title="${desc}">${name}</span>
          <span class="${val === 1 ? "signal-pass" : val === 0 ? "signal-fail" : "signal-na"}">${val === 1 ? "PASS" : val === 0 ? "FAIL" : "N/A"}</span>
        </li>
      `
        )
        .join("")}
    </ul>
    <div class="modal-section-title">Verdict</div>
    <div class="modal-verdict ${verdictClass}">${verdictText}</div>
  `;

  modalOverlay.style.display = "flex";
  lucide.createIcons();
}

function closeModal() {
  modalOverlay.style.display = "none";
}

// --- Export CSV ---
function exportCSV() {
  const headers = ["Ticker", "Company", "Sector", "Industry", "Price", "Market Cap", "P/B", "F-Score", "F-Score Max", "Classification", "Quadrant"];
  const rows = allResults.map((r) => [
    r.ticker,
    `"${r.name}"`,
    r.sector,
    r.industry,
    r.price || "",
    r.market_cap || "",
    r.pb_ratio || "",
    r.fscore,
    r.fscore_max,
    r.classification,
    `"${r.quadrant}"`,
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "fscore_analysis.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// --- Metadata ---
function renderMetadata(meta) {
  metadataBar.textContent = `Processed ${meta.total_processed} of ${meta.total_requested} tickers in ${meta.processing_time_seconds}s`;
  if (meta.total_errors > 0) {
    metadataBar.textContent += ` · ${meta.total_errors} error${meta.total_errors > 1 ? "s" : ""}`;
  }
}

// --- Utilities ---
function formatMcap(val) {
  if (!val) return "N/A";
  if (val >= 1e12) return "$" + (val / 1e12).toFixed(1) + "T";
  if (val >= 1e9) return "$" + (val / 1e9).toFixed(1) + "B";
  if (val >= 1e6) return "$" + (val / 1e6).toFixed(0) + "M";
  return "$" + val.toLocaleString();
}
