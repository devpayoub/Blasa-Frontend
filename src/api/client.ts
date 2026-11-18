/**
 * Thin fetch wrapper for the Blasa backend (Django + DRF).
 * Base URL comes from EXPO_PUBLIC_API_URL; Android emulators reach the host
 * machine at 10.0.2.2 instead of localhost.
 */

import { Platform } from 'react-native';

import { MOCK_ENABLED, mockRequest } from '@/api/mock';
import { friendlyError } from '@/lib/errors';
import { captureException } from '@/lib/monitoring';

function resolveBaseUrl(): string {
  const raw = (process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') || 'http://localhost:8000');
  if (Platform.OS === 'android') {
    return raw.replace('localhost', '10.0.2.2').replace('127.0.0.1', '10.0.2.2');
  }
  return raw;
}

export const API_BASE_URL = resolveBaseUrl();

/** ws(s):// counterpart of API_BASE_URL for the chat consumer. */
export function wsUrl(path: string): string {
  return `${API_BASE_URL.replace(/^http/, 'ws')}${path}`;
}

export class ApiError extends Error {
  status: number;
  body?: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

// Tokens are injected by the session store so we avoid an import cycle.
let accessToken: string | undefined;
export function setAuthToken(token?: string) {
  accessToken = token;
}

let refreshHandler: (() => Promise<boolean>) | undefined;
let refreshPending: Promise<boolean> | undefined;
export function setRefreshHandler(handler: () => Promise<boolean>) {
  refreshHandler = handler;
}

let authExpiredHandler: (() => void) | undefined;
export function setAuthExpiredHandler(handler: () => void) {
  authExpiredHandler = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Abort if the backend doesn't respond within this many ms. */
  timeoutMs?: number;
  auth?: boolean;
  /** Internal: this request already survived one refresh attempt. */
  _retried?: boolean;
}

async function rawRequest(path: string, opts: RequestOptions): Promise<{ ok: boolean; status: number; data: unknown }> {
  const { method = 'GET', body, timeoutMs = 10000, auth = false } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      // A proxy/gateway returned HTML (502, maintenance page). Keep the text so
      // the error catalog can still classify by status instead of crashing.
      data = { detail: text.slice(0, 200) };
    }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  // Mock mode: short-circuit before any network traffic so all screens can be
  // browsed with fixture data (EXPO_PUBLIC_MOCK=1 in .env).
  if (MOCK_ENABLED) {
    const mock = await mockRequest(opts.method ?? 'GET', path, opts.body);
    if (mock.status >= 400) {
      const body = mock.data;
      throw new ApiError(friendlyError({ status: mock.status, body }), mock.status, body);
    }
    return mock.data as T;
  }

  let { status, data, ok } = await rawRequest(path, opts).catch((err: unknown) => {
    // fetch() rejects on DNS/TLS/offline failures; there is no HTTP status.
    captureException(err, { source: 'api', path, method: opts.method ?? 'GET' });
    throw new ApiError(friendlyError(err), 0, undefined);
  });

  // Access token expired → try a single silent refresh, then retry once.
  if (status === 401 && opts.auth !== false && !opts._retried && refreshHandler) {
    refreshPending ??= refreshHandler().finally(() => { refreshPending = undefined; });
    const refreshed = await refreshPending;
    if (refreshed) {
      ({ status, data, ok } = await rawRequest(path, { ...opts, _retried: true }));
    } else {
      authExpiredHandler?.();
      throw new ApiError(friendlyError({ status: 401 }), 401);
    }
  }

  if (!ok) {
    if (status >= 500) captureException(new Error(`API ${status}`), { source: 'api', path, status });
    throw new ApiError(friendlyError({ status, body: data }), status, data);
  }
  return data as T;
}
