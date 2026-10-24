#!/usr/bin/env bash
# Keep approval ONLY for one conflict-free merge of trusted main, with no manual edits.
# Usage: bash scripts/same-pr-diff.sh <approved-before-sha> <event-after-sha> <trusted-main-ref>
# Exact tree comparison (including whitespace/binaries/modes), NOT patch-id, which ignores whitespace.
# Every missing object, ambiguous history, conflict or modified merge fails closed.
set -euo pipefail
before=${1:?before sha}
after=${2:?after sha}
base=${3:?trusted main ref}
fail() { echo "$1 — new review needed"; exit 1; }
[[ "$before" =~ ^[0-9a-f]{40}$ && "$after" =~ ^[0-9a-f]{40}$ ]] || fail "invalid event SHA"
# --no-replace-objects prevents local replacement refs changing the evidence.
export GIT_NO_REPLACE_OBJECTS=1
parents=$(git rev-list --parents -n 1 "$after")
read -r head first second extra <<< "$parents"
[ "$head" = "$after" ] && [ "$first" = "$before" ] && [ -n "$second" ] && [ -z "${extra:-}" ] || fail "not one two-parent sync merge"
git merge-base --is-ancestor "$second" "$base" || fail "second parent is not trusted main history"
# No content from main may have conflicted and been manually resolved. merge-tree exits nonzero on conflicts.
expected=$(git merge-tree --write-tree "$before" "$second") || fail "merge needs conflict resolution"
actual=$(git rev-parse "${after}^{tree}")
[ "$expected" = "$actual" ] || fail "merge tree differs from Git's clean merge"
echo "clean merge of trusted main only — keep existing approval"
