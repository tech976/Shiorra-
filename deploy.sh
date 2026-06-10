#!/usr/bin/env bash
# ============================================================================
# Shiōrra — production deploy script (Mac → VPS)
#
# Self-contained. Targets are HARDCODED below — this script can ONLY ever
# touch the Shiōrra VPS. Never reads CRM_* env vars. Never shares names,
# paths, or process IDs with the user's separate CRM project.
#
# Safety guard at the top refuses to run if any target matches CRM values:
#   CRM IP:    147.93.107.46
#   CRM path:  /opt/crm
#   CRM PM2:   crm
#   CRM repo:  github.com/tech976/CRM-
#
# Usage:
#   ./deploy.sh           — real deploy (push code + SSH + pull + migrate + restart)
#   ./deploy.sh --dry-run — show every action that WOULD run; change nothing
# ============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# HARDCODED TARGETS — edit ONLY this block. Never use env vars.
# ---------------------------------------------------------------------------
HOST="REPLACE_WITH_SHIORRA_VPS_IP"      # the IP of YOUR new Shiōrra VPS (NOT 147.93.107.46)
SSH_USER="deploy"                        # the unix user on the VPS that owns /opt/shiorra
SSH_KEY=""                               # path to ssh key (e.g. ~/.ssh/shiorra_deploy); leave "" to use default
APP_PATH="/opt/shiorra"                  # path on VPS — distinct from CRM's /opt/crm
APP_SUBDIR="app"                         # Node project lives at $APP_PATH/$APP_SUBDIR
PM2_NAME="shiorra-app"                   # PM2 process name — distinct from CRM's "crm"
REPO_URL="https://github.com/tech976/Shiorra-.git"  # this repo (NOT tech976/CRM-)
BRANCH="main"
REMOTE_NAME="tech976"                    # which `git remote -v` to push to

# ---------------------------------------------------------------------------
# SAFETY GUARD — abort if any target matches the CRM project.
# ---------------------------------------------------------------------------
CRM_IP="147.93.107.46"
CRM_PATH="/opt/crm"
CRM_PM2="crm"
CRM_REPO_HINT="CRM-"

if [[ "$HOST" == "$CRM_IP" ]]; then
  echo "✖ ABORT: HOST matches the CRM VPS IP. Refusing to deploy." >&2
  exit 2
fi
if [[ "$APP_PATH" == "$CRM_PATH" ]]; then
  echo "✖ ABORT: APP_PATH matches the CRM path. Refusing to deploy." >&2
  exit 2
fi
if [[ "$PM2_NAME" == "$CRM_PM2" ]]; then
  echo "✖ ABORT: PM2_NAME collides with the CRM process name. Refusing to deploy." >&2
  exit 2
fi
if [[ "$REPO_URL" == *"$CRM_REPO_HINT"* ]]; then
  echo "✖ ABORT: REPO_URL points at the CRM repo. Refusing to deploy." >&2
  exit 2
fi
if [[ "$HOST" == "REPLACE_WITH_SHIORRA_VPS_IP" ]]; then
  echo "✖ ABORT: HOST is still the placeholder. Edit deploy.sh and paste your Shiōrra VPS IP." >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# CLI flags
# ---------------------------------------------------------------------------
DRY_RUN=0
SKIP_PUSH=0
SKIP_MIGRATE=0
for arg in "${@:-}"; do
  case "$arg" in
    --dry-run)      DRY_RUN=1 ;;
    --skip-push)    SKIP_PUSH=1 ;;
    --skip-migrate) SKIP_MIGRATE=1 ;;
    -h|--help)
      cat <<USAGE
Shiōrra deploy.sh

  ./deploy.sh                   — full deploy
  ./deploy.sh --dry-run         — print every action; change nothing
  ./deploy.sh --skip-push       — skip 'git push' (use if remote already up to date)
  ./deploy.sh --skip-migrate    — skip 'prisma migrate deploy' on the VPS
  ./deploy.sh -h|--help         — this help
USAGE
      exit 0
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Print the resolved target so you can eyeball it before anything runs.
# ---------------------------------------------------------------------------
echo "════════════════════════════════════════════════════════════════"
echo "  Shiōrra deploy"
echo "    Mode:       $([[ $DRY_RUN -eq 1 ]] && echo "DRY-RUN (no changes)" || echo "LIVE")"
echo "    Host:       ${SSH_USER}@${HOST}"
echo "    Path:       ${APP_PATH}/${APP_SUBDIR}"
echo "    PM2 proc:   ${PM2_NAME}"
echo "    Repo:       ${REPO_URL}  (branch: ${BRANCH})"
echo "    Remote:     ${REMOTE_NAME}"
echo "    SSH key:    ${SSH_KEY:-default (~/.ssh/id_*)}"
echo "════════════════════════════════════════════════════════════════"

if [[ $DRY_RUN -eq 0 ]]; then
  read -r -p "Continue with LIVE deploy? [y/N] " confirm
  if [[ "${confirm,,}" != "y" && "${confirm,,}" != "yes" ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# ---------------------------------------------------------------------------
# Pre-flight: make sure local repo is clean + on the right branch.
# ---------------------------------------------------------------------------
LOCAL_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$LOCAL_BRANCH" != "$BRANCH" ]]; then
  echo "✖ Local branch is '$LOCAL_BRANCH' but deploy targets '$BRANCH'. Switch first." >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "✖ You have uncommitted changes. Commit (or stash) before deploying." >&2
  git status --short
  exit 1
fi

# ---------------------------------------------------------------------------
# 1) Push local commits to GitHub
# ---------------------------------------------------------------------------
if [[ $SKIP_PUSH -eq 0 ]]; then
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "▸ [dry-run] would: git push $REMOTE_NAME $BRANCH"
  else
    echo "▸ Pushing $BRANCH → $REMOTE_NAME …"
    git push "$REMOTE_NAME" "$BRANCH"
  fi
else
  echo "▸ Skipping git push (--skip-push)"
fi

# ---------------------------------------------------------------------------
# 2) Compose the remote command (runs on the Shiōrra VPS only)
#    Uses ${variables} from the local script — interpolated before sending.
# ---------------------------------------------------------------------------
MIGRATE_CMD="echo '▸ Skipping prisma migrate deploy (--skip-migrate)'"
if [[ $SKIP_MIGRATE -eq 0 ]]; then
  MIGRATE_CMD="echo '▸ prisma migrate deploy …' && npx --yes prisma migrate deploy"
fi

REMOTE_SCRIPT=$(cat <<REMOTE
set -euo pipefail
echo "▸ ssh ok — running on \$(hostname) as \$(whoami)"

cd "${APP_PATH}"
echo "▸ git fetch + reset to origin/${BRANCH} …"
git fetch origin
git reset --hard "origin/${BRANCH}"

cd "${APP_PATH}/${APP_SUBDIR}"
echo "▸ npm ci (production) …"
npm ci --omit=dev

${MIGRATE_CMD}

echo "▸ pm2 reload ${PM2_NAME} …"
pm2 reload "${PM2_NAME}" --update-env || pm2 start ecosystem.config.js --env production --name "${PM2_NAME}"
pm2 save

echo "▸ done."
REMOTE
)

# ---------------------------------------------------------------------------
# 3) Run the remote script over SSH (or print it for --dry-run)
# ---------------------------------------------------------------------------
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
[[ -n "$SSH_KEY" ]] && SSH_OPTS+=(-i "$SSH_KEY")

if [[ $DRY_RUN -eq 1 ]]; then
  echo "▸ [dry-run] would SSH to ${SSH_USER}@${HOST} and run:"
  echo "----------------------------------------------------------------"
  echo "$REMOTE_SCRIPT"
  echo "----------------------------------------------------------------"
else
  echo "▸ Connecting to ${SSH_USER}@${HOST} …"
  ssh "${SSH_OPTS[@]}" "${SSH_USER}@${HOST}" "bash -s" <<< "$REMOTE_SCRIPT"
fi

echo "✓ Shiōrra deploy complete  (${PM2_NAME} on ${HOST})"
