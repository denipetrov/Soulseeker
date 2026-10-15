#!/usr/bin/env bash
#
# Creates or updates every Secret the two charts read. Run once before the
# first deploy, and again whenever a credential changes.
#
# Credentials come from the environment and go to the cluster on standard
# input: none is ever written to disk, put on a command line, or printed.
#
# Required:
#   BLIZZARD_CLIENT_ID  BLIZZARD_CLIENT_SECRET  RAIDER_IO_API_KEY
#     Soulseeker's own — a separate Blizzard client and Raider.io key from
#     Rankwarden's, so the two never share a request budget.
# Optional:
#   GHCR_USERNAME  GHCR_TOKEN     pull secret for the image registry
#   TURNSTILE_SECRET              when TURNSTILE_ENABLED=true
#   NAMESPACE (backend)  RANKWARDEN_NAMESPACE (rankwarden)  REDIS_RELEASE (redis)
#
# Generated here once and kept on every later run, read back from the cluster:
#   the Redis password, the OAuth signing key and the cookie keys. Replacing the
#   signing key would log out every visitor; to rotate it, see
#   scripts/generate-oidc-keys.mjs.
#
# The MongoDB password of `rankwarden_backend` (read-only) is read from
# Rankwarden's `mongodb-auth` Secret, where its create-secrets.sh made it.

set -euo pipefail

NAMESPACE="${NAMESPACE:-backend}"
RANKWARDEN_NAMESPACE="${RANKWARDEN_NAMESPACE:-rankwarden}"
REDIS_RELEASE="${REDIS_RELEASE:-redis}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

for name in BLIZZARD_CLIENT_ID BLIZZARD_CLIENT_SECRET RAIDER_IO_API_KEY; do
  if [ -z "${!name:-}" ]; then
    echo "error: ${name} is not set" >&2
    exit 1
  fi
done

for tool in kubectl node; do
  command -v "$tool" >/dev/null || { echo "error: ${tool} is not installed" >&2; exit 1; }
done

kubectl get namespace "$NAMESPACE" >/dev/null 2>&1 || kubectl create namespace "$NAMESPACE" >/dev/null

# A JSON string literal. Values are passed to the cluster as JSON on stdin, so
# anything a credential may contain is safe; a newline never belongs in one.
json() {
  case "$1" in *$'\n'*) echo "error: a credential contains a newline" >&2; exit 1 ;; esac
  local value=${1//\\/\\\\}
  printf '"%s"' "${value//\"/\\\"}"
}

# apply_secret <name> <type> <key> <value> [<key> <value> ...]
apply_secret() {
  local name=$1 type=$2 body="" separator=""
  shift 2
  while [ $# -gt 0 ]; do
    body="${body}${separator}$(json "$1"): $(json "$2")"
    separator=", "
    shift 2
  done

  printf '{"apiVersion": "v1", "kind": "Secret", "type": %s, "metadata": {"name": %s}, "stringData": {%s}}' \
    "$(json "$type")" "$(json "$name")" "$body" |
    kubectl apply --namespace "$NAMESPACE" -f - >/dev/null
  echo "applied secret/${name}"
}

# existing <namespace> <secret> <key>: the decoded value, or nothing.
existing() {
  kubectl get secret "$2" --namespace "$1" -o "jsonpath={.data.$3}" 2>/dev/null | base64 -d 2>/dev/null || true
}

random_password() {
  node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
}

# --- Redis --------------------------------------------------------------------
REDIS_PASSWORD="$(existing "$NAMESPACE" redis-auth password)"
REDIS_PASSWORD="${REDIS_PASSWORD:-$(random_password)}"
apply_secret redis-auth Opaque password "$REDIS_PASSWORD"

# --- MongoDB (Rankwarden's, read-only user) -----------------------------------
BACKEND_PASSWORD="$(existing "$RANKWARDEN_NAMESPACE" mongodb-auth backend-password)"
if [ -z "$BACKEND_PASSWORD" ]; then
  echo "error: secret/mongodb-auth in ${RANKWARDEN_NAMESPACE} has no backend-password;" \
    "run Rankwarden's create-secrets.sh first" >&2
  exit 1
fi
MONGODB_URI="mongodb://rankwarden_backend:${BACKEND_PASSWORD}@mongodb.${RANKWARDEN_NAMESPACE}.svc.cluster.local:27017/rankwarden?authSource=admin"

# --- OAuth keys: generated once, then kept --------------------------------------
OIDC_JWKS="$(existing "$NAMESPACE" soulseeker-app OIDC_JWKS)"
OIDC_COOKIE_KEYS="$(existing "$NAMESPACE" soulseeker-app OIDC_COOKIE_KEYS)"
if [ -z "$OIDC_JWKS" ] || [ -z "$OIDC_COOKIE_KEYS" ]; then
  GENERATED="$(node "$ROOT/scripts/generate-oidc-keys.mjs")"
  OIDC_JWKS="${OIDC_JWKS:-$(printf '%s\n' "$GENERATED" | sed -n 's/^OIDC_JWKS=//p')}"
  OIDC_COOKIE_KEYS="${OIDC_COOKIE_KEYS:-$(printf '%s\n' "$GENERATED" | sed -n 's/^OIDC_COOKIE_KEYS=//p')}"
  echo "generated OAuth keys"
fi

apply_secret soulseeker-app Opaque \
  BLIZZARD_CLIENT_ID "$BLIZZARD_CLIENT_ID" \
  BLIZZARD_CLIENT_SECRET "$BLIZZARD_CLIENT_SECRET" \
  RAIDER_IO_API_KEY "$RAIDER_IO_API_KEY" \
  MONGODB_URI "$MONGODB_URI" \
  REDIS_URL "redis://:${REDIS_PASSWORD}@${REDIS_RELEASE}.${NAMESPACE}.svc.cluster.local:6379" \
  OIDC_JWKS "$OIDC_JWKS" \
  OIDC_COOKIE_KEYS "$OIDC_COOKIE_KEYS" \
  TURNSTILE_SECRET "${TURNSTILE_SECRET:-}"

# --- Registry -------------------------------------------------------------------
if [ -n "${GHCR_USERNAME:-}" ] && [ -n "${GHCR_TOKEN:-}" ]; then
  AUTH="$(printf '%s:%s' "$GHCR_USERNAME" "$GHCR_TOKEN" | base64 | tr -d '\n')"
  apply_secret ghcr kubernetes.io/dockerconfigjson \
    .dockerconfigjson "{\"auths\":{\"ghcr.io\":{\"auth\":\"${AUTH}\"}}}"
fi
