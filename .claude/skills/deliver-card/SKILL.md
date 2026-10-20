---
name: deliver-card
description: Deliver one task card end to end — implement on a t-NNNN branch, open the PR, run the Codex cross-review loop until clean, and hand the PR to the human for merge. Use when the user says "ทำการ์ด T-NNNN", "deliver T-NNNN" or "next card".
---

# deliver-card

Run the whole card workflow yourself. The human should only need to answer questions and merge.

## 1. Pick and check the card

- Card given (`T-NNNN`) → use it. "next card" → first card in `docs/tasks/PLAN-*.md` order that has a file, is not merged (`git log --oneline origin/main | grep T-NNNN`), and whose `depends_on` are all merged.
- `depends_on` not merged → stop and tell the user which.
- `owner: human` → stop.

## 2. Implement (AGENTS.md "Workflow for every card")

1. `git fetch && git checkout -b t-NNNN-<slug> origin/main`. Later, to bring main in: `scripts/sync-main.sh` (never hand-merge `pnpm-lock.yaml` or migrations).
2. Read the whole card, then only the *Read first* anchors.
3. Size L → write the plan first (it goes into the PR description).
4. Tests first, then code. Stay inside `allowed_paths`. Spec gap → write `docs/questions/T-NNNN-NN.md` (one file per question) + stop that part.
5. Run every *Done when* command + `pnpm verify` + `TASK_ID=T-NNNN node scripts/check-task-scope.mjs`. Fix until green.
6. Append to `docs/tasks/log/T-NNNN.md` (never edit the card — it is human-only). Commit. Push. Open the PR with `.github/pull_request_template.md` filled in (real numbers, not estimates).
7. Wait for CI (`gh pr checks <n> --watch`).

## 3. Codex review loop (ADR-0006 — max 3 rounds)

For round = 1, 2, 3:

1. Run `scripts/codex-review.sh T-NNNN <round>` (takes minutes — run it in the background and wait for it).
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

Only when CI is green, the last round is `CLEAN`, and every review thread is resolved:

- Card `human_review: false` → `gh pr edit <n> --add-label agent-approved`. The `auto-merge` workflow re-checks the card and merges after the required checks; watch for its comment if it refuses.
- Card `human_review: true` → do **not** label; the human reviews and merges.

Never run `gh pr merge` yourself. Pushing again after labelling removes the label — re-run the loop and label again.

## 5. Hand-off to the human

Reply in Thai, short:

- PR link, CI status, changed lines (excluding tests/lockfile/generated migrations)
- Codex rounds: what it found and what you changed (one line each); open P3s; disagreements
- Questions opened (`docs/questions/T-NNNN-NN.md`) or "ไม่มี"
- Merge: "ติด `agent-approved` แล้ว — จะ merge อัตโนมัติ" or, for `human_review: true`, "การ์ดนี้แตะเงิน — ต้องให้คุณ review และ merge"
- Next card(s) that become unblocked after this merge

Never edit `.github/`, `scripts/`, `.claude/`, `AGENTS.md`, `docs/spec/`, `docs/adr/` in a task branch.
