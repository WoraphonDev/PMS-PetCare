#!/usr/bin/env bash
# Executed ONLY from trusted main by the required approval-proof job (never from task PR code).
# Env: REPO, PR, AFTER (event's exact head SHA), EVENT_ACTION, EVENT_LABEL, RUNNER_TEMP, GH_TOKEN.
set -euo pipefail
: "${REPO:?}" "${PR:?}" "${AFTER:?}" "${RUNNER_TEMP:?}"
[[ "$AFTER" =~ ^[0-9a-f]{40}$ && "$PR" =~ ^[0-9]+$ ]] || exit 1
current=$(gh pr view "$PR" -R "$REPO" --json headRefOid --jq '.headRefOid')
[ "$current" = "$AFTER" ] || { echo 'Stale event head'; exit 1; }
labels=$(gh pr view "$PR" -R "$REPO" --json labels --jq '.labels[].name')
printf '%s\n' "$labels" | grep -qx agent-approved || { echo 'This head needs cross-agent review and agent-approved'; exit 1; }

if [ "${EVENT_ACTION:-}" = labeled ] && [ "${EVENT_LABEL:-}" = agent-approved ]; then
  # This explicit label event approves AFTER, not whatever head a later push might create.
  gh pr comment "$PR" -R "$REPO" --body "<!-- pms-agent-approved-sha:${AFTER} -->"
  echo 'Explicit approval for event head'
  exit 0
fi

git fetch --no-tags origin "+refs/pull/${PR}/head:refs/remotes/pr/head" "+refs/heads/main:refs/remotes/origin/main"
[ "$(git rev-parse refs/remotes/pr/head)" = "$AFTER" ] || exit 1
gh api --paginate --slurp "repos/${REPO}/issues/${PR}/comments" > "$RUNNER_TEMP/approval-comments.json"
approved=$(node scripts/approved-head.mjs "$RUNNER_TEMP/approval-comments.json")
git cat-file -e "${approved}^{commit}" 2>/dev/null || git fetch --no-tags origin "$approved"
if [ "$approved" = "$AFTER" ]; then
  echo 'Head already explicitly approved'
  exit 0
fi
# A skipped reset for unreviewed B cannot let C through: compare approved A -> C, never event.before B -> C.
bash scripts/same-pr-diff.sh "$approved" "$AFTER" origin/main
gh pr comment "$PR" -R "$REPO" --body "<!-- pms-agent-approved-sha:${AFTER} -->"
echo 'Approval extended only across a proven clean main sync'
