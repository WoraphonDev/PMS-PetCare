#!/usr/bin/env bash
# Cross-agent review (ADR-0006): ask Codex to review the current task branch against main.
# Usage: scripts/codex-review.sh T-0002 [round]
# Writes the review to .git/agent-review/<card>-round<N>.md (never committed) and prints it.
# Exit: 0 = VERDICT: CLEAN · 2 = VERDICT: CHANGES_REQUESTED · 1 = error / no verdict
set -euo pipefail

card="${1:?usage: scripts/codex-review.sh T-NNNN [round]}"
round="${2:-1}"
base="${BASE_REF:-origin/main}"
root="$(git rev-parse --show-toplevel)"
out_dir="$(git rev-parse --absolute-git-dir)/agent-review"
out="$out_dir/${card}-round${round}.md"
mkdir -p "$out_dir"

[[ -f "$root/docs/tasks/$card.md" ]] || { echo "card docs/tasks/$card.md not found" >&2; exit 1; }
git fetch -q origin main

prompt=$(cat <<EOF
You are the Reviewer agent for task card $card in this repository (see AGENTS.md "Roles").
Review ONLY the changes on this branch versus $base: run \`git diff $base...HEAD\` (and \`git diff --stat $base...HEAD\`) and read the changed files. Do not modify any files.
Do not run the test suite or pnpm verify (CI already runs them on this branch); read-only commands such as git, grep and cat are fine.

Read first: AGENTS.md, docs/tasks/$card.md (whole card; the agent's progress log is docs/tasks/log/$card.md, its questions docs/questions/$card-*.md), and only the spec/ADR anchors listed in the card's "Read first".

Check, in order:
1. Behaviour matches the cited spec field by field (names, types, nullability, error codes, HTTP status, Thai labels).
2. Every item in the card's Deliverables and Tests exists; tests actually assert the behaviour (no weakened/empty assertions, no .skip/.only/.todo).
3. Golden rules in AGENTS.md: allowed_paths, money as integer satang, time from clock, tenant access via the tenant helper + RLS, module boundaries, no secrets/PII in logs, no unlisted dependencies.
4. Security: auth, permission and tenant isolation (other org must get NOT_FOUND), injection, unsafe defaults.
5. Correctness bugs and missing edge cases that a test in the card should have caught.

Report each finding as one block:
[P0|P1|P2|P3] <file>:<line> — <one-sentence problem>
Why: <concrete failing scenario>
Fix: <what to change>

P0 = security/data loss, P1 = spec violation or bug, P2 = guard/test gap that lets a P0/P1 slip through, P3 = nit (optional).
Do not report style issues that biome already enforces. If the spec itself looks wrong, say "SPEC QUESTION:" instead of a finding.

End your reply with exactly one line:
VERDICT: CLEAN            (no P0–P2 findings)
VERDICT: CHANGES_REQUESTED (any P0–P2 finding)
EOF
)

echo "codex review $card round $round (base $base) …" >&2
rm -f "$out"
# </dev/null: codex exec otherwise waits for extra input on an open stdin ("Reading additional input from stdin...")
if ! codex exec --sandbox read-only --ephemeral -C "$root" -o "$out" "$prompt" </dev/null >"$out_dir/${card}-round${round}.log" 2>&1; then
  echo "codex exec failed — see $out_dir/${card}-round${round}.log" >&2
  exit 1
fi
[[ -s "$out" ]] || { echo "codex produced no review ($out)" >&2; exit 1; }
cat "$out"

verdict=$(grep -Eo '^VERDICT: (CLEAN|CHANGES_REQUESTED)' "$out" | tail -1 || true)
case "$verdict" in
  "VERDICT: CLEAN") exit 0 ;;
  "VERDICT: CHANGES_REQUESTED") exit 2 ;;
  *) echo "no VERDICT line in codex output ($out)" >&2; exit 1 ;;
esac
