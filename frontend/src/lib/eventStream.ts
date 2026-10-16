import { apiUrl } from './api';

// One SSE connection with reconnects: after an error, or when nothing (not even the
// server's 25s heartbeat) arrived for a minute. A caller may decide to stop after
// repeated failures, e.g. when the resource behind the stream is gone; EventSource
// cannot see the HTTP status, so that check is the caller's own request.
const STALE_TIMEOUT_MS = 60000;
const STALE_CHECK_MS = 10000;
const RECONNECT_DELAY_MS = 3000;
const FAILURES_BEFORE_CHECK = 3;

export type StreamState = 'connected' | 'reconnecting' | 'disconnected';

export type EventStreamOptions = {
  path: string;
  // The raw event data (JSON text); the caller parses it.
  onMessage: (data: string) => void;
  onStateChange?: (state: StreamState) => void;
  // Asked after several failed connects in a row with no message in between.
  onRepeatedFailure?: () => Promise<'retry' | 'stop'>;
};

export const openEventStream = ({ path, onMessage, onStateChange, onRepeatedFailure }: EventStreamOptions): (() => void) => {
  let es: EventSource | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let lastMessageAt = Date.now();
  let failures = 0;
  // Set by cleanup or by a "stop" decision: no path schedules anything afterwards.
  let stopped = false;

  const stop = () => {
    stopped = true;
    es?.close();
    clearTimeout(reconnectTimer);
    clearInterval(staleTimer);
  };

  const reconnectLater = () => {
    reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
  };

  const scheduleReconnect = () => {
    if (stopped) {
      return;
    }
    es?.close();
    clearTimeout(reconnectTimer);
    onStateChange?.('reconnecting');
    failures++;
    if (!onRepeatedFailure || failures < FAILURES_BEFORE_CHECK) {
      reconnectLater();
      return;
    }
    failures = 0;
    void onRepeatedFailure().catch(() => 'retry' as const).then(decision => {
      if (stopped) {
        return;
      }
      if (decision === 'stop') {
        stop();
        onStateChange?.('disconnected');
        return;
      }
      reconnectLater();
    });
  };

  const connect = () => {
    if (stopped) {
      return;
    }
    lastMessageAt = Date.now();
    es = new EventSource(apiUrl(path), { withCredentials: true });
    es.onmessage = (e: MessageEvent) => {
      lastMessageAt = Date.now();
      failures = 0;
      onStateChange?.('connected');
      onMessage(e.data as string);
    };
    es.onerror = () => {
      scheduleReconnect();
    };
  };

  connect();
  const staleTimer = setInterval(() => {
    if (Date.now() - lastMessageAt > STALE_TIMEOUT_MS) {
      scheduleReconnect();
    }
  }, STALE_CHECK_MS);

  return stop;
};
