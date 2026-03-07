import React from "react";
import { BentoGrid, BentoGridItem } from "@/components/ui/bento-grid";
import {
  IconRocket,
  IconFingerprint,
  IconChartBar,
  IconWallet,
  IconArrowNarrowDown,
  IconActivity,
} from "@tabler/icons-react";

export default function FeaturesGrid() {
  return (
    <BentoGrid className="md:auto-rows-[22rem] md:grid-cols-4 gap-6">
      {items.map((item, i) => (
        <BentoGridItem
          key={i}
          title={item.title}
          description={item.description}
          header={item.header}
          className={item.className}
          icon={item.icon}
        />
      ))}
    </BentoGrid>
  );
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 w-full h-full min-h-24 rounded-xl overflow-x-auto overflow-y-hidden relative bg-neutral-950 border border-white/6">
      <div className="absolute inset-0 mask-[radial-gradient(ellipse_at_center,white,transparent)] dark:bg-dot-white/[0.15]" />
      {children}
    </div>
  );
}

// ─── Token Launch ────────────────────────────────────────────────────────────

const bundleWallets = [
  { addr: "3xF9…aB12", amt: "0.05 SOL" },
  { addr: "7kL2…cD34", amt: "0.08 SOL" },
  { addr: "9mR4…eF56", amt: "0.03 SOL" },
  { addr: "2pQ8…gH78", amt: "0.06 SOL" },
];

function TokenLaunchHeader() {
  return (
    <CardShell>
      <div className="relative flex items-stretch w-full h-full">
        <div className="flex flex-col justify-center gap-2.5 px-6 py-5 border-r border-white/5 flex-1">
          {[
            { label: "Name", val: "PEPE COIN" },
            { label: "Symbol", val: "$PEPE" },
            { label: "Supply", val: "1,000,000,000" },
            { label: "Bundle", val: "8 wallets" },
          ].map(({ label, val }) => (
            <div
              key={label}
              className="flex items-center gap-3 rounded-md border border-white/5 bg-neutral-900/70 px-3 py-2"
            >
              <span className="text-[11px] text-neutral-600 uppercase tracking-widest w-12 shrink-0">
                {label}
              </span>
              <span className="text-xs font-mono text-neutral-300">{val}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col justify-center gap-2.5 px-6 py-5 flex-1">
          <span className="text-[11px] text-neutral-600 uppercase tracking-widest font-mono mb-1">
            Jito Bundle
          </span>
          {bundleWallets.map(({ addr, amt }) => (
            <div
              key={addr}
              className="flex items-center gap-2 rounded-md border border-white/5 bg-neutral-900/50 px-3 py-2"
            >
              <span className="text-[10px] font-semibold text-neutral-600 uppercase tracking-wide w-7 shrink-0">
                BUY
              </span>
              <span className="text-xs font-mono text-neutral-600 flex-1">
                {addr}
              </span>
              <span className="text-xs font-mono text-neutral-400 tabular-nums">
                {amt}
              </span>
            </div>
          ))}
        </div>
      </div>
    </CardShell>
  );
}

// ─── Vanity Mint ─────────────────────────────────────────────────────────────

const vanityAddrs = [
  { suffix: "7xR4mKj2pLnQaB8wYcFz", selected: true },
  { suffix: "nD2jvX8w3cBtR5Fy7mNe", selected: false },
  { suffix: "a1K8rYm4qZp9sEd6TgLx", selected: false },
  { suffix: "v5H2jN7wKr3xMp8cQdBt", selected: false },
];

function VanityMintHeader() {
  return (
    <CardShell>
      <div className="relative flex flex-col w-full h-full px-6 py-5 gap-3">
        <div className="flex items-center gap-3 rounded-md border border-white/8 bg-neutral-900/80 px-4 py-2.5">
          <span className="text-[11px] text-neutral-600 uppercase tracking-widest shrink-0">
            Suffix
          </span>
          <span className="text-base font-mono text-neutral-200">PUMP</span>
          <span className="w-px h-4 bg-neutral-400 animate-pulse" />
        </div>

        <div className="flex flex-col gap-2">
          {vanityAddrs.map(({ suffix, selected }) => (
            <div
              key={suffix}
              className={`flex items-center rounded-md border px-3 py-2 ${
                selected
                  ? "border-white/8 bg-neutral-900/70"
                  : "border-white/5 bg-neutral-900/40"
              }`}
            >
              <span className="text-xs font-mono text-neutral-600 truncate">
                {suffix}
              </span>
              <span className="text-xs font-mono text-neutral-300 shrink-0">
                PUMP
              </span>
              {selected && (
                <span className="ml-2 text-[11px] font-mono text-neutral-500 uppercase tracking-wide shrink-0">
                  selected
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between mt-auto">
          <span className="text-[11px] text-neutral-700 font-mono">
            4,823 candidates tested
          </span>
          <span className="text-[11px] text-neutral-500 font-mono uppercase tracking-wide">
            match found
          </span>
        </div>
      </div>
    </CardShell>
  );
}

// ─── Volume Bot ───────────────────────────────────────────────────────────────

const volumeWallets = [
  {
    addr: "3xF9…aB12",
    status: "ACTIVE" as const,
    last: "BUY 0.05 SOL",
    pnl: "+0.003",
  },
  {
    addr: "7kL2…cD34",
    status: "ACTIVE" as const,
    last: "SELL 0.08 SOL",
    pnl: "-0.001",
  },
  {
    addr: "9mR4…eF56",
    status: "ACTIVE" as const,
    last: "BUY 0.03 SOL",
    pnl: "+0.002",
  },
  { addr: "2pQ8…gH78", status: "PAUSED" as const, last: "—", pnl: "0.000" },
];

function VolumeBotHeader() {
  return (
    <CardShell>
      <div className="relative flex items-stretch w-full h-full">
        <div className="flex flex-col justify-between px-6 py-5 border-r border-white/5 w-44 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-neutral-300 animate-pulse" />
            <span className="text-xs font-mono text-neutral-300 uppercase tracking-widest">
              Running
            </span>
          </div>
          <div className="flex flex-col gap-2.5">
            {[
              { label: "Wallets", val: "4" },
              { label: "Ranges", val: "2" },
              { label: "Trades", val: "38" },
              { label: "Volume", val: "1.92 SOL" },
              { label: "Runtime", val: "14m 22s" },
            ].map(({ label, val }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-[11px] text-neutral-600">{label}</span>
                <span className="text-[11px] font-mono text-neutral-400">
                  {val}
                </span>
              </div>
            ))}
          </div>
          <span className="text-[11px] font-mono text-neutral-700">
            buy + sell · 2 ranges
          </span>
        </div>

        <div className="flex flex-col flex-1 px-5 py-5 gap-2">
          <div className="flex items-center gap-2 px-2 mb-1">
            <span className="text-[10px] text-neutral-700 uppercase tracking-widest w-18">
              Wallet
            </span>
            <span className="text-[10px] text-neutral-700 uppercase tracking-widest w-14">
              Status
            </span>
            <span className="text-[10px] text-neutral-700 uppercase tracking-widest flex-1">
              Last Trade
            </span>
            <span className="text-[10px] text-neutral-700 uppercase tracking-widest w-14 text-right">
              PnL
            </span>
          </div>
          {volumeWallets.map((w) => (
            <div
              key={w.addr}
              className="flex items-center gap-2 rounded-md border border-white/5 bg-neutral-900/50 px-2 py-2"
            >
              <span className="text-[11px] font-mono text-neutral-500 w-18">
                {w.addr}
              </span>
              <span
                className={`text-[11px] font-semibold uppercase w-14 ${
                  w.status === "ACTIVE"
                    ? "text-neutral-400"
                    : "text-neutral-700"
                }`}
              >
                {w.status}
              </span>
              <span className="text-[11px] font-mono text-neutral-500 flex-1">
                {w.last}
              </span>
              <span
                className={`text-[11px] font-mono w-14 text-right tabular-nums ${
                  w.pnl.startsWith("+")
                    ? "text-neutral-300"
                    : w.pnl.startsWith("-")
                      ? "text-neutral-600"
                      : "text-neutral-700"
                }`}
              >
                {w.pnl}
              </span>
            </div>
          ))}
        </div>
      </div>
    </CardShell>
  );
}

// ─── Multi-Wallet ─────────────────────────────────────────────────────────────

const managedWallets = [
  { type: "MAIN", addr: "9kPx…3aB1", bal: "4.820" },
  { type: "BUNDLER", addr: "3xF9…aB12", bal: "0.341" },
  { type: "VOLUME", addr: "7kL2…cD34", bal: "0.118" },
  { type: "VOLUME", addr: "9mR4…eF56", bal: "0.092" },
  { type: "DEV", addr: "2pQ8…gH78", bal: "0.003" },
];

function MultiWalletHeader() {
  return (
    <CardShell>
      <div className="relative flex flex-col justify-center w-full h-full px-4 py-5 gap-2">
        {managedWallets.map((w) => (
          <div
            key={w.addr}
            className="flex items-center gap-2 rounded-md border border-white/5 bg-neutral-900/60 px-3 py-2"
          >
            <span className="text-[11px] font-mono text-neutral-700 uppercase tracking-wide w-16 shrink-0">
              {w.type}
            </span>
            <span className="text-[11px] font-mono text-neutral-500 flex-1">
              {w.addr}
            </span>
            <span className="text-[11px] font-mono text-neutral-300 tabular-nums">
              {w.bal}
            </span>
            <span className="text-[11px] text-neutral-700 font-mono">SOL</span>
          </div>
        ))}
      </div>
    </CardShell>
  );
}

// ─── Bulk Exit ────────────────────────────────────────────────────────────────

const exitWallets = [
  { addr: "3xF9…aB12", tokens: "2.4M", sol: "0.18 SOL" },
  { addr: "7kL2…cD34", tokens: "1.1M", sol: "0.09 SOL" },
  { addr: "9mR4…eF56", tokens: "890K", sol: "0.07 SOL" },
];

function BulkExitHeader() {
  return (
    <CardShell>
      <div className="relative flex flex-col justify-center w-full h-full px-4 py-5 gap-2.5">
        {exitWallets.map((w) => (
          <div
            key={w.addr}
            className="flex items-center gap-2 rounded-md border border-white/5 bg-neutral-900/60 px-3 py-2"
          >
            <span className="text-[11px] font-mono text-neutral-500 flex-1">
              {w.addr}
            </span>
            <span className="text-[11px] font-mono text-neutral-600">
              {w.tokens}
            </span>
            <span className="text-[11px] font-mono text-neutral-400 tabular-nums">
              {w.sol}
            </span>
          </div>
        ))}

        <div className="flex items-center gap-2 px-1 py-0.5">
          <div className="flex-1 h-px bg-neutral-800" />
          <IconArrowNarrowDown className="h-3.5 w-3.5 text-neutral-700 shrink-0" />
          <div className="flex-1 h-px bg-neutral-800" />
        </div>

        <div className="flex items-center gap-2 rounded-md border border-white/8 bg-neutral-900/80 px-3 py-2.5">
          <IconWallet className="h-4 w-4 text-neutral-400 shrink-0" />
          <span className="text-[11px] font-mono text-neutral-500">
            Main Wallet
          </span>
          <span className="text-[11px] font-mono text-neutral-200 tabular-nums ml-auto">
            +0.34 SOL
          </span>
        </div>

        <span className="text-[11px] text-neutral-700 font-mono px-1">
          3 wallets · token accounts closed
        </span>
      </div>
    </CardShell>
  );
}

// ─── Real-Time Analytics ──────────────────────────────────────────────────────

const recentTrades = [
  { side: "BUY", addr: "3xF9…aB12", amount: "0.05 SOL", time: "2s" },
  { side: "SELL", addr: "7kL2…cD34", amount: "0.12 SOL", time: "8s" },
  { side: "BUY", addr: "2pQ8…gH78", amount: "0.03 SOL", time: "15s" },
  { side: "BUY", addr: "9mR4…eF56", amount: "0.08 SOL", time: "24s" },
];

function RealTimeAnalyticsHeader() {
  const pts = [
    28, 32, 30, 38, 35, 42, 40, 48, 44, 52, 50, 58, 55, 62, 60, 68, 65, 72, 70,
    78,
  ];
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const W = 400;
  const H = 80;
  const norm = (v: number) => ((v - min) / (max - min)) * (H - 16) + 8;
  const polyline = pts
    .map((v, i) => `${(i / (pts.length - 1)) * W},${H - norm(v)}`)
    .join(" ");

  return (
    <CardShell>
      <div className="relative flex items-stretch w-full h-full">
        <div className="flex flex-col justify-between px-6 py-5 border-r border-white/5 w-48 shrink-0">
          {[
            { label: "Price", val: "$0.00482", sub: "+12.4%" },
            { label: "24H Vol", val: "84.2 SOL", sub: "617 trades" },
            { label: "Holders", val: "1,284", sub: "+38 today" },
            { label: "Pool TVL", val: "12.8 SOL", sub: "Raydium" },
          ].map(({ label, val, sub }) => (
            <div key={label} className="flex flex-col gap-0.5">
              <span className="text-[11px] text-neutral-600 uppercase tracking-widest font-mono">
                {label}
              </span>
              <span className="text-sm font-mono text-neutral-200">{val}</span>
              <span className="text-[11px] font-mono text-neutral-600">
                {sub}
              </span>
            </div>
          ))}
        </div>

        <div className="flex flex-col flex-1 px-6 py-5 border-r border-white/5 gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-neutral-600 uppercase tracking-widest font-mono">
              Price
            </span>
            <span className="text-[11px] font-mono text-neutral-600">1H</span>
          </div>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full flex-1"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="analyticsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="rgb(163,163,163)"
                  stopOpacity="0.12"
                />
                <stop
                  offset="100%"
                  stopColor="rgb(163,163,163)"
                  stopOpacity="0"
                />
              </linearGradient>
            </defs>
            <polyline
              fill="none"
              stroke="rgb(212,212,212)"
              strokeWidth="1.5"
              points={polyline}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polygon
              fill="url(#analyticsGrad)"
              points={`0,${H} ${polyline} ${W},${H}`}
            />
          </svg>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-neutral-600 animate-pulse" />
            <span className="text-[11px] text-neutral-600 font-mono">
              Live · Shyft gRPC
            </span>
          </div>
        </div>

        <div className="flex flex-col px-6 py-5 w-60 shrink-0 gap-3">
          <span className="text-[11px] text-neutral-600 uppercase tracking-widest font-mono">
            Recent Trades
          </span>
          <div className="flex flex-col gap-2">
            {recentTrades.map((tx, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-md border border-white/5 bg-neutral-900/50 px-3 py-2"
              >
                <span
                  className={`text-[11px] font-mono font-semibold w-8 shrink-0 ${
                    tx.side === "BUY" ? "text-neutral-300" : "text-neutral-500"
                  }`}
                >
                  {tx.side}
                </span>
                <span className="text-[11px] font-mono text-neutral-600 flex-1">
                  {tx.addr}
                </span>
                <span className="text-[11px] font-mono text-neutral-400 tabular-nums">
                  {tx.amount}
                </span>
                <span className="text-[11px] font-mono text-neutral-700 w-6 text-right">
                  {tx.time}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </CardShell>
  );
}

// ─── Items ────────────────────────────────────────────────────────────────────

const items = [
  {
    title: "One-Click Token Launch",
    description:
      "Deploy your Solana token with metadata, supply, and authority configuration in a single atomic Jito bundle. Up to 10 wallets buy simultaneously at launch.",
    header: <TokenLaunchHeader />,
    className: "md:col-span-2 bg-linear-to-b from-neutral-900/50 to-black",
    icon: <IconRocket className="h-4 w-4 text-neutral-500" />,
  },
  {
    title: "Vanity Mint Address",
    description:
      "Launch with a custom token address suffix. Ballistik generates and validates candidates on-chain before bundle submission — no collision risk.",
    header: <VanityMintHeader />,
    className: "md:col-span-2 bg-linear-to-b from-neutral-900/50 to-black",
    icon: <IconFingerprint className="h-4 w-4 text-neutral-500" />,
  },
  {
    title: "Multi-Wallet Management",
    description:
      "Create, fund, and monitor bundler, volume, distribution, and dev wallets. Bulk send or return SOL with a single action.",
    header: <MultiWalletHeader />,
    className: "md:col-span-1 bg-linear-to-b from-neutral-900/50 to-black",
    icon: <IconWallet className="h-4 w-4 text-neutral-500" />,
  },
  {
    title: "Volume Bot",
    description:
      "Automated trading sessions with up to 50 wallets across configurable trade ranges. Independent timers per wallet-range pair, powered by Shyft gRPC streams.",
    header: <VolumeBotHeader />,
    className: "md:col-span-2 bg-linear-to-b from-neutral-900/50 to-black",
    icon: <IconChartBar className="h-4 w-4 text-neutral-500" />,
  },
  {
    title: "Bulk Exit",
    description:
      "Sell holdings across every wallet in parallel Jito bundles, close token accounts for rent reclaim, and sweep SOL back to your main wallet in one action.",
    header: <BulkExitHeader />,
    className: "md:col-span-1 bg-linear-to-b from-neutral-900/50 to-black",
    icon: <IconArrowNarrowDown className="h-4 w-4 text-neutral-500" />,
  },
  {
    title: "Real-Time Analytics",
    description:
      "Live price chart, DeFi pool stats, holder count, and transaction feed — streamed on-chain via Shyft gRPC subscriptions with sub-second latency.",
    header: <RealTimeAnalyticsHeader />,
    className: "md:col-span-4 bg-linear-to-b from-neutral-900/50 to-black",
    icon: <IconActivity className="h-4 w-4 text-neutral-500" />,
  },
];
