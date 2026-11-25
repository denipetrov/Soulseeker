import type { HiddenSet } from './hidden-list.service.js';

/**
 * How a hidden player appears in a group they played in — a run's five, a
 * boss kill's twenty — that is shown whole: their slot, class, spec, role and
 * gear stay, who they are goes. The same shape Raider.io gives the players it
 * anonymises itself, so the front end handles both alike.
 */
export const ANONYMOUS_NAME = 'Anonymous';
export const ANONYMOUS_REALM_SLUG = 'anonymous';

/** A run member as Rankwarden stores it (`mplus_runs.roster[]`). */
interface StoredMember {
  rioCharacterId: number;
  characterName: string;
  realmSlug: string;
  realmId: number | null;
  region: string;
  anonymized: boolean;
}

/** A stored run's roster, hidden players anonymised. Untouched when none are. */
export function anonymizeStoredRoster<M extends StoredMember>(roster: M[], hidden: HiddenSet): M[] {
  return roster.map((member) =>
    hidden.isCharacterHidden(member.region, member.realmSlug, member.characterName)
      ? {
          ...member,
          rioCharacterId: 0,
          characterName: ANONYMOUS_NAME,
          realmSlug: ANONYMOUS_REALM_SLUG,
          realmId: null,
          anonymized: true,
        }
      : member,
  );
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `realm.slug` or `region.slug` from Raider.io's nested objects, or a plain string. */
const slugOf = (value: unknown): string | null =>
  typeof value === 'string'
    ? value
    : isObject(value) && typeof value.slug === 'string'
      ? value.slug
      : null;

/**
 * A roster from Raider.io as it comes (`mythic-plus/run-details`,
 * `guilds/boss-kill`): `[{ character: { name, realm, region, … }, guild, ranks,
 * … }]`. A hidden player keeps class, spec, race, faction, level, talents,
 * role and items; their name, ids, realm, profile path, guild, ranks and
 * former character go. `region` is the fallback when a character carries none.
 */
export function anonymizeRaiderIoRoster(
  roster: unknown[],
  hidden: HiddenSet,
  region?: string,
): unknown[] {
  if (hidden.characters.size === 0) return roster;

  return roster.map((entry) => {
    if (!isObject(entry) || !isObject(entry.character)) return entry;
    const character = entry.character;
    const isHidden = hidden.isCharacterHidden(
      slugOf(character.region) ?? region,
      slugOf(character.realm),
      typeof character.name === 'string' ? character.name : null,
    );
    if (!isHidden) return entry;

    const kept = { ...entry };
    delete kept.guild;
    delete kept.ranks;
    delete kept.oldCharacter;
    return {
      ...kept,
      guild: null,
      character: {
        id: 0,
        name: ANONYMOUS_NAME,
        class: character.class,
        race: character.race,
        faction: character.faction,
        level: character.level,
        spec: character.spec,
        talentLoadout: character.talentLoadout,
        realm: { slug: ANONYMOUS_REALM_SLUG, name: ANONYMOUS_NAME },
        region: character.region,
        path: null,
        anonymized: true,
      },
    };
  });
}

/**
 * Blizzard's realm slug from a realm's name: `Tarren Mill` → `tarren-mill`,
 * `Mal'Ganis` → `malganis`, `Azjol-Nerub` → `azjolnerub`, `Aggra (Português)` →
 * `aggra-portugues`.
 */
export function realmSlugOf(realmName: string): string {
  return realmName
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Whether a Raider.io guild member (`{ rank, character: { name, realm,
 * region?, profile_url? } }`) is hidden. `realm` there is the display name, so
 * the slug is read from `profile_url` (`…/characters/<region>/<realm>/<name>`)
 * when it is there, else made from the name.
 */
export function isHiddenMember(member: unknown, hidden: HiddenSet, region: string): boolean {
  if (hidden.characters.size === 0 || !isObject(member) || !isObject(member.character))
    return false;
  const character = member.character;
  const name = typeof character.name === 'string' ? character.name : null;

  const fromUrl =
    typeof character.profile_url === 'string'
      ? /\/characters\/([^/]+)\/([^/]+)\//.exec(character.profile_url)
      : null;
  const realmSlug =
    fromUrl?.[2] ??
    (typeof character.realm === 'string' ? realmSlugOf(character.realm) : slugOf(character.realm));

  return hidden.isCharacterHidden(
    fromUrl?.[1] ?? (typeof character.region === 'string' ? character.region : region),
    realmSlug,
    name,
  );
}
