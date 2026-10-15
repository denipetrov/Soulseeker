# Deploying Soulseeker

Soulseeker runs in the `backend` namespace of the same DigitalOcean cluster as
Rankwarden. It uses two Helm releases, deployed in this order by `scripts/deploy.sh`:

| Release | Chart | What |
| --- | --- | --- |
| `redis` | `helm/redis` | One Redis 8.10.2 node, append-only file on a 1 GiB volume, password from `redis-auth`; only pods labelled `soulseeker.io/redis-client` may connect |
| `soulseeker` | `helm/soulseeker` | 2 replicas, rolling update, PodDisruptionBudget, HTTPRoute on the cluster Gateway, NetworkPolicy admitting only the gateway namespace |

## Before the first deploy

1. **Rankwarden is deployed**, and its `create-secrets.sh` has created
   `mongodb-auth` with `backend-password` in the `rankwarden` namespace. Rankwarden's
   NetworkPolicies already admit the `backend` namespace to its sync endpoints and its
   MongoDB.
2. **Soulseeker's own upstream credentials exist**:
   - a separate Blizzard API client at develop.battle.net;
   - a separate Raider.io API key.

   Never reuse Rankwarden's: the point is that the two do not share a quota.
3. **A Gateway exists**, with a listener for `api.rankwarden.gg`. Set
   `httpRoute.parentRefs` and `networkPolicy.allowedNamespaces` in `values.yaml` to
   your Gateway and the namespace its data plane runs in.
4. Check `env/production.env`: `OIDC_ISSUER`, `OIDC_API_RESOURCE` and `CORS_ORIGINS`
   must match the real hostnames.

## Secrets

`scripts/create-secrets.sh` creates them all from environment variables, and is
idempotent:

| Secret | Keys | Source |
| --- | --- | --- |
| `redis-auth` | `password` | generated once, then kept |
| `soulseeker-app` | `BLIZZARD_CLIENT_ID`, `BLIZZARD_CLIENT_SECRET`, `RAIDER_IO_API_KEY` | environment |
| | `MONGODB_URI` | built from Rankwarden's `backend-password` (read-only user) |
| | `REDIS_URL` | built from `redis-auth` |
| | `OIDC_JWKS`, `OIDC_COOKIE_KEYS` | generated once, then kept |
| | `TURNSTILE_SECRET` | environment, optional |
| `ghcr` | `.dockerconfigjson` | `GHCR_USERNAME`, `GHCR_TOKEN` |

Replacing `OIDC_JWKS` logs every visitor out once their access token expires. To
rotate the key without that, see `scripts/generate-oidc-keys.mjs`.

## Deploy

```bash
git tag v0.1.0 && git push origin v0.1.0     # release.yml publishes the image
# then run the Deploy workflow with image_tag=v0.1.0, or by hand:
BLIZZARD_CLIENT_ID=… BLIZZARD_CLIENT_SECRET=… RAIDER_IO_API_KEY=… \
  bash deploy/scripts/create-secrets.sh
bash deploy/scripts/deploy.sh v0.1.0
```

## Checking it

```bash
kubectl -n backend port-forward deploy/soulseeker 3001:3001
curl localhost:3001/health/ready     # 200 ok/degraded; 503 = MongoDB or Redis unreachable
```

Logs reach Grafana through Rankwarden's log collector, which follows every namespace
(`{namespace="backend", app="soulseeker"}`).

## Not yet verified

The charts lint and render, and the image builds and boots. Nothing has been deployed
to a real cluster yet, and the Gateway and HTTPRoute have not been exercised.
