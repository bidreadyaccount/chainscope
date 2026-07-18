'use client';

/** Index NAV/level history chart (lightweight-charts area series). */

import { useEffect, useRef } from 'react';
import { createChart, ColorType, type IChartApi } from 'lightweight-charts';
import { EmptyState } from './ui';

export function IndexNavChart({
  history,
  baseValue,
}: {
  history: Array<{ takenAt: string; level: number }>;
  baseValue: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const points = history
    .map((h) => ({ time: Math.floor(new Date(h.takenAt).getTime() / 1000), value: h.level }))
    .sort((a, b) => a.time - b.time)
    .filter((p, i, arr) => i === 0 || p.time > (arr[i - 1]?.time ?? 0));

  const up = points.length > 0 && (points[points.length - 1]?.value ?? 0) >= baseValue;

  useEffect(() => {
    if (!ref.current || points.length === 0) return;
    const color = up ? '#22c55e' : '#ef4444';
    const chart = createChart(ref.current, {
      height: 280,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#8a93a3' },
      grid: { vertLines: { color: '#1e232b' }, horzLines: { color: '#1e232b' } },
      rightPriceScale: { borderColor: '#1e232b' },
      timeScale: { borderColor: '#1e232b', timeVisible: false },
    });
    const series = chart.addAreaSeries({
      lineColor: color,
      topColor: up ? 'rgba(34,197,94,0.22)' : 'rgba(239,68,68,0.22)',
      bottomColor: 'rgba(0,0,0,0)',
      lineWidth: 2,
    });
    series.setData(points as never);
    // Reference line at the inception base value.
    const baseline = chart.addLineSeries({ color: '#3b82f6', lineWidth: 1, lineStyle: 2 });
    baseline.setData(points.map((p) => ({ time: p.time, value: baseValue })) as never);
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
  }, [points.length === 0 ? 'empty' : points[0]?.time, points.length, up, baseValue]);

  if (points.length === 0) return <EmptyState message="No NAV history yet." />;
  return <div ref={ref} className="w-full" />;
}
