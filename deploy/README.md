# Deploying Soulseeker

Soulseeker runs in the `soulseeker` namespace of the same DigitalOcean cluster as
Rankwarden. It uses two Helm releases, deployed in this order by `scripts/deploy.sh`:

| Release | Chart | What |
| --- | --- | --- |
| `redis` | `helm/redis` | One Redis 8.10.2 node, append-only file on a 1 GiB volume, password from `redis-auth`; only pods labelled `soulseeker.io/redis-client` may connect |
| `soulseeker` | `helm/soulseeker` | 2–6 replicas under a HorizontalPodAutoscaler (70 % CPU), rolling update, PodDisruptionBudget, HTTPRoute on the cluster Gateway, NetworkPolicy admitting only the gateway namespace |

## Before the first deploy

1. **Rankwarden is deployed**, and its `create-secrets.sh` has created
   `mongodb-auth` with `backend-password` in the `rankwarden` namespace. Rankwarden's
   NetworkPolicies admit the `soulseeker` namespace to its sync endpoints and its
   MongoDB: `networkPolicy.allowedNamespaces` in its `rankwarden` chart and
   `allowedNamespaces` in its `mongodb` chart must list `soulseeker`. Without it,
   readiness fails on MongoDB and every sync times out.
2. **Soulseeker's own upstream credentials exist**:
   - a separate Blizzard API client at develop.battle.net;
   - a separate Raider.io API key.

   Never reuse Rankwarden's: the point is that the two do not share a quota.
3. **A Gateway exists**, with a listener for `api.rankwarden.gg`. Set
   `httpRoute.parentRefs` and `networkPolicy.allowedNamespaces` in `values.yaml` to
   your Gateway and the namespace its data plane runs in.
4. Check `env/production.env`: `OIDC_ISSUER`, `OIDC_API_RESOURCE` and `CORS_ORIGINS`
   must match the real hostnames.
5. **metrics-server runs** in the cluster, for the HPA. DigitalOcean Kubernetes has it.
   Without it the HPA shows `cpu: <unknown>` and holds `minReplicas`; nothing breaks,
   but nothing scales either.

## Scaling

`autoscaling` in `values.yaml`: 2 to 6 replicas, on 70 % of the 100m CPU request. It
scales out by up to 2 pods a minute, and in by 1 pod a minute only after 5 minutes below
target. Replicas are interchangeable because every piece of shared state (budgets, rate
limits, OAuth grants, cache) is in Redis. With autoscaling on, the Deployment carries no
`replicas`, so a release never resets the HPA's count; `autoscaling.enabled=false` falls
back to a fixed `replicas`. The PodDisruptionBudget (`minAvailable: 1`) applies whenever
at least two replicas run. Redis stays one node: a second would be a separate Redis, and
the budgets would be counted twice.

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
| | `ADMIN_API_KEY` | for `POST /admin/hidden`: from the environment, else kept, else generated once |
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
kubectl -n soulseeker port-forward deploy/soulseeker 3001:3001
curl localhost:3001/health/ready     # 200 ok/degraded; 503 = MongoDB or Redis unreachable
```

Logs reach Grafana through Rankwarden's log collector, which follows every namespace
(`{namespace="soulseeker", app="soulseeker"}`).

## Trying it locally

Any local cluster with Rankwarden deployed in it works. Build the image, load it into the
cluster, and override what is DigitalOcean- or Gateway-specific:

```bash
npm run docker:build                                   # soulseeker:local
kind load docker-image soulseeker:local --name <cluster>
BLIZZARD_CLIENT_ID=… BLIZZARD_CLIENT_SECRET=… RAIDER_IO_API_KEY=…   bash deploy/scripts/create-secrets.sh
REDIS_HELM_ARGS="--set storage.className=standard" SOULSEEKER_HELM_ARGS="--set image.repository=soulseeker --set imagePullSecrets=null --set httpRoute.enabled=false"   bash deploy/scripts/deploy.sh local
```

`httpRoute.enabled=false` is needed where the Gateway API is not installed. A port-forward
reaches the pods all the same: it does not pass through the NetworkPolicy.

## What has been verified, and what has not

Verified on a local kind cluster next to Rankwarden's own prod-like deploy, with these
charts and scripts unchanged (2026-11-16), in the namespace then called `backend`, now
`soulseeker`:

- `create-secrets.sh`: it creates the namespace, `redis-auth` and `soulseeker-app`, building
  `MONGODB_URI` from Rankwarden's `backend-password`. Re-run, it keeps the Redis
  password and the OAuth keys, with byte-identical fingerprints.
- `deploy.sh`: Redis ready on a PVC, then both Soulseeker replicas ready. Readiness passes
  only with MongoDB and Redis reachable. An unchanged re-run leaves the pods running.
- The production configuration: `env/production.env` passes `config-check`, and the
  ConfigMap renders from it.
- MongoDB through `mongodb.rankwarden.svc.cluster.local` as the read-only
  `rankwarden_backend`: leaderboards, raids and Mythic+ seasons read real data.
- Redis through `redis.<namespace>.svc.cluster.local`, with its password: OAuth grants,
  budgets and cache.
- OAuth with the production issuer and origin: the anonymous grant issues tokens the API
  accepts.
- Syncs to Rankwarden through `rankwarden.rankwarden.svc.cluster.local:3000`. A PvP
  character page's inline `POST /characters/sync` showed in Rankwarden's log as "2
  brackets, 2 rating rows written". A PvE page's `POST /mplus/characters/sync` showed as
  "8 run(s) in … fully covered". Readiness reports both endpoints `ok`.
- Every NetworkPolicy, both ways:
  - Rankwarden's API and MongoDB are open from Soulseeker's namespace and refused from other
    namespaces.
  - Redis is open only to labelled pods in Soulseeker's namespace.
  - Soulseeker is refused to everything but the gateway namespace.
- The HPA and PDB are created: the HPA at 2/6 replicas, the PDB allowing 1 disruption.

Not verified:

- **Scaling itself.** The local cluster had no metrics-server, so the HPA was created but
  never had a metric to act on.
- The Gateway and HTTPRoute (no Gateway API locally).
- Anything DigitalOcean-specific: `do-block-storage`, pulling from GHCR with the `ghcr`
  secret.
- The GitHub workflows, which have never run.
