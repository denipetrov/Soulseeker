# Soulseeker — capabilities reference

Backend-for-frontend for the Rankwarden data. It reads Rankwarden's MongoDB, fetches
specific players on demand from Blizzard and Raider.io, caches in Redis, pushes
corrections back to Rankwarden, and protects its API with OAuth 2.0 tokens it issues
itself.

This document is written for agents that need to test or extend the service. It wins
over [README.md](README.md) and the online human handbook ([Soulseeker Handbook](https://claude.ai/artifact/NinpdHpweHpZmjF6N5kmxv))
where they differ in detail. The data model and its traps are Rankwarden's: read its
handbook and `SKILLS.md` §5 and §9 before writing a query.

**Where to start:**

- To **test** the service (live or in the suite), read §13, the testing playbook. It has
  the commands, a smoke test of every endpoint, the invariants to assert, and the traps.
- To **deploy** or check a deployment, read §14.
- To **change an endpoint**, read its section in §6–§7, then §12 and §13.
- After changing a route's parameters or response, update its section here, the
  endpoint tables in README.md, and its block in the online handbook (a claude.ai artifact: edit it there, no local copy is kept).

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
- **Never modify the Rankwarden repository.** Reading it is fine. A change Soulseeker needs
  there (an index, a sync field, a NetworkPolicy entry) is written up as a proposal for the
  user to make.
- **Never print a credential** to the terminal or a report: not the `.env` values, not a
  decoded Secret, not a token. Show lengths or fingerprints instead.
- **The Kubernetes namespace is `soulseeker`**, never `backend`.

---

## 1. Stack

Same as Rankwarden, on purpose: Node 24 (engines ≥ 22), TypeScript 6 strict ESM
(`nodenext`, `.js` import suffixes), NestJS 12 on Express, native `mongodb` 7, `got` 16,
`zod` 4, Vitest 4 with SWC, ESLint 10 flat config, Prettier. Added: `redis` (node-redis
6), `oidc-provider` 9 (certified OpenID Connect server, Koa inside), `jose` 6, `helmet`.

`@denipetrov/spirit-link` 0.6: `logLevelsFor`, `withRunId`, `RunLogger`,
`DependencyHealth`, `probeObservation`, `worstOf`, `hostOf`; `searchNameOf`
(`/search`); `REPRESENTATION_MIN_RATINGS`, `RaidDifficulty`, and (0.6) `SPECIALIZATIONS`,
`SpecRole` and `SpecSubRole` (`/constants`), which the role filters (§7) are built on.
`@denipetrov/blizz-auth` 0.1: the Blizzard OAuth token for the upstream.

## 2. Module map

| Module | Provides |
| --- | --- |
| `AppConfigModule` (global) | `ConfigService<Env, true>`; one zod schema, `src/config/env.schema.ts` |
| `DatabaseModule` (global) | `MongoService`: typed read collections, cached `ping()` |
| `RedisModule` (global) | `RedisService` (client, `key()`, `ping()`), `SharedFlight` (one load per key across replicas), `CacheService` (`getOrLoad`), `RefreshCooldown` |
| `CommonModule` (global) | `DependencyHealth`, `BlizzardBudget`, `RaiderIoBudget`, the global `BudgetSpentFilter` |
| `AuthModule` | the OIDC provider, `SessionController`, global `AccessTokenGuard` then `RateLimitGuard` |
| `BlizzardModule` | `ProfileApi` (profile, specializations, PvP, media, statistics, equipment, achievements, raid encounters) |
| `RaiderIoModule` | `RaiderIoCharacterApi`, `RaiderIoGuildApi`, `RaiderIoMythicPlusApi` (run details, cutoff analysis) |
| `RankwardenModule` | `RankwardenSyncClient` |
| `SeasonsModule` | `CurrentSeasons` (PvP and M+ current season per region, 60 s in memory), `PveCatalogue` (raids and M+ seasons, in Redis) |
| `SearchModule` | `/search/suggestions` |
| `PvpModule` | every `/pvp/*` route; `PvpSeasonsService`, `BoardEnricher` |
| `PveModule` | every `/pve/*` route; `MplusSeasonResolver`, `GuildRefs`, `MplusSeasonsService`, `MplusRunsService` |
| `CharactersModule` | read-side entities (`src/characters/entities/`) and the shared identity DTO |
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
- **A spent budget with nothing kept** throws `BudgetSpentException(upstream, subject)`
  (`src/common/quota/budget-spent.exception.ts`). `subject` names what is not cached:
  `this character`, `this guild`, `this run`, `this cutoff analysis`. The global
  `BudgetSpentFilter` answers it as 503 with `Retry-After: 60` on every route. Throw it;
  never set the header in a controller (two routes once forgot it).

### One fetch across replicas

`SharedFlight` (`src/redis/shared-flight.service.ts`) makes an upstream load happen once per
key across every replica, not just per process. Without it, one new page asked on two
replicas at once cost twice the budget and was synced to Rankwarden twice, which rotated
`previousRating` a second time (prodlike report ISSUE-01, 2026-11-16).

- `run(key, load, peek)` returns `{ value, loaded }`.
  - The first caller claims `<prefix>lock:<key>` with `SET NX PX` (30 s) and runs `load`.
  - Every other caller polls `peek` every 150 ms until it answers.
  - If the lock disappears and `peek` has nothing (the load failed, or found nothing), the
    waiter claims the lock and loads itself.
- **`load` must write its result to the cache before returning.** The lock is released
  after `load`, so a waiter that sees the lock gone always finds the result.
- **`peek` must accept only a result newer than the caller already had** (compare
  `fetchedAt`). Otherwise a forced refresh would take the copy it set out to replace.
- **`loaded` is true for exactly one caller.** Work done once per fetch keys off it: the
  PvP and PvE character syncs. Same-process callers that share a load get `false` too.
- **Fails open**: with Redis down, every caller loads, as before.
- **Used by:** the PvP character page (one flight for the parts it needs), the PvE
  character page (one per field set) and its bosses part, the cached guild widgets, and
  `CacheService.getOrLoad(…, { acrossReplicas: true })` for `/pve/mplus-run` and
  `/pve/mplus-cutoffs`. MongoDB-backed answers do not use it: the lock's round trips cost
  more than a duplicate read.
- **Not shared:** the guild's full roster is never cached, so it has nothing to peek. It
  keeps the per-process `SingleFlight`.
- **Edge left open:** one new PvP character asked in two languages at once on two replicas
  takes two flights (`core+locale:en_US` and `core+locale:de_DE`), and so two syncs.
- Tests: `test/pvp-character.spec.ts`, "asked twice at once on one replica" and "asked on
  two replicas at once". Both fail on the per-process version.

## 4. Auth

- **Authorization server.** oidc-provider at `/oidc`. `OIDC_ISSUER` must end in `/oidc`.
  There is one public client, `soulseeker-web`, with `token_endpoint_auth_method: none`
  and grants `urn:soulseeker:grant-type:anonymous` and `refresh_token`.
- **Anonymous grant** (`src/auth/oidc/anonymous.grant.ts`):
  - A `resource` other than `OIDC_API_RESOURCE` (exactly) is 400 `invalid_target`
    (RFC 8707). Without one, the token is for the API.
  - It runs `IssuancePolicy.check` first: the Origin must be in `CORS_ORIGINS` (403
    otherwise), at most `RATE_LIMIT_TOKEN_PER_MINUTE` per IP (429 with Retry-After), and
    Turnstile when `TURNSTILE_ENABLED` (`turnstile_token` form parameter).
  - It then creates account `anon:<uuid>`, a Grant scoped to `OIDC_API_RESOURCE` /
    `api:read`, an access token and a refresh token.
  - The checks live in the grant, not in middleware, because the grant type is in a body
    only oidc-provider may parse.
- **Origin gate** (`tokenOriginGate`, `issuance-origins.ts`, installed with `provider.use`):
  `POST /oidc/token` and its `OPTIONS` preflight answer 403
  `{ error: 'access_denied', error_description: 'origin not allowed' }` unless `Origin` is
  an issuance origin. This covers both grants: the refresh grant needs an Origin too.
  - It runs before oidc-provider's own client-based CORS check. That check answered a
    foreign Origin with 400 `invalid_request`, let a missing one through, and reflected
    any origin on the preflight (prodlike report ISSUE-04 and ISSUE-06).
  - Discovery, JWKS and revocation are not gated.
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
  - Guilds carry `faction` (lowercase, as on characters; null when not stored) and `logo`: Raider.io's image URL as Rankwarden stores it on `guilds`
    (`https://cdn.raiderio.net/images/...`), null when it has none. It is the same field
    `GuildRefs` gives the raid and boss boards.
- **Cache.** Whole answers are cached in Redis per type and prefix for
  `SEARCH_CACHE_TTL_SECONDS` (60).

## 7. Endpoints

One subsection per route or service, PvP first, then PvE. Each gives the parameters, the
reads, the shape, the cache and the errors.

### PvP seasons and title cutoffs

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

### PvP `world`

Every PvP endpoint that takes `region` (the leaderboard, title cutoffs, spec
representation with its history, and the tier list) also takes `region=world`: every
region together, as the Mythic+ and raid endpoints already do. The schema is
`pvpBoardSchema` (`src/pvp/world.ts`). `region` stays required, and `regionsOf(board)` lists
the regions a board covers. The character page is one character, so it has none.

- **One season everywhere.** Blizzard's PvP season ids are global (42 in every region), so
  a world board is the same season across regions: `region: { $in: [...] }` on Rankwarden's
  indexes, which lead with season then region. MongoDB merges the regions' ranges in rating
  order, with no in-memory sort.
- **Leaderboard.** The season is looked up per region, and a region without it is left out.
  At a rollover (live in one region, archived in another) the live regions form the board.
  - Rows are enriched per region (`BoardEnricher.entriesAcross`): character ids are unique
    only within a region.
  - Every entry now carries `region`, on single-region boards too. `inTitleRange` uses the
    entry's own region's cutoff.
  - The board's `cutoff` is null on `world`, and `regionCutoffs` gives each region's.
  - Archived rows are projected with their `region` for the same reason. Without it, a
    world archive judged no row in range.
- **Cutoffs.** Blizzard sets them per region (3v3: US 2954, EU 2982), so there is no world
  cutoff. Each region is counted against its own and the counts summed: Shuffle total
  1,196 = 464 + 458 + 151 + 123.
  - `cutoff` is null, and `regionCutoffs` (3v3/RBG) or each spec's `regionCutoffs`
    (Shuffle/Blitz) give each region's.
  - The class + spec list merges every region's qualifying characters by rating.
  - `final` means final in every region. `rewardsFetchedAt` is the oldest region's read.
  - A region without cutoffs yet is left out; only none at all is a 404. The regions used
    are those on the newest season.
- **Spec representation.** Rankwarden writes snapshots per region only, so a world day is
  that day's regional snapshots added up (`combineSnapshots`, `representation/combine.ts`,
  unit-tested).
  - `total`, `classified`, each spec's `count` and `heroTalentsClassified`, and each hero
    talent tree's `count` are summed, and the shares are worked out again from the sums,
    never averaged. Real data: 32,863 = 14,440 + 17,686 + 441 + 296, and the shares sum
    to 1.
  - Per region, a rollover day keeps the newer season. `computedAt` is the latest region's.
  - `regions` (now on every answer, and on each history day) lists the regions in it.
  - `latest` is the newest day any region has, combining the regions that have it.
    `earliestDate` is the first day any region has classified specs.
- **Tier list.** Both reads run across every region on the current season: the top 5,000
  of all of them merged by rating, and every row at or above 1500. ~175 ms uncached for
  world Shuffle.
- Tests: `test/pvp-world.spec.ts`, with EU and US fixtures sharing a character id.

### Role and sub-role filters

`/pvp/leaderboard`, `/pvp/cutoffs` and `/pve/mplus-leaderboard` take `role` (`tank`,
`healer`, `dps`) and `subRole` (`melee`, `ranged`). Everything shared is in
`src/pvp/roles.ts`; its unit tests are `src/pvp/roles.spec.ts`.

- **Source.** spirit-link's `SPECIALIZATIONS` gives each spec, by Blizzard spec id, its
  `role` and `subRole` (null for tanks and healers). `SPEC_ROLES` maps that onto this
  service's `class-spec` slugs through `SPEC_IDS`. A unit test checks that all 40 pairs
  in `ALL_SPECS` have a role, and that every spirit-link spec has a slug. A spec added to
  the game needs both lists updated.
- **Counts:** 6 tanks, 7 healers, 13 melee, 14 ranged (27 dps).
- **`specsMatching({ class, role, subRole })`** gives the class and spec pairs a filter
  names. Always use it: pairs, never spec names. Frost is melee for a death knight and
  ranged for a mage; Holy, Restoration and Protection each belong to two classes.
- **Schemas.** `roleSchema` and `subRoleSchema` are the query fields.
  `checkRoleFilters(query, ctx)` adds the shared 400s:
  - a `subRole` with `role` other than `dps` ("is only for role dps");
  - a role with `spec` ("cannot be combined with spec");
  - a `class` with no spec of the role ("has no tank spec").
  - `subRole` alone means dps.
- **Answers** echo `role` and `subRole`, null when not given.
- **Import order.** `CLASSES` lives in `src/pvp/specs.ts`, re-exported from the
  leaderboard schema, so the schemas can import `roles.ts` without a cycle (`specs.ts` used
  to import `CLASSES` from that schema).
- **Query shapes, measured on the local data (2026-11-19).**
  - PvP rows: `$or` of `{ class, spec }` pairs. Each branch walks `spec_board`, and MongoDB
    merges them in rating order (SORT_MERGE), reading index keys only. US Shuffle melee:
    ~28 ms 5,000 deep, count ~10 ms.
  - `class $in` × `spec $in` was rejected: the planner sometimes took `class_board` and
    fetched ~9,300 documents for a 5,000-deep page, and the count took ~120 ms.
  - M+: `profile.specId $in` on the spec board (`mplus_spec_board` /
    `_region_board`), also a SORT_MERGE. World melee: ~20 ms 20,000 deep, count ~7 ms.

### Blizzard ids beside names

Wherever an answer names a class, spec, race or hero talent tree, it carries Blizzard's id
beside it, so the front end keys everything on one id (added 2026-11-19).

- **Helpers.** `classIdOf(slug)` and `specIdOf(classSlug, specSlug)` (`src/pvp/specs.ts`),
  from `CLASS_IDS` / `SPEC_IDS`. Use them wherever a response is built from slugs.
- **PvP entries** (leaderboard, cutoff characters, `currentEntry` in
  `leaderboard.mapper.ts`): `classId` and `specId` from the slugs. `raceId` comes from
  `profile.race.id`, and `heroTalentId` from the same tree as `heroTalents`
  (`heroTalentTreeFor`: the ladder's spec loadout on Shuffle and Blitz, else the active
  tree). `BoardEnricher` projects whole `{ id, name }` objects for these. Archived rows have
  none of them.
- **Per-spec lists.** Cutoff counts, both tier lists (`TierListSpec`), hero talents (per
  class and per spec) and PvP spec representation all get `classId`/`specId`.
  - The representation ids are added on the way out (`withIds` in
    `representation.service.ts`); Rankwarden does not store them.
  - Unenriched cutoff entries answer null.
- **Search.** The PvP suggestion reads `profile.{class,spec,heroTalentTree,race}.id`; the
  M+ one reads `profile.classId/specId/raceId`. `heroTalentId` is always null for M+.
- **`/pve/character`.** Raider.io gives names only. These are worked out per answer in
  `responseOf`, so cached pages carry them too:
  - `classId` and `activeSpecId` come from spirit-link's `SPECIALIZATIONS`, by class and
    spec name together.
  - `raceId` comes from `raceIdOf(name, faction)` in `src/characters/races.ts`. Pandaren
    (25/26), Dracthyr (52/70), Earthen (85/84) and Haranir (86/91) are split by faction
    (alliance/horde), as Rankwarden's data showed. A new race answers null until it is
    added there.
  - `heroTalents` and `heroTalentId` (whole page only) come from
    `talentLoadout.active_hero_tree`. Raider.io's hero tree ids are Blizzard's: Farseer is
    56 in both, checked against Rankwarden's stored trees.
- **Already there:** `/pvp/character` (Blizzard's `{ id, name }` objects), and the M+
  leaderboard profile, runs, compositions and `/pve/spec-representation`, which keep
  Rankwarden's stored ids.

### PvP leaderboard

`GET /pvp/leaderboard?region=&seasonId=&bracket=[&class=&spec=][&role=&subRole=][&page=&pageSize=]`
(`src/pvp/leaderboard/`). The parameters:

- `bracket` is a family (`2v2`, `3v3`, `rbg`, `shuffle`, `blitz`) or one spec ladder by
  name (`shuffle-mage-fire`, the same as `bracket=shuffle&class=mage&spec=fire`).
- `class` and `spec` are slugs; `spec` needs `class`.
- `role` and `subRole` (above): with or without `class`, never with `spec` or a spec ladder
  name.
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
  - `realmName` (`profile.realmName`) and `talentLoadouts`: every stored loadout as
    `{ spec (slug), specId, heroTalents, heroTalentId, talentLoadoutCode }`, `[]` before
    enrichment. They cost ~3 loadouts and ~300 characters of codes per character, ~15 KB a
    50-row page before compression (season 42, 2026-11-26). `BoardEnricher` projects the
    loadouts whole. The cutoff character lists get them too, through the same enricher.
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
- **`previousRating`** (current season only, like the profile fields) is
  `characters.brackets.<row.bracket>.previousRating`, which the enricher's batch read
  already fetches. It is Rankwarden's rating from before its latest write, equal to
  `rating` when nothing moved, and null on a character's first appearance on the ladder
  or with no character document. Archived rows have no such field (`archive_entries`
  stores none), so the key is absent there. The cutoff endpoint's `characters` list
  carries it too, through the same `BoardEnricher`.
- **`rank`** is Blizzard's rank on the row's ladder. On a live all-specs Shuffle or Blitz
  board it is the rank within that spec, not the position. The front end orders by
  `rating` and numbers such a board itself.
- **Paging** uses skip and limit, which read only index keys: 100,000 deep costs ~40 ms
  on the largest board (Shuffle, ~120,000 rows). `total` is a `countDocuments` on the
  same filter, and `totalPages` comes with it.
- **Cache.** Whole pages are cached in Redis for `LEADERBOARD_CACHE_TTL_SECONDS` (60).
- **Enrichment gaps.** On 2v2, 3v3 and RBG, rows only have a class once Rankwarden has
  enriched the character. A class filter there leaves the others out, and today every
  EU 3v3 row is unenriched, so `class=` returns nothing for EU. The same holds for a role.
- **Role.**
  - Live boards filter on the role's exact pairs (`$or`, see above).
  - Archived Shuffle and Blitz are stored per spec ladder, so a role there reads
    `bracket: { $in: [<family>-<class>-<spec>, …] }` through `archive_board`, merged by
    rating. An archived spec family now needs class and spec, or a role.
  - Archived 2v2, 3v3 and RBG have no class at all: a role there is 400.
  - `cutoff` is null on a role board (several specs, each with its own); every entry's
    `inTitleRange` still uses its own ladder.
  - Real data (US Shuffle, season 42): 121,300 rows, 30,729 healers, 45,181 melee,
    44,030 ranged.
  - The cache key carries `role` and `subRole`.

### PvP title cutoffs

`GET /pvp/cutoffs?region=&bracket=` (`src/pvp/cutoffs/`) returns the current season's
title cutoffs for one ladder family, and how many characters of each spec are at or above
them.

- **`bracket`** is `3v3`, `rbg`, `shuffle` or `blitz`. 2v2 awards no title and is a 400.
- **Cutoffs** come from the cached current season (`PvpSeasonsService.currentSeason`:
  Rankwarden's `season_state`, or the archive once the season is final). `seasonName`,
  `final` and `rewardsFetchedAt` come with them.
- **Counts** are read live, not cached. `rating >= cutoff` is a short index range, and a
  whole Shuffle answer reads ~600 index keys in ~45 ms.
  - **3v3 and RBG:** one cutoff, the top-level `cutoff`. The qualifying rows are grouped
    by the rows' `class` and `spec`, the active spec. Characters Rankwarden has not
    enriched are one entry with a null class and spec. Every EU 3v3 row is in that entry
    today.
  - **Shuffle and Blitz:** a cutoff per spec ladder, set on each `specs[]` entry with its
    title. There is one `countDocuments` per spec through `spec_board` (season, region,
    class, spec, rating), all run together. A single `$or` aggregation over the 40 specs
    was tried and scanned the whole region (125k keys, ~240 ms).
  - A spec with a cutoff but nobody in range answers `count: 0`.
- **Faction-split cutoffs.** Where these differ by faction (3v3 and RBG up to season 33,
  never a live season since), the count uses the lower one: rating rows carry no faction.
- **404** when the region has no current season, or no cutoffs recorded for the bracket
  yet (early in a season, before Rankwarden has read them).
- **With `role` or `subRole`**, the counts only:
  - Only the specs of that role are listed, and `total` is theirs.
  - `class` may come with a role (not alone), to narrow to that class's specs of it.
  - On 3v3 and RBG the not-enriched entry (null class and spec) is left out: its role is
    unknown.
  - On Shuffle and Blitz only the role's spec ladders are counted. A role whose specs have
    no cutoff recorded is a 200 with `specs: []`; the 404 stays for a season with no
    cutoffs at all.
  - The counts answer echoes `class`, `role` and `subRole`.
  - A role does not switch to a characters list: that still needs one class and spec.
    Offered as a later addition if the front end wants "every healer with the title".
- **With `class` and `spec`** (always together; a spec slug alone is ambiguous, as in
  `holy`, `frost`, `restoration`, `protection`): no counts. It returns `characters`, the
  spec's characters at or above the cutoff, best first.
  - Each entry is built by `BoardEnricher` (`src/pvp/leaderboard/`), which the
    leaderboard uses too, so an entry is byte-for-byte the leaderboard's for that
    character. That was checked on real data for six specs.
  - Not paged: a title cutoff is the top fraction of a percent of a ladder, a few dozen
    characters per spec. `total` is the list's length.
  - The cutoff counted against is the spec's own on Shuffle and Blitz, and the season's
    on 3v3 and RBG.
  - On 3v3 and RBG the spec is the active one, so only enriched characters can appear.
  - A pair the season has no spec ladder for (`paladin` + `fire`, `mage` + `bogus`) is
    404 on every bracket. The season's Shuffle and Blitz cutoffs serve as the list of
    specs that exist. A real spec nobody reaches is 200 with `characters: []`.

### PvP tier list

`GET /pvp/tier-list?region=&bracket=` (`src/pvp/tier-list/`) scores each spec of the
current season's ladder from 0 to 100 and cuts the specs into tiers. Any family: `2v2`,
`3v3`, `rbg`, `shuffle`, `blitz`.

- **Reads.** Two, run together on the family's `*_ratings` collection:
  - the top 5,000 rows' class and spec, best first, through `board_order`;
  - every row at or above 1500 with a spec, grouped by spec, with its count and mean
    rating. That is ~63,000 rows on EU Shuffle, ~70 ms.
- **Score** (`tier-list.scoring.ts`, pure and unit-tested):
  - **Top tier density, 45 points.** The spec's rows in the top 250, 500, 1,000, 2,500
    and 5,000 (cumulative), weighted 30/25/20/15/10 %. Each band is taken against the
    spec that leads it (`count / max`), so the spec that leads every band gets all 45.
  - **Representation, 35 points**, and **average rating, 20 points**, both from the rows
    at or above 1500, are split by order (`rankPoints`): the highest spec gets all the
    points, the lowest none, the rest evenly between. Ties share the mean of their places.
- **Tiers** (`assignTiers`). Ordered by score (a tie by slug), the specs are split by four
  lines. Each line starts at a baseline, `round(n × 0.10 / 0.35 / 0.65 / 0.90)` specs
  from the top (40 specs give 4 / 10 / 12 / 10 / 4).
  - From its baseline, each line moves up to `TIER_LINE_SLACK` (2) specs either way, to
    the widest score drop between two neighbours in that window. Specs that score close
    together then share a tier: on US Shuffle, Fire (80.58) and Restoration Druid (80.09)
    are both S, with the line at the 14.6-point drop to Assassination.
  - Equal drops (within 1e-9, as the scores are sums of fractions) go to the one nearer
    the baseline, then the higher.
  - A line stays below the one above it and short of the next one's baseline, so a tier
    is empty only when its baseline is.
  - Under 5 specs there is no S: 10 % rounds to none.
  - Real sizes: US Shuffle 5 / 11 / 11 / 8 / 5, US 3v3 6 / 6 / 16 / 7 / 5.
- **Specs.** Every pair in `ALL_SPECS` (`src/pvp/specs.ts`, 40 pairs by class) is always
  on the list, so a spec nobody plays (a tank spec on Shuffle) is not dropped: it scores 0
  on every factor and comes last.
  - A spec with no rows gets no points from the by-order factors, rather than sharing the
    bottom places with other empty specs.
  - A spec found in the data but missing from the list (one Blizzard just added) is
    still scored, and logged at warn, so the list can be updated. Keep `specs.ts` in step
    with the game.
  - A spec only in the top rows, below 1500 (on an RBG ladder, where the top 5,000 reaches
    down to ~200), has `averageRating.value: null` and gets nothing there.
- **Rounding.** `score` is rounded from the unrounded sum, so it can differ by 0.01 from
  adding up the three rounded factor scores.
- **Unclassified rows.** On 2v2, 3v3 and RBG, rows of characters Rankwarden has not
  enriched have no spec. They hold their place in the top bands but count for no spec.
  `topRows`, `topClassified` and `classified` say how much was known.
- **Average rating is weighed by count.** A spec is ranked by `averageRating.adjusted`,
  not by its plain mean (`value`):
  `(count × mean + 50 × 1500) / (count + 50)` (`adjustedAverage`,
  `AVERAGE_RATING_PRIOR_WEIGHT`). It is as if every spec had 50 more players at the 1500
  floor.
  - 1,000 players at 1800 stay ~1786; 5 at 1800 fall to ~1527. Every row is ≥ 1500, so
    more players always helps.
  - The floor is used rather than the ladder's mean on purpose: pulling toward the mean
    would reward a small spec that sits below it.
  - Before this, rank was by the plain mean and ignored count. 20 Protection Warriors at
    1932 took 17 of 20 points on US Shuffle and outscored Feral (660 players) and Frost DK
    (882). Now they adjust to ~1624 and score 2.
  - 50 was chosen on real ladders: it keeps a typical 3v3 spec (~80 rows) mostly its own,
    and pulls Shuffle and Blitz tank specs (3–30 rows) well down.
- **Cache.** The whole list is cached per region, season and bracket for
  `TIER_LIST_CACHE_TTL_SECONDS` (1 h), so `computedAt` stays the same until then. A ladder
  with no spec at all, however many specs are listed, is a **404** and is not cached; so is a region without a current
  season. The response is ~10 KB for Shuffle.

### PvP hero talents

`GET /pvp/hero-talents?region=&bracket=&top=` (`src/pvp/hero-talents/`) shows which hero
talent trees each spec's best players use, for a page like drustvar's hero-talents stats.

- **Parameters.** `region`: a region or `world`. `bracket`: `2v2`, `3v3`, `rbg`, `shuffle`
  or `blitz`. `top`: characters per spec, 1–500, default 50. Always the current season.
- **Reads.**
  - For every spec of `SPECS_BY_CLASS`, its top `top` rows of the family's ratings
    collection through `spec_board`: forty short index walks, run together. On `world` the
    regions are `$in` and merge by rating.
  - On 2v2, 3v3 and RBG a row's spec is the character's active one, known only once
    Rankwarden has enriched the character, so a spec there counts enriched characters only.
  - Then the characters' profiles: one `$in` per region (ids are unique only within a
    region), projected to `profile.heroTalentTree` and `talentLoadouts[].{spec.name,
    heroTalentTree}`.
- **Which tree** (`treeOf`, unit-tested): on Shuffle and Blitz, the loadout of the ladder's
  own spec, never the active spec's (Rankwarden's reader rule). On 2v2, 3v3 and RBG, the
  active spec's tree, which is the spec the row counts for.
- **Shape.**
  - `{ region, bracket, seasonId, seasonName, top, computedAt, classes }`, every class with
    every spec in the game's order. A spec nobody plays has zeros and nulls.
  - Per spec: `characters` (rows read, at most `top`), `covered` (those with a known tree;
    the rest are not enriched yet), `minRating` and `maxRating` over `characters`, and
    `heroTalents`.
  - Each tree has `{ id, name, count, share }`, with `share` of `covered`, most played first
    (equal counts by id).
- **Cost.** World 3v3 at top 50 takes ~90 ms uncached; US Blitz at top 100 ~160 ms. Cached
  in Redis per region, season, bracket and `top` for `HERO_TALENTS_CACHE_TTL_SECONDS`
  (15 min).
- **Local data.** EU characters are not enriched in the local database, so EU Shuffle shows
  25/0 covered and EU 3v3 has no rows with a spec. US 3v3 is fully covered; US Blitz is
  partly covered (Arms 35 of 100).

### PvP spec representation

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

#### History, for a graph over time

`GET /pvp/spec-representation/history?region=&bracket=&rating=` returns each spec over
the last `HISTORY_DAYS` (31) UTC days, today included, as drawn by sites like
drustvar.com's "flavor of the month".

- **Parameters.** The daily endpoint's `region`, `bracket` and `rating`, picked from its
  schema so the two cannot drift. There is no date: the window always ends today (UTC).
- **Response.** `from` and `to` are the window, for the axis. `days` lists only days
  that have a snapshot, oldest first.
  - Days are missing when Rankwarden did not write them: today before its daily run, a
    day the job missed, or days before the current season, which Rankwarden deletes.
    `days[0].date` is where the data starts.
  - A spec is also missing from a day nobody played it on at that rating (EU Blitz 2700
    has 39 specs one day and 40 the next); the graph treats it as 0.
- **Per day:** `date`, `computedAt`, `total`, `classified`, and `specs`, most played
  first. Each spec is exactly the daily endpoint's entry for that date, hero talents
  included (`heroTalentsClassified`, `heroTalents[]`), checked on real data.
- **Size.** Hero talents make up most of the payload: a full Shuffle month is ~265 KB
  raw, against ~79 KB without them. The API compresses responses.
- **Unenriched 2v2, 3v3 and RBG** days are still listed, with `classified: 0` and empty
  `specs`.
- **Reading.** One range read through `snapshot_identity` (date first), at most 31
  documents. Not cached, like the daily endpoint. On a rollover day with two seasons,
  the newer one wins.
- **404** only when the whole window is empty.

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
  - One flight across replicas for the parts a request needs (`SharedFlight`). Only the
    caller that fetched syncs.
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
  - `rank` and `previousRating` are read from Rankwarden's `characters.brackets.<ladder>`
    on every answer and never cached, because both move hourly. It is one lookup by
    season, region and character id, made **after** the answer's own sync (below). Both
    are null when Rankwarden does not track the character or ladder, or when the read
    fails.
  - `previousRating` is Rankwarden's rating from before its latest write, sweep or sync.
    It equals `rating` when nothing moved. Rankwarden's sync rotates it, so a page that
    fetched fresh ratings shows the rating before this very sync.
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
- **Sync.** Only when `core` was fetched fresh, and **before** the standings are read
  back, so `previousRating` reflects it:
  - One attempt, waited on for at most `RANKWARDEN_SYNC_INLINE_TIMEOUT_MS` (3 s), with
    no 409 retries.
  - A busy Rankwarden (409) has written nothing, so the sync is retried in the
    background with the full backoff, and the page shows the standings as they were.
  - A timeout or other failure is not retried: it may still have landed, and writing
    again would rotate `previousRating` a second time and hide the movement.
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
  - One flight across replicas per field set, and for the bosses (`SharedFlight`). Only
    the caller that fetched the whole page pushes it.
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
- **`previousMythicScore`** (whole page only). The order is: read Raider.io and the stored
  score together, answer, then sync.
  - While the full page is fetched from Raider.io, the character's stored `mythicScore` for
    the region's current season (`mplus_season_state`) is read from `mplus_characters` in
    parallel, by `key` (`region/realm/lowercased name`). That is the score before this
    page's push. `mythicPlusScores[0].scores.all`, Raider.io's, is the score now. The push
    that follows brings Rankwarden up to date, so the next fresh page compares against it.
  - It is cached with the full part, so a cached page answers the value it was fetched
    with. It is absent on widget answers (`raidProgression`, `mplusSeasonScore`).
  - It is null when Rankwarden has not stored the character for that season, or when
    Raider.io's current season is not the stored one (a rollover Rankwarden has not seen).
  - A failed read gives null and a warning; it never fails the page.
  - Real check: Rooiben (eu/sylvanas) had 4366.7 stored, and Raider.io answered 4378.1.
  - The two scores are not the same measure: Rankwarden's is summed over the runs it
    stores. Once the push lands Raider.io's best runs, a fully covered character's stored
    score follows Raider.io's.
- **Docker.** `docker-compose.yml` points the app at `http://host.docker.internal:3000` for
  Rankwarden, as it does for MongoDB. With `.env`'s `localhost:3000`, the container called
  itself and every push failed with `ECONNREFUSED`.

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
  - From `raids`: each raid's `slug`, `name`, `shortName`, `expansionId`, `icon`, `starts`
    and `ends` per region (ISO strings), and `encounters` (`id`, `slug`, `name`, in boss
    order). Raider.io's placeholder end for a raid still open, `2030-01-01`, becomes
    `null`.
  - From `mplus_seasons`: each season's `slug`, `name`, `expansionId`, `dungeonIds`, and
    `cutoffs` per region. A region's cutoffs are the top 0.1% (`p999`) and top 1% (`p990`)
    minimum scores, from `cutoffs.<region>.quantiles.*.all.minScore`.
  - A projection keeps raid rankings, keystone-title cutoffs and archive progress from ever
    being read.
- **Order.** Newest expansion first, then the latest to open within it, by the earliest
  regional start. Unlisted entries are kept, since a character's history may name them.
- **In Redis, shared by every replica.** Two values: the raids under
  `ss:cache:pve:raids` (`RAIDS_CACHE_KEY`, ~32 KB) and the Mythic+ seasons under
  `ss:cache:pve:mplus-seasons` (`MPLUS_SEASONS_CACHE_KEY`, ~3.5 KB).
  - Each is filled on demand: the first call that finds its key missing reads Mongo and
    stores the list for `PVE_CATALOGUE_TTL_SECONDS` (a day), through
    `CacheService.getOrLoad`.
  - Nothing is loaded at startup, and nothing is held in memory. Concurrent misses on one
    replica share one read.
  - The top-percent cutoffs move through a live season, so they can be up to a day behind
    Rankwarden.
  - If Redis is down, each call reads Mongo. If Mongo fails too while a key is missing,
    the call fails (`GET /pve/raids` answers 503).
  - To pick up a raid or season Rankwarden has just added, delete its key: the next call
    refills it.
- **API.** `raids()`, `currentExpansionRaids()`, `mplusSeasons()`,
  `raidSlugs()`, `mplusSeasonSlugs()`, `raid(slug)` and `mplusSeason(slug)`.

### PvE raids

`GET /pve/raids` (`src/pve/raids/raids.controller.ts`) lists every raid in the catalogue:
`{ raids: CatalogueRaid[] }`, with all 31 raids today, ~32 KB before compression.

- **Source.** `PveCatalogue.raids()`: the list in Redis, shared by every replica, read
  from Mongo when it is missing. It is up to a day (`PVE_CATALOGUE_TTL_SECONDS`) behind
  Rankwarden, which is fine: raids change a few times an expansion.
- **Order.** Newest expansion first, then the latest to open within it. Unlisted raids
  are included.
- **Fields.**
  - `ends.<region>` is null while the raid is open there.
  - `icon` is Raider.io's value as stored: an icon name (`inv_1215_raid_achievement_kithix`)
    or, on some raids, a numeric file id (`8039569`). It is null on Legion raids. The front
    end resolves it to an image.
- **503** only when the list is missing from Redis and Mongo cannot be read.

### PvE Mythic+ runs

`GET /pve/mplus-runs` (`src/pve/mplus-runs/`) returns timed runs by `score`, best first,
one page at a time.

- **Parameters** (all optional):
  - `region`: `world` (default) or `us`, `eu`, `kr`, `tw`, `cn`.
  - `season`: a slug or `current` (default).
  - `dungeon`: a dungeon slug of that season.
  - `page` and `pageSize`: the same paging as the leaderboards.
- **Season.** `MplusSeasonResolver` (`src/pve/shared/`, shared with the M+ leaderboard)
  resolves `current` and says whether the season is live.
  - Live reads `mplus_runs` (~800,000 runs this season: 160k per region, 20k per dungeon
    per region). Any other season reads `mplus_archive_runs` (7–10k per season).
  - An unknown slug is a **404**.
- **Dungeon.** The slug is looked up among the season's dungeons in
  `MplusSeasonsService`'s cached list, and the board filters on its id (`dungeon.id`, which
  the indexes carry). A dungeon the season does not run is a **404**: Murder Row is not in
  MN 1.
- **Reads** are hinted by name (`MplusRunIndexes`).
  - Live: `run_board` or `run_dungeon_board`. On `world`, `region: { $in: [all five] }`
    merges the regions in score order.
  - Archive: `archive_run_board`, `archive_run_region_board` or
    `archive_run_dungeon_board`. There is no region + dungeon index, so that board walks
    the dungeon's range and checks the region.
  - Live runs with `missedSince` (about to be pruned by Rankwarden) are never listed, as
    Rankwarden's reader rules say.
- **Total.** The `missedSince` check means every run is fetched to count. The live `world`
  total costs ~0.5 s, against ~50 ms from the index alone. It is counted per board, not
  per page, and cached apart (`<board>:total`), so every page of a board shares one count.
  The first `world` request takes ~0.6 s; later ones ~30 ms.
- **Paging** stops at row 200,000 (`MAX_OFFSET`, as on the other boards; ~0.4 s at that
  depth). `totalPages` is capped at the last reachable page, so the live `world` board
  shows 4,001 pages of 50, not 16,016. A page past it is a **400**.
- **Shape.** `{ region, season, current, dungeon, page, pageSize, total, totalPages, runs }`.
  - Each run has `rank` (its place on this board; the stored `rank` is the place on the
    Raider.io board it was read from, and is dropped), `keystoneRunId`, `region`, `score`,
    `dungeon` (`{ id, name, slug, shortName }`), `mythicLevel`, `clearTimeMs`,
    `keystoneTimeMs`, `timeRemainingMs`, `numChests`, `completedAt`, `affixIds`, `faction`
    and `roster` (five members, as stored).
  - `rosterKeys` and `fetchedAt` are Rankwarden's and are left out.
  - Affixes come by id: `/pve/mplus-seasons` lists them.
- **Cache.** Pages and totals are kept in Redis for `MPLUS_RUNS_CACHE_TTL_SECONDS` (5 min).
  A 100-run page is ~135 KB before compression.

### PvE Mythic+ run

`GET /pve/mplus-run?keystoneRunId=[&season=]` (`src/pve/mplus-run/`) returns one run's
details from Raider.io's `mythic-plus/run-details` (`RaiderIoMythicPlusApi`,
`RAIDERIO_PATH_MPLUS_RUN_DETAILS`).

- **The season matters.** Raider.io requires it, and run ids are per season: the wrong
  season does not fail but answers that season's run of the same id (19324786 is a Murder
  Row +22 in MN 2 and an Algeth'ar Academy +10 in MN 1). So the season sent is, in order:
  1. `season` when given, checked against the catalogue (404 if unknown);
  2. the run's season as Rankwarden stores it: `mplus_runs` (`run_identity`: season ×
     region `$in`, then the id) or `mplus_archive_runs` (`archive_run_identity`);
  3. the current season.
- **Shape.** Raider.io's own field names, as the guild boss kill: `season`,
  `keystone_run_id`, `dungeon`, `mythic_level`, `score`, `clear_time_ms`,
  `keystone_time_ms`, `time_remaining_ms`, `num_chests`, `completed_at`, `faction`,
  `weekly_modifiers` (affixes in full) and `roster`.
  - The roster is passed through as Raider.io gives it (character with talents, guild,
    role, items, ranks), like the boss kill's.
  - The other ~1 MB of Raider.io's answer (logged details, videos, permissions) is
    dropped.
- **Size and cost.** ~220 KB, ~28 KB with brotli. ~1.3 s for the first fetch, since
  Raider.io's answer is 1.2 MB, then ~40 ms. A finished run does not change, so it is
  cached per season and id for `MPLUS_RUN_CACHE_TTL_SECONDS` (a day).
- **Errors.**
  - **404** for a run Raider.io does not know (its 404 "could not find keystone run", or a
    400); not cached.
  - **503** when the Raider.io budget is spent, **502** when it fails.

### PvE Mythic+ cutoffs

`GET /pve/mplus-cutoffs?region=&season=` (`src/pve/mplus-cutoffs/`) is a proxy for
Raider.io's `mythic-plus/cutoff-analysis/summary` (`RaiderIoMythicPlusApi.getCutoffAnalysis`,
`RAIDERIO_PATH_MPLUS_CUTOFF_ANALYSIS`, sent with `format=json`).

- **Parameters.** `region`: `world` (default; Raider.io takes it as is) or `us`, `eu`,
  `kr`, `tw`, `cn`. `season`: `current` (default) or a slug, resolved by
  `MplusSeasonResolver`, so an unknown slug is a 404 before Raider.io is asked.
- **Answer.** Raider.io's JSON as it comes (~25–42 KB):
  - `populations`: overall, plus Horde and Alliance on a single region, each with the title
    cutoff and the 0.1 / 1 / 5 / 10 / 25 / 40 % scores;
  - `history`: one entry per day since the season started, with the population and the
    score at each percentile;
  - the snapshot date and update time.
  - Raider.io's quirks pass through: MN 1's `season` field reads `season-mn-1-cutoffs`.
- **404** when Raider.io has no analysis for the season or region (its 404 "Unknown cutoff
  season or region"): none for TWW 1 or Dragonflight, nor CN in TWW 3. Not cached. **503**
  for a spent budget, **502** when Raider.io fails.
- **Cache.** Per season and region for `MPLUS_CUTOFFS_CACHE_TTL_SECONDS` (1 h); Raider.io
  dates its snapshot by day. ~0.3–0.8 s uncached, ~10 ms cached.

### PvE Mythic+ compositions

`GET /pve/mplus-compositions` (`src/pve/mplus-compositions/`) returns the 50 most played
party compositions among a board's best runs.

- **Parameters.** `region`, `season` and `dungeon` are those of `/pve/mplus-runs` (one
  schema, `mplusRunBoardSchema`). `top` is how many of the board's best runs to count:
  default 1000, 1–10,000. There is no paging.
- **Same board as the runs.** `MplusRunsService.board()` resolves the season (live or
  archive), checks the dungeon (**404**), and gives the collection, filter and index hint.
  Both endpoints read exactly the same runs, `missedSince` excluded.
- **Composition.** The party's five class and spec pairs, whoever played them and in
  whatever roster order (`topCompositions`, `compositions.ts`, unit-tested).
  - Each roster is sorted tank, healer, damage dealers, then by class and spec id, so
    reordered rosters match.
  - Two specs of one class are different compositions. A member without a spec (rare) is
    kept, with null spec.
  - Equal counts rank by their best run: the runs are read best first, and the order of
    first appearance is kept.
- **Shape.** `{ region, season, current, dungeon, top, runs, compositions }`.
  - `runs` is the runs read (`top`, or fewer on a smaller board).
  - Each composition has `rank`, `count`, `share` (of `runs`, 0–1, four places) and
    `members`. Each member has `class` and `spec` slugs (from `CLASS_IDS` / `SPEC_IDS`;
    null for an unknown id), plus the stored `classId`, `className`, `specId`, `specName`
    and `role`.
- **Reads.** One index walk of `top` runs, projected to `roster.classId`, `className`,
  `specId`, `specName` and `role`; grouping happens in the app. The default takes ~80 ms;
  `top=10000` ~0.4 s.
- **Cache.** Redis, per board and `top` (`pve:mplus-compositions:<region>:<season>:<dungeon>:<top>`),
  for `MPLUS_RUNS_CACHE_TTL_SECONDS` (5 min), as the runs.
- **Real data** (MN 2, world, top 1000): one party finished 52.6% of the runs (Blood DK,
  Holy Paladin, Arms, Subtlety, Elemental). The top 50 cover 96.5% of the runs.

### PvE spec representation

`GET /pve/spec-representation` (`src/pve/spec-representation/`) returns which specs a
Mythic+ season's best runs were played with, from Rankwarden's `mplus_spec_representation`.

- **Season-based, not dated.** Rankwarden keeps one document per season, region and
  dungeon. It recomputes the live season after every pass, overwriting it, and writes a
  finished season once from the archive. So where `/pvp/spec-representation` takes `date`
  and `getEarliestDate`, this takes:
  - `season`: `current` (default) or a slug, resolved by `MplusSeasonResolver`;
  - `getSeasons=true`: the seasons with a snapshot for that region and dungeon, newest
    first, for a season picker.
  - A dated history would need Rankwarden to write daily snapshots, as it does for PvP. If
    it ever does, `date` can be added without breaking this.
- **Other parameters.** `region`: `world` (default; Rankwarden's `region: 'all'`) or `us`,
  `eu`, `kr`, `tw`, `cn`. `dungeonSlug`: `all` (default; `dungeonId: null`) or a dungeon
  of the season, checked by `MplusSeasonsService.dungeon()`, which the run boards use too.
- **Read.** One `findOne` by `mplus_representation_key` (season, region, dungeonId).
  `getSeasons` adds a `distinct` over the 162 documents. Not cached, like the PvP
  snapshot: ~25 ms.
- **Shape.**
  - `{ region, season, dungeon, source, computedAt, runs, slots, classified, roles, specs,
    seasons? }`. `source` is `live` (still moving) or `archive` (final).
  - Counted by roster slot, so a player in forty runs counts forty times, over the top of
    each region's board.
  - Each spec as stored: `classId`, `className`, `specId`, `specName`, `role`, `count`,
    `percent` (of classified slots) and `rolePercent` (of its role's slots, the figure to
    compare by), both **0–100**, unlike the PvP `share` (0–1). The `class` and `spec`
    slugs come from `classSlugOf` / `specSlugOf` in `src/pvp/specs.ts`. Most played first.
- **404** for a missing snapshot (`kr` before Rankwarden counts it, `season-tww-1`), a
  season the catalogue does not know, or a dungeon the season does not run.

### PvE tier list

`GET /pve/tier-list?region=` (`src/pve/tier-list/`) is the PvP tier list's rules and
shape, applied to the current Mythic+ season.

- **Same scoring.** `scoreTierList` from `src/pvp/tier-list/tier-list.scoring.ts`, unchanged:
  - top tier density 45, representation 35, average 20;
  - rank-based points;
  - the average weighed by count (50 phantom players at the floor);
  - every `ALL_SPECS` spec listed;
  - S/A/B/C/D lines at 10/25/30/25/10 %, moved to the widest drop within 2 specs.
  The only change is the floor, which is now a parameter (`floor`, default `MIN_RATING`
  1500), so PvP is unaffected.
- **Mythic+ mapping.**
  - The ladder is `mplus_characters` by `mythicScore`, each character counted once for its
    profile spec. Ids become slugs through `classSlugOf` / `specSlugOf`.
  - The floor is **2000, Keystone Master** (`MPLUS_MIN_SCORE`), PvP's 1500 counterpart.
  - **Density** reads the board's top 5,000, everyone, as the leaderboard lists them
    (`mplus_score_board`, regions merged on `world`). Today all 5,000 are fully covered.
  - **Representation and average** count only **fully covered** characters at or above
    2000 (`mplus_covered_board` / `_region_board`). A partial score is a partial sum (443
    on average over one dungeon, against 3,691 over eight), so including them would rank
    specs by Rankwarden's coverage. The user chose both the coverage rule and the floor.
- **Parameters.** `region` only: `world` (default) or `us`, `eu`, `kr`, `tw`, `cn`. The
  season is always the current one, as on PvP.
- **Shape.** As PvP's, with `season` (slug) and `seasonName` in place of
  `bracket`/`seasonId`, and `minScore` in place of `minRating`. Each spec entry is exactly
  `TierListSpec`, so one front-end component draws both; `averageRating` holds the average
  score.
- **Cost.** ~150 ms uncached on `world` (95,885 covered characters grouped), ~45 ms for a
  region. Cached for `TIER_LIST_CACHE_TTL_SECONDS` (1 h) under `pve:tiers:<region>:<season>`.
- **Real data (MN 2, world).** S tier: Arms, Subtlety, Holy Paladin, Elemental, Blood DK,
  the dominant composition. D: Destruction Warlock, Fire Mage.

### PvE Mythic+ seasons

`GET /pve/mplus-seasons` (`src/pve/mplus-seasons/`) returns every Mythic+ season with its
dungeons and cutoffs, plus every affix: `{ seasons, affixes }`. It reads three small
collections whole.

- **Seasons** come from `mplus_seasons`, newest first (the catalogue's `newestFirst`). Each
  has `slug`, `name`, `shortName`, `expansionId`, `blizzardSeasonId`, and `starts` and
  `ends` per region. A running season's `2030-01-01` end is null, as on `/pve/raids`. The
  `archive` marker is Rankwarden's bookkeeping and is left out.
- **Dungeons.** Each season's `dungeonIds` is replaced by the full `mplus_dungeons`
  documents in the season's order: `id`, `slug`, `name`, `shortName`, `challengeModeId`,
  `keystoneTimerSeconds`, `iconUrl`, `backgroundImageUrl`, `expansionIds`.
  - A dungeon runs in several seasons, so it repeats.
  - An id the collection lacks keeps its `id`, with nulls. No season has one today.
- **Cutoffs** per region as stored: `status`, `updatedAt`, `keystones` (title cutoffs) and
  `quantiles` (`p999`, `p990`), each with `alliance`, `horde` and `all`. The fetch
  bookkeeping (`fetchedAt`, `attempts`, `finalised`) is dropped. It is empty for a season
  Rankwarden has none for; today only TWW 3, MN 1 and MN 2 have cutoffs.
- **Affixes** from `mplus_affixes`, by id. They are not linked to seasons.
- **Size and cache.** ~135 KB before compression, ~15 KB as brotli, ~30 ms uncached. The
  whole answer is one Redis value, `ss:cache:pve:mplus-season-list`, filled on demand and
  kept for `MPLUS_SEASONS_CACHE_TTL_SECONDS` (1 h), since a live season's cutoffs move
  every M+ pass.
  - The key is deliberately not `pve:mplus-seasons`: that is `PveCatalogue`'s slim season
    list. The two once shared it, and each then served the other's shape. The test now
    fills the catalogue's key first, to keep it so.

### PvE Mythic+ leaderboard

`GET /pve/mplus-leaderboard` (`src/pve/mplus-leaderboard/`) returns Mythic+ characters by
`mythicScore`, best first, one page at a time.

- **Parameters** (all optional):
  - `region`: `world` (default), `us`, `eu`, `kr`, `tw` or `cn`. Raider.io covers China,
    unlike the PvP ladders.
  - `season`: a slug or `current` (default).
  - `class`, `spec`, `role`, `subRole`.
  - `page` and `pageSize`: the same paging as `/pvp/leaderboard` (default 50, max 100, rows
    up to 200,000).
- **Season.** `current` is the region's live season from `mplus_season_state`. On `world`
  it is the newest season any region is on (catalogue order).
  - That season reads `mplus_characters`. Any other reads `mplus_archive_characters`, and
    `current: false` says so. The archive keeps only the top of each region (~4,750
    characters for season-mn-1).
  - A slug the catalogue does not know is a **404**.
- **Filters** match the stored profile by Blizzard id: `profile.classId` (`CLASS_IDS`) and
  `profile.specId` (`SPEC_IDS`, both in `src/pvp/specs.ts`, checked against every spec in
  the data), and `profile.role` (`tank`, `healer`, `dps`).
  - The slugs are the PvP endpoints'; the stored names (`Death Knight`, `Beast Mastery`)
    are never matched.
  - `spec` needs `class`, and must be one of its specs. A role or sub-role never comes
    with `spec`, and `class` with a role must have a spec of it (`checkRoleFilters`). Each
    of these is a **400**.
  - `class=mage&role=healer` used to answer an empty board. Since 2026-11-19 it is a 400,
    as on the PvP endpoints.
  - `subRole` reads the spec board with `profile.specId $in` the role's spec ids. Ids are
    unique across classes, so `class` only narrows the list. `profile.role` is not checked:
    a sub-role is always dps.
- **Reads** are hinted by name to Rankwarden's board index for the filter
  (`MplusBoardIndexes` in `src/database/collections.ts`, live and archive, world and
  region), so a page is an index walk in score order. The count uses the same hint.
  - The board is chosen in this order: the spec board with a spec or a sub-role; else the class board
    with a class (a `role` beside it is checked on the documents); else the role board;
    else the score board.
  - The live collection has no score board without region. On `world`,
    `region: { $in: [all five] }` lets `mplus_score_board`'s per-region ranges merge in
    order (`SORT_MERGE`) instead of an in-memory sort.
  - On the 269,722-character season, every page reads about one page of documents:
    unfiltered `world` p1 takes 6 ms (count 27 ms), and Fire mage on `world` takes 2 ms.
- **Coverage.** Every character is listed, and each entry carries `isFullyCovered`. The
  board is not filtered on it: the front end flags characters whose runs miss a dungeon
  of the season, whose `mythicScore` is therefore a partial sum.
  - About 36% of live characters are covered, and about 8% of the archive. The top of the
    board is covered; uncovered characters appear lower down (a Fire mage at #67, 7 of 8
    dungeons).
  - Rankwarden also has `*_covered_board` indexes, for a covered-only board if one is
    ever wanted. They are not used.
- **Shape.** `{ region, season, current, class, spec, role, page, pageSize, total,
  totalPages, entries }`.
  - Each entry has `rank` (its place on the filtered board), then `characterName`,
    `realmName`, `realmSlug`, `region`, `faction`, `mythicScore`, `previousMythicScore`,
    `isFullyCovered`, the stored `profile`, and
    `dungeonRuns` as stored (with `completedAt` as an ISO string).
  - Dungeons are not enriched from `mplus_dungeons`: the front end reads them separately.
- **`previousMythicScore`** is the `mythicScore` before Rankwarden's latest write: equal
  when the character gained nothing, lower when they climbed. It lets the front end show
  movement.
  - It is null on a character's first write, and always on archived seasons (written
    once). A document written before Rankwarden recorded it also answers null.
  - Only this endpoint carries it. The other PvE endpoints that return characters have no
    stored score: search suggestions and the run rosters have none, and `/pve/character`
    shows Raider.io's own score, which Rankwarden's previous score does not describe.
- **Ties.** Many characters share a score (several at 4265.1 at the top). The order among
  equal scores is the index's, stable from page to page.
- **Cache.** Pages are cached in Redis for `MPLUS_LEADERBOARD_CACHE_TTL_SECONDS` (5 min).

### PvE raid board

`GET /pve/raid?raidSlug=&region=&difficulty=` (`src/pve/raid/`) returns one raid and its
top hundred guilds, from the `guilds` boards on Rankwarden's `raids` documents.

- **Parameters.** `raidSlug` is required: a catalogue raid, or `current` (as on
  `/pve/bosses`). `region` defaults to `world` (or `us`, `eu`, `kr`, `tw`). `difficulty`
  defaults to `mythic`. There is no fallback to an easier difficulty.
- **Shape.**
  - `{ region, difficulty, raid, updatedAt, guilds }`. `raid` is `{ slug, name, icon,
    encounters }` from the catalogue.
  - `updatedAt` is when Rankwarden last read the board (`guildsUpdatedAt`).
  - Each of `guilds` keeps everything stored (`rank`, `regionRank`, `encountersPulled`,
    `encountersDefeated`, with dates as ISO strings), with `guildId` replaced by the
    `guild` object that `/pve/bosses` also uses.
- **Reads.** A `findOne` by `slug` (`raid_slug`), projected to the one board and its
  timestamp, so the other boards (~180 KB each) are never read. Then the board's guilds
  through `GuildRefs`.
- **Size.** ~220 KB before compression for 100 guilds with every pull and kill; ~40 ms
  uncached. Cached in Redis per region, raid and difficulty for
  `RAID_BOARD_CACHE_TTL_SECONDS` (10 min).
- A board Rankwarden has never read is a 200 with `guilds: []` and `updatedAt: null`.
  Old raids have empty `encountersPulled`, and The Emerald Nightmare's world board holds
  97 guilds, not 100.
- **404** for a raid the catalogue lacks.

`GuildRefs` (`src/pve/shared/guild-refs.service.ts`) is the guild join both boards use. It
reads the guilds of a board in one `$in` on `guilds` (`guild_identity`) and answers
`{ id, name, faction, logo, realm, realmSlug, region }`. An id not stored keeps its `id`,
with its other fields null.

### PvE bosses

`GET /pve/bosses` (`src/pve/bosses/`) returns the first guilds to kill each boss of a raid,
from Rankwarden's `bosses` collection. That collection holds one document per raid
encounter, with its boards (`bossRankings.<board>.<difficulty>`, the first 50 guilds).

- **Parameters** (all optional):
  - `region`: `world` (default), `us`, `eu`, `kr` or `tw`.
  - `raidSlug`: a catalogue raid, or `current` (default).
  - `bossSlug`: one boss of that raid.
  - `difficulty`: `mythic`, `heroic` or `normal`.
  - `top`: 1–50, default 50.
- **`current`** is `PveCatalogue.currentRaid()`: of the newest expansion's raids still
  open in some region, the one with the most bosses. Midnight has three open (The
  Venomous Abyss with 8 bosses, and two 1-boss raids beside it), so this picks the tier's
  main raid. When none is open (between tiers), all of the newest expansion's raids are
  taken. A tie goes to the newer raid.
- **Order.** The bosses come in the raid's `encounters` order from the catalogue, not
  Mongo's order. A boss is matched by encounter `id`, then by `slug`. A boss the catalogue
  lists but `bosses` lacks still appears, with `difficulty: null` and no rankings.
- **Difficulty is one for the whole answer**, at the top level next to `region`. A list
  must not mix mythic and heroic bosses.
  - Without one asked for, it is the first of mythic, heroic, normal on which any of the
    requested bosses has guilds on the region's board. Every boss is answered at it, so a
    boss nobody has killed there has an empty `bossRankings`, not an easier board.
  - Blackrock Depths has no mythic board at all, so it answers `heroic`.
  - A difficulty asked for is used even when every board is empty. `difficulty` is null
    only when no board of any difficulty has guilds.
- **Reads.** The raid's bosses are read by `{ raidSlug, slug: { $in } }` through
  `boss_raid_slug_name`, never by slug alone: a re-release's boss can share a slug with
  the original's. The projection keeps only `bossRankings.<region>.<difficulty>`. Then
  every guild on the chosen boards is read in one `$in` on `guilds` (`guild_identity`).
- **Shape.** `{ region, difficulty, bosses }`. Each boss has `bossName` and `bossSlug`; a
  `raid` object (`slug`, `name`, `icon`, `expansionId`); and `bossRankings`. Each ranking has `rank`,
  `itemLevelAvg`, `attempts` and `firstDefeated`, plus a `guild` object (`id`, `name`,
  `faction`, `logo`, `realm`, `realmSlug`, `region`).
  - `firstDefeated` and `attempts` are null for a guild ranked for progress without a
    kill. `attempts` is often null or 0, as Raider.io sends it.
  - A guild missing from `guilds` keeps its `id`, with its other fields null.
- **Cache.** Whole boards are cached in Redis per region, raid, boss and difficulty for
  `BOSSES_CACHE_TTL_SECONDS` (10 min). `top` slices the cached answer.
  - The current raid with every boss is ~113 KB before compression and takes ~50 ms
    uncached.
- **404** for a raid the catalogue lacks, or a boss the raid does not have.

### Hidden players and guilds

Rankwarden can hide a player or a guild (`POST /hidden` there, commit 45f842f, 2026-11-25).
It keeps the list in `hidden_entries` and still collects their data. Soulseeker leaves them
out of every answer, and changes the list only through Rankwarden.

- **Endpoint.** `POST /admin/hidden` (`src/hidden/admin-hidden.controller.ts`).
  - Body: `{ kind: 'character', region, realmSlug, name, hidden }`, or
    `{ kind: 'guild', guildId | (region, realmSlug, name), hidden }`. A guild named by realm
    and name gets its id from `guilds` through `guild_search` (exact name wins): 404 if not
    stored.
  - Forwarded by `RankwardenSyncClient.setHidden` with one attempt. The DTO mirror is
    `src/rankwarden/dto/set-hidden.dto.ts`; keep it in step with Rankwarden's.
  - On success, `HiddenList.invalidate()`. Answers: 200 with Rankwarden's body, 400, 401,
    404, or 502 when Rankwarden failed and nothing changed.
- **Auth.** `@Public()` (no OAuth token: any visitor can get one) plus `AdminKeyGuard`: the
  `X-Admin-Key` header must equal `ADMIN_API_KEY`, compared through SHA-256 digests in
  constant time.
  - The key is at least 32 characters, a secret, redacted in health output, and generated
    and kept by `create-secrets.sh`.
  - With no key configured the route answers 404, so it is off, never open.
- **The list is the source of truth**, not the `hidden` flags Rankwarden copies onto
  `characters`, `mplus_characters` and `guilds`. The reasons:
  - the `*_ratings` rows and both archives carry no flag;
  - a local database may predate the flags;
  - `{ hidden: true }` without Rankwarden's `*_hidden` index would scan a whole season.
- **`HiddenList`** (`src/hidden/hidden-list.service.ts`, global module):
  - `current()` gives a `HiddenSet`: player keys `region/realmslug/nfc-lowercased-name`
    (Rankwarden's `mplusCharacterKey`, see `hiddenCharacterKey`) and guild ids. It is cached
    in Redis (`hidden:list`, `HIDDEN_LIST_TTL_SECONDS`, 60 s).
  - `pvpCharacterIds()` maps hidden players to Blizzard character ids. It reads `characters`
    through `character_search` by folded name, then matches the exact key, as Rankwarden
    does. The ids are stable across seasons, so they filter live ladders and the archive
    alike.
  - `pvpExclusion(regions)` builds `$nor` on `{ region, characterId $in }`, or null when
    nobody is hidden there.
  - `invalidate()` drops the list, the ids and the cached answers filtered in the query
    (`pvp:board:`, `pve:mplus-board:`, `search:`), through `CacheService.deleteByPrefix`
    (SCAN, never KEYS).
- **Where:**
  - **In the query**, so totals and paging stay exact: search (PvP `$nor` by id; M+ `key
    $nin`; guilds `id $nin`), `/pvp/leaderboard` live and archived, `/pvp/cutoffs` counts and
    lists, and `/pve/mplus-leaderboard` (`key $nin`, live and archive both carry `key`).
  - **At serve time**, so cached answers follow the list at once:
    - runs (`anonymizeStoredRoster`), and run details and boss kills
      (`anonymizeRaiderIoRoster`);
    - guild member lists (`isHiddenMember`, realm slug from `profile_url` else `realmSlugOf`);
    - raid boards and bosses (hidden guilds filtered out; the rest keep their ranks).
  - **Before anything**, the same 404 as "no such character / guild": `/pvp/character` and
    `/pve/character` (no cache, upstream or sync), and `/pve/guild` when `guilds` holds it
    under a hidden id.
  - **Not filtered:** statistics that name nobody (tier lists, hero talents, both spec
    representations, compositions).
- **Anonymised** = Raider.io's own shape: `rioCharacterId: 0`, `characterName: 'Anonymous'`,
  `realmSlug: 'anonymous'`, `anonymized: true`. For Raider.io rosters, `character.id: 0`,
  `name: 'Anonymous'`, `anonymized: true`; class, spec, race, level, talents, role and items
  are kept; guild, ranks and `oldCharacter` are removed.
- **Tests:** `test/hidden.spec.ts` (a fake Rankwarden that writes `hidden_entries`; before and
  after, then shown again) and `src/hidden/anonymize.spec.ts`.

### Translated names

`GET /i18n/names?locale=` (`src/localization/`) gives the front end game names in one
language. Raider.io has no localization: tested 2026-11-25. `locale`, `lang` and the
like are refused with a 400 "Invalid request query input", and `Accept-Language` is
ignored. So the front end translates PvE names by id or slug.

- **Languages.** `LOCALES` (`blizzard.constants.ts`): Blizzard's 12 plus `zh_CN`, which was
  added the same day. It works on the global hosts for Game Data and Profile alike, so
  `/pvp/character?locale=zh_CN` works too. The user's languages are en_US, es_ES, pt_BR,
  fr_FR, de_DE, ru_RU, ko_KR and zh_CN; the rest cost nothing extra. The query takes any
  case and `-`.
- **Source.** `GameDataApi` (`src/blizzard/game-data.api.ts`) reads 8 indexes from
  `BLIZZARD_REGION` (US when that is `cn`), each with `locale: null`.
  `BlizzardHttpService.get` leaves the locale out for `null`, and Blizzard then names
  everything in every language at once (`{ en_US, de_DE, … }`).
  - Paths are configuration: `BLIZZARD_PATH_PLAYABLE_CLASSES`, `…_SPECIALIZATIONS`,
    `…_RACES`, `…_TALENT_TREES` (hero trees), `…_KEYSTONE_AFFIXES`, `…_KEYSTONE_DUNGEONS`
    (the dynamic namespace), `…_JOURNAL_INSTANCES` and `…_JOURNAL_ENCOUNTERS`.
  - Validated with `src/blizzard/schemas/game-data-index.schema.ts`.
- **Builder** (`game-names.builder.ts`, pure, unit-tested): `buildGameNames` turns the
  indexes plus the catalogue (`PveCatalogue.raids()` and `mplus_dungeons`) into one
  document with every language. `namesIn` picks one language, falling back to English.
  - Classes, specs, races, hero trees and affixes are by Blizzard id.
  - Dungeons are by `challengeModeId`, which is Blizzard's keystone dungeon id, else by
    English name.
  - Raids and bosses are by English name through `nameKey` / `shortNameKey`
    (`src/common/utils/name-key.ts`, shared with the per-boss kills).
  - An `Awakened ` / `Fated ` re-release falls back to the original raid's name.
  - What finds no match is left out (the front end keeps its English) and logged at warn,
    with the list at debug.
- **Real data (2026-11-25).**
  - Everything matched except the `tier-mn-1` raid name and Halondrus (Blizzard has
    "Halondrus the Reclaimer").
  - One language is 11–16 KB.
  - The first build takes ~1.2 s; later answers take ~6 ms.
- **Cache.** `ss:cache:i18n:game-names`, one value for every language.
  - Fresh for `I18N_NAMES_TTL_SECONDS` (a week), and kept `I18N_NAMES_STALE_SECONDS`
    (30 days) more.
  - Rebuilt in one `SharedFlight` across replicas.
  - When Blizzard fails, the kept copy is served; with nothing kept, it is 502, or 503 for
    a spent budget.
  - To pick up a new patch's names now, delete the key.
- **Not covered:** item and spell names (gear, talents). The front end uses Wowhead
  tooltips for those.
- **Tests:** `src/localization/game-names.builder.spec.ts` and `test/i18n-names.spec.ts`. The
  integration test checks that the 8 requests carry no `locale`, the namespaces, every
  language from one build, the stale copy and the 502.

## 8. Rankwarden sync

`RankwardenSyncClient.pushPvpCharacter` / `pushMplusCharacter`:

- It validates against the mirrored DTOs, then POSTs to `RANKWARDEN_BASE_URL`.
- It never throws. It returns `written`, `invalid` (400), `not-tracked` (404), `busy`
  (409 after `RANKWARDEN_SYNC_RETRY_LIMIT` retries, backoff `base × 2^n`) or `failed`.
- With default options a 409 retries for ~35 s, so a page must never wait on that. Push
  after responding, or, as the PvP character page does to read `previousRating` back,
  wait on one attempt only: `{ retries: 0, timeoutMs }`. Wrap the call in
  `withRunId(RunKind.Sync, …)` for log correlation.
- Every sync is a write that rotates Rankwarden's `previousRating` (PvP) and
  `previousMythicScore` (M+). Never send the same data twice "to be sure".
- The PvP endpoint replaces every bracket at once, so send the whole document. The M+
  endpoint merges runs and never lowers a score. Rankwarden never creates characters.
- PvP brackets carry no `rank`: only the leaderboard has one, and Rankwarden keeps what its
  sweep stored.

## 9. API docs (Swagger)

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

## 10. Health and logging

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

## 11. Configuration

All variables are validated at start; `npm run config:check` runs the same validation
without starting. `.env.example` documents each one. Production refuses to start
without `OIDC_JWKS`, without `OIDC_COOKIE_KEYS`, or with an `http://` issuer. Endpoint
paths are configuration (`BLIZZARD_PATH_*`, `RAIDERIO_PATH_*`) with checked
placeholders, as in Rankwarden.

## 12. Test suite

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

## 13. Testing playbook

For agents asked to test Soulseeker, whether the suites or a running instance. Everything
here can be run without asking, except what spends real upstream quota at scale or
touches a cluster: say what you will run first.

### 13.1 Choose the kind of test

| Kind | Proves | Touches | Use when |
| --- | --- | --- | --- |
| Unit (`npm test`) | pure logic: schemas, scoring, mappers, budgets, sync client | nothing | always, first |
| Integration (`npm run test:int`) | the real app end to end, with every upstream faked | local MongoDB + Redis, test databases only | after any change to a route |
| Live smoke (§13.4) | the running service against real data | the local `rankwarden` database (read), real Blizzard / Raider.io (a few calls), Rankwarden's sync (writes) | checking a build, a deploy, or real data shapes |

Report results as counts: files and tests passed and failed, with each failing test's name
and assertion. If a step was skipped (MongoDB down, no credentials), say so; do not call
it passed.

### 13.2 Prerequisites

```bash
node --version                 # 24.x
npm install                    # needs the read:packages token in ~/.npmrc
npm run db:up                  # Redis on 6379
# MongoDB on 27017: Rankwarden's compose (its data), or `npm run db:up:standalone` (empty)
npm run build                  # the suites do not need it; config:check and start:prod do
```

- The integration suite's global setup fails readably if MongoDB or Redis is down. It does
  not need Rankwarden's data: every file seeds its own. `TEST_MONGODB_URI` and
  `TEST_REDIS_URL` point it elsewhere.
- A live smoke test needs Rankwarden's data in MongoDB, `.env` filled in, and
  `npm run start:dev` (or `npm run docker:up`). Rankwarden on `:3000` is needed only to see
  syncs land; without it they fail quietly, and readiness shows `rankwarden: down`, which
  degrades the status but keeps 200.

### 13.3 Running the suites

```bash
npm run typecheck && npm run lint
npm test                                                        # unit
npm run test:int                                                # integration
npx vitest run --project integration test/pve-raid.spec.ts      # one file
npx vitest run --project integration -t "falls back to heroic"  # by test name
npm run test:cov                                                # unit coverage
```

Each endpoint has one integration file:

| Endpoint | File |
| --- | --- |
| `/oidc/*`, `/session`, guards | `test/auth.spec.ts` |
| budgets across replicas | `test/budgets.spec.ts` |
| compression | `test/compression.spec.ts` |
| Swagger | `test/docs.spec.ts` |
| `/health*` | `test/health.spec.ts` |
| `/search/suggestions` | `test/search.spec.ts` |
| `/pvp/leaderboard` | `test/leaderboard.spec.ts` |
| `/pvp/cutoffs` | `test/cutoffs.spec.ts` |
| `/pvp/tier-list` | `test/tier-list.spec.ts` |
| `/pvp/hero-talents` | `test/pvp-hero-talents.spec.ts` |
| `/pvp/spec-representation` (+ history) | `test/spec-representation.spec.ts`, `test/spec-representation-history.spec.ts` |
| `/pvp/character` | `test/pvp-character.spec.ts` |
| PvP seasons service | `test/pvp-seasons.spec.ts` |
| `region=world` on PvP | `test/pvp-world.spec.ts` |
| `/pve/character` | `test/pve-character.spec.ts` |
| `/pve/guild` | `test/guild.spec.ts` |
| PvE catalogue | `test/pve-catalogue.spec.ts` |
| `/pve/raids`, `/pve/raid`, `/pve/bosses` | `test/pve-raids.spec.ts`, `test/pve-raid.spec.ts`, `test/pve-bosses.spec.ts` |
| `/pve/mplus-seasons` | `test/pve-mplus-seasons.spec.ts` |
| `/pve/mplus-leaderboard` | `test/pve-mplus-leaderboard.spec.ts` |
| `/pve/mplus-runs`, `/pve/mplus-run` | `test/pve-mplus-runs.spec.ts`, `test/pve-mplus-run.spec.ts` |
| `/pve/mplus-compositions` | `test/pve-mplus-compositions.spec.ts` |
| `/pve/spec-representation` | `test/pve-spec-representation.spec.ts` |
| `/pve/tier-list` | `test/pve-tier-list.spec.ts` |
| `/pve/mplus-cutoffs` | `test/pve-mplus-cutoffs.spec.ts` |

### 13.4 Live smoke test

Against `http://localhost:3001` (or a port-forward). Get a token first; the `Origin` must be
in `CORS_ORIGINS` (`http://localhost:5173` locally, `https://rankwarden.gg` in production):

```bash
BASE=http://localhost:3001
ORIGIN=http://localhost:5173
token() {
  curl -s -X POST "$BASE/oidc/token" -H "Origin: $ORIGIN" \
    -d grant_type=urn:soulseeker:grant-type:anonymous -d client_id=soulseeker-web | jq -r .access_token
}
T=$(token)                                   # lasts 10 min; call token() again after
get() { curl -s -w '\n%{http_code} %{time_total}s\n' -H "Authorization: Bearer $T" "$BASE$1"; }
get '/pvp/tier-list?region=us&bracket=shuffle'
```

Against a production-configured instance (issuer `https://api.rankwarden.gg/oidc`), use
`ORIGIN=https://rankwarden.gg` and also send
`--data-urlencode resource=https://api.rankwarden.gg`.

Each request below is answered from MongoDB unless marked. The figures are those of the
local data on 2026-11-16 and will move. **U** marks a real upstream call (Blizzard or
Raider.io quota); **S** marks a write to Rankwarden through its sync endpoint.

| Request | Expect |
| --- | --- |
| `/health/ready` (no token) | 200, `status` `ok` or `degraded`, `mongo` and `redis` `ok` |
| `/session` | 200, `subject` starts `anon:`, `scopes` `["api:read"]` |
| `/search/suggestions?type=pvp&q=pe` | 200, `characters` ≤ 100, `guilds` `[]` |
| `/search/suggestions?type=pve&q=ec` | 200, `characters` and `guilds` |
| `/pvp/leaderboard?region=us&seasonId=42&bracket=3v3&pageSize=3` | 200, `current: true`, 3 entries, ratings non-increasing |
| `/pvp/leaderboard?region=world&seasonId=42&bracket=3v3` | 200, `cutoff: null`, `regionCutoffs`, each entry has `region` |
| `/pvp/leaderboard?region=us&seasonId=42&bracket=shuffle-mage-fire` | 200, every entry's `bracket` is `shuffle-mage-fire` |
| `/pvp/cutoffs?region=us&bracket=shuffle` | 200, `cutoff: null`, every spec has its own `cutoff` |
| `/pvp/cutoffs?region=us&bracket=3v3&class=rogue&spec=subtlety` | 200, every character at or above `cutoff.rating` |
| `/pvp/tier-list?region=us&bracket=shuffle` | 200, 40 specs, scores non-increasing, tiers S→D in order |
| `/pvp/hero-talents?region=world&bracket=3v3&top=50` | 200, 13 classes; every spec's `covered` ≤ `characters` ≤ 50 |
| `/pvp/spec-representation?region=eu&bracket=shuffle&rating=2100&date=latest&getEarliestDate=true` | 200, `share`s sum to ~1, `earliestDate` key present |
| `/pvp/spec-representation/history?region=eu&bracket=shuffle&rating=2100` | 200, `days` oldest first, all within `from`–`to` |
| `/pvp/character?region=us&realmSlug=tichondrius&characterName=Petkick` | 200 **U S**; `brackets` non-empty; Rankwarden logs "Synced us/Petkick" |
| `/pve/character?region=us&realmSlug=illidan&characterName=Bondd` | 200 **U S**; `previousMythicScore` key present; Rankwarden logs "Synced Mythic+ us/illidan/bondd" |
| `/pve/character?region=us&realmSlug=illidan&characterName=Bondd&mplusSeasonScore=season-mn-2` | 200 **U**, `mythicPlusScores` only: no run lists, no `previousMythicScore` |
| `/pve/guild?region=eu&realmSlug=tarren-mill&guildName=Echo` | 200 **U**, `members` of ranks 0 and 1 only |
| `/pve/raids` | 200, 31 raids, `ends` null for open raids |
| `/pve/raid?raidSlug=current` | 200, `difficulty` `mythic`, ≤ 100 guilds |
| `/pve/bosses?raidSlug=current&top=3` | 200, one `difficulty` for the whole answer, ≤ 3 rankings per boss |
| `/pve/mplus-seasons` | 200, 21 seasons, `affixes` non-empty |
| `/pve/mplus-leaderboard?region=world&pageSize=5` | 200, `current: true`, scores non-increasing, `isFullyCovered` on each entry |
| `/pve/mplus-leaderboard?subRole=melee&pageSize=5` | 200, `subRole: 'melee'`, every `profile.specId` a melee spec (81,004 on world) |
| `/pvp/leaderboard?region=us&seasonId=42&bracket=shuffle&role=healer` | 200, `role: 'healer'`, `cutoff: null`, every entry's `bracket` a healer ladder |
| `/pvp/leaderboard?region=us&seasonId=42&bracket=shuffle&subRole=ranged` | 200, Frost Mage present, no Frost Death Knight |
| `/pvp/cutoffs?region=us&bracket=shuffle&role=healer` | 200, only healer specs, `total` their sum |
| `/pve/mplus-runs?region=world&dungeon=murder-row&pageSize=5` | 200, every run's `dungeon.slug` is `murder-row`, `rank` 1..5 |
| `/pve/mplus-run?keystoneRunId=19324786` | 200 **U**, `dungeon.slug` `murder-row`, `mythic_level` 22 |
| `/pve/mplus-compositions?top=1000` | 200, ≤ 50 compositions of 5 members, `share`s sum to ≤ 1 |
| `/pve/spec-representation?region=world` | 200, `percent`s sum to ~100 |
| `/pve/tier-list?region=world` | 200, `minScore` 2000, 40 specs |
| `/pve/mplus-cutoffs?region=us` | 200 **U**, `populations` and `history` |

Send a second identical request to see the cache: the same body, much faster. A
`forceRefresh=true` repeated within 5 minutes is ignored. **Never loop the U rows**: each
costs real quota (a PvP page is ~14 Blizzard requests). Each S row rotates Rankwarden's
`previousRating` or `previousMythicScore`.

### 13.5 Negative cases

| Request | Expect |
| --- | --- |
| any API route without `Authorization` | 401 `invalid_request` |
| with a garbage or expired token | 401 `invalid_token` |
| `POST /oidc/token` without `Origin`, or with another (either grant) | 403 `access_denied` "origin not allowed" |
| `OPTIONS /oidc/token` with a foreign `Origin` | 403, no `Access-Control-Allow-Origin` |
| anonymous grant with `resource=https://evil.example` | 400 `invalid_target` |
| `/pvp/leaderboard?region=us&bracket=3v3` (no `seasonId`) | 400, `seasonId`: "is required" |
| `/pve/mplus-run?keystoneRunId=abc` | 400, "must be a number" |
| a Raider.io route with the minute budget spent and nothing cached | 503, `Retry-After: 60`, message naming the run, guild, character or cutoff analysis |
| 11 token requests in a minute from one IP | 429 with `Retry-After` |
| `/pvp/leaderboard?region=us&seasonId=42&bracket=3v3&spec=fire` | 400, spec needs class |
| `/pvp/leaderboard?region=us&seasonId=42&bracket=3v3&page=4002&pageSize=50` | 400, past row 200,000 |
| `/pvp/cutoffs?region=us&bracket=2v2` | 400 |
| `/pvp/cutoffs?region=us&bracket=3v3&class=paladin&spec=fire` | 404 |
| `/pvp/spec-representation?region=eu&bracket=3v3&rating=2000&date=latest` | 400, not a snapshot rating |
| `/pvp/spec-representation?region=eu&bracket=3v3&rating=2100&date=2026-02-30` | 400, not a calendar date |
| `/pvp/character?region=cn&realmSlug=x&characterName=abc` | 400, no Blizzard API in China |
| `/pvp/character?region=us&realmSlug=x&characterName=a1` | 400, letters only |
| `/pve/character?region=us&realmSlug=illidan&characterName=Bondd&raidProgression=nope` | 400, not in the catalogue; no Raider.io call |
| `/pve/guild?region=eu&realmSlug=tarren-mill&guildName=Echo&showFullRoster=true&raidEncounters=tier-mn-1` | 400, one widget per call |
| `/pve/mplus-leaderboard?class=mage&spec=fire&role=dps` | 400, spec and role never together |
| `/pvp/leaderboard?…&role=tank&subRole=melee` (any of the three endpoints) | 400, "is only for role dps" |
| `/pvp/leaderboard?region=eu&seasonId=42&bracket=shuffle&class=priest&role=tank` | 400, "has no tank spec" |
| `/pvp/leaderboard?region=eu&seasonId=42&bracket=shuffle-mage-fire&role=dps` | 400, a spec ladder already names a spec |
| `/pvp/leaderboard?region=eu&seasonId=41&bracket=3v3&role=dps` (an archived season) | 400, archived 3v3 has no class |
| `/pvp/cutoffs?region=eu&bracket=shuffle&class=mage` (class without spec or role) | 400 |
| `/pve/mplus-runs?season=season-nope` | 404 |
| `/pve/mplus-runs?season=season-mn-1&dungeon=murder-row` | 404, not run in MN 1 |
| `/pve/raid?raidSlug=nope` | 404 |
| `/pve/bosses?raidSlug=current&bossSlug=nope` | 404 |

Every 400 body is `{ message: "Invalid <what>", issues: [{ path, message }] }`, and never
repeats the input. A required numeric parameter (`seasonId`, `rating`, `keystoneRunId`)
goes through `requiredNumber()` (`src/common/pipes/required-number.ts`), so a missing one
reads "is required", not "expected number, received NaN".

To spend a budget in a test, fill the current bucket in Redis: for Raider.io,
`redis.key('budget', 'raiderio', 'minute', Math.floor(Date.now() / 5000))`. For
Blizzard's hour, use one-minute buckets: `redis.key('budget', 'blizzard', 'hour',
Math.floor(Date.now() / 60000))`. The 503 test in `test/pve-mplus-run.spec.ts` does this.

### 13.6 Invariants worth asserting

- **Boards.** Ratings or scores non-increasing down a page; `entries.length ≤ pageSize`;
  `rank` on the M+ boards is `(page − 1) × pageSize + i + 1`; `totalPages` never points past
  row 200,000.
- **`world`.** Every PvP and M+ entry carries `region`. PvP world answers have
  `cutoff: null` and a `regionCutoffs` map.
- **Tier lists.** Exactly the 40 pairs of `ALL_SPECS`; `score` in 0–100 and non-increasing;
  tier order S, A, B, C, D; each line within 2 specs of its baseline (4/10/12/10/4 for 40).
- **Shares.** PvP `share` is 0–1 and sums to ~1 over `specs`; M+ `percent` is 0–100;
  composition `share`s sum to at most 1.
- **Optional keys.** Archived PvP rows have no profile keys at all (absent, not null).
  `previousMythicScore` exists only on the whole `/pve/character` page. Each guild widget
  answers only its own shape.
- **Freshness.** `stale: false` unless an upstream failed; `fetchedAt` is ISO.
- **Compression.** An answer over 1 KB, asked with `Accept-Encoding: br`, has
  `Content-Encoding: br`; `/health*` and `/oidc*` are never compressed.

### 13.7 Writing an integration test

```ts
import { anonymousTokens, bootTestApp, resetRedis, type TestApp } from './support/app.js';
import { openTestDatabase } from './support/database.js';

let app: TestApp, db: Db, drop: () => Promise<void>, token: string;

beforeAll(async () => {
  app = await bootTestApp({ env: { RATE_LIMIT_API_PER_MINUTE: '1000', RAIDERIO_RETRY_LIMIT: '0' } });
  ({ db, drop } = await openTestDatabase(app.dbName));
  // Seed Rankwarden's shapes: catalogue, current-season state, the documents read.
  await db.collection('mplus_seasons').insertMany([/* … */]);
  await db.collection('mplus_season_state').insertMany([/* … */]);
  // Create every index the service hints by name, with Rankwarden's exact name and keys.
  await db.collection('mplus_runs').createIndexes([/* … */]);
  token = (await anonymousTokens(app)).access_token;
});
beforeEach(() => resetRedis(app)); // otherwise the cache answers with the last test's data
afterAll(async () => {
  await drop?.();
  await resetRedis(app);
  await app?.close();
});

it('answers the run', async () => {
  app.upstream.route((req) =>
    req.path === '/raiderio/mythic-plus/run-details' ? { status: 200, body: details } : undefined,
  );
  const res = await fetch(`${app.url}/pve/mplus-run?keystoneRunId=100`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  expect(app.upstream.requestsTo('/raiderio/mythic-plus/run-details')).toHaveLength(1);
});
```

The traps:

- **Hinted indexes must exist.** Board queries pass `hint` with Rankwarden's index name
  (`Indexes`, `MplusBoardIndexes`, `MplusRunIndexes` in `src/database/collections.ts`). On a
  test database without that index the query fails, and the route answers 500. Copy the
  name and keys from `collections.ts`.
- **One configuration per file.** `ConfigModule` reads the environment once per module
  graph, and `bootTestApp` refuses a second boot with different settings. A test that needs
  other settings goes in another file.
- **`CurrentSeasons` caches 60 s in memory**, per app. Seed `season_state` and
  `mplus_season_state` before the first request, and do not change the current season within
  a file.
- **Redis survives between tests** in a file. Call `resetRedis(app)` in `beforeEach`, or a
  cached answer hides the change. That includes the catalogue keys (`pve:raids`,
  `pve:mplus-seasons`).
- **Unrouted upstream calls answer 599.** Route every path the code calls; routes are tried
  newest first. `app.upstream.requestsTo(prefix)` counts calls: that is how "cached, not
  asked again" and "400 before any upstream call" are proved.
- **Upstream paths** on the fake: `/blizzard/<region>/…`, `/raiderio/…`, `/rankwarden/…`,
  `/turnstile`. A fake Rankwarden route may write to the test database before answering, to
  stand for a real sync.
- **Two replicas**: boot twice in one file with the same `env`, passing the same `upstream`,
  as `test/budgets.spec.ts` and `test/pvp-character.spec.ts` do. Each replica signs its
  own tokens in tests, so get a token from each (`anonymousTokens(replica)`). To make two
  requests overlap, add a route that holds its answer (`await` a timer) before returning.
- **Speed**: set `*_RETRY_LIMIT` to `0` in failure tests, or each failure waits for got's
  retry.
- **Dates** in seeds are `Date` objects, as Rankwarden stores them; answers carry ISO strings.

### 13.8 Testing in a local Kubernetes cluster

This machine has a kind cluster, `prodlike`, with Rankwarden deployed. Two local traps:

- Host `kubectl` fails TLS (antivirus interception, or a stale kubeconfig). Run `kubectl` and
  `helm` in a container on the docker `kind` network, with the kubeconfig's server set to
  `https://prodlike-control-plane:6443`.
- Load images with
  `docker save soulseeker:local | docker exec -i prodlike-control-plane ctr -n k8s.io images import -`
  when `kind load` is not available.

Then deploy as §14 says. To prove the NetworkPolicies, start throwaway pods with
`kubectl run --rm -i --restart=Never` in each namespace, with and without the
`soulseeker.io/redis-client=true` label, and try a TCP connect to each service:

- Rankwarden `:3000` and MongoDB `:27017`: open from `soulseeker`, refused from `default`.
- Readiness is per replica: each pod reports upstreams only from its own traffic. Check
  every pod; budgets read the same on all of them.
- Redis: open only to labelled pods in `soulseeker`.
- Soulseeker `:3001`: refused to everything but the gateway namespace.

## 14. Deployment

Read [deploy/README.md](deploy/README.md) for the full procedure. What an agent needs:

- **Namespace `soulseeker`.** It is the default in both scripts (`NAMESPACE`). Rankwarden's
  NetworkPolicies must list it: `networkPolicy.allowedNamespaces` in its `rankwarden` chart,
  `allowedNamespaces` in its `mongodb` chart. That change is the user's, in Rankwarden.
- **Order.**
  1. `create-secrets.sh` creates the namespace, `redis-auth`, `soulseeker-app` and `ghcr`.
     It is idempotent and keeps generated passwords and keys.
  2. `deploy.sh <image tag>` installs the Redis release, waits for it, then installs the
     Soulseeker release and waits. `SKIP_REDIS=1` skips the Redis release.
- **Overrides** without editing charts: `REDIS_HELM_ARGS`, `SOULSEEKER_HELM_ARGS`. For one
  setting, `--set-string envOverrides.KEY=value`, e.g. adding a dev origin to `CORS_ORIGINS`.
- **Charts.**
  - `soulseeker`:
    - Deployment.
    - HPA: 2–6 replicas at 70% CPU. `autoscaling.enabled=false` falls back to `replicas`.
    - PDB: `minAvailable: 1` whenever at least two replicas run.
    - ConfigMap from `env/production.env`. A credential there fails the render.
    - HTTPRoute for `api.rankwarden.gg`, with `/health/ready` redirected to `/health`.
    - NetworkPolicy admitting the gateway namespace only.
  - `redis`:
    - A one-node StatefulSet with AOF on a 1 GiB volume, `volatile-lru` at 256 MB.
    - Password from `redis-auth`.
    - A NetworkPolicy for labelled clients only.
- **Checking a deploy.** Run `kubectl -n soulseeker get pods,hpa,pdb`, then a port-forward
  and the first rows of §13.4:
  - `/health/ready` must show `mongo` and `redis` `ok`;
  - a token must issue with the production origin and resource;
  - one PvP and one PvE character page must show their sync in Rankwarden's log.
- **Redis by hand.** The Secret is base64: decode it, and never print it. There is no named
  user: authenticate as `default`. A port-forward bypasses the NetworkPolicy.
- **Validated in CI**: Helm lint and render with `--namespace soulseeker`, the scripts parse,
  and `env/production.env` passes `config-check`.
- **Not yet verified**: HPA scaling (no metrics-server locally), the Gateway and HTTPRoute,
  DigitalOcean storage, GHCR pulls, and the workflows.
