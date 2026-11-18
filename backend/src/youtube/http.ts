import { config } from '../config.js';
import { AppError } from '../errors.js';

export interface HttpResult {
  status: number;
  body: string;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  /** Aborts when the client that triggered this work disconnects. */
  signal?: AbortSignal;
  timeoutMs?: number;
}

const RETRY_DELAY_MS = 350;

/**
 * Fetch a URL and read the whole body, with a hard timeout covering both.
 * Failures are mapped to AppErrors: TIMEOUT, NETWORK_ERROR or CANCELLED.
 * A transient network failure is retried once.
 */
export async function request(url: string, options: RequestOptions = {}): Promise<HttpResult> {
  try {
    return await attempt(url, options);
  } catch (err) {
    if (!(err instanceof AppError) || err.code !== 'NETWORK_ERROR') throw err;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    if (options.signal?.aborted) throw new AppError('CANCELLED');
    return attempt(url, options);
  }
}

async function attempt(url: string, options: RequestOptions): Promise<HttpResult> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? config.youtubeTimeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      signal,
      redirect: 'follow',
    });
    const body = await response.text();
    return { status: response.status, body };
  } catch (err) {
    if (options.signal?.aborted) throw new AppError('CANCELLED', { cause: err });
    if (timeout.aborted) throw new AppError('TIMEOUT', { cause: err });
    throw new AppError('NETWORK_ERROR', { cause: err });
  }
}
