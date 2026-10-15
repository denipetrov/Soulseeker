import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import got, { HTTPError, RequestError, type Got } from 'got';
import { DependencyHealth } from '@denipetrov/spirit-link/health';
import { RunLogger } from '@denipetrov/spirit-link/logging';

import { UpstreamProvider } from '../../common/health/upstream-provider.js';
import { BlizzardBudget } from '../../common/quota/budgets.js';
import { budgetErrorOf } from '../../common/quota/request-budget.js';
import type { Env } from '../../config/env.schema.js';
import { apiHost, namespaceFor, type NamespaceKind, type Region } from '../blizzard.constants.js';
import { BLIZZARD_TOKEN_PROVIDER, type BlizzardTokenProvider } from '../auth/token-provider.js';
import { BlizzardApiError, BlizzardEmptyResponseError } from './blizzard-api.error.js';

/**
 * Whether a parsed body carries nothing at all. `got` resolves an empty body
 * to `''` rather than raising, and a gateway shedding load answers exactly so.
 */
function isEmptyBody(payload: unknown): boolean {
  return payload === '' || payload === null || payload === undefined;
}

/** Requests actually spent on a failure — got counts retries from zero. */
function attemptsSpent(error: unknown): number {
  return error instanceof RequestError ? (error.request?.retryCount ?? 0) + 1 : 1;
}

export interface BlizzardGetOptions {
  /** Extra query parameters merged after namespace/locale. */
  searchParams?: Record<string, string | number>;
  /** Defaults to `profile`: Soulseeker reads characters, not ladders. */
  namespace?: NamespaceKind;
}

/**
 * Single got instance shared by every Blizzard call: bearer auth, retries with
 * backoff, the namespace/locale pair, and this service's own budget.
 *
 * Mirrors Rankwarden's `BlizzardHttpService`. The difference is the budget: it
 * lives in Redis, is shared by every replica, and is acquired before each
 * attempt rather than recorded after, because a BFF must not overspend by the
 * number of replicas. A spent budget surfaces as `BudgetExhaustedError`, never
 * as an upstream failure — Blizzard did nothing wrong.
 */
@Injectable()
export class BlizzardHttpService {
  private readonly logger = new RunLogger(BlizzardHttpService.name);
  private readonly client: Got;
  private readonly locale: string;
  private readonly hostTemplate: string;

  constructor(
    config: ConfigService<Env, true>,
    @Inject(BLIZZARD_TOKEN_PROVIDER) private readonly tokens: BlizzardTokenProvider,
    private readonly health: DependencyHealth<UpstreamProvider>,
    private readonly budget: BlizzardBudget,
  ) {
    this.locale = config.get('BLIZZARD_LOCALE', { infer: true });
    this.hostTemplate = config.get('BLIZZARD_API_HOST_TEMPLATE', { infer: true });

    this.client = got.extend({
      timeout: { request: config.get('BLIZZARD_REQUEST_TIMEOUT_MS', { infer: true }) },
      retry: {
        limit: config.get('BLIZZARD_RETRY_LIMIT', { infer: true }),
        methods: ['GET'],
        statusCodes: [408, 429, 500, 502, 503, 504],
      },
      headers: { accept: 'application/json' },
      hooks: {
        beforeRequest: [
          async (options) => {
            // Per attempt: this hook runs again for every retry, and Blizzard
            // counts retries against the quota exactly like first attempts.
            await this.budget.acquire();

            const token = await this.tokens.getAccessToken();
            options.headers.authorization = `Bearer ${token}`;
          },
        ],
        beforeRetry: [
          (error, retryCount) => {
            this.logger.warn(
              `Retry ${retryCount} for ${error.options?.url?.toString() ?? 'unknown url'}: ${error.message}`,
            );
          },
        ],
      },
    });
  }

  /**
   * GETs an API path (no leading slash) for a region and returns raw JSON.
   * Callers are expected to validate the payload with a zod schema.
   */
  async get(region: Region, path: string, options: BlizzardGetOptions = {}): Promise<unknown> {
    const url = `${apiHost(region, this.hostTemplate)}/${path.replace(/^\//, '')}`;
    const startedAt = Date.now();

    try {
      const payload = await this.client
        .get(url, {
          searchParams: {
            namespace: namespaceFor(options.namespace ?? 'profile', region),
            locale: this.locale,
            ...options.searchParams,
          },
        })
        .json<unknown>();

      if (isEmptyBody(payload)) throw new BlizzardEmptyResponseError(url);

      this.health.recordSuccess(UpstreamProvider.Blizzard, region, Date.now() - startedAt);

      return payload;
    } catch (error) {
      const budgetError = budgetErrorOf(error);
      if (budgetError) throw budgetError;

      const attempts = attemptsSpent(error);

      if (error instanceof HTTPError) {
        const status = error.response.statusCode;

        // A 404 is Blizzard answering: the character was renamed, moved or
        // deleted. Recording it as a failure would report an outage every
        // time someone searched for a name that does not exist.
        if (status === 404) {
          this.health.recordSuccess(UpstreamProvider.Blizzard, region, Date.now() - startedAt);
        } else {
          this.health.recordFailure(
            UpstreamProvider.Blizzard,
            region,
            `HTTP ${status} for ${url}`,
            status,
          );
        }

        throw new BlizzardApiError(
          status,
          url,
          `Blizzard API ${status} for ${url} after ${attempts} ` +
            `${attempts === 1 ? 'attempt' : 'attempts'}: ${error.message}`,
          { cause: error, attempts },
        );
      }

      const reason = error instanceof Error ? error.message : String(error);
      this.health.recordFailure(UpstreamProvider.Blizzard, region, `${reason} for ${url}`);

      if (error instanceof Error) {
        error.message = `${error.message} (${attempts} ${attempts === 1 ? 'attempt' : 'attempts'} for ${url})`;
      }

      throw error;
    }
  }
}
