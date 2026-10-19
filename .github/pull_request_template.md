## Task
- Card: `docs/tasks/T-____.md` · Branch: `t-____-<slug>` · Author agent: claude / codex
- Depends on (merged): T-____

## What changed (per file — all within allowed_paths)
-

## Spec / ADR implemented (anchors)
- `docs/spec/features/<feature>.md#…`

## Tests
- [ ] Every *Done when* command passes (paste summary)
- [ ] `pnpm verify` passes
- [ ] API: happy path + every error code + role denial + other org → NOT_FOUND
- [ ] UI: every field/button in the screen spec is present
- [ ] No new `.skip` / `.only` / `.todo`, no weakened assertions

## Questions raised
- Q-____ (docs/questions.md) or "none"

## Review (by the *other* agent; human when card has `human_review: true`)
- [ ] Matches the cited spec field by field
- [ ] Money / permission / tenant (RLS + org_id) correct
- [ ] State change + outbox event + audit in one transaction
- [ ] No secrets / PII in logs
