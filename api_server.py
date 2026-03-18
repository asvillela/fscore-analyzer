#!/usr/bin/env python3
"""F-Score & Value/Glamour Analyzer — FastAPI Backend"""

import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

import pandas as pd
import yfinance as yf
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

app = FastAPI(title="F-Score Analyzer API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Cache ---
_cache: dict = {}
CACHE_TTL = 86400  # 24 hours


class AnalyzeRequest(BaseModel):
    tickers: list[str]


class FScoreDetail(BaseModel):
    roa_positive: Optional[int] = None
    cfo_positive: Optional[int] = None
    delta_roa: Optional[int] = None
    accruals: Optional[int] = None
    delta_leverage: Optional[int] = None
    delta_liquidity: Optional[int] = None
    no_dilution: Optional[int] = None
    delta_gross_margin: Optional[int] = None
    delta_asset_turnover: Optional[int] = None


class CompanyResult(BaseModel):
    ticker: str
    name: str
    sector: str
    industry: str
    price: Optional[float] = None
    market_cap: Optional[float] = None
    book_value_per_share: Optional[float] = None
    pb_ratio: Optional[float] = None
    pb_display: Optional[str] = None
    fscore: int
    fscore_max: int
    fscore_details: FScoreDetail
    classification: str
    quadrant: str
    negative_book_value: bool = False


def safe_get(data, keys, default=None):
    """Try multiple key names and return the first found value."""
    if data is None:
        return default
    for key in keys:
        if key in data.index:
            val = data[key]
            if pd.notna(val):
                return float(val)
    return default


def calculate_fscore(ticker_obj):
    """Calculate Piotroski F-Score from yfinance data."""
    try:
        bs = ticker_obj.balance_sheet
        fin = ticker_obj.financials
        cf = ticker_obj.cashflow

        if bs is None or bs.empty or fin is None or fin.empty or cf is None or cf.empty:
            return None, None

        # Need at least 2 years of data
        if bs.shape[1] < 2 or fin.shape[1] < 2 or cf.shape[1] < 2:
            return None, None

        # Current and previous year
        cur_bs = bs.iloc[:, 0]
        prev_bs = bs.iloc[:, 1]
        cur_fin = fin.iloc[:, 0]
        prev_fin = fin.iloc[:, 1]
        cur_cf = cf.iloc[:, 0]
        prev_cf = cf.iloc[:, 1]

        details = {}
        score = 0
        max_score = 0

        # --- PROFITABILITY ---
        total_assets = safe_get(cur_bs, ['Total Assets'])
        prev_total_assets = safe_get(prev_bs, ['Total Assets'])
        net_income = safe_get(cur_fin, ['Net Income', 'Net Income Common Stockholders'])
        prev_net_income = safe_get(prev_fin, ['Net Income', 'Net Income Common Stockholders'])
        cfo = safe_get(cur_cf, ['Operating Cash Flow', 'Total Cash From Operating Activities',
                                 'Cash Flow From Continuing Operating Activities'])

        # 1. ROA > 0
        if total_assets and net_income is not None:
            roa = net_income / total_assets
            val = 1 if roa > 0 else 0
            details['roa_positive'] = val
            score += val
            max_score += 1
        else:
            details['roa_positive'] = None

        # 2. CFO > 0
        if cfo is not None:
            val = 1 if cfo > 0 else 0
            details['cfo_positive'] = val
            score += val
            max_score += 1
        else:
            details['cfo_positive'] = None

        # 3. Delta ROA > 0
        if total_assets and prev_total_assets and net_income is not None and prev_net_income is not None:
            roa_cur = net_income / total_assets
            roa_prev = prev_net_income / prev_total_assets
            val = 1 if roa_cur > roa_prev else 0
            details['delta_roa'] = val
            score += val
            max_score += 1
        else:
            details['delta_roa'] = None

        # 4. Accruals: CFO > Net Income
        if cfo is not None and net_income is not None:
            val = 1 if cfo > net_income else 0
            details['accruals'] = val
            score += val
            max_score += 1
        else:
            details['accruals'] = None

        # --- LEVERAGE / LIQUIDITY ---
        # 5. Delta Leverage < 0
        lt_debt = safe_get(cur_bs, ['Long Term Debt', 'Long Term Debt And Capital Lease Obligation'])
        prev_lt_debt = safe_get(prev_bs, ['Long Term Debt', 'Long Term Debt And Capital Lease Obligation'])
        if lt_debt is not None and prev_lt_debt is not None and total_assets and prev_total_assets:
            lev = lt_debt / total_assets
            prev_lev = prev_lt_debt / prev_total_assets
            val = 1 if lev < prev_lev else 0
            details['delta_leverage'] = val
            score += val
            max_score += 1
        elif lt_debt is not None and lt_debt == 0:
            # No debt = good
            details['delta_leverage'] = 1
            score += 1
            max_score += 1
        else:
            details['delta_leverage'] = None

        # 6. Delta Liquidity > 0
        cur_assets = safe_get(cur_bs, ['Current Assets'])
        cur_liab = safe_get(cur_bs, ['Current Liabilities'])
        prev_cur_assets = safe_get(prev_bs, ['Current Assets'])
        prev_cur_liab = safe_get(prev_bs, ['Current Liabilities'])
        if cur_assets and cur_liab and prev_cur_assets and prev_cur_liab:
            cr = cur_assets / cur_liab
            prev_cr = prev_cur_assets / prev_cur_liab
            val = 1 if cr > prev_cr else 0
            details['delta_liquidity'] = val
            score += val
            max_score += 1
        else:
            details['delta_liquidity'] = None

        # 7. No Dilution
        shares = safe_get(cur_bs, ['Share Issued', 'Ordinary Shares Number',
                                    'Common Stock Shares Outstanding'])
        prev_shares = safe_get(prev_bs, ['Share Issued', 'Ordinary Shares Number',
                                          'Common Stock Shares Outstanding'])
        if shares is not None and prev_shares is not None:
            val = 1 if shares <= prev_shares else 0
            details['no_dilution'] = val
            score += val
            max_score += 1
        else:
            details['no_dilution'] = None

        # --- OPERATING EFFICIENCY ---
        # 8. Delta Gross Margin > 0
        gross_profit = safe_get(cur_fin, ['Gross Profit'])
        revenue = safe_get(cur_fin, ['Total Revenue'])
        prev_gross_profit = safe_get(prev_fin, ['Gross Profit'])
        prev_revenue = safe_get(prev_fin, ['Total Revenue'])
        if gross_profit is not None and revenue and prev_gross_profit is not None and prev_revenue:
            gm = gross_profit / revenue
            prev_gm = prev_gross_profit / prev_revenue
            val = 1 if gm > prev_gm else 0
            details['delta_gross_margin'] = val
            score += val
            max_score += 1
        else:
            details['delta_gross_margin'] = None

        # 9. Delta Asset Turnover > 0
        if revenue and total_assets and prev_revenue and prev_total_assets:
            at = revenue / total_assets
            prev_at = prev_revenue / prev_total_assets
            val = 1 if at > prev_at else 0
            details['delta_asset_turnover'] = val
            score += val
            max_score += 1
        else:
            details['delta_asset_turnover'] = None

        return score, max_score, details

    except Exception as e:
        print(f"F-Score calculation error: {e}")
        traceback.print_exc()
        return None, None, None


def classify(fscore, fscore_max, pb_ratio, negative_bv):
    """Classify into Piotroski & So matrix quadrant."""
    if negative_bv or pb_ratio is None:
        return "n/a", "Negative Book Value"

    # Thresholds
    is_value = pb_ratio < 3.0
    is_high_fscore = fscore >= 6 if fscore_max == 9 else fscore >= (fscore_max * 0.67)

    if is_value and is_high_fscore:
        return "incongruent", "Value + Strong Fundamentals"
    elif is_value and not is_high_fscore:
        return "congruent", "Value + Weak Fundamentals"
    elif not is_value and is_high_fscore:
        return "congruent", "Glamour + Strong Fundamentals"
    else:
        return "incongruent", "Glamour + Weak Fundamentals"


def analyze_ticker(symbol: str) -> dict:
    """Analyze a single ticker."""
    symbol = symbol.strip().upper()

    # Check cache
    if symbol in _cache:
        cached_time, cached_data = _cache[symbol]
        if time.time() - cached_time < CACHE_TTL:
            return cached_data

    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info or {}

        if not info.get('longName') and not info.get('shortName'):
            return {"error": f"Ticker '{symbol}' not found", "ticker": symbol}

        name = info.get('longName') or info.get('shortName', symbol)
        sector = info.get('sector', 'Unknown')
        industry = info.get('industry', 'Unknown')
        price = info.get('currentPrice') or info.get('regularMarketPrice')
        market_cap = info.get('marketCap')
        book_value = info.get('bookValue')

        # Calculate P/B
        negative_bv = False
        pb_ratio = None
        pb_display = None
        if book_value is not None and price is not None:
            if book_value < 0:
                negative_bv = True
                pb_display = "Negative BV"
            elif book_value > 0:
                pb_ratio = round(price / book_value, 2)
                pb_display = str(pb_ratio)

        # Calculate F-Score
        result = calculate_fscore(ticker)
        if result[0] is None:
            return {"error": f"Insufficient financial data for '{symbol}'", "ticker": symbol}

        fscore, fscore_max, details = result

        # Classify
        classification, quadrant = classify(fscore, fscore_max, pb_ratio, negative_bv)

        company = {
            "ticker": symbol,
            "name": name,
            "sector": sector,
            "industry": industry,
            "price": price,
            "market_cap": market_cap,
            "book_value_per_share": book_value,
            "pb_ratio": pb_ratio,
            "pb_display": pb_display,
            "fscore": fscore,
            "fscore_max": fscore_max,
            "fscore_details": details,
            "classification": classification,
            "quadrant": quadrant,
            "negative_book_value": negative_bv,
        }

        _cache[symbol] = (time.time(), company)
        return company

    except Exception as e:
        print(f"Error analyzing {symbol}: {e}")
        traceback.print_exc()
        return {"error": f"Failed to analyze '{symbol}': {str(e)}", "ticker": symbol}


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest):
    start = time.time()
    tickers = list(set([t.strip().upper() for t in req.tickers if t.strip()]))

    if not tickers:
        return {"results": [], "errors": [], "metadata": {"total_requested": 0, "total_processed": 0, "processing_time_seconds": 0}}

    if len(tickers) > 50:
        tickers = tickers[:50]

    results = []
    errors = []

    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(analyze_ticker, t): t for t in tickers}
        for future in as_completed(futures):
            data = future.result()
            if "error" in data:
                errors.append(data)
            else:
                results.append(data)

    # Sort by F-Score descending
    results.sort(key=lambda x: x["fscore"], reverse=True)

    elapsed = round(time.time() - start, 1)
    return {
        "results": results,
        "errors": errors,
        "metadata": {
            "total_requested": len(tickers),
            "total_processed": len(results),
            "total_errors": len(errors),
            "processing_time_seconds": elapsed,
        }
    }


# --- Serve frontend ---
_STATIC = Path(__file__).resolve().parent


@app.get("/")
async def root():
    return FileResponse(_STATIC / "index.html")


app.mount("/", StaticFiles(directory=_STATIC, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
