# Mechanical Kernel Purity Gate

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** todo

## What to build

Build the Phase 4 purity gate described under "Purity enforcement" in the parent PRD. Before
implementation, read the plugin-system overview, the Phase 4 plan, the parent PRD, and this task.

The check must derive domain vocabulary from the trusted media and fitness manifests, supplement it
with conceptual terms that reveal hidden policy, scan authored production kernel/contract/query-core
source, and report exact locations. Integrate it into the ordinary backend check/test flow. Establish
narrow permanent exclusions and temporary, reasoned entries for known Phase 4 residue so the branch
remains shippable while later tasks burn those entries down.

Do not move domain behavior in this task. Its deliverable is the enforcement mechanism and a
reviewable baseline that names the later task responsible for every temporary exception.

## Acceptance criteria

- [ ] Vocabulary is derived from all relevant manifest definition, script, provider, binding, operation, workflow, scheduler, import, and integration sections
- [ ] Conceptual terms cover known library and removed-native-module policy that exact manifest slugs alone would miss
- [ ] Authored backend, contract, and query-core production source is scanned deterministically
- [ ] Test files and generated sandbox output are excluded by explicit scanner rules
- [ ] Legacy bootstrap, boot-source wiring, and retained backup-only contract types use narrow reasoned exceptions rather than broad directory exemptions
- [ ] Every violation reports term, file, line, and matching source text
- [ ] Every temporary exception names its removal task and final acceptance rejects unexplained entries
- [ ] Focused tests cover forbidden hits, exclusions, allowlist matching, diagnostics, and vocabulary changes
- [ ] The gate runs through the normal backend verification command

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 4
- User story 49
