import type { Config } from 'tailwindcss';

/**
 * Institutional dark-terminal palette (BUILD_BRIEF Phase 5 / SPEC §15):
 * near-black surfaces, neutral borders; green ONLY for positive flow, red ONLY
 * for negative flow, amber for caution/low-confidence, blue for neutral info.
 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0a0b0d',
        panel: '#101216',
        edge: '#1e232b',
        muted: '#8a93a3',
        bright: '#e6eaf0',
        pos: '#22c55e',
        neg: '#ef4444',
        warn: '#f59e0b',
        info: '#3b82f6',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
