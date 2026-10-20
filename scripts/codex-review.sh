#!/usr/bin/env bash
# Kept for existing instructions/links. Reviewer is now chosen automatically (the agent that did not write
# the branch) — see scripts/agent-review.sh. Usage unchanged: scripts/codex-review.sh T-NNNN [round]
exec "$(dirname "$0")/agent-review.sh" "$@"
