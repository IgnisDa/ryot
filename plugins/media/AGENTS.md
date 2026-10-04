# Media Plugin

- Read the relevant `README.md` section before changing schema descriptors, recipes, operation contracts, integrations, or lifecycle behavior. Keep contracts, manifest declarations, docs, and focused tests aligned.
- Operation schemas live in `backend/contracts/operations.ts`, outside sandbox entrypoints. Workflow consumers import `Schema` from the backend SDK's workflow surface. Non-fatal script failures use the `log` host capability.
- Keep title parsing/matching within the backend compiler's ES2022 support; do not use `toReversed`.
- Shared recipe factories and descriptor engines own reusable behavior. Schema files supply configuration, vocabulary, and declared fields; do not re-wrap overview recipes or duplicate shared schemas in `client/`.
- `client/media/` stays schema-agnostic: no schema symbols, copy, or fixed poster geometry. Descriptors supply nouns, sections, facts, artwork purposes, and aspect through the canonical helpers documented in the README.
- Select only fields declared by the target schema. Group creator credits cannot use `publishYear`; only person credits select `character`.
- Episode lists use cursor-paged top-level row queries, not includes. Container totals come from aggregates, not loaded pages. Episode ordering is presentation-only; lifecycle uses default seasons.
- Keep activity vocabulary and notification formatters plugin-owned. Track durations are seconds; time-total measures are minutes.
- Use canonical sync selections, UI SDK sync/art primitives, and SDK managed assets; do not hand-code sync columns or asset lifecycle.
- Fill the frame-owned hero box without adding safe-area or bar offsets.
