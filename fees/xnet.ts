import { FetchOptions, SimpleAdapter } from "../adapters/types";
import { CHAIN } from "../helpers/chains";
import { METRIC } from "../helpers/metrics";
import fetchURL from "../utils/fetchURL";

const REVENUE_URL =
  "https://raw.githubusercontent.com/" +
  "xnet-community-data/xnet-data-integration/main/data/xnet_defillama_revenue.json";

const FIAT_DEPLOYER_PAYOUT = "Fiat deployer payouts";
const PROTOCOL_RETAINED_REVENUE = "Operations and protocol-owned liquidity";

interface DailyRevenueRow {
  date: string;
  service_month: string;
  offload_gb: number;
  fees_usd: number;
  user_fees_usd: number;
  revenue_usd: number;
  supply_side_revenue_usd: number;
  holders_revenue_usd: number;
  protocol_revenue_usd: number;
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

  if (
    !response ||
    response.schema_version < 3 ||
    !Array.isArray(response.daily_data)
  ) {
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

  const sumField = (field: keyof DailyRevenueRow) =>
    rows.reduce(
      (sum, row) => sum + toFiniteNumber(row[field], String(field)),
      0,
    );

  const feesUsd = sumField("fees_usd");
  const userFeesUsd = sumField("user_fees_usd");
  const revenueUsd = sumField("revenue_usd");
  const supplySideRevenueUsd = sumField("supply_side_revenue_usd");
  const holdersRevenueUsd = sumField("holders_revenue_usd");
  const protocolRevenueUsd = sumField("protocol_revenue_usd");

  const tolerance = 0.02;

  if (Math.abs(feesUsd - revenueUsd - supplySideRevenueUsd) > tolerance) {
    throw new Error("XNET feed invariant failed: Fees != Revenue + SupplySideRevenue");
  }

  if (Math.abs(revenueUsd - holdersRevenueUsd - protocolRevenueUsd) > tolerance) {
    throw new Error(
      "XNET feed invariant failed: Revenue != HoldersRevenue + ProtocolRevenue",
    );
  }

  const dailyFees = options.createBalances();
  const dailyUserFees = options.createBalances();
  const dailyRevenue = options.createBalances();
  const dailySupplySideRevenue = options.createBalances();
  const dailyHoldersRevenue = options.createBalances();
  const dailyProtocolRevenue = options.createBalances();

  if (feesUsd > 0) {
    dailyFees.addUSDValue(feesUsd, METRIC.SERVICE_FEES);
  }

  if (userFeesUsd > 0) {
    dailyUserFees.addUSDValue(userFeesUsd, METRIC.SERVICE_FEES);
  }

  if (revenueUsd > 0) {
    dailyRevenue.addUSDValue(revenueUsd, METRIC.SERVICE_FEES);
  }

  if (supplySideRevenueUsd > 0) {
    dailySupplySideRevenue.addUSDValue(
      supplySideRevenueUsd,
      FIAT_DEPLOYER_PAYOUT,
    );
  }

  if (holdersRevenueUsd > 0) {
    dailyHoldersRevenue.addUSDValue(
      holdersRevenueUsd,
      METRIC.TOKEN_BUY_BACK,
    );
  }

  if (protocolRevenueUsd > 0) {
    dailyProtocolRevenue.addUSDValue(
      protocolRevenueUsd,
      PROTOCOL_RETAINED_REVENUE,
    );
  }

  return {
    dailyFees,
    dailyUserFees,
    dailyRevenue,
    dailySupplySideRevenue,
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
      "Carriers pay XNET for mobile data offloaded onto WiFi. Until payment arrives, fees are conservatively estimated from daily offload. Payments typically arrive about two months later; historical estimates are then reconciled to the amount actually paid.",

    Revenue:
      "Carrier fees retained within the XNET ecosystem after payments to deployers who choose fiat compensation.",

    SupplySideRevenue:
      "Payments to deployers who choose fiat compensation for carrying mobile traffic. For the fiat option, 75% of the gross fiat allocation is paid to the deployer.",

    HoldersRevenue:
      "Revenue allocated to XNET buyback-and-burn. For the fiat-deployer option, 5% of the gross fiat allocation goes to BBB.",

    ProtocolRevenue:
      "Revenue retained for XNET operations and protocol-owned liquidity. For the fiat-deployer option, 20% of the gross fiat allocation goes to operations.",
  },

  breakdownMethodology: {
    Fees: {
      [METRIC.SERVICE_FEES]:
        "Carrier WiFi offload fees estimated from daily offload until settlement, then reconciled to the carrier amount actually paid.",
    },

    Revenue: {
      [METRIC.SERVICE_FEES]:
        "Carrier WiFi offload fees after subtracting fiat-deployer payouts.",
    },

    SupplySideRevenue: {
      [FIAT_DEPLOYER_PAYOUT]:
        "Fiat compensation paid to deployers. The fiat option allocates 75% to the deployer, 5% to BBB and 20% to XNET operations; the corresponding token emissions are burned.",
    },

    HoldersRevenue: {
      [METRIC.TOKEN_BUY_BACK]:
        "BBB allocation. Ordinary carrier revenue follows the applicable XNET policy, while 5% of each fiat-option gross allocation goes to BBB.",
    },

    ProtocolRevenue: {
      [PROTOCOL_RETAINED_REVENUE]:
        "Operations and protocol-owned-liquidity allocation. The fiat-option slice contributes 20% of its gross allocation to XNET operations.",
    },
  },
};

export default adapter;
