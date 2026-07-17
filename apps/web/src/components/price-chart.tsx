'use client';

/**
 * Recent-trade price chart (lightweight-charts v4 area series). Points are the
 * token's recent trade execution prices — an honest "trades we saw" line, not a
 * fabricated candle feed. Renders an empty-state when no priced trades exist.
 */

import { useEffect, useRef } from 'react';
import { createChart, ColorType, type IChartApi } from 'lightweight-charts';
import { type Trade } from '@/lib/api';
import { EmptyState } from './ui';

export function PriceChart({ trades }: { trades: Trade[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const points = trades
    .filter((t) => t.priceUsd !== null)
    .map((t) => ({
      time: Math.floor(new Date(t.blockTimestamp).getTime() / 1000),
      value: t.priceUsd as number,
    }))
    .sort((a, b) => a.time - b.time)
    // lightweight-charts requires strictly ascending times — collapse duplicates.
    .filter((p, i, arr) => i === 0 || p.time > (arr[i - 1]?.time ?? 0));

  useEffect(() => {
    if (!ref.current || points.length === 0) return;
    const chart = createChart(ref.current, {
      height: 260,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#8a93a3' },
      grid: { vertLines: { color: '#1e232b' }, horzLines: { color: '#1e232b' } },
      rightPriceScale: { borderColor: '#1e232b' },
      timeScale: { borderColor: '#1e232b', timeVisible: true, secondsVisible: false },
    });
    const series = chart.addAreaSeries({
      lineColor: '#3b82f6',
      topColor: 'rgba(59,130,246,0.25)',
      bottomColor: 'rgba(59,130,246,0)',
      lineWidth: 2,
    });
    series.setData(points as never);
    chart.timeScale().fitContent();
    chartRef.current = chart;

    const onResize = (): void => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth });
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.remove();
      chartRef.current = null;
    };
    // Re-create when the underlying data identity changes (deliberate narrow dep).
  }, [points.length === 0 ? 'empty' : points[0]?.time, points.length]);

  if (points.length === 0) {
    return (
      <EmptyState message="Insufficient pricing data — no confidently priced trades to chart." />
    );
  }
  return <div ref={ref} className="w-full" />;
}
