/**
 * Sync live market data for all public companies with tickers.
 * Uses Yahoo Finance API — covers US, HK, A-share, Japan, Korea, Europe.
 *
 * Usage: npx tsx scripts/sync-market-data.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";
import { fetchQuote, fetchFinancials, toYahooSymbol } from "../src/server/services/market-data";

dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local"), override: true });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

async function main() {
  // Get all public companies with tickers
  const companies = await db.company.findMany({
    where: {
      isPublic: true,
      ticker: { not: null },
      exchange: { not: null },
    },
    select: {
      id: true,
      name: true,
      ticker: true,
      exchange: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\n📈 同步实时行情: ${companies.length} 家上市公司\n`);

  let success = 0, failed = 0, skipped = 0;
  const startTime = Date.now();

  for (let i = 0; i < companies.length; i++) {
    const c = companies[i];
    const symbol = toYahooSymbol(c.ticker!, c.exchange!);

    if (!symbol) {
      skipped++;
      continue;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    process.stdout.write(`  [${elapsed}s] ${i + 1}/${companies.length} ${c.name} (${symbol}) ... `);

    try {
      const [quote, fin] = await Promise.all([
        fetchQuote(c.ticker!, c.exchange!),
        fetchFinancials(c.ticker!, c.exchange!),
      ]);

      if (!quote && !fin) {
        failed++;
        console.log("✗ 无数据");
        continue;
      }

      await db.$executeRawUnsafe(`
        UPDATE "Company" SET
          "yahooSymbol" = $1,
          "liveMarketCap" = $2,
          "livePrice" = $3,
          "livePeRatio" = $4,
          "liveChange" = $5,
          "liveCurrency" = $6,
          "liveRevenue" = $7,
          "liveRevenueGrowth" = $8,
          "liveGrossMargin" = $9,
          "liveNetMargin" = $10,
          "liveRoe" = $11,
          "liveOperatingMargin" = $12,
          "liveEbitda" = $13,
          "liveFreeCashflow" = $14,
          "liveOperatingCashflow" = $15,
          "liveTotalCash" = $16,
          "liveTotalDebt" = $17,
          "liveDebtToEquity" = $18,
          "liveCurrentRatio" = $19,
          "liveForwardPE" = $20,
          "livePriceToBook" = $21,
          "liveEnterpriseValue" = $22,
          "liveEps" = $23,
          "liveBeta" = $24,
          "livePegRatio" = $25,
          "liveSharesOutstanding" = $26,
          "liveUpdatedAt" = NOW()
        WHERE id = $27
      `,
        symbol,
        quote?.marketCap ? BigInt(Math.round(quote.marketCap)) : null,
        quote?.price ?? null,
        quote?.peRatio ?? null,
        quote?.changePercent ?? null,
        quote?.currency ?? fin?.currency ?? null,
        fin?.revenue ? BigInt(Math.round(fin.revenue)) : null,
        fin?.revenueGrowth ?? null,
        fin?.grossMargin ?? null,
        fin?.netMargin ?? null,
        fin?.roe ?? null,
        fin?.operatingMargin ?? null,
        fin?.ebitda ? BigInt(Math.round(fin.ebitda)) : null,
        fin?.freeCashflow ? BigInt(Math.round(fin.freeCashflow)) : null,
        fin?.operatingCashflow ? BigInt(Math.round(fin.operatingCashflow)) : null,
        fin?.totalCash ? BigInt(Math.round(fin.totalCash)) : null,
        fin?.totalDebt ? BigInt(Math.round(fin.totalDebt)) : null,
        fin?.debtToEquity ?? null,
        fin?.currentRatio ?? null,
        fin?.forwardPE ?? null,
        fin?.priceToBook ?? null,
        fin?.enterpriseValue ? BigInt(Math.round(fin.enterpriseValue)) : null,
        fin?.eps ?? null,
        fin?.beta ?? null,
        fin?.pegRatio ?? null,
        fin?.sharesOutstanding ? BigInt(Math.round(fin.sharesOutstanding)) : null,
        c.id,
      );

      success++;
      const mcap = quote?.marketCap
        ? quote.marketCap >= 1e12 ? `${(quote.marketCap / 1e12).toFixed(1)}T`
        : quote.marketCap >= 1e9 ? `${(quote.marketCap / 1e9).toFixed(0)}B`
        : `${(quote.marketCap / 1e6).toFixed(0)}M`
        : "-";
      console.log(`✓ 市值 ${mcap} | ${quote?.changePercent != null ? (quote.changePercent >= 0 ? "+" : "") + quote.changePercent.toFixed(2) + "%" : ""}`);

      // Rate limit: ~2 requests per second to avoid Yahoo blocking
      await new Promise((r) => setTimeout(r, 500));
    } catch (err: any) {
      failed++;
      console.log(`✗ ${err.message.slice(0, 50)}`);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n✅ 完成: ${success} 成功, ${failed} 失败, ${skipped} 跳过, ${totalTime}s\n`);

  await db.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
