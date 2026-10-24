---
name: deliver-card
description: Deliver one task card end to end — implement on a t-NNNN branch, open the PR, run the Codex cross-review loop until clean, and hand the PR to the human for merge. Use when the user says "ทำการ์ด T-NNNN", "deliver T-NNNN" or "next card".
---

# deliver-card

Run the whole card workflow yourself. The human should only need to answer questions and merge.

## 1. Pick and check the card

- Card given (`T-NNNN`) → use it. "next card" → use `node scripts/plan-index.mjs` for the dependency index; independently check merged implementation PRs and decision gates. `PLAN-foundation.md` is historical; a grep hit mentioning a card is not proof it is implemented.
- `depends_on` not merged → stop and tell the user which.
- `owner: human` → stop.

## 1.5 Which agent is Dev

Default: you (Claude) are Dev, Codex reviews. If you are near your usage limit, do not start the card — tell the human/orchestrator so Codex can be Dev (AGENTS.md *Agent fallback*); you will then be the reviewer. Every commit you make ends with the trailer line `Agent: claude`.

## 2. Implement (AGENTS.md "Workflow for every card")

1. `git fetch && git checkout -b t-NNNN-<slug> origin/main`. Bring main in with `scripts/sync-main.sh` (never hand-merge `pnpm-lock.yaml` or migrations) — early and often: small conflicts now instead of one big one at the end.
2. Read the whole card, then only the *Read first* anchors.
3. Size L → write the plan first (it goes into the PR description).
4. Tests first, then code. Stay inside `allowed_paths`. Spec gap → write `docs/questions/T-NNNN-NN.md` (one file per question) + stop that part.
5. Run every *Done when* command + `pnpm verify` + `TASK_ID=T-NNNN node scripts/check-task-scope.mjs`. Fix until green.
6. Append to `docs/tasks/log/T-NNNN.md` (never edit the card — it is human-only). Commit. Push. Open the PR with `.github/pull_request_template.md` filled in (real numbers, not estimates).
7. Wait for the **CI `verify` check only** (inspect `gh pr checks <n> --json name,state` or watch the `ci.yml` run for this exact head with `gh run watch <run-id> --exit-status`). `approval-proof` intentionally does not pass for an unapproved agent task; do not wait for it before review/labelling.

## 3. Codex review loop (ADR-0006 — max 3 rounds)

For round = 1, 2, 3:

1. Run `scripts/sync-main.sh` (exit 1 → resolve the listed files first, explain them in a PR comment), push if it merged anything. Then run `scripts/codex-review.sh T-NNNN <round>` (takes minutes — run it in the background and wait for it).
2. Post the review on the PR so it is traceable: `gh pr comment <n> --body-file "$(git rev-parse --absolute-git-dir)/agent-review/T-NNNN-round<round>.md"` (prefix the body with `**Codex review — round <round>**`).
3. Exit 0 (`VERDICT: CLEAN`) → go to step 4.
4. Exit 2 → for every P0–P2 finding:
   - Agree → fix it (tests first if it is a test gap), staying in `allowed_paths`.
   - Disagree → reply on the PR with the concrete reason (spec anchor / test) — do not silently skip.
   - `SPEC QUESTION:` → write `docs/questions/T-NNNN-NN.md`, do not guess.
   Then re-run step 2.5 checks, append to `docs/tasks/log/T-NNNN.md` ("review round N fixes"), commit, push, wait for CI, next round.
   P3 findings: fix if trivial, otherwise list them in the hand-off.
5. Exit 1 (no verdict / codex error) → retry once; still failing → stop and report.

After round 3 still `CHANGES_REQUESTED`, or any disagreement you could not settle → stop and ask the human.

## 4. Approve for merge

Only when CI is green, the last round is `CLEAN`, and every review thread is resolved. Run `scripts/sync-main.sh` once more right before labelling — if it merged anything, push and wait for CI (see *Syncing after CLEAN* below).

- Card `human_review: false` → `gh pr edit <n> --add-label agent-approved`. The `auto-merge` workflow re-checks the card and merges after the required checks; watch for its comment if it refuses.
- Card `human_review: true` → do **not** label; the human reviews and merges.

Never run `gh pr merge` yourself. After labelling, `approval-proof` is a required head-specific merge gate. Only an exact clean merge of main verified against the recorded approved SHA preserves approval. Code edits, regenerated lockfile/migrations, manual conflict resolution or missing proof require new review and re-labelling.
Main moving after labelling does **not** require a branch update (`strict: false`); do not create update/review loops just because a PR is behind main. Required `verify` and `approval-proof` still apply.

**Syncing after CLEAN** (does not count toward the 3 review rounds — it adds main's code, not yours):
- merged cleanly with the exact Git merge tree → existing approval can be preserved by `approval-proof`; CI `verify` must pass on the new head
- any other change, including lockfile/migration regeneration → a new cross-agent review is required
- you resolved a conflict by hand → one *sync review*: `scripts/codex-review.sh T-NNNN sync` on the merge; `CLEAN` → label; anything else → stop and ask the human

## 5. Hand-off to the human

Reply in Thai, short:

- PR link, CI status, changed lines (excluding tests/lockfile/generated migrations)
- Codex rounds: what it found and what you changed (one line each); open P3s; disagreements
- Questions opened (`docs/questions/T-NNNN-NN.md`) or "ไม่มี"
- Merge: "ติด `agent-approved` แล้ว — จะ merge อัตโนมัติ" or, for `human_review: true`, "การ์ดนี้แตะเงิน — ต้องให้คุณ review และ merge"
- Next card(s) that become unblocked after this merge

Never edit `.github/`, `scripts/`, `.claude/`, `AGENTS.md`, `docs/spec/`, `docs/adr/` in a task branch.
