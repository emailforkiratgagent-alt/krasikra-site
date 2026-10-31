#!/usr/bin/env bash
# One-time setup of the test stand for automatic deploys from GitHub.
#
# Creates (skips what already exists):
#   - service account krasikra-ci-sa for GitHub Actions and its roles;
#   - workload identity federation for GitHub OIDC (no keys stored in GitHub);
#   - Lockbox secret krasikra-web-test with generated PAYLOAD_SECRET and
#     SETTINGS_ENCRYPTION_KEY, readable by the runtime account krasikra-web-sa.
#
# Run on a computer with a configured `yc` CLI (owner or admin of the folder):
#   bash infra/yc/setup-ci.sh
set -euo pipefail

FOLDER_ID="b1ghi207b5unmot9jler"
REGISTRY_ID="crpctlodpodsi49b12cm"
RUNTIME_SA_ID="ajeaghsfme6fi2g3j6es" # krasikra-web-sa
CI_SA_NAME="krasikra-ci-sa"
FEDERATION_NAME="krasikra-github"
GITHUB_OWNER="emailforkiratgagent-alt"
GITHUB_REPO="krasikra-site"
SECRET_NAME="krasikra-web-test"

GITHUB_ISSUER="https://token.actions.githubusercontent.com"
GITHUB_SUBJECT="repo:${GITHUB_OWNER}/${GITHUB_REPO}:ref:refs/heads/main"

# Top-level "id:" from yc YAML output.
yaml_id() { awk '/^id:/ {print $2; exit}'; }

say() { printf '\n==> %s\n' "$*"; }

# Add a role binding; an already existing binding is not an error.
bind() { # <description> <command...>
  local what="$1"; shift
  local out
  if out="$("$@" 2>&1)"; then
    echo "  + $what"
  elif grep -qi "already" <<<"$out"; then
    echo "  = $what (already granted)"
  else
    echo "$out" >&2
    exit 1
  fi
}

command -v yc >/dev/null || { echo "yc CLI not found" >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl not found" >&2; exit 1; }
yc iam workload-identity --help >/dev/null 2>&1 || {
  echo "This yc version has no workload identity commands. Update it: yc components update" >&2
  exit 1
}

say "Service account $CI_SA_NAME"
CI_SA_ID="$(yc iam service-account get --name "$CI_SA_NAME" --folder-id "$FOLDER_ID" --format yaml 2>/dev/null | yaml_id || true)"
if [ -z "$CI_SA_ID" ]; then
  CI_SA_ID="$(yc iam service-account create --name "$CI_SA_NAME" --folder-id "$FOLDER_ID" \
    --description "GitHub Actions: build and deploy the test stand" --format yaml | yaml_id)"
  echo "  + created $CI_SA_ID"
else
  echo "  = exists $CI_SA_ID"
fi

say "Roles for $CI_SA_NAME"
for role in serverless-containers.editor functions.editor lockbox.viewer; do
  bind "$role on folder" yc resource-manager folder add-access-binding "$FOLDER_ID" \
    --role "$role" --subject "serviceAccount:$CI_SA_ID"
done
bind "container-registry.images.pusher on registry" yc container registry add-access-binding "$REGISTRY_ID" \
  --role container-registry.images.pusher --subject "serviceAccount:$CI_SA_ID"
bind "iam.serviceAccounts.user on krasikra-web-sa" yc iam service-account add-access-binding "$RUNTIME_SA_ID" \
  --role iam.serviceAccounts.user --subject "serviceAccount:$CI_SA_ID"

say "Workload identity federation $FEDERATION_NAME"
FEDERATION_ID="$(yc iam workload-identity oidc federation get --name "$FEDERATION_NAME" --folder-id "$FOLDER_ID" --format yaml 2>/dev/null | yaml_id || true)"
if [ -z "$FEDERATION_ID" ]; then
  FEDERATION_ID="$(yc iam workload-identity oidc federation create --name "$FEDERATION_NAME" --folder-id "$FOLDER_ID" \
    --issuer "$GITHUB_ISSUER" \
    --audiences "https://github.com/${GITHUB_OWNER}" \
    --jwks-url "${GITHUB_ISSUER}/.well-known/jwks" \
    --format yaml | yaml_id)"
  echo "  + created $FEDERATION_ID"
else
  echo "  = exists $FEDERATION_ID"
fi

say "Federated credential for $GITHUB_SUBJECT"
bind "main branch of ${GITHUB_OWNER}/${GITHUB_REPO} -> $CI_SA_NAME" \
  yc iam workload-identity federated-credential create \
    --service-account-id "$CI_SA_ID" \
    --federation-id "$FEDERATION_ID" \
    --external-subject-id "$GITHUB_SUBJECT"

say "Lockbox secret $SECRET_NAME"
if yc lockbox secret get --name "$SECRET_NAME" --folder-id "$FOLDER_ID" >/dev/null 2>&1; then
  echo "  = exists (values are not changed)"
else
  PAYLOAD_SECRET="$(openssl rand -hex 32)"
  SETTINGS_ENCRYPTION_KEY="$(openssl rand -base64 32)"
  yc lockbox secret create --name "$SECRET_NAME" --folder-id "$FOLDER_ID" \
    --description "Test stand app secrets" \
    --payload "[{\"key\":\"PAYLOAD_SECRET\",\"text_value\":\"$PAYLOAD_SECRET\"},{\"key\":\"SETTINGS_ENCRYPTION_KEY\",\"text_value\":\"$SETTINGS_ENCRYPTION_KEY\"}]" \
    >/dev/null
  unset PAYLOAD_SECRET SETTINGS_ENCRYPTION_KEY
  echo "  + created with generated values"
fi
bind "lockbox.payloadViewer for krasikra-web-sa" yc lockbox secret add-access-binding --name "$SECRET_NAME" \
  --folder-id "$FOLDER_ID" --role lockbox.payloadViewer --subject "serviceAccount:$RUNTIME_SA_ID"

say "Done"
cat <<EOF
Send this line to the chat (it is an ID, not a secret):

  CI_SA_ID=$CI_SA_ID

Federation: $FEDERATION_ID
EOF
