import { Injectable } from '@nestjs/common';
import { RunLogger } from '@denipetrov/spirit-link/logging';

import { describeError } from '../common/utils/errors.js';
import { RedisService } from './redis.service.js';

/**
 * Whether a forced refresh of one thing may go upstream now: once per cooldown,
 * across replicas, through a `SET NX EX` under `<prefix>refresh:`.
 */
@Injectable()
export class RefreshCooldown {
  private readonly logger = new RunLogger(RefreshCooldown.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * True for the first claim of `key` in `seconds`, false for every other.
   * Fails closed: without Redis no budget could be charged for the refresh anyway.
   */
  async claim(key: string, seconds: number): Promise<boolean> {
    try {
      const claimed = await this.redis.client.set(this.redis.key('refresh', key), '1', {
        condition: 'NX',
        expiration: { type: 'EX', value: seconds },
      });

      return claimed === 'OK';
    } catch (error) {
      this.logger.warn(`Refresh cooldown unavailable: ${describeError(error)}`);
      return false;
    }
  }
}
