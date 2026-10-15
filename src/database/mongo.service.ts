import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongoClient, type Collection, type Db, type Document } from 'mongodb';

import type { Env } from '../config/env.schema.js';
import type { ReadCollection } from './collections.js';

export interface PingResult {
  ok: boolean;
  latencyMs: number;
  /** Raw driver message; redact before it reaches a response. */
  error: string | null;
}

/** How long one ping answers for. Long enough to absorb a probe storm. */
const PING_CACHE_MS = 3_000;

/**
 * Owns the MongoClient lifecycle and hands out typed collections of
 * Rankwarden's database.
 *
 * Read-only by contract: Soulseeker connects as `rankwarden_backend`, which
 * the database itself refuses any write, and corrections go through
 * Rankwarden's sync endpoints instead. Collections are therefore named only
 * through `ReadCollection`, and there is no schema step — the structure
 * belongs to Rankwarden's deploy.
 */
@Injectable()
export class MongoService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MongoService.name);
  private readonly client: MongoClient;
  private readonly dbName: string;
  private cachedPing: { at: number; result: PingResult } | null = null;

  constructor(config: ConfigService<Env, true>) {
    this.client = new MongoClient(config.get('MONGODB_URI', { infer: true }), {
      socketTimeoutMS: config.get('MONGODB_SOCKET_TIMEOUT_MS', { infer: true }),
      // A read is always safe to retry; a user-facing one should not hang on
      // a primary election when a secondary could answer.
      readPreference: 'primaryPreferred',
      appName: 'soulseeker',
    });
    this.dbName = config.get('MONGODB_DB', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    this.logger.log(`Connected to MongoDB database "${this.dbName}"`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
    this.logger.log('MongoDB connection closed');
  }

  private get db(): Db {
    return this.client.db(this.dbName);
  }

  collection<T extends Document>(name: ReadCollection): Collection<T> {
    return this.db.collection<T>(name);
  }

  /**
   * Round-trips a `ping` to the server, with the result cached briefly.
   *
   * The readiness endpoint is unauthenticated, so without the cache a burst of
   * probes turns into a burst of commands against the primary.
   */
  async ping(): Promise<PingResult> {
    const now = Date.now();

    if (this.cachedPing && now - this.cachedPing.at < PING_CACHE_MS) {
      return this.cachedPing.result;
    }

    const startedAt = Date.now();
    let result: PingResult;

    try {
      await this.db.command({ ping: 1 });
      result = { ok: true, latencyMs: Date.now() - startedAt, error: null };
    } catch (error) {
      result = {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    this.cachedPing = { at: now, result };

    return result;
  }
}
