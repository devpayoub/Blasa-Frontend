/**
 * Minimal Sentry reporter.
 *
 * Uses Sentry's public Store endpoint instead of `@sentry/react-native` so the
 * bundle stays small and the app still builds offline. Enabled only when
 * `EXPO_PUBLIC_SENTRY_DSN` is set; otherwise every call is a no-op.
 */

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';
const ENVIRONMENT = process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? (__DEV__ ? 'development' : 'production');
const RELEASE = process.env.EXPO_PUBLIC_SENTRY_RELEASE ?? 'blasa-app@1.0.0';

export const MONITORING_ENABLED = Boolean(DSN);

interface ParsedDsn {
  storeUrl: string;
  publicKey: string;
}

function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const projectId = url.pathname.replace(/^\//, '');
    if (!publicKey || !projectId) return null;
    return { storeUrl: `${url.protocol}//${url.host}/api/${projectId}/store/`, publicKey };
  } catch {
    return null;
  }
}

const parsed = parseDsn(DSN);
// Cap per-session volume so a loop of failed requests cannot burn the free quota.
let budget = 10;

function eventId(): string {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

function stackFrames(error: unknown) {
  const stack = error instanceof Error ? error.stack : undefined;
  if (!stack) return undefined;
  return stack
    .split('\n')
    .slice(1, 30)
    .map((line) => ({ filename: line.trim().replace(/^at\s+/, '') }));
}

/** Report a handled failure. Safe to call anywhere; never throws. */
export function captureException(error: unknown, context: Record<string, unknown> = {}): void {
  if (!parsed || budget <= 0) return;
  budget -= 1;

  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : String(error);

  const payload = {
    event_id: eventId(),
    timestamp: new Date().toISOString(),
    platform: 'javascript',
    level: 'error',
    logger: 'blasa.app',
    environment: ENVIRONMENT,
    release: RELEASE,
    transaction: context.screen ?? undefined,
    tags: {
      source: String(context.source ?? 'app'),
      ...(context.status ? { http_status: String(context.status) } : {}),
    },
    extra: context,
    exception: {
      values: [
        {
          type: name,
          value: message.slice(0, 1000),
          stacktrace: { frames: stackFrames(error) },
        },
      ],
    },
  };

  try {
    void fetch(parsed.storeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=${RELEASE}, sentry_key=${parsed.publicKey}`,
      },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Monitoring must never break the app.
  }
}
