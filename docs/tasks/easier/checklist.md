# Backend Simplification Checklist

## High-Impact Items (Start with these)

- [x] **1. Atomic integration-run admission** [H/M/M]
  - Owner: D15 Integrations
  - Scope: Add `createRunForIntegrationIfIdle` with partial unique index
  - Prereq: Resolve duplicate active rows first

- [x] **2. Preserve raw webhook transport** [H/M/W]
  - Owner: D15 Integrations
  - Scope: Carry `{ rawBody, contentType }` envelope
  - Prereq: Contract and durable-payload versioning

- [x] **3. Deterministic frequent-cron IDs** [H/S/M]
  - Owner: D26 Scheduler
  - Scope: Derive ID from schedule and interval bucket
  - Prereq: Prefer after rank 1

- [x] **4. Remove incorrect entity provenance pre-read** [H/S/M]
  - Owner: D08 Entities
  - Scope: Validate first, then use `insertEntity` as sole conflict primitive

- [x] **5. Correct Pro-key expiry representation** [H/S/N]
  - Owner: I01 Configuration
  - Scope: Decode expiry to `DateTime`, compare with `DateTime.now` each verification

- [x] **6. Atomic translation upsert** [H/S/N]
  - Owner: D11 Entity translation
  - Scope: Single `INSERT ... ON CONFLICT DO UPDATE RETURNING`

- [x] **7. Atomic saved-view reorder** [M/S-M/M]
  - Owner: D25 Saved views
  - Scope: One `reorderBySlugs` operation per transaction

## Medium-Impact Items

- [x] **8. Simplify upload cleanup state** [M/M/M]
  - Owner: D30 Uploads
  - Scope: Use intent lock only, stop writing `cleaning`
  - Prereq: Drain/dual-decode Redis records

- [x] **9. Scope-own sandbox bridge sessions** [H/M/M]
  - Owner: I07 Sandbox runtime
  - Scope: Scoped registration with identity-aware deletion

- [x] **10. Reuse backup event export context** [M/M/M]
  - Owner: D03 Backup export
  - Scope: Build plugin/schema/entity context once

- [x] **11. Scope-own backup archive spool** [M/S/M]
  - Owner: D03 Backup archive
  - Scope: Scoped resource ownership for spool directory

- [x] **12. Centralize import dispatch and rollback** [M/M/M]
  - Owner: D14 Imports
  - Scope: Single post-admission dispatch operation

- [ ] **13. Single-own RyotQL kind inference** [M/M/M]
  - Owner: D22 Backend RyotQL
  - Scope: One resolver-neutral kind function

- [ ] **14. Make SDK provider codecs canonical** [M/M/W]
  - Owner: W14 Sandbox SDK
  - Scope: Alias backend decoders to SDK schemas
  - Prereq: SDK first, backend second

- [ ] **15. Return structured saved-view validation issues** [M/S-M/M]
  - Owner: D06 Definition registry
  - Scope: Return `{ layout, issue, field?, diagnostic }`

- [ ] **16. Discriminate lifecycle mutations** [M/M/M]
  - Owner: D08 Entities lifecycle
  - Scope: In-memory operation union with snapshot requirements

- [ ] **17. Discriminate user-lifecycle preparation** [M/S/N]
  - Owner: D31 User lifecycle
  - Scope: Tagged `active`, `retryable`, `new`, or `missing` cases

- [ ] **18. Remove unreachable local-storage states** [M/M/M]
  - Owner: I06 Storage
  - Scope: Both local roots as required resolved strings

- [ ] **19. Use one durable request index** [M/S/M]
  - Owner: D24 Durable sandbox
  - Scope: Remove `requestIndex`, derive all from `request.index`

- [ ] **20. Reuse provider search resolution** [M/S/N]
  - Owner: D20 Provider entities
  - Scope: Accept already-resolved provider/script context

- [ ] **21. Single-own legacy episodic fallback SQL** [M/S/M]
  - Owner: D16 Legacy bootstrap
  - Scope: One SQL fragment from `episodic-sub-entity-mapping.ts`

- [ ] **22. Remove obsolete transactional template pipeline** [M/M/W]
  - Owner: W18 Transactional email
  - Scope: Remove static build/copy pipeline

- [ ] **24. Remove website-local admin result protocol** [M/S/M]
  - Owner: C02 Website bridge
  - Scope: Use shared rejecting contract runner

---

**Legend:** [Impact/Effort/Blast-radius] where N=None, S=Small, M=Medium, W=Wide
