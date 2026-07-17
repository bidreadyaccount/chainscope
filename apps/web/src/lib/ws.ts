'use client';

/**
 * Live WebSocket hook against the API's /ws endpoint (envelope
 * { type, ts, data }). Auto-reconnects with capped exponential backoff and
 * supports a pause switch — while paused, frames are dropped (not queued) so a
 * resumed feed shows only current data.
 */

import { useEffect, useRef, useState } from 'react';
import { WS_URL } from './api';

export type WsEnvelope = { type: string; ts: string; data: unknown };

export interface UseLiveFeedOptions {
  channels?: string[];
  tokens?: string[];
  paused?: boolean;
  onFrame: (frame: WsEnvelope) => void;
}

export type WsState = 'connecting' | 'open' | 'closed';

export function useLiveFeed(opts: UseLiveFeedOptions): WsState {
  const [state, setState] = useState<WsState>('connecting');
  const onFrameRef = useRef(opts.onFrame);
  const pausedRef = useRef(opts.paused ?? false);
  onFrameRef.current = opts.onFrame;
  pausedRef.current = opts.paused ?? false;

  const channelsKey = (opts.channels ?? []).join(',');
  const tokensKey = (opts.tokens ?? []).join(',');

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = (): void => {
      if (closed) return;
      setState('connecting');
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        attempt = 0;
        setState('open');
        if (channelsKey) {
          ws?.send(
            JSON.stringify({
              action: 'subscribe',
              channels: channelsKey.split(','),
              ...(tokensKey ? { tokens: tokensKey.split(',') } : {}),
            }),
          );
        }
      };
      ws.onmessage = (ev) => {
        if (pausedRef.current) return;
        try {
          const frame = JSON.parse(ev.data as string) as WsEnvelope & { control?: string };
          if (frame.control) return; // welcome/subscribed/pong control frames
          if (frame.type) onFrameRef.current(frame);
        } catch {
          /* non-JSON frame — ignore */
        }
      };
      ws.onclose = () => {
        setState('closed');
        if (closed) return;
        const delay = Math.min(15_000, 500 * 2 ** attempt++);
        timer = setTimeout(connect, delay);
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, [channelsKey, tokensKey]);

  return state;
}
