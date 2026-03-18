# F-Score Analyzer

A web application for evaluating publicly traded companies using the **Piotroski F-Score** and **Price-to-Book (P/B)** ratio framework from Piotroski & So (2012). The tool classifies stocks into four quadrants (Value/Glamour × Strong/Weak) to identify potential expectation errors — stocks the market may have mispriced.

Built as part of the **Value Investing assignment** for [15.465 Alphanomics](https://mitsloan.mit.edu/) at MIT Sloan School of Management (March 2026).

**Authors:** Andre Villela, Alex Ershov, Colin McGonigle, Luiz Rodolfo Ribeiro

![Screenshot](screenshot.png)

## Features

- Analyze up to **50 companies** at a time by entering ticker symbols
- Computes all **9 Piotroski F-Score signals** from live financial data (Yahoo Finance)
- Interactive **Value/Glamour Matrix** scatter plot (log-scale P/B vs. F-Score)
- Color-coded quadrant classification (green = BUY candidates, red = SHORT candidates)
- Bubble sizes proportional to market capitalization
- Detailed data table with filtering by quadrant
- CSV export of results

## Quick Start

### Prerequisites

- **Python 3.9+** installed
- Internet connection (for Yahoo Finance data)

### Installation

```bash
# 1. Clone the repo
git clone https://github.com/asvillela/fscore-analyzer.git
cd fscore-analyzer

# 2. Create a virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate        # macOS/Linux
# venv\Scripts\activate          # Windows

# 3. Install dependencies
pip install -r requirements.txt
```

### Run

```bash
python api_server.py
```

Open your browser and go to: **http://localhost:8000**

The backend serves both the API and the frontend from a single process — no separate build step required.

### Usage

1. Enter ticker symbols separated by commas (e.g., `AAPL, MSFT, GOOG`) or paste a list
2. Click **Analyze**
3. Wait for data to load (Yahoo Finance lookups take ~1–2 seconds per company)
4. Explore the scatter plot and data table
5. Filter by quadrant using the buttons above the table

## Methodology

The system implements the framework from:

> **Piotroski, J. D. & So, E. C. (2012).** *Identifying Expectation Errors in Value/Glamour Strategies: A Fundamental Analysis Approach.* Review of Financial Studies, 25(9), 2841–2875. [DOI: 10.1093/rfs/hhs065](https://doi.org/10.1093/rfs/hhs065)

Building on the original F-Score paper:

> **Piotroski, J. D. (2000).** *Value Investing: The Use of Historical Financial Statement Information to Separate Winners from Losers.* Journal of Accounting Research, 38, 1–41. [DOI: 10.2307/2672906](https://doi.org/10.2307/2672906)

### F-Score Signals (9 binary indicators)

| # | Signal | Category | Scores 1 if... |
|---|--------|----------|----------------|
| 1 | ROA > 0 | Profitability | Net Income / Total Assets > 0 |
| 2 | CFO > 0 | Profitability | Operating Cash Flow > 0 |
| 3 | ΔROA | Profitability | ROA improved year-over-year |
| 4 | Accruals | Profitability | CFO > Net Income (cash quality) |
| 5 | ΔLeverage | Leverage | Long-term debt / assets decreased |
| 6 | ΔLiquidity | Leverage | Current ratio improved |
| 7 | No Dilution | Leverage | Shares outstanding did not increase |
| 8 | ΔGross Margin | Efficiency | Gross margin improved |
| 9 | ΔAsset Turnover | Efficiency | Revenue / assets improved |

### Quadrant Classification

Stocks are classified using P/B = 3.0 and F-Score = 5.5 as thresholds:

|  | P/B < 3.0 (Value) | P/B ≥ 3.0 (Glamour) |
|---|---|---|
| **F-Score > 5.5 (Strong)** | **BUY** — Potentially undervalued | Congruent (no mispricing) |
| **F-Score ≤ 5.5 (Weak)** | Congruent (no mispricing) | **SHORT** — Potentially overvalued |

The key insight of Piotroski & So is that the combination of valuation and fundamentals reveals **expectation errors**: value stocks with strong fundamentals are likely over-penalized by the market; glamour stocks with weak fundamentals are likely overpriced.

## Application to U.S. Restaurant Industry

This tool was originally used to screen **51 U.S.-listed restaurant and fast food companies**. Results from that analysis:

- **8 companies** in Value + Strong quadrant (BUY zone, ~22%)
- **6 companies** in Glamour + Weak quadrant (SHORT zone, ~17%)
- Industry average F-Score: **5.1**

Selected BUY candidates identified: `LOCO, CBRL, BLMN, RICK`
Selected SHORT candidates identified: `WEN, HCHL`

To replicate the restaurant industry screen, try entering:
```
LOCO, CBRL, BLMN, RICK, CAVA, WEN, HCHL, YUMC, MCD, QSR, DRI, EAT, SHAK, BROS
```

## Tech Stack

- **Backend:** Python, FastAPI, yfinance, pandas
- **Frontend:** Vanilla HTML/CSS/JavaScript (no build step)
- **Charts:** Plotly.js

## Data Source

All financial data is retrieved from **Yahoo Finance** via the [yfinance](https://github.com/ranaroussi/yfinance) Python library. Data is cached for 24 hours to minimize API calls.

## License

This project was built for educational purposes as part of MIT Sloan's Alphanomics course (15.465). Use at your own discretion. Not investment advice.
