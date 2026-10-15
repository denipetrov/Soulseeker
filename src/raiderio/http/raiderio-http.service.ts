import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import got, { HTTPError, RequestError, type Got } from 'got';
import { DependencyHealth } from '@denipetrov/spirit-link/health';
import { RunLogger } from '@denipetrov/spirit-link/logging';

import { UpstreamProvider } from '../../common/health/upstream-provider.js';
import { RaiderIoBudget } from '../../common/quota/budgets.js';
import { budgetErrorOf } from '../../common/quota/request-budget.js';
import type { Env } from '../../config/env.schema.js';
import { RaiderIoApiError, RaiderIoEmptyResponseError } from './raiderio-api.error.js';

function isEmptyBody(payload: unknown): boolean {
  return payload === '' || payload === null || payload === undefined;
}

/** Requests actually spent on a failure — got counts retries from zero. */
function attemptsSpent(error: unknown): number {
  return error instanceof RequestError ? (error.request?.retryCount ?? 0) + 1 : 1;
}

export interface RaiderIoGetOptions {
  /** Query parameters. The access key is added by the client, never here. */
  searchParams?: Record<string, string | number>;
  /** The region the call is about, for per-region health. */
  region?: string;
}

/**
 * Single got instance shared by every Raider.io call: the access key, retries
 * with backoff, and this service's own per-minute budget.
 *
 * Mirrors Rankwarden's `RaiderIoHttpService`. The access key travels as a
 * query parameter, so it is added in `beforeRequest` — the url this class
 * builds, logs and reports never contains it — and stripped from anything got
 * quotes back. The budget lives in Redis and is shared by every replica.
 */
@Injectable()
export class RaiderIoHttpService {
  private readonly logger = new RunLogger(RaiderIoHttpService.name);
  private readonly client: Got;
  private readonly baseUrl: string;
  private readonly accessKey: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly health: DependencyHealth<UpstreamProvider>,
    private readonly budget: RaiderIoBudget,
  ) {
    this.baseUrl = config.get('RAIDERIO_API_BASE_URL', { infer: true });
    this.accessKey = config.get('RAIDER_IO_API_KEY', { infer: true });

    this.client = got.extend({
      timeout: { request: config.get('RAIDERIO_REQUEST_TIMEOUT_MS', { infer: true }) },
      retry: {
        limit: config.get('RAIDERIO_RETRY_LIMIT', { infer: true }),
        methods: ['GET'],
        // 400 is absent on purpose: Raider.io answers 400 for a character it
        // does not know, and asking again will not change that.
        statusCodes: [408, 429, 500, 502, 503, 504],
        maxRetryAfter: config.get('RAIDERIO_REQUEST_TIMEOUT_MS', { infer: true }),
      },
      headers: { accept: 'application/json' },
      hooks: {
        beforeRequest: [
          async (options) => {
            // Per attempt, retries included: a retry is a real request against
            // the per-minute ceiling.
            await this.budget.acquire();

            // Added at the last possible moment so the key is in no url this
            // class built, logged or handed to an error.
            options.url?.searchParams.set('access_key', this.accessKey);
          },
        ],
        beforeRetry: [
          (error, retryCount) => {
            this.logger.warn(
              `Retry ${retryCount} for ${this.safe(error.options?.url?.toString())}: ` +
                this.safe(error.message),
            );
          },
        ],
      },
    });
  }

  /**
   * GETs an API path (no leading slash) and returns raw JSON. Callers are
   * expected to validate the payload with a zod schema.
   */
  async get(path: string, options: RaiderIoGetOptions = {}): Promise<unknown> {
    const url = `${this.baseUrl}/${path.replace(/^\//, '')}`;
    const region = options.region ?? 'global';
    const startedAt = Date.now();

    try {
      const payload = await this.client
        .get(url, { searchParams: { ...options.searchParams } })
        .json<unknown>();

      if (isEmptyBody(payload)) throw new RaiderIoEmptyResponseError(url);

      this.health.recordSuccess(UpstreamProvider.RaiderIo, region, Date.now() - startedAt);

      return payload;
    } catch (error) {
      const budgetError = budgetErrorOf(error);
      if (budgetError) throw budgetError;

      const attempts = attemptsSpent(error);

      if (error instanceof HTTPError) {
        const status = error.response.statusCode;

        // 400 and 404 are Raider.io answering — "no such character" — not
        // Raider.io failing.
        if (status === 400 || status === 404) {
          this.health.recordSuccess(UpstreamProvider.RaiderIo, region, Date.now() - startedAt);
        } else {
          this.health.recordFailure(
            UpstreamProvider.RaiderIo,
            region,
            `HTTP ${status} for ${url}`,
            status,
          );
        }

        throw new RaiderIoApiError(
          status,
          url,
          `Raider.io API ${status} for ${url} after ${attempts} ` +
            `${attempts === 1 ? 'attempt' : 'attempts'}: ${this.safe(error.message)}`,
          { cause: error, attempts },
        );
      }

      const reason = this.safe(error instanceof Error ? error.message : String(error));
      this.health.recordFailure(UpstreamProvider.RaiderIo, region, `${reason} for ${url}`);

      if (error instanceof Error) {
        error.message =
          `${this.safe(error.message)} ` +
          `(${attempts} ${attempts === 1 ? 'attempt' : 'attempts'} for ${url})`;
      }

      throw error;
    }
  }

  /** Strips the access key from anything got built rather than this class. */
  private safe(value: string | undefined): string {
    if (!value) return 'unknown url';

    return this.health.redact(value).replace(/([?&]access_key=)[^&\s#]*/g, '$1[redacted]');
  }
}
