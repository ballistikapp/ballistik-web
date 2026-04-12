"use client";

import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import {
  createChart,
  AreaSeries,
  type IChartApi,
  type ISeriesApi,
  type AreaData,
  type Time,
  ColorType,
  CrosshairMode,
  LineType,
} from "lightweight-charts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPriceSol } from "@/lib/utils/format";

interface PricePoint {
  time: number;
  price: number;
}

interface PriceChartProps {
  tokenPublicKey: string;
  isComplete: boolean;
  priceHistory: PricePoint[];
  currentPriceSol: number;
  /** When set, replaces the default DexScreener / bonding-curve subtitle */
  chartDescription?: string;
}

function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return isDark;
}

function DexScreenerEmbed({
  tokenPublicKey,
  isDark,
}: {
  tokenPublicKey: string;
  isDark: boolean;
}) {
  const [loading, setLoading] = useState(true);

  const src = useMemo(() => {
    const theme = isDark ? "dark" : "light";
    const params = new URLSearchParams({
      embed: "1",
      loadChartSettings: "0",
      chartLeftToolbar: "0",
      chartDefaultOnMobile: "1",
      chartTheme: theme,
      theme: theme,
      chartType: "usd",
      interval: "15",
      trades: "0",
      info: "0",
    });
    return `https://dexscreener.com/solana/${tokenPublicKey}?${params.toString()}`;
  }, [tokenPublicKey, isDark]);

  return (
    <div className="relative w-full h-[420px] overflow-hidden rounded-b-xl">
      {loading && <Skeleton className="absolute inset-0 rounded-none" />}
      <iframe
        src={src}
        title="DexScreener price chart"
        className="w-full h-full border-0"
        allow="clipboard-write"
        loading="lazy"
        onLoad={() => setLoading(false)}
      />
    </div>
  );
}

function BondingCurveChart({
  priceHistory,
  currentPriceSol,
  isDark,
}: {
  priceHistory: PricePoint[];
  currentPriceSol: number;
  isDark: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area", Time> | null>(null);

  const getColors = useCallback(() => {
    return {
      textColor: isDark
        ? "rgba(255, 255, 255, 0.6)"
        : "rgba(0, 0, 0, 0.6)",
      gridColor: isDark
        ? "rgba(255, 255, 255, 0.06)"
        : "rgba(0, 0, 0, 0.06)",
      lineColor: isDark
        ? "rgba(34, 197, 94, 1)"
        : "rgba(22, 163, 74, 1)",
      areaTopColor: isDark
        ? "rgba(34, 197, 94, 0.28)"
        : "rgba(22, 163, 74, 0.28)",
      areaBottomColor: isDark
        ? "rgba(34, 197, 94, 0.02)"
        : "rgba(22, 163, 74, 0.02)",
      crosshairColor: isDark
        ? "rgba(255, 255, 255, 0.4)"
        : "rgba(0, 0, 0, 0.4)",
    };
  }, [isDark]);

  useEffect(() => {
    if (!containerRef.current) return;

    const colors = getColors();

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: colors.textColor,
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      },
      grid: {
        vertLines: { color: colors.gridColor },
        horzLines: { color: colors.gridColor },
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: {
          color: colors.crosshairColor,
          labelBackgroundColor: colors.lineColor,
          width: 1,
          style: 3,
        },
        horzLine: {
          color: colors.crosshairColor,
          labelBackgroundColor: colors.lineColor,
          width: 1,
          style: 3,
        },
      },
      rightPriceScale: {
        borderVisible: false,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: { vertTouchDrag: false },
    });

    chartRef.current = chart;

    const series = chart.addSeries(AreaSeries, {
      lineColor: colors.lineColor,
      topColor: colors.areaTopColor,
      bottomColor: colors.areaBottomColor,
      lineWidth: 2,
      lineType: LineType.Curved,
      priceFormat: {
        type: "custom",
        formatter: (price: number) => formatPriceSol(price),
      },
      crosshairMarkerRadius: 4,
      crosshairMarkerBackgroundColor: colors.lineColor,
    });

    seriesRef.current = series;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        if (width > 0) chart.applyOptions({ width });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [getColors]);

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;

    const deduped = new Map<number, number>();
    for (const p of priceHistory) {
      deduped.set(p.time, p.price);
    }

    if (currentPriceSol > 0) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      deduped.set(nowSeconds, currentPriceSol);
    }

    const data: AreaData<Time>[] = Array.from(deduped.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([time, value]) => ({ time: time as Time, value }));

    seriesRef.current.setData(data);
    chartRef.current.timeScale().fitContent();
  }, [priceHistory, currentPriceSol]);

  const hasChartData = priceHistory.length >= 2 ||
    (priceHistory.length >= 1 && currentPriceSol > 0);

  if (!hasChartData) {
    return (
      <div className="flex flex-col items-center justify-center h-[300px] gap-2">
        {currentPriceSol > 0 ? (
          <>
            <p className="text-3xl font-semibold tabular-nums">
              {formatPriceSol(currentPriceSol)} SOL
            </p>
            <p className="text-muted-foreground text-sm">
              Current bonding curve price. Chart will populate as trades occur.
            </p>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            No price data available yet
          </p>
        )}
      </div>
    );
  }

  return <div ref={containerRef} className="h-[300px] w-full" />;
}

export function PriceChart({
  tokenPublicKey,
  isComplete,
  priceHistory,
  currentPriceSol,
  chartDescription,
}: PriceChartProps) {
  const isDark = useIsDarkMode();

  return (
    <Card className="@container/card">
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex flex-col gap-1 min-w-0">
            <CardTitle className="flex items-center gap-3">
              Price
              {!isComplete && currentPriceSol > 0 && (
                <span className="text-2xl font-semibold tabular-nums">
                  {formatPriceSol(currentPriceSol)} SOL
                </span>
              )}
            </CardTitle>
            <CardDescription>
              {chartDescription ??
                (isComplete
                  ? "Live chart powered by DexScreener"
                  : "Price in SOL from bonding curve transactions")}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className={isComplete ? "px-0 pb-0" : "px-2 sm:px-4"}>
        {isComplete ? (
          <DexScreenerEmbed
            tokenPublicKey={tokenPublicKey}
            isDark={isDark}
          />
        ) : (
          <BondingCurveChart
            priceHistory={priceHistory}
            currentPriceSol={currentPriceSol}
            isDark={isDark}
          />
        )}
      </CardContent>
    </Card>
  );
}
