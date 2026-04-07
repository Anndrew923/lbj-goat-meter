#!/usr/bin/env bash
set -euo pipefail

# Apply Artifact Registry cleanup policies to all Docker repositories.
#
# Policy:
# - Keep most recent 3 versions
# - Delete untagged versions older than 7 days
#
# Safety notes:
# - "Keep" policy wins when an image matches both Keep and Delete.
# - This policy ONLY deletes UNTAGGED versions; tagged versions are not removed by this script.
# - Cleanup runs asynchronously (typically within ~1 day), not immediately at deploy time.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POLICY_FILE="$ROOT_DIR/gcp/artifact-registry/cleanup-policy.json"

PROJECT_ID="${PROJECT_ID:-lbj-goat-meter}"
LOCATION="${LOCATION:-us-central1}"
DRY_RUN="${DRY_RUN:-0}" # set DRY_RUN=1 to preview

if [[ ! -f "$POLICY_FILE" ]]; then
  echo "Missing policy file: $POLICY_FILE" >&2
  exit 1
fi

echo "==> Project: $PROJECT_ID"
echo "==> Location: $LOCATION"
echo "==> Policy: $POLICY_FILE"
echo "==> Dry-run: $DRY_RUN"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud not found. Install Google Cloud SDK first." >&2
  exit 1
fi

# Hard requirement: gcloud must be usable (auth + supported python).
echo "==> Checking gcloud auth & environment..."
gcloud auth list --filter=status:ACTIVE --format="value(account)" --project="$PROJECT_ID" >/dev/null

echo "==> Listing Docker repositories..."
mapfile -t REPOS < <(
  gcloud artifacts repositories list \
    --project="$PROJECT_ID" \
    --location="$LOCATION" \
    --filter="format=DOCKER" \
    --format="value(name)"
)

if [[ "${#REPOS[@]}" -eq 0 ]]; then
  echo "No Docker repositories found in $PROJECT_ID / $LOCATION" >&2
  exit 0
fi

echo "Found ${#REPOS[@]} Docker repos:"
printf ' - %s\n' "${REPOS[@]}"

for REPO in "${REPOS[@]}"; do
  echo
  echo "==> Applying cleanup policies to: $REPO"
  if [[ "$DRY_RUN" == "1" ]]; then
    gcloud artifacts repositories set-cleanup-policies "$REPO" \
      --project="$PROJECT_ID" \
      --location="$LOCATION" \
      --policy="$POLICY_FILE" \
      --dry-run
  else
    gcloud artifacts repositories set-cleanup-policies "$REPO" \
      --project="$PROJECT_ID" \
      --location="$LOCATION" \
      --policy="$POLICY_FILE"
  fi

  echo "==> Verifying policies on: $REPO"
  gcloud artifacts repositories describe "$REPO" \
    --project="$PROJECT_ID" \
    --location="$LOCATION" \
    --format="yaml(cleanupPolicies)"
done

echo
echo "==> Done."
