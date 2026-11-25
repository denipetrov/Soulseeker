# Soulseeker

Soulseeker is the API behind the Rankwarden website. [Rankwarden](../Rankwarden) collects
World of Warcraft rankings into MongoDB; Soulseeker turns that data into what the front
end shows: PvP ladders, title cutoffs, tier lists, Mythic+ boards, raid races and
character pages.

What it reads, and what it does with it:

- It **reads** Rankwarden's MongoDB, read-only.
- It **looks up** single characters, guilds and runs on demand from Blizzard and Raider.io,
  with its own API keys and request budgets.
- It **caches** in Redis.
- It **sends** fresh character data back to Rankwarden, so every page visit improves the
  shared database.

Every API call needs an OAuth 2.0 access token, which Soulseeker issues itself.

| | |
| --- | --- |
| Runtime | Node 24, NestJS 12, TypeScript (ESM) |
| Reads | MongoDB `rankwarden`, as the read-only `rankwarden_backend` user |
| Writes | Redis (cache, budgets, rate limits, OAuth state); Rankwarden's two sync endpoints |
| Upstreams | Blizzard Profile API and Raider.io, **with Soulseeker's own credentials and budget** |
| Auth | OAuth 2.0 server at `/oidc`; anonymous sessions now, Battle.net login later |
| Hosting | DigitalOcean Kubernetes, namespace `soulseeker`, 2–6 replicas behind the Gateway API, public at `api.rankwarden.gg` |

## Documentation

| Document | For |
| --- | --- |
| [Soulseeker Handbook](https://claude.ai/artifact/NinpdHpweHpZmjF6N5kmxv) (online) | Everyone. Every endpoint with its parameters and response, the architecture, configuration and deployment. |
| Swagger UI at `/docs` | Trying the API from a browser, outside production (see below) |
| [SKILLS.md](SKILLS.md) | Agents and maintainers: every decision, trap and test recipe in detail |
| [deploy/README.md](deploy/README.md) | Deploying to a cluster |

## Getting started

You need Node 24, Docker, and a GitHub token with `read:packages` in `~/.npmrc` for the
private `@denipetrov/*` packages. MongoDB is Rankwarden's: start Rankwarden's own
compose file first, or use the standalone MongoDB below.

```bash
cp .env.example .env            # fill in BLIZZARD_* and RAIDER_IO_API_KEY (Soulseeker's own, never Rankwarden's)
npm run keys:generate >> .env   # optional locally: a lasting OAuth signing key, so tokens survive restarts
npm install
npm run db:up                   # Redis (add MongoDB with: npm run db:up:standalone)
npm run start:dev               # http://localhost:3001
```

Check it is up, get a token, and call the API:

```bash
curl localhost:3001/health/ready

curl -X POST localhost:3001/oidc/token -H 'Origin: http://localhost:5173' \
  -d grant_type=urn:soulseeker:grant-type:anonymous -d client_id=soulseeker-web
# → { "access_token": "eyJ…", "refresh_token": "…", "expires_in": 600, … }

curl -H "Authorization: Bearer <access_token>" \
  "localhost:3001/pvp/leaderboard?region=eu&seasonId=42&bracket=3v3"
```

The token request must carry an `Origin` from `CORS_ORIGINS`, or it is refused with
403 "origin not allowed".

### In Docker

```bash
npm run docker:build            # image soulseeker:local; finds the npm token and any extra CA itself
npm run docker:up               # Redis + the app on :3001; MongoDB and Rankwarden from the host
npm run docker:logs
npm run docker:down
```

If an antivirus or proxy re-signs HTTPS on your machine (Avast does), set
`DOCKER_EXTRA_CA` in `.env` to its root certificate, or the container cannot reach
Blizzard and Raider.io.

### Swagger UI

Outside production, **http://localhost:3001/docs** documents every route.

1. Open `POST /oidc/token`, press **Try it out**, then **Execute**. The defaults are the
   anonymous grant.
2. Copy `access_token` from the response.
3. Press **Authorize** and paste the token. Every other route can now be tried. A token
   lasts 10 minutes; repeat step 1 for a new one.

## How a request is handled

1. The front end gets a token pair from `POST /oidc/token` with the anonymous grant. The
   request must come from an allowed `Origin`, is limited per IP, and can require a
   Cloudflare Turnstile token.
2. Every API call carries `Authorization: Bearer <access token>`, an ES256 JWT that is
   checked locally. It lives 10 minutes and is renewed with the refresh token, which
   rotates on every use.
3. Each call is rate-limited per session and per IP, in Redis, so every replica shares the
   count.
4. Query parameters are validated. A bad one answers 400 and lists every problem.
5. Data comes from MongoDB, then the Redis cache, then Blizzard or Raider.io. Every
   upstream request is charged to Soulseeker's budget first. When the budget is spent, a
   cached copy is served (`"stale": true`), or the answer is 503 with `Retry-After`.
6. Fresh character data goes to Rankwarden (`POST /characters/sync`,
   `POST /mplus/characters/sync`).

## Endpoints

All need a token except health and `/oidc`. Full parameters and responses are in the
[handbook](https://claude.ai/artifact/NinpdHpweHpZmjF6N5kmxv).

**Platform**

| Route | Purpose |
| --- | --- |
| `POST /oidc/token` | Anonymous grant and `refresh_token` grant (Origin-checked, rate-limited) |
| `GET /oidc/.well-known/openid-configuration`, `/oidc/jwks` | Discovery and public keys |
| `POST /oidc/token/revocation` | Revoke a refresh token (logout) |
| `GET /session` | Who the token says the caller is |
| `GET /health`, `GET /health/ready` | Liveness; readiness (503 if MongoDB or Redis is down) |
| `GET /search/suggestions?type=pvp&q=biba` | Name suggestions while typing: PvP characters, or Mythic+ characters and guilds |

**PvP**

| Route | Purpose |
| --- | --- |
| `GET /pvp/leaderboard?region=eu&seasonId=42&bracket=3v3&page=1` | A ladder page, live or archived; optional `class`/`spec`, or `role`/`subRole` |
| `GET /pvp/cutoffs?region=eu&bracket=shuffle` | Title cutoffs and how many of each spec reach them, optionally for one `role`/`subRole`; with `class`+`spec`, the characters |
| `GET /pvp/tier-list?region=eu&bracket=shuffle` | Every spec scored 0–100 and ranked S to D |
| `GET /pvp/hero-talents?region=world&bracket=3v3&top=50` | Hero talent trees of each spec's top players |
| `GET /pvp/spec-representation?region=eu&bracket=3v3&rating=2100&date=latest` | Spec shares at a rating on one day; `getEarliestDate=true` for the calendar |
| `GET /pvp/spec-representation/history?region=eu&bracket=shuffle&rating=2100` | The last 31 days of spec shares |
| `GET /pvp/character?region=us&realmSlug=tichondrius&characterName=Petkick` | One character from Blizzard; syncs ratings to Rankwarden |

Every PvP board also takes `region=world`: all regions together.

**Role filters.** `/pvp/leaderboard`, `/pvp/cutoffs` and `/pve/mplus-leaderboard` take
`role` (`tank`, `healer`, `dps`) and `subRole` (`melee`, `ranged`, damage dealers only).
They work with or without `class`, never with `spec`. Each spec's role comes from
`@denipetrov/spirit-link` (`SPECIALIZATIONS`, 0.6.0).
Example: `/pvp/leaderboard?region=us&seasonId=42&bracket=shuffle&subRole=melee`.

**Ids.** Wherever an answer names a class, spec, race or hero talent tree, it also carries
Blizzard's id (`classId`, `specId`, `raceId`, `heroTalentId`), the same on PvP and PvE.

**PvE**

| Route | Purpose |
| --- | --- |
| `GET /pve/character?region=us&realmSlug=illidan&characterName=Bondd` | One character from Raider.io (whole page, or `raidProgression` / `mplusSeasonScore`); syncs runs |
| `GET /pve/guild?region=eu&realmSlug=tarren-mill&guildName=Echo` | One guild widget: summary, `showFullRoster`, a raid, or one boss kill |
| `GET /pve/raids` | Every catalogued raid |
| `GET /pve/raid?raidSlug=current&region=world&difficulty=mythic` | One raid's top 100 guilds |
| `GET /pve/bosses?region=world&raidSlug=current&top=10` | The first guilds to kill each boss |
| `GET /pve/mplus-seasons` | Every Mythic+ season with dungeons and cutoffs, and every affix |
| `GET /pve/mplus-leaderboard?region=world&season=current&class=mage&spec=arcane` | Mythic+ characters by score, paged; optional `class`/`spec`, or `role`/`subRole` |
| `GET /pve/mplus-runs?region=world&season=current&dungeon=murder-row` | Mythic+ runs by score, paged |
| `GET /pve/mplus-run?keystoneRunId=19324786` | One run's details and roster, from Raider.io |
| `GET /pve/mplus-compositions?region=world&top=1000` | The 50 most played party compositions |
| `GET /pve/spec-representation?region=world&dungeonSlug=all&season=current` | Spec shares in a season's best runs |
| `GET /pve/tier-list?region=world` | Every Mythic+ spec scored 0–100 and ranked S to D |
| `GET /pve/mplus-cutoffs?region=world&season=current` | Percentile cutoffs, day by day (Raider.io) |

**Languages**

| Route | Purpose |
| --- | --- |
| `GET /i18n/names?locale=de_DE` | Class, spec, race, hero talent, affix, dungeon, raid and boss names in one language, from Blizzard, for translating what Raider.io sends in English |

Raider.io answers in English only. The front end translates PvE names by looking them up
by the ids and slugs every answer carries. `/pvp/character` is already translated: it takes
`locale`. Languages: `en_US`, `es_ES`, `pt_BR`, `fr_FR`, `de_DE`, `ru_RU`, `ko_KR`, `zh_CN`,
and Blizzard's others.

## Testing

| Command | What it runs | Needs |
| --- | --- | --- |
| `npm test` | Unit tests, `src/**/*.spec.ts` | nothing |
| `npm run test:int` | Integration tests, `test/**/*.spec.ts`: the real app on real MongoDB and Redis, with fake upstreams | `npm run db:up` (and a MongoDB) |
| `npm run test:all` | Both | |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint | |

Tests use only `soulseeker_test_*` databases and `sstest_*` Redis keys, and every
upstream points at a local fake, so they never touch your data or spend real quota.

## Deployment

Soulseeker deploys to the `soulseeker` namespace of the cluster Rankwarden runs in, as
two Helm releases: `redis` and `soulseeker` (with an autoscaler, 2–6 replicas).

```bash
git tag v0.1.0 && git push --tags          # publishes the image
# then run the Deploy workflow, or by hand:
bash deploy/scripts/create-secrets.sh      # with BLIZZARD_*, RAIDER_IO_API_KEY, GHCR_* set
bash deploy/scripts/deploy.sh v0.1.0
```

Rankwarden's network policies must admit the `soulseeker` namespace. See
[deploy/README.md](deploy/README.md) for prerequisites, secrets and a local-cluster
recipe.

## Layout

```
src/
  main.ts, configure-app.ts   bootstrap; middleware order (OIDC before the body parser)
  config/                     environment schema (zod)
  common/                     logging, health, upstream budgets, validation pipe, utils
  database/                   read-only MongoDB; Rankwarden's collection and index names
  redis/                      connection, cache, refresh cooldown
  auth/                       OAuth server, access-token and rate-limit guards
  blizzard/  raiderio/        upstream clients and their response schemas
  rankwarden/                 sync client and mirrored request schemas
  seasons/                    current seasons, raid and Mythic+ catalogue
  search/                     /search/suggestions
  pvp/                        PvP endpoints; specs.ts lists every class and spec
  pve/                        PvE endpoints; shared/ holds the season resolver and guild join
  localization/               /i18n/names: translated game names from Blizzard
  health/  docs/              health endpoints; Swagger
test/                         integration suite and its harness (test/support/)
deploy/                       Helm charts (soulseeker, redis), scripts
```
