import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import got, { HTTPError, type Got } from 'got';
import { DependencyHealth } from '@denipetrov/spirit-link/health';
import { RunLogger } from '@denipetrov/spirit-link/logging';
import type { ZodType } from 'zod';

import { UpstreamProvider } from '../common/health/upstream-provider.js';
import { describeError } from '../common/utils/errors.js';
import type { Env } from '../config/env.schema.js';
import { characterSyncSchema, type CharacterSyncInput } from './dto/character-sync.dto.js';
import {
  mplusCharacterSyncSchema,
  type MplusCharacterSyncInput,
} from './dto/mplus-character-sync.dto.js';

/**
 * What became of one push, as Rankwarden's sync endpoints define it:
 *
 * - `written`     200 — stored; `result` is Rankwarden's own summary.
 * - `invalid`     400 — the payload is wrong. Retrying it unchanged is pointless.
 * - `not-tracked` 404 — Rankwarden never creates characters; this one is not on
 *                 its ladders, so there is nothing to correct.
 * - `busy`        409 on every attempt — the job owning the documents kept running.
 * - `failed`      anything else: unreachable, timed out, 5xx.
 */
export type SyncOutcome =
  | { status: 'written'; result: unknown }
  | { status: 'invalid' | 'not-tracked' | 'busy' | 'failed'; reason: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Health is observed per endpoint, since PvP and M+ have different owners. */
const Endpoint = {
  Pvp: 'characters/sync',
  Mplus: 'mplus/characters/sync',
} as const;
type Endpoint = (typeof Endpoint)[keyof typeof Endpoint];

/** Overrides for one push. */
export interface PushOptions {
  /**
   * Retries of a 409, in place of `RANKWARDEN_SYNC_RETRY_LIMIT`. 0 for a push
   * a person is waiting on: a busy answer then comes back at once, and the
   * caller can retry in the background.
   */
  retries?: number;
  /** In place of `RANKWARDEN_TIMEOUT_MS`, for the same reason. */
  timeoutMs?: number;
}

/**
 * Pushes fresh character data to Rankwarden between its own passes.
 *
 * Never throws: every outcome is a value, because a failed push only means the
 * ladders catch up on Rankwarden's next pass. Call it after the response to the
 * front end has been sent — a 409 is retried with backoff for up to
 * `base × (2^limit − 1)` ms, which is far longer than a person should wait.
 *
 * Rankwarden has no authentication of its own: its NetworkPolicy admits the
 * `backend` namespace, which is where this service runs.
 */
@Injectable()
export class RankwardenSyncClient {
  private readonly logger = new RunLogger(RankwardenSyncClient.name);
  private readonly client: Got;
  private readonly retryLimit: number;
  private readonly retryBaseMs: number;

  constructor(
    config: ConfigService<Env, true>,
    private readonly health: DependencyHealth<UpstreamProvider>,
  ) {
    this.retryLimit = config.get('RANKWARDEN_SYNC_RETRY_LIMIT', { infer: true });
    this.retryBaseMs = config.get('RANKWARDEN_SYNC_RETRY_BASE_MS', { infer: true });

    this.client = got.extend({
      prefixUrl: config.get('RANKWARDEN_BASE_URL', { infer: true }),
      timeout: { request: config.get('RANKWARDEN_TIMEOUT_MS', { infer: true }) },
      // Retries are this class's own: got's would retry a 409 without the
      // backoff Rankwarden asks for, and would not retry a POST at all.
      retry: { limit: 0 },
      headers: { accept: 'application/json' },
    });
  }

  pushPvpCharacter(input: CharacterSyncInput, options: PushOptions = {}): Promise<SyncOutcome> {
    return this.push(Endpoint.Pvp, characterSyncSchema, input, options);
  }

  pushMplusCharacter(
    input: MplusCharacterSyncInput,
    options: PushOptions = {},
  ): Promise<SyncOutcome> {
    return this.push(Endpoint.Mplus, mplusCharacterSyncSchema, input, options);
  }

  private async push<T>(
    endpoint: Endpoint,
    schema: ZodType<T>,
    input: T,
    options: PushOptions,
  ): Promise<SyncOutcome> {
    const retryLimit = options.retries ?? this.retryLimit;
    const timeout =
      options.timeoutMs === undefined ? {} : { timeout: { request: options.timeoutMs } };

    const parsed = schema.safeParse(input);

    if (!parsed.success) {
      const reason = `payload refused before sending: ${describeError(parsed.error)}`;
      this.logger.warn(`Sync ${endpoint}: ${reason}`);

      return { status: 'invalid', reason };
    }

    for (let attempt = 0; ; attempt += 1) {
      const startedAt = Date.now();

      try {
        const result = await this.client
          .post(endpoint, { json: parsed.data, ...timeout })
          .json<unknown>();
        this.health.recordSuccess(UpstreamProvider.Rankwarden, endpoint, Date.now() - startedAt);

        return { status: 'written', result };
      } catch (error) {
        if (!(error instanceof HTTPError)) {
          const reason = describeError(error);
          this.health.recordFailure(UpstreamProvider.Rankwarden, endpoint, reason);
          this.logger.warn(`Sync ${endpoint} failed: ${reason}`);

          return { status: 'failed', reason };
        }

        const status = error.response.statusCode;
        const reason = `HTTP ${status}: ${String(error.response.body).slice(0, 500)}`;

        // 400, 404 and 409 are Rankwarden answering as designed.
        if (status === 400 || status === 404 || status === 409) {
          this.health.recordSuccess(UpstreamProvider.Rankwarden, endpoint, Date.now() - startedAt);
        } else {
          this.health.recordFailure(UpstreamProvider.Rankwarden, endpoint, reason, status);
        }

        if (status === 400) {
          // The mirrors of Rankwarden's schemas have drifted from the real ones.
          this.logger.error(`Sync ${endpoint} refused as invalid: ${reason}`);
          return { status: 'invalid', reason };
        }

        if (status === 404) return { status: 'not-tracked', reason };

        if (status === 409) {
          if (attempt >= retryLimit) {
            this.logger.warn(`Sync ${endpoint} still busy after ${attempt + 1} attempts`);
            return { status: 'busy', reason };
          }

          await sleep(this.retryBaseMs * 2 ** attempt);
          continue;
        }

        this.logger.warn(`Sync ${endpoint} failed: ${reason}`);
        return { status: 'failed', reason };
      }
    }
  }
}
