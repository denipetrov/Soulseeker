# Soulseeker — capabilities reference

Backend-for-frontend for the Rankwarden data. It reads Rankwarden's MongoDB, fetches
specific players on demand from Blizzard and Raider.io, caches in Redis, pushes
corrections back to Rankwarden, and protects its API with OAuth 2.0 tokens it issues
itself.

This document is written for agents that need to test or extend the service. It wins
over [README.md](README.md) where the two differ in detail. The data model and its
traps are Rankwarden's: read its handbook and `SKILLS.md` §5 and §9 before writing a
query.

---

## Scope

**In scope:**

- Serving the front end: everything it reads goes through this service.
- On-demand lookups of single characters from Blizzard and Raider.io, within
  **Soulseeker's own** request budgets.
- Pushing fresher character data to Rankwarden's sync endpoints.
- Issuing and checking access tokens: the authorization server and the API guards.
- Its own deployment: Dockerfile, Helm charts for itself and its Redis, scripts, CI.

**Out of scope:**

- **Writing MongoDB.** Never. The database user cannot, and corrections go through
  Rankwarden's sync endpoints.
- **Bulk ingestion.** Ladders, archives and passes are Rankwarden's jobs. Soulseeker
  looks up one character at a time, because a person asked for it.
- **The database structure.** Collections and indexes belong to Rankwarden's schema
  step. A query that needs a new index is a change in Rankwarden.
- **Shared logging and health logic**, which is in `@denipetrov/spirit-link`, and
  **Blizzard OAuth** for the upstream, which is in `@denipetrov/blizz-auth`.

---

## Agent directives

- **Do not commit, push or merge** unless asked.
- **Never write a credential anywhere it persists**: not in `.npmrc`, not in a committed
  file, not in `production.env` (the chart refuses to render one), not in a log or health
  payload. Tokens go through environment variables or BuildKit secrets.
- **Never use Rankwarden's Blizzard client or Raider.io key.** Soulseeker has its own, so
  the two services never compete for one quota.
- **Tests touch only `soulseeker_test_*` databases and `sstest_*` Redis keys.** The
  harness refuses anything else.
- **No write to MongoDB, ever.** `MongoService.collection()` takes only names from
  `src/database/collections.ts`, and that file lists only collections a reader uses.
- **Keep the sync DTO mirrors in step** with Rankwarden's
  (`src/rankwarden/dto/*.dto.ts` ↔ Rankwarden's `src/sync/dto/`). A 400 from Rankwarden
  is logged at `error` because it means they drifted.
- **Every route needs a token** unless it is a health probe (`@Public()`).

---

## 1. Stack

Same as Rankwarden, on purpose: Node 24 (engines ≥ 22), TypeScript 6 strict ESM
(`nodenext`, `.js` import suffixes), NestJS 12 on Express, native `mongodb` 7, `got` 16,
`zod` 4, Vitest 4 with SWC, ESLint 10 flat config, Prettier. Added: `redis` (node-redis
6), `oidc-provider` 9 (certified OpenID Connect server, Koa inside), `jose` 6, `helmet`.

`@denipetrov/spirit-link` 0.1: `logLevelsFor`, `withRunId`, `RunLogger`,
`DependencyHealth`, `probeObservation`, `worstOf`, `hostOf`.

## 2. Module map

| Module | Provides |
| --- | --- |
| `AppConfigModule` | `ConfigService<Env, true>`; one zod schema, `src/config/env.schema.ts` |
| `DatabaseModule` (global) | `MongoService`: typed read collections, cached `ping()` |
| `RedisModule` (global) | `RedisService` (client, `key()`, `ping()`), `CacheService` |
| `CommonModule` (global) | `DependencyHealth`, `BlizzardBudget`, `RaiderIoBudget` |
| `AuthModule` | the OIDC provider, `SessionController`, global `AccessTokenGuard` then `RateLimitGuard` |
| `BlizzardModule` | `ProfileApi` (profile, specializations, pvp bracket) |
| `RaiderIoModule` | `RaiderIoCharacterApi` |
| `RankwardenModule` | `RankwardenSyncClient` |
| `CharactersModule` | imports the three above; feature controllers and services go here |
| `HealthModule` | `/health`, `/health/ready` |

`configureApp()` (`src/configure-app.ts`) is shared by `main.ts` and the test harness.
It sets up the middleware in this order: trust proxy, request logging, response
compression, helmet, **the OIDC provider at `/oidc`**, then CORS for the API. The provider
must be mounted before Nest registers its body parsers in `init()`, because oidc-provider
parses its own form bodies. It also answers its own CORS, which is why the API's CORS
layer comes after it.

**Response compression** (`compression` middleware, in the same file):

- Brotli for clients that accept it, gzip for the rest, chosen by `Accept-Encoding`; the
  response carries `Vary: Accept-Encoding`. Brotli runs at quality 4, the library's default.
- Measured on real answers: an 850 KB boss kill becomes 68 KB (brotli, ~3 ms) or 128 KB
  (gzip, ~8 ms); a 356 KB guild roster becomes 22 KB.
- Answers under 1 KB are sent as they are.
- `/health*` (probes gain nothing) and `/oidc*` (small answers that carry tokens) are
  never compressed.
- Every endpoint gets it, the docs included. A CDN or gateway added later can pass the
  compressed answers through.

## 3. Upstream budgets

These are separate from Rankwarden's, and shared across replicas through Redis.

| Provider | Windows (usable = limit × utilisation) | Defaults |
| --- | --- | --- |
| Blizzard | rolling hour (60 buckets) **and** rolling second (10 buckets) | 32,400/h, 90/s |
| Raider.io | rolling minute (12 buckets) | 900/min |

- `RedisRollingWindow` checks every window and charges them all in one Lua script, so
  two replicas cannot both take the last slot.
- **Every attempt is charged, retries included**: `budget.acquire()` runs in got's
  `beforeRequest` hook, which runs again for each retry.
- A spent window shorter than `BUDGET_WAIT_MS` (the per-second one) is waited out. A
  spent hour or minute throws `BudgetExhaustedError` at once, and the caller should
  serve stored data. `budgetErrorOf()` unwraps it from got's `RequestError`.
- Budgets **fail closed**: if Redis is down, no upstream request is sent. Rate limits
  **fail open**: if Redis is down, the request is let through and a warning is logged.
- A 404 from Blizzard, or a 400/404 from Raider.io, means "no such character". It
  resolves to `null` and is recorded as a *successful* upstream call.

## 4. Auth

- **Authorization server.** oidc-provider at `/oidc`. `OIDC_ISSUER` must end in `/oidc`.
  There is one public client, `soulseeker-web`, with `token_endpoint_auth_method: none`
  and grants `urn:soulseeker:grant-type:anonymous` and `refresh_token`.
- **Anonymous grant** (`src/auth/oidc/anonymous.grant.ts`):
  - It runs `IssuancePolicy.check` first: the Origin must be in `CORS_ORIGINS` (403
    otherwise), at most `RATE_LIMIT_TOKEN_PER_MINUTE` per IP (429 with Retry-After), and
    Turnstile when `TURNSTILE_ENABLED` (`turnstile_token` form parameter).
  - It then creates account `anon:<uuid>`, a Grant scoped to `OIDC_API_RESOURCE` /
    `api:read`, an access token and a refresh token.
  - The checks live in the grant, not in middleware, because the grant type is in a body
    only oidc-provider may parse.
- **Tokens:**
  - Access token: ES256 JWT, `typ: at+jwt`, `aud` = the API resource, 600 s.
  - Refresh token: opaque, 12 h, rotated on every use. Reuse revokes the grant.
  - The Grant lives at most `OIDC_SESSION_MAX_SECONDS` (30 days). After that the visitor
    gets a new anonymous session.
- **Storage.** `oidc-redis.adapter.ts` keeps everything under `<prefix>oidc:*`, with the
  provider's TTLs, and a per-grant index of keys so a revocation removes them all.
- **API guard.** `AccessTokenGuard` verifies locally with `jose` against the public JWKS
  (issuer, audience, `ES256`, `at+jwt`, scope `api:read`) and sets `req.auth`. It makes
  no network or Redis call. The trade-off is that a revoked session's access token works
  until it expires, at most 10 minutes.
- **Keys.** `OIDC_JWKS` holds the private JWK set (required in production). Without it,
  development generates a key per process. To rotate without logging anyone out, put
  the new key first and keep the old one until the longest refresh token has expired.
- **Battle.net login (later).**
  1. Add `authorization_code` (PKCE is already required) to the client, with
     `redirect_uris` and `response_types: ['code']`.
  2. Add an interaction that redirects to Battle.net OAuth and maps the user to
     `bnet:<id>` in `AccountService.find`.
  3. Leave the guard alone. If an anonymous session should carry over to the account,
     do it in the interaction.
- **What it does not do.** A public client cannot keep a secret, so anonymous tokens
  slow scraping and make it traceable per session; they do not prevent it. The
  per-IP and per-session limits and Turnstile are what set the cost.

## 5. MongoDB (read-only)

- Rankwarden's database, as `rankwarden_backend`. `readPreference: primaryPreferred`.
- Entities in `src/characters/entities/` mirror Rankwarden's document shapes.
- Reader rules from the Rankwarden handbook that bite:
  - Filter every query on season and region.
  - `ratings.<bracket>` queries need `{ $gt: 0 }`. Prefer the flat `*_ratings`
    collections for boards.
  - Paginate with a rating cursor, never `skip`.
  - Per-ladder hero talents come from `profile.talentLoadouts`.
  - PvP ↔ M+ characters join on region + realmSlug + lowercased name, never on an id.
  - Skip `mplus_runs` that carry `missedSince`.
  - Compare `mythicScore` only between characters with the same `dungeonsCovered`.
  - `2030-01-01` is the placeholder "still running" end date.

## 6. Search suggestions

`GET /search/suggestions?type=pvp|pve&q=<letters>` (`src/search/`):

- **Input.** `type` is case-insensitive. `q` is folded with spirit-link's `searchNameOf`
  (from `@denipetrov/spirit-link/search`), the function Rankwarden stores `searchName`
  with, and must then be at least 2 characters. Use the shared function, never a local
  copy, or some names stop being found.
- **Query.** It is `{ searchName: { $regex: '^' + escapeRegex(prefix) } }`: anchored, with
  no `i` flag, so MongoDB answers it as an index range.
- **Index hint.** Each query is pinned with `hint` to `character_search`,
  `mplus_character_search` or `guild_search` (`Indexes` in `collections.ts`). Without
  it, the current-season `$or` next to it would draw the planner to the season indexes.
  On the local data a search reads 4 keys and takes 0 ms.
- **What is searched.**
  - PvP: `characters` of the current season per region (`season_state`, cached 60 s in
    memory).
  - PvE: `mplus_characters` of the current season per region (`mplus_season_state`),
    and `guilds`.
  - At most 100 per list, in `searchName` order.
- **Results.**
  - Mythic+ characters have no hero talents, so `heroTalents` is always null for them.
  - PvP characters Rankwarden has not enriched yet answer null for class, spec, race
    and realm name.
  - Faction is lowercased for both.
- **Cache.** Whole answers are cached in Redis per type and prefix for
  `SEARCH_CACHE_TTL_SECONDS` (60).

## 7. PvP seasons and title cutoffs

`PvpSeasonsService` (`src/pvp/seasons/`) is what the leaderboard endpoint reads for season
detail and the cutoff of the ladder it shows.

- **Methods.**
  - `season(region, id)`, `currentSeason(region)`, `seasons(region)` (newest first, no
    cutoffs).
  - `cutoff(region, id, bracket)`, by the ladder name: `3v3`, `rbg`, `shuffle-mage-fire`.
- **Where the data comes from.** Rankwarden's `season_state` (the live season, with its
  moving `rewards`) and `archive_seasons` (finished seasons, with final `rewards`). A
  season in both, because it ended and was archived but not yet replaced, is taken from
  the archive and still marked `current`.
- **Cache.**
  - One Redis entry per region and season, `pvp:season:<region>:<id>` (~15–23 KB), plus
    an index `pvp:seasons`.
  - All are written in one transaction with `PVP_SEASONS_CACHE_TTL_SECONDS` (3600), so
    they expire together.
  - A miss reads both collections whole (~64 documents, ~40 ms) and refills every
    entry. There is a single flight per replica.
  - The index tells "not cached" from "no such season", so unknown season ids never
    reach MongoDB.
- **Shape.**
  - `cutoffs['2v2' | '3v3' | 'rbg']`.
  - `specCutoffs.shuffle | blitz['<class>-<spec>']`, keyed by the ladder name without its
    family.
  - Each cutoff is `{ rating, title, achievementId, factions }`.
- **Traps in the data.**
  - **2v2 never has a cutoff**: it awards no title, so it is always null.
  - **Factions.** RBG and Blitz always list Alliance and Horde (different titles, so far
    the same rating), and `factions` holds both. Up to season 33, 3v3 and RBG cutoffs
    really differ per faction (US s28 3v3: 3071 / 2953). Then `rating` is null and the
    front end must show `factions`.
  - **Gaps.** Solo Shuffle has cutoffs from season 34, Blitz from season 38, and TW
    season 37 has no rewards at all. A missing ladder is null, or absent from
    `specCutoffs`.
  - **Live cutoffs move** until the season ends; `final: false` marks them.

### PvP leaderboard

`GET /pvp/leaderboard?region=&seasonId=&bracket=[&class=&spec=][&page=&pageSize=]`
(`src/pvp/leaderboard/`). The parameters:

- `bracket` is a family (`2v2`, `3v3`, `rbg`, `shuffle`, `blitz`) or one spec ladder by
  name (`shuffle-mage-fire`, the same as `bracket=shuffle&class=mage&spec=fire`).
- `class` and `spec` are slugs; `spec` needs `class`.
- `page` is 1-based; `pageSize` defaults to 50, at most 100, and no page may start past
  row 200,000.

How it reads each kind of season:

- **Current season** (`season.current`):
  - Rows come from the family's `*_ratings` collection, `rating` descending, through
    Rankwarden's `board_order`, `class_board` or `spec_board` index.
  - One batch read of `characters` (by season, region and `$in` ids) adds the name,
    realm, faction and `brackets[<row.bracket>]` (rank, played, won, lost). It also adds
    the profile: class, spec, gender, level, race, hero talents and `profileStatus`.
  - Hero talents come from the spec loadout on spec ladders, and from the active tree
    on 2v2, 3v3 and RBG.
- **Archived season**:
  - Rows come from `archive_entries`, which carry everything inline and have no
    profile fields; those keys are absent, not null.
  - One archived ladder at a time, through `archive_board`. 2v2, 3v3 and RBG take no
    class or spec (400 if given).
  - Shuffle and Blitz are archived per spec only, so they must name both `class` and
    `spec`, which picks that spec's ladder. A whole-family board or a class alone is 400.
    The front end never asks for either.

The response and its fields:

- **`inTitleRange`** is `rating >= cutoff` of the row's own ladder (`cutoffOf(season,
  row.bracket)`). Where the cutoffs differ by faction, the character's faction decides.
  With no cutoff (2v2, no rewards recorded) it is false. The board-level `cutoff` is
  null for 2v2 and for a board mixing several specs.
- **`rank`** is Blizzard's rank on the row's ladder. On a live all-specs Shuffle or Blitz
  board it is the rank within that spec, not the position. The front end orders by
  `rating` and numbers such a board itself.
- **Paging** uses skip and limit, which read only index keys: 100,000 deep costs ~40 ms
  on the largest board (Shuffle, ~120,000 rows). `total` is a `countDocuments` on the
  same filter, and `totalPages` comes with it.
- **Cache.** Whole pages are cached in Redis for `LEADERBOARD_CACHE_TTL_SECONDS` (60).
- **Enrichment gaps.** On 2v2, 3v3 and RBG, rows only have a class once Rankwarden has
  enriched the character. A class filter there leaves the others out, and today every
  EU 3v3 row is unenriched, so `class=` returns nothing for EU.

### PvP character

`GET /pvp/character?region=&realmSlug=&characterName=[&locale=en_US][&forceRefresh=true]`
(`src/pvp/character/`). One character, from Blizzard's Profile API.

- **Parameters.** Region, realm slug and name are all required. The name is NFC-normalised
  and lowercased, letters only, 2–12 of them. `locale` is one of `LOCALES`
  (`blizzard.constants.ts`) and defaults to `en_US`.
- **Blizzard calls.** A full page costs 8 + one per ladder (~14):
  - `core`, the same in every language, always read in `en_US`: character-media,
    pvp-summary, one pvp-bracket per ladder it lists, statistics, achievements and
    achievement statistics;
  - `localized`, per language: profile, specializations and equipment.
  - pvp-summary lists exactly the ladders played this season, per-spec Shuffle and Blitz
    included, so nothing is spent on ladders the character never played.
- **Cache.** The two parts are cached apart, `pvp:character:<region>:<realm>:<name>:core`
  and `…:locale:<locale>`, so a second language costs 3 requests.
  - A part is fresh for `PVP_CHARACTER_CACHE_TTL_SECONDS` (6 h), judged by its own
    `fetchedAt`. Redis keeps it `PVP_CHARACTER_STALE_SECONDS` (24 h) longer.
  - There is a single flight per part on each replica.
  - `forceRefresh` claims `refresh:pvp:character:<id>` (`RefreshCooldown`) with `SET NX EX`
    (`PVP_CHARACTER_REFRESH_COOLDOWN_SECONDS`, 300). While the claim is held, it is
    ignored and the cache answers. Without Redis it is refused.
- **Failures.**
  - A profile 404 is a 404. Any other part's 404 makes that part null.
  - Any other failure fails the load, so a page is never cached with a gap. The kept
    copy is then served with `stale: true` if both parts exist. Otherwise a spent budget
    is a 503 with `Retry-After: 60`, and anything else a 502.
- **Payload sizes.** Achievements (~2 MB) are cut down to the PvP history before caching.
  Specializations (~500 KB) keep only each spec's active loadout and PvP talents.
  Equipped items keep only `item`, `slot`, `name`, `media`, `level`, `quality`,
  `bonus_list`, `enchantments`, `sockets`, `set`, `transmog`, `limit_category` and
  `spells`: stats, armor, prices and requirements are dropped. Blizzard's API links
  (`_links`, `key.href`) are stripped everywhere. On a real character, `core` is ~45 KB
  and `localized` ~95 KB (equipment ~21 KB).
- **Embellishments** carry `limit_category` (`Unique-Equipped: Embellished (2)`) and their
  effect in `spells`. Other items carry a `limit_category` too, such as the Gladiator's
  Medallion. The text is in the requested language.
- **Statistics.** Avoidance and speed have no `value`, so their `rating_bonus` stands in.
  `versatility` is the rating behind `versatilityDamageDoneBonus`.
- **Ladders.**
  - `rounds` is Solo Shuffle's round record (`season_round_statistics`); `played` / `won` /
    `lost` are matches. It is null on every other ladder.
  - `rank` is read from Rankwarden's `characters.brackets.<ladder>.rank` on every answer
    and never cached, because ranks move hourly. It is one lookup by season, region and
    character id. It is null when Rankwarden does not track the character or ladder, or
    when the read fails.
- **Highest ratings** (`highestRatings`) are achievement statistics 370, 595 and 596 (2v2,
  3v3, 5v5 personal), matched by id. Blizzard has none for RBG, Shuffle or Blitz. A 0, or
  Blizzard's 2^32 − 2 "never set", becomes null.
- **PvP history** (`pvp-history.ts`) is parsed from English names, account-wide:
  - **Tiers.** `<Tier>[ I| II]: [<Expansion> ]Season <N>`, where the tier is Combatant,
    Challenger, Rival, Duelist, Elite, Gladiator, Legend, Strategist or Battle Mender.
    This covers Warlords to now and `Challenger: Season 14`.
  - **Rank 1.** Recognised by the achievement ids in Rankwarden's season rewards, which
    give the season and ladder. One id shared by several spec ladders stands for the
    family (`shuffle`). For seasons Rankwarden lacks, recognised by name: `<Prefix>
    Gladiator|Legend: …`, `Hero of the Alliance|Horde: <Prefix>`.
  - **`seasonId`.** For a tier, the Rankwarden season whose start is the latest before
    `completed_timestamp`; null before season 27.
  - **`earnedByThisCharacter`** is `criteria.is_completed`. Other entries were earned by
    another character on the account.
  - Look-alikes such as `Scholomance Challenger`, `Challenge Warlord: Gold` and
    `Cruel Elite` are ignored.
- **Sync.** Only when `core` was fetched fresh, and on the next tick after the response:
  - Every ladder from pvp-summary goes in `brackets`, without `rank`. Solo Shuffle sends
    its rounds as `played` / `won` / `lost`: that is what Blizzard's leaderboard, and so
    Rankwarden's sweep, counts.
  - The profile goes too, but only for `en_US`, so Rankwarden never stores translated
    names. Its fields are mapped as Rankwarden's enrichment maps them: `gender.type`,
    `realm.name`, `active_title.display_string`.
  - A character with no rating this season is not pushed.

### PvE character

`GET /pve/character?region=&realmSlug=&characterName=[&raidProgression=][&mplusSeasonScore=][&forceRefresh=true]`
(`src/pve/character/`). One character, from Raider.io's `characters/profile`, with per-boss
kills from Blizzard's `encounters/raids`.

- **Parameters.** Region (`cn` too), realm slug and name are required, with the same rules as
  PvP (`src/characters/dto/character-identity.ts`). There is no locale: Raider.io answers in
  English and the front end translates.
  - `raidProgression` must be a raid and `mplusSeasonScore` a season in the `PveCatalogue`.
    Otherwise the answer is a 400, and Raider.io is not asked.
- **What is asked for.** Each answer is one Raider.io request, for the fields of the parts it
  is missing:
  - **Whole page**, when neither parameter is given:
    - `gear`, `talents:categorized` and `guild`;
    - `raid_progression:current-expansion`, and `raid_achievement_curve:<…>` for the current
      expansion's raids from the catalogue;
    - `mythic_plus_scores_by_season:current:previous` (current first) and `mythic_plus_ranks`;
    - `mythic_plus_best_runs:all`, `mythic_plus_recent_runs`, `mythic_plus_highest_level_runs`,
      `mythic_plus_weekly_highest_level_runs` and
      `mythic_plus_previous_weekly_highest_level_runs`.
  - **`raidProgression=<slug>`**: `raid_progression:<slug>` and `raid_achievement_curve:<slug>`.
  - **`mplusSeasonScore=<slug>`**: `mythic_plus_scores_by_season:<slug>`.
  - Both parameters may be given together.
- **What is kept.**
  - **Base profile, in every answer:** name, race, class, active spec and role, gender,
    faction, realm (its display name), region, thumbnail, achievement points, profile banner,
    profile URL and `lastCrawledAt`.
  - **Gear:** `item_level_equipped`, and per slot `item_id`, `item_level`, `name`, `icon`,
    `item_quality`, `tier`, `bonuses`, `enchants_detail` and `gems_detail`.
  - **Talents:** the whole `talentLoadout` (~34 KB). **Guild:** its name and realm.
  - **Raids:** everything Raider.io returns, keyed by raid slug. The curve is
    `[{ raid, aotc?, cutting_edge? }]`, and empty when neither was earned.
  - **Scores:** `season`, `scores`, and `colors` (each score's colour from Raider.io's
    `segments`). **Ranks:** everything.
  - **Top 0.1% / 1%:** `topPercent` on each score is worked out on every answer, not cached.
    It compares `scores.all` with the region's `p999` / `p990` minimum score in the
    catalogue: `{ percent: 0.1 | 1, minScore }`, or null below 1% or without cutoffs.
  - **Runs (all five lists)** drop `keystone_run_id`, `map_challenge_mode_id`, `short_name`,
    `zone_expansion_id` and `zone_id`. They keep `par_time_ms`, so the front end can show
    the time left. Affixes keep only `id`, `icon_url` and `wowhead_url`; the rest is in
    `mplus_affixes`. The spec keeps only its `id`.
- **Raid bosses** (`raidBosses`, for the whole page's current raids or the one asked for):
  - One Blizzard request (`encounters/raids`, in English), cached as
    `pve:character:<…>:bosses` for every catalogue raid (~9 KB). The page and every raid
    widget share it.
  - Bosses are matched to the catalogue's encounters by name, because Blizzard's encounter
    ids are not Raider.io's and `tier-mn-1` spans several Blizzard instances. The full
    name is tried first, then the short form (no leading "The", nothing after a comma):
    Blizzard's "Sikran, Captain of the Sureki" is Raider.io's "Sikran". On a real character
    every boss killed in the last two expansions matched.
  - Each boss has `kills` per `lfr` / `normal` / `heroic` / `mythic`: `{ count, lastKillAt }`.
    A boss never killed has `{}`.
  - Extra, not essential: a Blizzard failure serves the kept copy however old, or null, and
    never fails the page. China has no Blizzard API, so it is always null there. A season-only
    answer has no `raidBosses` field.
- **Cache.** One entry per part: `pve:character:<region>:<realm>:<name>:full`, `…:raid:<slug>`,
  `…:season:<slug>` and `…:bosses`. A widget never pays for the page, nor the page for a
  widget.
  - A part is fresh for `PVE_CHARACTER_CACHE_TTL_SECONDS` (1 h) and kept
    `PVE_CHARACTER_STALE_SECONDS` (24 h) longer.
  - `forceRefresh` goes through `RefreshCooldown` (`refresh:pve:character:<id>`,
    `PVE_CHARACTER_REFRESH_COOLDOWN_SECONDS`) and refetches the bosses too.
  - There is a single flight per field set, and for the bosses, on each replica.
- **Failures.** Raider.io's 400 ("no such character") is a 404. Otherwise, as for PvP: stale
  if every Raider.io part asked for is kept, else 503 with `Retry-After: 60` for a spent
  budget and 502 for anything else.
- **Sync.** After a fresh whole page only, and on the next tick, the current season's best
  runs go to `POST /mplus/characters/sync`:
  - The season is the first one in `mythic_plus_scores_by_season`, which is the current one.
  - The dungeon is `zone_id`, the name, the slug from the run's url and `short_name`.
  - `timeRemainingMs` is `par_time_ms − clear_time_ms`.
  - Runs whose dungeon is not in the season's `dungeonIds` (from the catalogue) are left
    out, since one of them makes Rankwarden refuse the whole request.
  - The profile sends class, spec, race and role. The base profile's `HEALING` / `TANK` /
    `DPS` is spelled `healer` / `tank` / `dps`, as runs and Rankwarden spell it.
  - Nothing is pushed without a run in the season.

### PvE guild

`GET /pve/guild?region=&realmSlug=&guildName=[&showFullRoster=true | &raidEncounters=&difficulty=[&boss=]][&forceRefresh=true]`
(`src/pve/guild/`, in `PveModule`). One guild, from Raider.io's `guilds/profile` and
`guilds/boss-kill` (`RaiderIoGuildApi`).

- **Parameters.**
  - `region` (`cn` too), `realmSlug` and `guildName` are required, as for characters. The name is
    NFC-normalised, lowercased and has its spaces collapsed; it allows letters, spaces,
    apostrophes and hyphens, 2–24 characters.
  - `difficulty` is spirit-link's `RaidDifficulty` (`normal`, `heroic`, `mythic`); Raider.io
    ranks no LFR.
  - `raidEncounters` must be a catalogue raid and `boss` one of its encounters' slugs.
    Otherwise the answer is a 400, and Raider.io is not asked.
- **One widget per call.** Exactly one of the following; any other combination is a 400:
  - **Summary** (no options): `raid_progression:current-expansion`,
    `raid_rankings:current-expansion` and `members`. Only the members of ranks 0 and 1 are
    kept, guild master first: 99 of 948 for a large guild, ~39 KB.
  - **`showFullRoster=true`**: `members`, every one (~350 KB for 948 members). **Never
    cached**, so each call is one Raider.io request; concurrent calls share one per replica.
  - **`raidEncounters` + `difficulty`**: `raid_encounters:<raid>:<difficulty>`, each boss
    killed with `defeatedAt`, in kill order. Empty when none.
  - **`raidEncounters` + `boss` + `difficulty`**: `guilds/boss-kill`, returned as it comes.
    `kill` holds the times, duration and the group's item level. `roster` holds every
    player with talents, items and auras, ~850 KB for 20 players. Raider.io answers `{}` for
    a boss not killed yet, which becomes `kill: null, roster: []`.
- **Cache.**
  - `guild:<region>:<realm>:<name>:summary` and `…:raid:<raid>:<difficulty>` are fresh for
    `GUILD_CACHE_TTL_SECONDS` (1 h).
  - `…:boss:<raid>:<boss>:<difficulty>` is fresh for `GUILD_BOSS_KILL_CACHE_TTL_SECONDS`
    (24 h), since a kill is history. A boss not killed yet keeps only the shorter TTL.
  - Every part is kept `GUILD_STALE_SECONDS` (24 h) longer. `forceRefresh` goes through
    `RefreshCooldown` (`refresh:guild:<id>`, `GUILD_REFRESH_COOLDOWN_SECONDS`).
- **Failures.** Raider.io's 400 ("Could not find requested guild") is a 404, for every
  widget, and nothing is cached. Otherwise the kept part is served stale; without one, a
  spent budget is a 503 with `Retry-After: 60` and anything else a 502. The roster has
  nothing kept, so it always fails that way.
- **No sync.** Rankwarden has no guild sync endpoint; its `guilds` are only written by its
  raid rankings job.

### PvE catalogue

`PveCatalogue` (`src/seasons/pve-catalogue.service.ts`, exported by `SeasonsModule`) holds
every raid and Mythic+ season Rankwarden catalogues, for the PvE character lookups.

- **What it keeps.**
  - From `raids`: each raid's `slug`, `name`, `expansionId` and `encounters` (`id`, `slug`,
    `name`, in boss order).
  - From `mplus_seasons`: each season's `slug`, `name`, `expansionId`, `dungeonIds`, and
    `cutoffs` per region. A region's cutoffs are the top 0.1% (`p999`) and top 1% (`p990`)
    minimum scores, from `cutoffs.<region>.quantiles.*.all.minScore`.
  - A projection keeps raid rankings, keystone-title cutoffs and archive progress from ever
    being read.
- **Order.** Newest expansion first, then the latest to open within it, by the earliest
  regional start. Unlisted entries are kept, since a character's history may name them.
- **In memory, per replica.** It is read at startup (`onApplicationBootstrap`), then again
  on the first call after `PVE_CATALOGUE_TTL_SECONDS` (a day). There is a single flight
  per replica. The top-percent cutoffs move through a live season, so they can be up to a
  day behind Rankwarden.
  - A failed reload keeps the last catalogue and is retried on the next call.
  - A failure at startup is logged and does not stop the boot. Only a replica that has
    never read the catalogue fails a call.
- **API.** `catalogue()`, `raids()`, `currentExpansionRaids()`, `mplusSeasons()`,
  `raidSlugs()`, `mplusSeasonSlugs()`, `raid(slug)` and `mplusSeason(slug)`.

## 8. Rankwarden sync

`RankwardenSyncClient.pushPvpCharacter` / `pushMplusCharacter`:

- It validates against the mirrored DTOs, then POSTs to `RANKWARDEN_BASE_URL`.
- It never throws. It returns `written`, `invalid` (400), `not-tracked` (404), `busy`
  (409 after `RANKWARDEN_SYNC_RETRY_LIMIT` retries, backoff `base × 2^n`) or `failed`.
- Call it **after** responding to the front end. Wrap the call in
  `withRunId(RunKind.Sync, …)` for log correlation.
- The PvP endpoint replaces every bracket at once, so send the whole document. The M+
  endpoint merges runs and never lowers a score. Rankwarden never creates characters.
- PvP brackets carry no `rank`: only the leaderboard has one, and Rankwarden keeps what its
  sweep stored.

### Spec representation

`GET /pvp/spec-representation?region=&bracket=&rating=&date=[&getEarliestDate=true]`
(`src/pvp/representation/`). It reads one snapshot from Rankwarden's
`spec_representation` straight from MongoDB.

- **Not cached, on purpose.** The collection is a few hundred small documents, and a
  request reads one, or two with `getEarliestDate`.
- **Parameters.**
  - `rating` must be one of `REPRESENTATION_MIN_RATINGS` from
    `@denipetrov/spirit-link/constants` (≥ 0.3.0): `1500, 1800, 2100, 2300, 2700`.
    Rankwarden writes snapshots at exactly those, and the front end offers the same
    list.
  - `bracket` is a family (`2v2` … `blitz`).
  - `date` is a UTC day, `YYYY-MM-DD`; impossible days such as `2026-02-30` are 400.
  - `date=latest` answers the newest snapshot stored for that region, bracket and
    rating: the newest by `date`, whether or not it has classified specs. It covers the
    hours after midnight UTC before Rankwarden has computed the day. The response
    `date` is the day actually answered.
- **No season parameter.** Rankwarden deletes snapshots from before the current season,
  so a day names one season. On a rollover day the newer season wins.
- **404** when there is no snapshot: for a day (today before the daily job has run, or a
  day the job missed), or for `latest` with nothing stored at all. A 200 therefore
  always carries a real snapshot. The front end's first load should ask for
  `date=latest&getEarliestDate=true`, which answers as soon as Rankwarden has written
  one day.
- **`earliestDate`** is the first day whose snapshot has `classified > 0` for the same
  region, bracket and rating. Snapshots from before Rankwarden enriched a 2v2, 3v3 or
  RBG ladder count players but name no spec, and the calendar should not offer them.
  It is null when no day qualifies, which is every EU 2v2, 3v3 and RBG snapshot today.
- **Order.** `specs` comes as stored, sorted by `count` descending. `share` is of
  `classified`, and each hero talent `share` is of the spec's `heroTalentsClassified`.

### API docs

`@nestjs/swagger` (`src/docs/`), served at `/docs` (`/docs/openapi.json`) only when
`NODE_ENV` is not `production`. The docs map every route, and anonymous tokens exist to
make scraping harder.

- **Query parameters come from the zod schemas** through `ApiZodQuery(schema)`
  (`z.toJSONSchema`, `io: 'input'`, `target: 'openapi-3.0'`). They cannot drift from
  validation.
  - Fields that normalise before validating (`region`, `class`, `type`) lose their enum
    on the way, so they carry it in `.meta({ enum, description, example })`.
  - A new route documents its query with `@ApiZodQuery(itsSchema)`, plus
    `@ApiBearerAuth(BEARER_AUTH)` unless it is `@Public()`.
- **Responses** are TypeScript interfaces, so they are documented by example
  (`@ApiOkResponse({ schema: { example } })`).
- **The token endpoint** is oidc-provider's, not a Nest route, so `swagger.ts` adds it
  to the document by hand. That is what lets "Try it out" obtain a token.
- **Origin.** For that to work, outside production the service's own origin (from
  `OIDC_ISSUER`) is allowed to obtain tokens next to `CORS_ORIGINS`. See
  `issuance-origins.ts`, used by both the issuance policy and oidc-provider's CORS.
- **Helmet** gets a separate policy on `/docs` without `upgrade-insecure-requests`.
  Under plain http that directive sends the browser to `https://localhost` for the UI's
  own scripts, and the page stays blank. The API keeps the full policy.

## 9. Health and logging

- `/health` is liveness and touches nothing. `/health/ready` pings MongoDB and Redis
  (both hard dependencies, 503 if either is down). Blizzard, Raider.io and Rankwarden
  are observed from real traffic: a `down` upstream degrades the status to `degraded`
  but keeps 200.
- The readiness body includes the budget usage. The public HTTPRoute redirects
  `/health/ready` to `/health`, so that detail stays inside the cluster.
- Each request runs under `withRunId('http')`, so every line it causes is tagged
  `[http a1b2c3]`. Requests are logged at `debug`; a 5xx is logged at `warn`. Query
  strings are never logged.
- The Blizzard OAuth check at boot logs an error and records a health failure, but does
  not stop the boot (Blizzard is a soft dependency here, unlike in Rankwarden).

## 10. Configuration

All variables are validated at start; `npm run config:check` runs the same validation
without starting. `.env.example` documents each one. Production refuses to start
without `OIDC_JWKS`, without `OIDC_COOKIE_KEYS`, or with an `http://` issuer. Endpoint
paths are configuration (`BLIZZARD_PATH_*`, `RAIDERIO_PATH_*`) with checked
placeholders, as in Rankwarden.

## 11. Testing

- **Unit** (`src/**/*.spec.ts`): no services needed.
- **Integration** (`test/**/*.spec.ts`):
  - `bootTestApp()` boots the real `AppModule` through `configureApp()` against real
    MongoDB and Redis, with every upstream on one local `FakeUpstream` HTTP server
    (`/blizzard/{region}`, `/raiderio`, `/rankwarden`, `/turnstile`).
  - Only the Blizzard token provider is replaced. Retries, budget hooks and key
    redaction run for real.
  - Two boots in one file that share the upstream represent two replicas
    (`test/budgets.spec.ts`).
- **One configuration per test file**: `ConfigModule` reads the environment once per
  module graph, and the harness refuses a second boot with different settings.
- `resetRedis(app)` clears the file's keys between tests.
- **CI's `test` job runs on `ubuntu-22.04`, not `ubuntu-latest`.** MongoDB 8.x refuses
  to start on Linux kernels 6.19 to 7.0.13 (SERVER-121912, a clash with its bundled
  TCMalloc). The ubuntu-24.04 image moved into that range on 2026-10-18, while 22.04 is
  on 6.8.
  - The job prints `uname -r` first, so a kernel change shows up on a green run before
    it breaks one.
  - Return to `ubuntu-latest` once MongoDB ships a fix or the runners reach 7.0.14+.
  - Same fix as Rankwarden's CI (83825fd).
  - The same limit applies to a local Docker VM. This machine's WSL2 kernel is 6.18,
    just below the range, so a WSL kernel update could stop the local MongoDB.
