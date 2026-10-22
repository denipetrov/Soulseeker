# Soulseeker

The backend for the front end of the Rankwarden data. It reads the ladders and
characters that [Rankwarden](../Rankwarden) keeps in MongoDB, looks specific players up
on demand from Blizzard and Raider.io, caches in Redis, and pushes fresh character data
back to Rankwarden through its sync endpoints. Every API request carries an OAuth 2.0
access token issued by Soulseeker itself.

| | |
| --- | --- |
| Runtime | Node 24, NestJS 12, TypeScript ESM |
| Reads | MongoDB `rankwarden`, as the read-only `rankwarden_backend` user |
| Writes | Redis (cache, budgets, rate limits, OAuth state); Rankwarden's sync endpoints |
| Upstreams | Blizzard Profile API and Raider.io, **with its own credentials and budget** |
| Auth | OAuth 2.0 authorization server at `/oidc` (oidc-provider); anonymous sessions now, Battle.net login later |
| Hosting | DigitalOcean Kubernetes, namespace `backend`, 2+ replicas behind the Gateway API |

**State of the code:** a runnable skeleton. Configuration, logging, health, MongoDB,
Redis, both upstream clients with their budgets, the Rankwarden sync client and OAuth
are wired and tested. The front-end endpoints so far are search suggestions
(`src/search/`), the PvP leaderboard, spec representation and the PvP character page
(`src/pvp/`), and the PvE character page (`src/pve/`).

## How a request is handled

1. On first load the front end gets a token pair from `POST /oidc/token` with
   `grant_type=urn:soulseeker:grant-type:anonymous`. That request must come from an
   allowed `Origin`, is limited per IP, and can require a Cloudflare Turnstile token.
2. Every API call carries `Authorization: Bearer <access token>`. The token is an ES256
   JWT (`at+jwt`) for the API resource, verified locally against the signing keys. It
   lives 10 minutes.
3. The front end renews it with `grant_type=refresh_token`. Refresh tokens rotate on
   every use; presenting a used one revokes the whole session.
4. Each API call is rate-limited per session and per IP (Redis, shared by replicas).
5. Data comes from MongoDB first, then the Redis cache, then Blizzard or Raider.io.
   Every upstream attempt is charged to Soulseeker's own budget in Redis. A spent
   budget fails at once with `BudgetExhaustedError`, and the caller serves stored data.
6. Fresh data goes back to Rankwarden (`POST /characters/sync`,
   `POST /mplus/characters/sync`) after the response is sent. A 409 is retried with
   backoff.

## Getting started

```bash
cp .env.example .env            # fill in BLIZZARD_* and RAIDER_IO_API_KEY (Soulseeker's own)
npm run keys:generate >> .env   # optional locally: a lasting OAuth signing key
npm install                     # needs a read:packages token for @denipetrov/* in ~/.npmrc
npm run db:up                   # Redis; MongoDB is Rankwarden's (or: npm run db:up:standalone)
npm run start:dev               # http://localhost:3001
```

Or in Docker, with the same `.env`:

```bash
npm run docker:build            # image soulseeker:local; finds the npm token and any extra CA itself
npm run docker:up               # Redis + the app on :3001; MongoDB from the host
npm run docker:logs
npm run docker:down
```

On a machine whose antivirus or proxy re-signs HTTPS (Avast here), set
`DOCKER_EXTRA_CA` in `.env` to its root certificate so the container can reach
Blizzard and Raider.io.

```bash
curl localhost:3001/health/ready
curl -H 'Origin: http://localhost:5173' -X POST localhost:3001/oidc/token \
  -d 'grant_type=urn:soulseeker:grant-type:anonymous&client_id=soulseeker-web'
curl -H "Authorization: Bearer <access_token>" localhost:3001/session
```

## Endpoints

| Route | Auth | Purpose |
| --- | --- | --- |
| `POST /oidc/token` | Origin + rate limit | Anonymous grant, `refresh_token` grant |
| `GET /oidc/.well-known/openid-configuration`, `/oidc/jwks` | none | Discovery and public keys |
| `POST /oidc/token/revocation` | none | Revoke a refresh token (logout) |
| `GET /session` | token | Who the token says the caller is |
| `GET /search/suggestions?type=pvp&q=…` (or `type=pve`) | token | Name suggestions as the visitor types: PvP characters, or Mythic+ characters and guilds; accent- and case-insensitive |
| `GET /pvp/leaderboard?region=eu&seasonId=42&bracket=3v3&page=1` | token | A PvP ladder page: live ratings enriched from `characters`, or a finished season's archive; optional `class`/`spec` for the current season |
| `GET /pvp/spec-representation?region=eu&bracket=3v3&rating=2100&date=2026-10-20` | token | Which specs are played at or above a rating on one day; `getEarliestDate=true` adds the first day with data |
| `GET /pvp/character?region=us&realmSlug=demon-soul&characterName=Manongauz&locale=en_US` | token | One PvP character from Blizzard: profile, ladders, talents, stats, equipment, render and PvP titles; cached 6 h, `forceRefresh=true` once per 5 min; pushes the ratings to Rankwarden |
| `GET /pve/character?region=us&realmSlug=demon-soul&characterName=Manongauz` | token | One PvE character from Raider.io: gear, talents, guild, current raids, M+ scores, ranks and best runs; `raidProgression=<raid>` and/or `mplusSeasonScore=<season>` for just those; cached 1 h, `forceRefresh=true` once per 5 min; pushes the season's runs to Rankwarden |
| `GET /health` | none | Liveness: process only |
| `GET /health/ready` | none | Readiness: 503 if MongoDB or Redis is down; upstreams only degrade it |

## API docs

Outside production, Swagger UI is at **http://localhost:3001/docs** (the spec at
`/docs/openapi.json`); in production both are absent.

1. Open `POST /oidc/token` and press **Try it out**, then **Execute**. The defaults are
   the anonymous grant.
2. Copy `access_token` from the response.
3. Press **Authorize**, paste the token, and every other route can then be tried. A
   token lasts 10 minutes; repeat step 1 for a new one.

## Testing

| Command | Covers | Needs |
| --- | --- | --- |
| `npm test` | `src/**/*.spec.ts`: schema, budgets, keys, sync client | nothing |
| `npm run test:int` | `test/**/*.spec.ts`: the real app, real MongoDB and Redis, a fake upstream server | MongoDB, Redis |
| `npm run test:all` | both | |

Test databases are `soulseeker_test_*` and Redis keys `sstest_*`; the harness refuses
anything else, and upstream hosts default to a dead local port.

## Deployment

Not deployed yet: work happens locally and in Docker for now. The cluster setup is
ready for when it is. `git tag v0.1.0 && git push --tags` publishes the image; the manual **Deploy** workflow
runs `deploy/scripts/create-secrets.sh` and `deploy/scripts/deploy.sh <tag>`. See
[deploy/README.md](deploy/README.md).

## Layout

```
src/
  main.ts, configure-app.ts      bootstrap; middleware order (OIDC before the body parser)
  config/                        env schema (zod), config module
  common/                        logging, health providers, budgets, pipes, utils
  database/                      read-only MongoDB, Rankwarden collection names
  redis/                         connection, cache
  auth/                          authorization server, access-token and rate-limit guards
  blizzard/  raiderio/           upstream clients
  rankwarden/                    sync client and mirrored request schemas
  characters/                    read-side entities; feature endpoints go here
  health/
test/                            integration suite and harness
deploy/                          Helm charts (soulseeker, redis), scripts
```

[SKILLS.md](SKILLS.md) is the reference for agents and the detail behind every decision
here.
