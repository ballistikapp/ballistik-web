"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type Time,
  ColorType,
  CrosshairMode,
} from "lightweight-charts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface PriceDataPoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface PriceChartProps {
  priceHistory: PriceDataPoint[];
  currentPrice: {
    priceSol: number;
    isComplete: boolean;
  } | null;
}

type Interval = "1m" | "5m" | "15m" | "30m" | "1h" | "4h";

const INTERVAL_CONFIGS: Record<Interval, { label: string; seconds: number }> = {
  "1m": { label: "1m", seconds: 60 },
  "5m": { label: "5m", seconds: 5 * 60 },
  "15m": { label: "15m", seconds: 15 * 60 },
  "30m": { label: "30m", seconds: 30 * 60 },
  "1h": { label: "1h", seconds: 60 * 60 },
  "4h": { label: "4h", seconds: 4 * 60 * 60 },
};

function formatPriceSol(price: number): string {
  if (price === 0) return "0";
  if (price < 0.000001) return price.toExponential(4);
  if (price < 0.001) return price.toFixed(9);
  if (price < 1) return price.toFixed(6);
  return price.toFixed(4);
}

function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setIsDark(e.matches);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return isDark;
}

export function PriceChart({ priceHistory, currentPrice }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick", Time> | null>(null);
  const [interval, setInterval] = useState<Interval>("5m");
  useIsDarkMode();

  const getChartColors = useCallback(() => {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    return {
      backgroundColor: "transparent",
      textColor: dark ? "rgba(255, 255, 255, 0.6)" : "rgba(0, 0, 0, 0.6)",
      gridColor: dark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.06)",
      upColor: dark ? "rgba(34, 197, 94, 1)" : "rgba(22, 163, 74, 1)",
      downColor: dark ? "rgba(239, 68, 68, 1)" : "rgba(220, 38, 38, 1)",
      borderUpColor: dark ? "rgba(34, 197, 94, 1)" : "rgba(22, 163, 74, 1)",
      borderDownColor: dark ? "rgba(239, 68, 68, 1)" : "rgba(220, 38, 38, 1)",
      wickUpColor: dark ? "rgba(34, 197, 94, 1)" : "rgba(22, 163, 74, 1)",
      wickDownColor: dark ? "rgba(239, 68, 68, 1)" : "rgba(220, 38, 38, 1)",
      crosshairColor: dark ? "rgba(255, 255, 255, 0.4)" : "rgba(0, 0, 0, 0.4)",
    };
  }, []);

  const aggregateToInterval = useCallback((data: PriceDataPoint[], intervalSeconds: number): PriceDataPoint[] => {
    const candleMap = new Map<number, { open: number; high: number; low: number; close: number; lastTime: number }>();
    
    for (const point of data) {
      const bucketTime = Math.floor(point.time / intervalSeconds) * intervalSeconds;
      const existing = candleMap.get(bucketTime);
      
      if (!existing) {
        candleMap.set(bucketTime, {
          open: point.open,
          high: point.high,
          low: point.low,
          close: point.close,
          lastTime: point.time,
        });
      } else {
        existing.high = Math.max(existing.high, point.high);
        existing.low = Math.min(existing.low, point.low);
        if (point.time > existing.lastTime) {
          existing.close = point.close;
          existing.lastTime = point.time;
        }
      }
    }

    return Array.from(candleMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([time, candle]) => ({
        time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const colors = getChartColors();

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: colors.backgroundColor },
        textColor: colors.textColor,
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      },
      grid: {
        vertLines: { color: colors.gridColor },
        horzLines: { color: colors.gridColor },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { 
          color: colors.crosshairColor, 
          labelBackgroundColor: colors.upColor,
          width: 1,
          style: 3, // dashed
        },
        horzLine: { 
          color: colors.crosshairColor, 
          labelBackgroundColor: colors.upColor,
          width: 1,
          style: 3, // dashed
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

    const series = chart.addSeries(CandlestickSeries, {
      upColor: colors.upColor,
      downColor: colors.downColor,
      borderUpColor: colors.borderUpColor,
      borderDownColor: colors.borderDownColor,
      wickUpColor: colors.wickUpColor,
      wickDownColor: colors.wickDownColor,
      priceFormat: {
        type: "price",
        precision: 9,
        minMove: 0.000000001,
      },
    });

    seriesRef.current = series;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        if (width > 0) {
          chart.applyOptions({ width });
        }
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [getChartColors]);

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;

    if (priceHistory.length === 0) {
      seriesRef.current.setData([]);
      return;
    }

    const intervalSeconds = INTERVAL_CONFIGS[interval].seconds;
    const aggregated = aggregateToInterval(priceHistory, intervalSeconds);

    const data: CandlestickData<Time>[] = aggregated.map((point) => ({
      time: point.time as Time,
      open: point.open,
      high: point.high,
      low: point.low,
      close: point.close,
    }));

    seriesRef.current.setData(data);

    if (currentPrice && currentPrice.priceSol > 0 && data.length > 0) {
      const lastCandle = data[data.length - 1];
      const lastTime = lastCandle.time as number;
      const nowSeconds = Math.floor(Date.now() / 1000);
      const currentBucketTime = Math.floor(nowSeconds / intervalSeconds) * intervalSeconds;
      const lastBucketTime = Math.floor(lastTime / intervalSeconds) * intervalSeconds;

      if (currentBucketTime === lastBucketTime) {
        // Update existing candle
        seriesRef.current.update({
          time: lastCandle.time,
          open: lastCandle.open,
          high: Math.max(lastCandle.high, currentPrice.priceSol),
          low: Math.min(lastCandle.low, currentPrice.priceSol),
          close: currentPrice.priceSol,
        });
      } else {
        // Create new candle
        seriesRef.current.update({
          time: currentBucketTime as Time,
          open: currentPrice.priceSol,
          high: currentPrice.priceSol,
          low: currentPrice.priceSol,
          close: currentPrice.priceSol,
        });
      }
    }

    chartRef.current.timeScale().fitContent();
  }, [priceHistory, currentPrice, interval, aggregateToInterval]);

  if (priceHistory.length === 0 && !currentPrice) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Price</CardTitle>
          <CardDescription>Token price over time</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[300px]">
          <p className="text-muted-foreground text-sm">
            No price data available yet
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="@container/card">
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex flex-col gap-1 min-w-0">
            <CardTitle className="flex items-center gap-3">
              Price
              {currentPrice && (
                <span className="text-2xl font-semibold tabular-nums">
                  {formatPriceSol(currentPrice.priceSol)} SOL
                </span>
              )}
            </CardTitle>
            <CardDescription>
              {INTERVAL_CONFIGS[interval].label} candlestick chart · Price in SOL from transactions
              {currentPrice && !currentPrice.isComplete && " and bonding curve"}
            </CardDescription>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {(Object.keys(INTERVAL_CONFIGS) as Interval[]).map((int) => (
              <Button
                key={int}
                variant={interval === int ? "default" : "outline"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setInterval(int)}
              >
                {INTERVAL_CONFIGS[int].label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:px-4">
        <div ref={containerRef} className="h-[300px] w-full" />
      </CardContent>
    </Card>
  );
}
