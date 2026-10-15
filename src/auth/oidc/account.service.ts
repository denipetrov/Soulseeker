import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Account } from 'oidc-provider';

import { AccountKind } from '../auth.constants.js';

/**
 * Who a token belongs to.
 *
 * Today only anonymous visitors: an `anon:<uuid>` account exists for as long
 * as a grant names it, and is stored nowhere else — the grant is the session.
 * A Battle.net login adds `bnet:<id>` accounts here, and nothing about how the
 * API checks a token changes.
 */
@Injectable()
export class AccountService {
  createAnonymous(): string {
    return `${AccountKind.Anonymous}:${randomUUID()}`;
  }

  /** oidc-provider's `findAccount`: an account object, or undefined for an unknown id. */
  async find(accountId: string): Promise<Account | undefined> {
    const [kind] = accountId.split(':', 1);

    if (kind !== AccountKind.Anonymous) return undefined;

    return { accountId, claims: () => ({ sub: accountId }) };
  }
}
