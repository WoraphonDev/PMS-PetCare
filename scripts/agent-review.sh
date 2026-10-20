#!/usr/bin/env bash
# Cross-agent review (ADR-0006 §2.1, §2.3): the reviewer is always the agent that did NOT write the PR.
# Usage: scripts/agent-review.sh T-NNNN [round] [reviewer]
#   reviewer = codex | claude. Default: the opposite of the PR's dev agent, read from the
#   `Agent:` trailer of the branch commits (no trailer → dev = claude → reviewer = codex).
# Writes the review to .git/agent-review/<card>-round<N>.md (never committed) and prints it.
# Exit: 0 = VERDICT: CLEAN · 2 = VERDICT: CHANGES_REQUESTED · 1 = error / no verdict / reviewer = author
set -euo pipefail

card="${1:?usage: scripts/agent-review.sh T-NNNN [round] [codex|claude]}"
round="${2:-1}"
base="${BASE_REF:-origin/main}"
root="$(git rev-parse --show-toplevel)"
out_dir="$(git rev-parse --absolute-git-dir)/agent-review"
out="$out_dir/${card}-round${round}.md"
log="$out_dir/${card}-round${round}.log"
mkdir -p "$out_dir"

[[ -f "$root/docs/tasks/$card.md" ]] || { echo "card docs/tasks/$card.md not found" >&2; exit 1; }
[[ "${SKIP_FETCH:-}" == 1 ]] || git fetch -q origin main

# Dev agent(s) of this branch = every distinct `Agent:` trailer on commits since base.
authors=$(git log --format='%(trailers:key=Agent,valueonly)' "$base..HEAD" | tr 'A-Z' 'a-z' | grep -Eo 'claude|codex' | sort -u | tr '\n' ' ' || true)
authors="${authors:-claude }"
if [[ -n "${3:-}" ]]; then
  reviewer="$3"
elif [[ "$authors" == "claude " ]]; then
  reviewer=codex
elif [[ "$authors" == "codex " ]]; then
  reviewer=claude
else
  echo "branch has commits from both agents ($authors) — no independent reviewer left; ask the human" >&2
  exit 1
fi
case "$reviewer" in codex | claude) ;; *) echo "reviewer must be codex or claude, got: $reviewer" >&2; exit 1 ;; esac
case " $authors" in *" $reviewer "*)
  echo "reviewer $reviewer also wrote this branch (dev: $authors) — a different agent must review (AGENTS.md Roles)" >&2
  exit 1 ;;
esac

prompt=$(cat <<EOF
You are the Reviewer agent for task card $card in this repository (see AGENTS.md "Roles").
Review ONLY the changes on this branch versus $base: run \`git diff $base...HEAD\` (and \`git diff --stat $base...HEAD\`) and read the changed files. Do not modify any files.
Do not run the test suite or pnpm verify (CI already runs them on this branch); read-only commands such as git, grep and cat are fine.

Read first: AGENTS.md, docs/tasks/$card.md (whole card; the agent progress log is docs/tasks/log/$card.md, its questions docs/questions/$card-*.md), and only the spec/ADR anchors listed in the card's "Read first".

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

echo "$reviewer review $card round $round (dev: ${authors% }, base $base) …" >&2
rm -f "$out"
# </dev/null: both CLIs otherwise may wait for extra input on an open stdin.
if [[ "$reviewer" == codex ]]; then
  ok=0; codex exec --sandbox read-only --ephemeral -C "$root" -o "$out" "$prompt" </dev/null >"$log" 2>&1 || ok=$?
else
  # Read-only: no Edit/Write tools, shell limited to read-only git/grep/cat/ls.
  ok=0; (cd "$root" && claude -p "$prompt" --permission-mode default \
    --allowedTools "Read,Grep,Glob,Bash(git diff:*),Bash(git log:*),Bash(git show:*),Bash(git status:*),Bash(grep:*),Bash(cat:*),Bash(ls:*)" \
    --tools "Read,Grep,Glob,Bash" --disallowedTools "Edit,Write,NotebookEdit" \
    --no-session-persistence) </dev/null >"$out" 2>"$log" || ok=$?
fi
if [[ "$ok" != 0 ]]; then
  echo "$reviewer failed (exit $ok) — see $log (usage limit? → AGENTS.md 'Agent fallback')" >&2
  exit 1
fi
[[ -s "$out" ]] || { echo "$reviewer produced no review ($out)" >&2; exit 1; }
cat "$out"

verdict=$(grep -Eo '^VERDICT: (CLEAN|CHANGES_REQUESTED)' "$out" | tail -1 || true)
case "$verdict" in
  "VERDICT: CLEAN") exit 0 ;;
  "VERDICT: CHANGES_REQUESTED") exit 2 ;;
  *) echo "no VERDICT line in $reviewer output ($out)" >&2; exit 1 ;;
esac
