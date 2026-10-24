# Per-card specification amendments

New additive specifications belong in `docs/spec/amendments/T-NNNN.md` (the human-assigned owning card ID), not appended to `features/foundation.md` by every parallel branch. One file per card avoids shared append-only registries.

- Keep the accepted base and all existing anchors in place; this is not a retroactive rewrite of foundation.
- No shared index needs editing: discover with `git ls-files 'docs/spec/amendments/*.md'` or search the unique anchor. Each card's Read first links directly to its amendment and the exact base sections it depends on.
- Human review/merge is mandatory; task dev agents cannot edit specs, including these files.
- Give new sections globally unique anchor IDs. For changes to an existing rule, include an explicit `Supersedes: <base-path>#<anchor> — <precise clause>` and identify affected cards/tests. Never silently override the base.
- Two amendments touching the same rule are NOT independent. Merge/resolve the earlier decision first, then update the later proposal; do not rely on filename order or dates to choose the winner.
- Record product choices in the existing per-question files. After amendment merge, the implementation card must list it as a start gate. Do not interpret a draft on another branch as accepted.
- Consolidation of an old spec is a separate human-reviewed, non-parallel maintenance PR, not routine work for every feature.

Template:

```markdown
# T-NNNN — <topic>

Status: proposed — human merge required
Base: docs/spec/features/foundation.md#<anchor>
Decision: docs/questions/T-NNNN-01.md
Supersedes: none (additive) / <precise base clause>

<a id="contract-unique-topic"></a>
## Contract
<exact fields, errors, ordering, transaction/race behaviour, privacy rules>

## Acceptance
<testable assertions and affected existing regression tests>
```
