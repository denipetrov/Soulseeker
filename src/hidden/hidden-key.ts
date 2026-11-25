/**
 * A player on the hidden list, as Rankwarden keys it (`mplusCharacterKey`
 * there): `region/realmslug/name`, the realm lowercased and the name
 * NFC-normalised and lowercased, so any casing or Unicode composition of the
 * name matches.
 */
export function hiddenCharacterKey(region: string, realmSlug: string, name: string): string {
  return `${region}/${realmSlug.toLowerCase()}/${name.normalize('NFC').toLowerCase()}`;
}

/** A hidden player's key, split back into its parts. */
export interface HiddenCharacter {
  key: string;
  region: string;
  realmSlug: string;
  /** Lowercased, as in the key. */
  name: string;
}

export function parseHiddenCharacterKey(key: string): HiddenCharacter | null {
  const [region, realmSlug, ...rest] = key.split('/');
  const name = rest.join('/');

  return region && realmSlug && name ? { key, region, realmSlug, name } : null;
}
