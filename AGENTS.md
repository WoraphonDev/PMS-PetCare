# AGENTS.md — PMS-PetCare

SaaS **PMS** for pet Grooming · Hotel · Daycare shops: shop console as a PWA + **LINE** notifications via each shop's own LINE OA (LIFF booking later) + a **Channel API** for external marketplaces (later). Shops' customers pay the shop directly; we earn from subscription plans. Marketplace and native mobile apps are **out of scope** for this repo.
All development, testing and deployment is done by AI agents (Claude Code, Codex). This file is the single rulebook for every agent.

Decisions live in `docs/adr/` (read 0001–0006 once). Product behaviour lives in `docs/spec/` (Thai prose, English identifiers). You implement **one task card at a time**.

## Golden rules (never break)

1. **One card = one branch = one PR.** Branch `t-<nnnn>-<slug>` (e.g. `t-0012-booking-create`). Change only files matching the card's `allowed_paths` (+ the card's *Status log* and `docs/questions.md`). CI (`scripts/check-task-scope.mjs`) fails otherwise.
2. **Read-only for task agents:** `docs/spec/**`, `docs/adr/**`, other cards, merged migrations, every `AGENTS.md`/`CLAUDE.md`, `.claude/**`, `.codex/**`, `.github/**`, `scripts/**`. If something there looks wrong: write `docs/questions.md`, stop that part, say so in the PR.
3. **Never invent** a table, column, enum value, endpoint, field, error code, screen, permission or business rule. Not in the spec → it is a question, not a guess.
4. **Tests define done.** Write tests first. Never add `.skip`/`.only`/`.todo`, never weaken an existing assertion to make it pass.
5. **Data rules:** money = integer satang (`*_satang` / `*Satang`), never floats · instants = UTC `timestamptz` / ISO strings · local dates = `YYYY-MM-DD` strings · current time only from injected `clock`/`now` · tenant data only through the tenant repository helper (sets `org_id` + RLS context) — see ADR-0003.
6. **Module boundaries (ADR-0002):** call another module only via its `index.ts` public service; cross-module async work via outbox events (ADR-0004); clients call the API only via `packages/api-client`.
7. **External services only behind our interfaces** (`NotificationChannel`, `FileStorage`, `EmailSender`, `PaymentProvider`, …) — ADR-0005.
8. **No new dependencies** unless the card lists them under *Dependencies*; license must be MIT / MIT-0 / Apache-2.0 / BSD / ISC / PostgreSQL / MPL-2.0.
9. **Never:** touch production data or credentials, run migrations against a non-local DB yourself, edit a merged migration, commit `.env*` or secrets, log tokens/PII, disable TLS checks, force-push, use `--no-verify`, push to `main`, run `gh pr merge` yourself (merging happens only via the auto-merge workflow or a human — see Roles), change branch protection or CI to make something pass.
10. **Small PRs:** < 600 changed lines **excluding tests**, generated migrations/snapshots and the lockfile (Q-0012, Q-0017 — never write fewer tests to fit). Bigger → stop and propose a split in `docs/questions.md`.

## Roles

- **Dev agent:** implements a card (workflow below).
- **Reviewer agent:** a *different* agent from the author (Claude ⇄ Codex). Reviews the PR against the card + cited spec, field by field; runs the card's *Done when*; comments findings, does not push to the author's branch. Cards with `human_review: true` (anything touching money) also need a human approval.
- **Review loop (automated):** the Dev agent runs `scripts/codex-review.sh T-nnnn <round>` itself, posts the result on the PR, fixes P0–P2 findings (or replies with the reason it disagrees), and repeats — max 3 rounds, then asks the human. Claude Code: use the `deliver-card` skill (`.claude/skills/deliver-card/SKILL.md`). The human is not a messenger between agents.
- **Merge:** after CI is green and the review loop ends `CLEAN`, the Dev agent adds the label `agent-approved` to a **task-card PR** (`t-NNNN-*`). The `auto-merge` workflow re-checks the card (`owner: agent`, `human_review: false`) and merges once required checks pass; any new push removes the label. Cards with `human_review: true`, and PRs that change spec / ADR / AGENTS.md / CI, are merged by a human — say so in the hand-off.
- **Release:** only through GitHub Actions (staging auto on merge; production via the `production` environment approval). Agents never hold production secrets.

## Workflow for every card

1. Read the whole card `docs/tasks/T-nnnn.md`. Check every `depends_on` is merged (`git log --oneline | grep T-nnnn`). If not → stop.
2. Read only the spec sections listed in *Read first* (search the anchor, e.g. `grep -n 'id="ep-booking.create"' docs/spec/*.md`). Don't load whole spec files.
3. Plan: files (must match `allowed_paths`), function signatures, tests. Size L → put the plan in the PR description first.
4. Tests first. API services need integration tests on real Postgres (Testcontainers) covering: happy path, **every error code of the endpoint**, role denial, **other organization → NOT_FOUND**.
5. Implement.
6. Run every *Done when* command + `pnpm verify`. Fix until green.
7. Append to the card's *Status log* (date, what was done, questions raised). Open the PR with `.github/pull_request_template.md` filled in.

## Commands

```bash
pnpm install          # Node 24 LTS, pnpm 10
pnpm verify           # lint + typecheck + tests across the workspace (run before every PR)
TASK_ID=T-0012 node scripts/check-task-scope.mjs
```
(More commands are added by the cards that create each package — they will be listed here by a human-approved update.)

## Stop and ask (write `docs/questions.md`, don't guess) when

the spec is silent/contradictory · a needed file is outside `allowed_paths` · a test seems wrong · a dependency task is missing · you need a schema change not in the card · you would touch auth, money or tenant logic in a way the card doesn't describe.

## Language

Code, identifiers, commits, PR text: English. User-facing strings: Thai via i18n message files (labels copied from the spec).
