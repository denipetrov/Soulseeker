/** A name compared across Blizzard and Raider.io: no case, accents, spaces or punctuation. */
export const nameKey = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * The same, short: without a leading "The" and anything after a comma. The two
 * sites disagree on exactly those: Blizzard's "Sikran, Captain of the Sureki"
 * and "The One-Armed Bandit" are Raider.io's "Sikran" and "One-Armed Bandit".
 */
export const shortNameKey = (name: string) => nameKey(name.split(',')[0]!.replace(/^the\s+/i, ''));
