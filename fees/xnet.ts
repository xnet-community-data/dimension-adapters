import { FetchOptions, SimpleAdapter } from "../adapters/types";
import { CHAIN } from "../helpers/chains";
import { METRIC } from "../helpers/metrics";
import fetchURL from "../utils/fetchURL";

const REVENUE_URL =
  "https://raw.githubusercontent.com/" +
  "xnet-community-data/xnet-data-integration/main/data/xnet_defillama_revenue.json";

const XIP12_EFFECTIVE_DATE = "2025-05-22";

const OPERATIONS_REVENUE = "Operations";
const PROTOCOL_OWNED_LIQUIDITY = "Protocol-owned liquidity";

interface DailyRevenueRow {
  date: string;
  service_month: string;
  offload_gb: number;
  fees_usd: number;
  user_fees_usd: number;
  basis: string;
  rate_usd_per_api_gb?: number;
  rate_source_month?: string;
}

interface RevenueFeed {
  schema_version: number;
  daily_data: DailyRevenueRow[];
}

const fetch = async (options: FetchOptions) => {
  const response: RevenueFeed = await fetchURL(REVENUE_URL);

  if (!response || !Array.isArray(response.daily_data)) {
    throw new Error("Unexpected XNET daily revenue feed response");
  }

  const rows = response.daily_data.filter(
    (row) => row.date === options.dateString,
  );

  const toFiniteNumber = (value: unknown, field: string) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Invalid XNET revenue feed value: ${field}`);
    }
    return value;
  };

  const feesUsd = rows.reduce(
    (sum, row) => sum + toFiniteNumber(row.fees_usd, "fees_usd"),
    0,
  );

  const userFeesUsd = rows.reduce(
    (sum, row) => sum + toFiniteNumber(row.user_fees_usd, "user_fees_usd"),
    0,
  );

  const postXip12 = options.dateString >= XIP12_EFFECTIVE_DATE;

  const holdersRevenueUsd = feesUsd * (postXip12 ? 0.6 : 0.8);
  const operationsRevenueUsd = feesUsd * 0.2;
  const liquidityRevenueUsd = postXip12 ? feesUsd * 0.2 : 0;

  const dailyFees = options.createBalances();
  const dailyUserFees = options.createBalances();
  const dailyRevenue = options.createBalances();
  const dailyHoldersRevenue = options.createBalances();
  const dailyProtocolRevenue = options.createBalances();

  if (feesUsd > 0) {
    dailyFees.addUSDValue(feesUsd, METRIC.SERVICE_FEES);
    dailyRevenue.addUSDValue(feesUsd, METRIC.SERVICE_FEES);
    dailyHoldersRevenue.addUSDValue(holdersRevenueUsd, METRIC.TOKEN_BUY_BACK);
    dailyProtocolRevenue.addUSDValue(operationsRevenueUsd, OPERATIONS_REVENUE);

    if (liquidityRevenueUsd > 0) {
      dailyProtocolRevenue.addUSDValue(
        liquidityRevenueUsd,
        PROTOCOL_OWNED_LIQUIDITY,
      );
    }
  }

  if (userFeesUsd > 0) {
    dailyUserFees.addUSDValue(userFeesUsd, METRIC.SERVICE_FEES);
  }

  return {
    dailyFees,
    dailyUserFees,
    dailyRevenue,
    dailyHoldersRevenue,
    dailyProtocolRevenue,
  };
};

const adapter: SimpleAdapter = {
  version: 2,
  pullHourly: false,
  fetch,
  chains: [CHAIN.OFF_CHAIN],

  // DeFiLlama treats start as a lower boundary. The first XNET daily accrual
  // is 2024-09-01, so step back one day to ensure it is included.
  start: "2024-08-31",

  methodology: {
    Fees:
      "Estimated carrier WiFi offload fees. Until carrier payment arrives, fees are conservatively estimated from daily offload. Carrier payments typically arrive about two months later; when they do, historical estimates are reconciled to the amount actually paid.",

    Revenue: "Same as Fees.",

    HoldersRevenue:
      "Share of carrier revenue allocated to XNET buybacks and burns: historically 80%, and 60% since XIP-12.",

    ProtocolRevenue:
      "Share of carrier revenue retained for operations and protocol-owned liquidity: historically 20%, and 40% since XIP-12.",
  },

  breakdownMethodology: {
    Fees: {
      [METRIC.SERVICE_FEES]:
        "Carrier WiFi offload fees estimated from daily offload until settlement, then reconciled to the carrier amount actually paid.",
    },

    Revenue: {
      [METRIC.SERVICE_FEES]: "Same as Fees.",
    },

    HoldersRevenue: {
      [METRIC.TOKEN_BUY_BACK]:
        "XNET market buyback-and-burn allocation: historically 80% of carrier revenue, changing under XIP-12 to 60% when 20 percentage points were redirected to bolster protocol-owned liquidity.",
    },

    ProtocolRevenue: {
      [OPERATIONS_REVENUE]:
        "20% of carrier revenue allocated to XNET operations in both the historical and XIP-12 regimes.",

      [PROTOCOL_OWNED_LIQUIDITY]:
        "Under XIP-12, 20% of carrier revenue is allocated to protocol-owned liquidity. This allocation was carved out of the historical 80% buyback-and-burn allocation to bolster XNET liquidity.",
    },
  },
};

export default adapter;
