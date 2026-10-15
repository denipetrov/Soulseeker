#!/usr/bin/env bash
#
# Deploys Redis, then Soulseeker, to the `backend` namespace:
#
#   1. Redis        StatefulSet up and ready (no rollback: a datastore is never
#                   rolled back automatically)
#   2. Soulseeker   rolling update; rolled back if the new pods never get ready
#
# Rankwarden is deployed separately, by its own pipeline. Soulseeker reads its
# MongoDB and calls its sync endpoints; both admit the `backend` namespace.
#
# Usage:
#   deploy/scripts/deploy.sh <image-tag>
#
# Environment:
#   NAMESPACE (backend)
#   REDIS_HELM_ARGS, SOULSEEKER_HELM_ARGS   extra arguments for each release
#   SKIP_REDIS=1                            leave the Redis release alone

set -euo pipefail

IMAGE_TAG="${1:-}"
if [ -z "$IMAGE_TAG" ]; then
  echo "usage: $0 <image-tag>" >&2
  exit 1
fi

NAMESPACE="${NAMESPACE:-backend}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for tool in kubectl helm; do
  command -v "$tool" >/dev/null || { echo "error: ${tool} is not installed" >&2; exit 1; }
done

# Helm 4 renamed --atomic to --rollback-on-failure.
case "$(helm version --short)" in
  v3.*) ROLLBACK_FLAG=--atomic ;;
  *) ROLLBACK_FLAG=--rollback-on-failure ;;
esac

echo "cluster:   $(kubectl config current-context)"
echo "namespace: ${NAMESPACE}"
echo "image tag: ${IMAGE_TAG}"
echo

for secret in redis-auth soulseeker-app; do
  if ! kubectl get secret "$secret" --namespace "$NAMESPACE" >/dev/null 2>&1; then
    echo "error: secret/${secret} does not exist in ${NAMESPACE}; run deploy/scripts/create-secrets.sh first" >&2
    exit 1
  fi
done

if [ "${SKIP_REDIS:-}" != "1" ]; then
  echo "==> Redis"
  # shellcheck disable=SC2086
  helm upgrade --install redis "$ROOT/helm/redis" \
    --namespace "$NAMESPACE" \
    --wait --timeout 5m \
    ${REDIS_HELM_ARGS:-}
  echo
fi

echo "==> Soulseeker"
# shellcheck disable=SC2086
helm upgrade --install soulseeker "$ROOT/helm/soulseeker" \
  --namespace "$NAMESPACE" \
  --set-string "image.tag=${IMAGE_TAG}" \
  --wait --timeout 10m "$ROLLBACK_FLAG" \
  ${SOULSEEKER_HELM_ARGS:-}

echo
kubectl get pods --namespace "$NAMESPACE" -o wide
echo
echo "Deployed ${IMAGE_TAG}. Readiness, from inside the cluster:"
echo "  kubectl -n ${NAMESPACE} port-forward deploy/soulseeker 3001:3001"
echo "  curl http://localhost:3001/health/ready"
