import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'soulseeker:public';

/**
 * Exempts a route or controller from the access token and the API rate limit.
 * For health probes only: anything a front end reads goes through both.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
