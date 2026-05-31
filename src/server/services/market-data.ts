/**
 * Market Data Service
 *
 * Fetches real-time financial data for public companies from:
 * - Yahoo Finance (global coverage: US, HK, A-share, Japan, Europe)
 *
 * Exchange → Yahoo Finance ticker format:
 * - NASDAQ/NYSE: AAPL, NVDA
 * - HKEX: 0700.HK, 9888.HK
 * - SSE (上交所): 600519.SS
 * - SZSE (深交所): 000858.SZ
 * - TSE (东京): 6954.T
 * - KRX (韩国): 005930.KS
 * - TWSE (台湾): 2330.TW
 * - XETRA (德国): SAP.DE
 * - LSE (伦敦): SHEL.L
 */

import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export interface MarketQuote {
  price: number | null;
  marketCap: number | null;
  currency: string;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  peRatio: number | null;
  updatedAt: string;
}

export interface FinancialData {
  revenue: number | null;
  revenueGrowth: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  roe: number | null;
  eps: number | null;
  ebitda: number | null;
  freeCashflow: number | null;
  operatingCashflow: number | null;
  totalDebt: number | null;
  totalCash: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  forwardPE: number | null;
  priceToBook: number | null;
  enterpriseValue: number | null;
  beta: number | null;
  pegRatio: number | null;
  sharesOutstanding: number | null;
  fiscalYear: string | null;
  currency: string;
  updatedAt: string;
}

/**
 * Convert our exchange + ticker format to Yahoo Finance symbol
 */
export function toYahooSymbol(ticker: string, exchange: string): string | null {
  if (!ticker) return null;

  const ex = exchange?.toUpperCase().replace(/\s/g, "") ?? "";
  const t = ticker.replace(/\s/g, "");

  // US markets — use as-is
  if (ex.includes("NASDAQ") || ex.includes("NYSE") || ex.includes("AMEX")) {
    return t;
  }

  // Hong Kong
  if (ex.includes("HK") || ex.includes("HKEX") || ex.includes("港")) {
    const num = t.replace(/^0+/, "").replace(/\.HK$/i, "");
    return `${num.padStart(4, "0")}.HK`;
  }

  // China A-shares
  if (ex.includes("SSE") || ex.includes("上交") || ex.includes("上海") || ex === "SH") {
    const num = t.replace(/\.SS$/i, "").replace(/\.SH$/i, "");
    return `${num}.SS`;
  }
  if (ex.includes("SZSE") || ex.includes("深交") || ex.includes("深圳") || ex === "SZ") {
    const num = t.replace(/\.SZ$/i, "");
    return `${num}.SZ`;
  }
  if (ex.includes("科创") || ex.includes("创业")) {
    // 科创板 688xxx → .SS, 创业板 300xxx → .SZ
    if (t.startsWith("688")) return `${t}.SS`;
    if (t.startsWith("300")) return `${t}.SZ`;
    return `${t}.SS`;
  }

  // Japan
  if (ex.includes("TSE") || ex.includes("东京") || ex.includes("TYO")) {
    const num = t.replace(/\.T$/i, "");
    return `${num}.T`;
  }

  // Korea
  if (ex.includes("KRX") || ex.includes("KOSPI") || ex.includes("KOSDAQ") || ex.includes("韩国")) {
    const num = t.replace(/\.KS$/i, "").replace(/\.KQ$/i, "");
    return `${num}.KS`;
  }

  // Taiwan
  if (ex.includes("TWSE") || ex.includes("TWO") || ex.includes("台") || ex.includes("TPE")) {
    const num = t.replace(/\.TW$/i, "");
    return `${num}.TW`;
  }

  // Germany
  if (ex.includes("XETRA") || ex.includes("FRA") || ex.includes("德")) {
    return `${t}.DE`;
  }

  // London
  if (ex.includes("LSE") || ex.includes("LON") || ex.includes("伦敦")) {
    return `${t}.L`;
  }

  // Paris / Euronext
  if (ex.includes("EURONEXT") || ex.includes("PAR") || ex.includes("巴黎")) {
    return `${t}.PA`;
  }

  // Switzerland
  if (ex.includes("SIX") || ex.includes("SWX") || ex.includes("瑞士")) {
    return `${t}.SW`;
  }

  // Stockholm
  if (ex.includes("OMX") || ex.includes("STOCKHOLM") || ex.includes("瑞典")) {
    return `${t}.ST`;
  }

  // Fallback: try ticker as-is
  return t;
}

/**
 * Format large numbers to human-readable Chinese format
 */
function formatAmount(value: number | null, currency: string): string | null {
  if (value == null) return null;

  const abs = Math.abs(value);
  let formatted: string;

  if (currency === "CNY" || currency === "HKD" || currency === "TWD") {
    if (abs >= 1e12) formatted = `${(value / 1e12).toFixed(2)}万亿`;
    else if (abs >= 1e8) formatted = `${(value / 1e8).toFixed(1)}亿`;
    else if (abs >= 1e4) formatted = `${(value / 1e4).toFixed(1)}万`;
    else formatted = `${value.toFixed(0)}`;

    const currLabel = currency === "CNY" ? "元" : currency === "HKD" ? "港元" : "新台币";
    return `${formatted}${currLabel}`;
  }

  if (currency === "JPY") {
    if (abs >= 1e12) formatted = `${(value / 1e12).toFixed(2)}万亿`;
    else if (abs >= 1e8) formatted = `${(value / 1e8).toFixed(0)}亿`;
    else formatted = `${(value / 1e4).toFixed(0)}万`;
    return `${formatted}日元`;
  }

  if (currency === "KRW") {
    if (abs >= 1e12) formatted = `${(value / 1e12).toFixed(1)}万亿`;
    else if (abs >= 1e8) formatted = `${(value / 1e8).toFixed(0)}亿`;
    else formatted = `${value.toFixed(0)}`;
    return `${formatted}韩元`;
  }

  // USD, EUR, GBP, CHF, SEK, etc.
  const currSymbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : `${currency} `;
  if (abs >= 1e12) formatted = `${currSymbol}${(value / 1e12).toFixed(2)}T`;
  else if (abs >= 1e9) formatted = `${currSymbol}${(value / 1e9).toFixed(1)}B`;
  else if (abs >= 1e6) formatted = `${currSymbol}${(value / 1e6).toFixed(0)}M`;
  else formatted = `${currSymbol}${value.toFixed(0)}`;

  return formatted;
}

/**
 * Fetch real-time quote for a company
 */
export async function fetchQuote(ticker: string, exchange: string): Promise<MarketQuote | null> {
  const symbol = toYahooSymbol(ticker, exchange);
  if (!symbol) return null;

  try {
    const quote = await yahooFinance.quote(symbol);
    if (!quote) return null;

    return {
      price: quote.regularMarketPrice ?? null,
      marketCap: quote.marketCap ?? null,
      currency: quote.currency ?? "USD",
      change: quote.regularMarketChange ?? null,
      changePercent: quote.regularMarketChangePercent ?? null,
      volume: quote.regularMarketVolume ?? null,
      fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: quote.fiftyTwoWeekLow ?? null,
      peRatio: quote.trailingPE ?? null,
      updatedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error(`[MarketData] Quote failed for ${symbol}:`, (e as Error).message);
    return null;
  }
}

/**
 * Fetch financial statements summary
 */
export async function fetchFinancials(ticker: string, exchange: string): Promise<FinancialData | null> {
  const symbol = toYahooSymbol(ticker, exchange);
  if (!symbol) return null;

  try {
    const summary = await yahooFinance.quoteSummary(symbol, {
      modules: ["financialData", "defaultKeyStatistics", "incomeStatementHistory"],
    });

    const fd = summary.financialData;
    const ks = summary.defaultKeyStatistics;

    if (!fd) return null;

    return {
      revenue: fd.totalRevenue ?? null,
      revenueGrowth: fd.revenueGrowth != null ? fd.revenueGrowth * 100 : null,
      grossMargin: fd.grossMargins != null ? fd.grossMargins * 100 : null,
      operatingMargin: fd.operatingMargins != null ? fd.operatingMargins * 100 : null,
      netMargin: fd.profitMargins != null ? fd.profitMargins * 100 : null,
      roe: fd.returnOnEquity != null ? fd.returnOnEquity * 100 : null,
      eps: ks?.trailingEps ?? null,
      ebitda: fd.ebitda ?? null,
      freeCashflow: fd.freeCashflow ?? null,
      operatingCashflow: fd.operatingCashflow ?? null,
      totalDebt: fd.totalDebt ?? null,
      totalCash: fd.totalCash ?? null,
      debtToEquity: fd.debtToEquity ?? null,
      currentRatio: fd.currentRatio ?? null,
      forwardPE: ks?.forwardPE ?? null,
      priceToBook: ks?.priceToBook ?? null,
      enterpriseValue: ks?.enterpriseValue ?? null,
      beta: ks?.beta ?? null,
      pegRatio: ks?.pegRatio ?? null,
      sharesOutstanding: ks?.sharesOutstanding ?? null,
      fiscalYear: ks?.lastFiscalYearEnd ? new Date(ks.lastFiscalYearEnd).getFullYear().toString() : null,
      currency: fd.financialCurrency ?? "USD",
      updatedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error(`[MarketData] Financials failed for ${symbol}:`, (e as Error).message);
    return null;
  }
}

/**
 * Fetch and format all data for a company, ready to display
 */
export async function fetchCompanyMarketData(ticker: string, exchange: string): Promise<{
  marketCap: string | null;
  price: string | null;
  revenue: string | null;
  revenueGrowth: string | null;
  grossMargin: string | null;
  netMargin: string | null;
  roe: string | null;
  peRatio: string | null;
  change: string | null;
} | null> {
  const [quote, fin] = await Promise.all([
    fetchQuote(ticker, exchange),
    fetchFinancials(ticker, exchange),
  ]);

  if (!quote && !fin) return null;

  const currency = quote?.currency ?? fin?.currency ?? "USD";

  return {
    marketCap: quote?.marketCap ? formatAmount(quote.marketCap, currency) : null,
    price: quote?.price ? `${currency} ${quote.price.toFixed(2)}` : null,
    revenue: fin?.revenue ? formatAmount(fin.revenue, fin.currency) : null,
    revenueGrowth: fin?.revenueGrowth != null ? `${fin.revenueGrowth.toFixed(1)}%` : null,
    grossMargin: fin?.grossMargin != null ? `${fin.grossMargin.toFixed(1)}%` : null,
    netMargin: fin?.netMargin != null ? `${fin.netMargin.toFixed(1)}%` : null,
    roe: fin?.roe != null ? `${fin.roe.toFixed(1)}%` : null,
    peRatio: quote?.peRatio != null ? `${quote.peRatio.toFixed(1)}x` : null,
    change: quote?.changePercent != null
      ? `${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}%`
      : null,
  };
}
