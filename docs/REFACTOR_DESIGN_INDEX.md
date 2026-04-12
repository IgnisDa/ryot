# Refactored Interface Design — Documentation Index

**Project:** Query Engine / Views Coupling Refactor  
**Constraint:** Minimize interface to 1-3 entry points  
**Status:** ✅ Design Complete — Ready for Implementation  
**Date:** 2026-04-14

---

## Documents

### 1. **REFACTOR_INTERFACE_DESIGN.md** — Full Design Document
- **Best for:** Architects, reviewers, comprehensive understanding
- **Length:** ~2,500 words
- **Contains:**
  - Problem summary
  - Target design with 1-3 entry points
  - Architecture diagram
  - Detailed signatures & types
  - Usage examples (before/after)
  - Complexity hidden by interface
  - Dependency strategy
  - Trade-offs
  - Implementation plan with checklist

**When to read:** Start here for complete context.

---

### 2. **REFACTOR_INTERFACE_SUMMARY.txt** — ASCII Quick Overview
- **Best for:** Terminal viewing, quick reference
- **Length:** ~1,000 words
- **Contains:**
  - Current state (problem)
  - Target state (solution)
  - Architecture flow diagrams
  - What gets hidden
  - Trade-offs comparison
  - Implementation checklist
  - Summary table

**When to read:** Need a quick understanding without opening an editor.

---

### 3. **QUICK_REFERENCE.md** — Developer Quick Reference
- **Best for:** Developers implementing the refactor
- **Length:** ~1,200 words
- **Contains:**
  - One-liner summary
  - What changes (before/after table)
  - The 3-4 entry points explained
  - Files to create/delete/update
  - Code patterns (copy-paste ready)
  - Key types
  - Why this design
  - Trade-offs
  - Migration steps
  - Exact files to modify

**When to read:** When you're ready to start implementation.

---

### 4. **interface_exact_types.ts** — TypeScript Signatures
- **Best for:** Developers coding the implementation
- **Length:** ~400 lines
- **Contains:**
  - Exact TypeScript types
  - Function signatures with JSDoc
  - Dependency injection types
  - Public API functions
  - Implementation notes
  - Usage examples in comments
  - Route integration examples

**When to read:** When implementing `view-orchestrator.ts` and `validator-public.ts`.

---

### 5. **REFACTOR_DESIGN_INDEX.md** — This File
- **Best for:** Navigation and overview
- **Length:** ~400 words
- **Contains:** Document descriptions and reading guide

---

## Reading Guide by Role

### Software Architect
1. Start with **REFACTOR_INTERFACE_DESIGN.md** — get full context
2. Review **interface_exact_types.ts** — verify type safety
3. Skim **Trade-offs** section in **REFACTOR_INTERFACE_SUMMARY.txt**

### Technical Reviewer (Code Review)
1. Read **REFACTOR_INTERFACE_DESIGN.md** — understand design rationale
2. Use **interface_exact_types.ts** as reference during review
3. Check **Implementation Plan** checklist before approving

### Backend Developer (Implementing)
1. Start with **QUICK_REFERENCE.md** — get oriented
2. Use **interface_exact_types.ts** as you code
3. Refer to **Code Patterns** for copy-paste templates
4. Check **Migration Steps** as you progress

### QA / Tester
1. Read **Dependency Strategy** in **REFACTOR_INTERFACE_DESIGN.md**
2. Study **Pure Validation (Unit Test)** code pattern in **QUICK_REFERENCE.md**
3. Check **Testing with Mocked Dependencies** pattern

---

## Key Concepts Summary

### The Problem
- `lib/views/definition.ts` (280 LOC) orchestrates at library level ❌
- Bidirectional coupling: `lib/views ↔ query-engine` ❌
- Validation hard to test without DB/HTTP ❌

### The Solution
- Move to `query-engine/view-orchestrator.ts` (250 LOC) ✓
- Add pure validation API: `lib/views/validator-public.ts` (30 LOC) ✓
- Single entry point: `validateAndPrepareView()` ✓
- Unidirectional coupling: `query-engine → lib/views` ✓

### The Interface (2 Public Functions)
1. **`validateAndPrepareView()`** — Primary function
   - Location: `query-engine/view-orchestrator.ts`
   - Does: Load schemas + validate + return PreparedView
   - Replaces: `viewDefinitionModule.prepare()`

2. **`validateViewDefinitionOnly()`** — Utility function (tests only)
   - Location: `lib/views/validator-public.ts`
   - Does: Pure validation without DB
   - Useful for: Unit tests, pre-flight checks

3. **`PreparedView` methods** (3 total)
   - `.execute()` — Run query, return results
   - `.assertSavable()` — Validate before persistence
   - `.toRuntimeRequest()` — Build UI request

### Files to Modify
- **Create 2:** `view-orchestrator.ts`, `validator-public.ts`
- **Delete 1:** `lib/views/definition.ts`
- **Update 5:** Routes, indexes, tests

---

## What Each Section Teaches

| Document | Teaches What? |
|----------|---------------|
| DESIGN.md | Full architecture, types, rationale, trade-offs |
| SUMMARY.txt | Problem/solution comparison, quick flow diagram |
| QUICK_REF.md | Implementation steps, code patterns, exact files |
| exact_types.ts | TypeScript signatures, integration examples |
| INDEX.md | Navigation and reading guide |

---

## Constraint Achievement

**Constraint:** Minimize interface to 1-3 entry points  
**Target:** ✅ Achieved with 2 public functions (1 primary + 1 utility)

- **Primary entry point:** `validateAndPrepareView()` — single orchestration
- **Utility entry point:** `validateViewDefinitionOnly()` — testable validation
- **Methods on PreparedView:** `execute()`, `assertSavable()`, `toRuntimeRequest()`

Total: 1 primary + 1 utility + 2 methods = **Minimal interface** ✓

---

## Next Steps

1. **Stakeholder review** → Use DESIGN.md
2. **Technical design review** → Use exact_types.ts
3. **Begin implementation** → Use QUICK_REFERENCE.md
4. **Implement code** → Use exact_types.ts as reference
5. **Code review** → Use DESIGN.md + exact_types.ts
6. **Test** → Refer to testing patterns in QUICK_REFERENCE.md

---

## File Locations

All documents are in the repository root:

```
/Users/diptesh/Desktop/Code/ryot/
├── REFACTOR_INTERFACE_DESIGN.md
├── REFACTOR_INTERFACE_SUMMARY.txt
├── QUICK_REFERENCE.md
├── interface_exact_types.ts
└── REFACTOR_DESIGN_INDEX.md (this file)
```

Additionally:
- `/tmp/interface_exact_types.ts` — Backup copy

---

## Design Principles

1. **Minimize surface area** — 1 primary + 1 utility entry point
2. **Clear responsibilities** — Orchestrator coordinates, lib/views validates
3. **Testable** — Pure validation needs only schema maps
4. **Unidirectional** — query-engine → lib/views only
5. **Explicit errors** — Routes catch specific error types
6. **Hidden complexity** — Maps, SQL, pagination internals

---

## Questions?

- **"What's the main entry point?"** → `validateAndPrepareView()` (QUICK_REFERENCE.md section 3)
- **"How do I test validation?"** → `validateViewDefinitionOnly()` (QUICK_REFERENCE.md code pattern 3)
- **"What changes do I need to make?"** → See QUICK_REFERENCE.md "Files to Update"
- **"Why move code out of lib/?"** → See DESIGN.md "Trade-offs" section
- **"How do I inject test dependencies?"** → See QUICK_REFERENCE.md code pattern 4

---

## Last Updated

**Date:** 2026-04-14  
**Version:** 1.0 (Design Complete)  
**Status:** Ready for Implementation
