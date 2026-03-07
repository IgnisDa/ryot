# Entity Schema Properties Builder Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the entity schema `propertiesSchema` textarea with an array-backed dynamic property builder that serializes to the existing backend JSON Schema string payload.

**Architecture:** Keep authoring state in frontend form rows instead of raw JSON text. Validate rows with pure helpers, serialize rows into the narrow JSON Schema shape the backend already accepts, and submit the same API payload as today.

**Tech Stack:** React, TanStack Form, Mantine, TypeScript, Bun test, Turbo

---

### Task 1: Refactor entity schema form types around property rows

**Files:**
- Modify: `apps/app-frontend/src/features/entity-schemas/form.ts`
- Test: `apps/app-frontend/src/features/entity-schemas/form.test.ts`

**Step 1: Write the failing tests**

Add tests that define the new form defaults and row helpers:

- default form values include one property row
- property row defaults are empty key, `string` type, `required: false`

Example assertions to add:

```ts
expect(buildEntitySchemaFormValues().properties).toEqual([
  { key: "", type: "string", required: false },
]);
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun test 'apps/app-frontend/src/features/entity-schemas/form.test.ts'
```

Expected: FAIL because the form values still expose `propertiesSchema` text instead of row-based state.

**Step 3: Write minimal implementation**

In `apps/app-frontend/src/features/entity-schemas/form.ts`:

- add `EntitySchemaPropertyType`
- add `EntitySchemaPropertyRow`
- add a helper that returns a default row
- change form values to use `properties: EntitySchemaPropertyRow[]`
- make `buildEntitySchemaFormValues()` return one default row when no values are provided

**Step 4: Run test to verify it passes**

Run:

```bash
bun test 'apps/app-frontend/src/features/entity-schemas/form.test.ts'
```

Expected: PASS for the new defaults coverage.

### Task 2: Add pure builder validation helpers

**Files:**
- Modify: `apps/app-frontend/src/features/entity-schemas/form.ts`
- Test: `apps/app-frontend/src/features/entity-schemas/form.test.ts`

**Step 1: Write the failing tests**

Add tests for builder validation rules:

- reject zero rows
- reject blank trimmed keys
- reject duplicate trimmed keys
- accept distinct trimmed keys

Example assertions to add:

```ts
expect(validateEntitySchemaProperties([])).toEqual([
  "At least one property is required",
]);
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun test 'apps/app-frontend/src/features/entity-schemas/form.test.ts'
```

Expected: FAIL because validation helpers do not exist yet.

**Step 3: Write minimal implementation**

In `apps/app-frontend/src/features/entity-schemas/form.ts`:

- add a pure validation helper for property rows
- trim keys before validation
- detect duplicates with a `Set`
- return stable, user-friendly error messages
- connect the helper into the zod form schema with a refinement on `properties`

**Step 4: Run test to verify it passes**

Run:

```bash
bun test 'apps/app-frontend/src/features/entity-schemas/form.test.ts'
```

Expected: PASS for the new validation coverage.

### Task 3: Add JSON Schema serialization helpers

**Files:**
- Modify: `apps/app-frontend/src/features/entity-schemas/form.ts`
- Test: `apps/app-frontend/src/features/entity-schemas/form.test.ts`

**Step 1: Write the failing tests**

Add tests that prove row serialization matches backend expectations:

- `string`, `number`, `boolean` map to simple `{ type }`
- `date` maps to `{ type: "string", format: "date" }`
- required rows create a top-level `required` array
- non-required rows omit the `required` array

Example assertion to add:

```ts
expect(serializeEntitySchemaProperties([
  { key: "releasedOn", type: "date", required: true },
])).toBe(
  '{"type":"object","properties":{"releasedOn":{"type":"string","format":"date"}},"required":["releasedOn"]}',
)
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun test 'apps/app-frontend/src/features/entity-schemas/form.test.ts'
```

Expected: FAIL because serialization does not exist yet.

**Step 3: Write minimal implementation**

In `apps/app-frontend/src/features/entity-schemas/form.ts`:

- add a serializer from property rows to JSON object
- add a formatter that returns the final JSON string
- preserve the narrow backend-compatible top-level shape
- keep the serializer deterministic so tests can assert exact strings

**Step 4: Run test to verify it passes**

Run:

```bash
bun test 'apps/app-frontend/src/features/entity-schemas/form.test.ts'
```

Expected: PASS for serialization coverage.

### Task 4: Update payload mapping to submit serialized schema text

**Files:**
- Modify: `apps/app-frontend/src/features/entity-schemas/form.ts`
- Test: `apps/app-frontend/src/features/entity-schemas/form.test.ts`

**Step 1: Write the failing tests**

Update payload tests so they assert:

- `name` and `slug` are trimmed
- `facetId` is included
- `propertiesSchema` is generated from property rows instead of copied from a textarea

**Step 2: Run test to verify it fails**

Run:

```bash
bun test 'apps/app-frontend/src/features/entity-schemas/form.test.ts'
```

Expected: FAIL because payload mapping still expects `propertiesSchema` in form state.

**Step 3: Write minimal implementation**

Update `toCreateEntitySchemaPayload()` in `apps/app-frontend/src/features/entity-schemas/form.ts` so it:

- trims `name`
- trims `slug`
- serializes `properties`
- returns the same backend payload shape as before

**Step 4: Run test to verify it passes**

Run:

```bash
bun test 'apps/app-frontend/src/features/entity-schemas/form.test.ts'
```

Expected: PASS.

### Task 5: Replace the textarea UI with a property row builder

**Files:**
- Modify: `apps/app-frontend/src/routes/_protected/tracking/$facetSlug.tsx`
- Modify: `apps/app-frontend/src/hooks/forms.tsx` if a reusable checkbox/select helper becomes necessary

**Step 1: Write the minimal UI code**

In `apps/app-frontend/src/routes/_protected/tracking/$facetSlug.tsx`:

- remove the `Textarea` import and usage for `propertiesSchema`
- add a properties section driven by a TanStack array field named `properties`
- render one row per property with:
  - key text input
  - type select
  - required toggle
  - remove button
- add an `Add property` button that appends a default row
- disable row actions while submit is pending

If the row JSX makes the route file too large, extract a small builder component to `apps/app-frontend/src/features/entity-schemas/`.

**Step 2: Wire validation errors into the UI**

Show field-level errors for row keys and a form-level error for cross-row issues like duplicate keys or zero rows.

**Step 3: Run typecheck**

Run:

```bash
bun run turbo typecheck --filter='@ryot/app-frontend'
```

Expected: PASS.

### Task 6: Run focused frontend verification

**Files:**
- Modify: `apps/app-frontend/src/features/entity-schemas/form.test.ts` if any assertions need cleanup

**Step 1: Run logic tests**

Run:

```bash
bun test 'apps/app-frontend/src/features/entity-schemas/form.test.ts'
```

Expected: PASS.

**Step 2: Run package tests**

Run:

```bash
bun run turbo test --filter='@ryot/app-frontend'
```

Expected: PASS.

**Step 3: Run lint**

Run:

```bash
bun run turbo lint --filter='@ryot/app-frontend'
```

Expected: PASS.

**Step 4: Run typecheck**

Run:

```bash
bun run turbo typecheck --filter='@ryot/app-frontend'
```

Expected: PASS.

### Task 7: Final review against scope

**Files:**
- Review: `apps/app-frontend/src/features/entity-schemas/form.ts`
- Review: `apps/app-frontend/src/features/entity-schemas/form.test.ts`
- Review: `apps/app-frontend/src/routes/_protected/tracking/$facetSlug.tsx`

**Step 1: Confirm supported scope**

Verify the builder supports only:

- `string`
- `number`
- `boolean`
- `date`

Verify each row only exposes:

- `key`
- `type`
- `required`

**Step 2: Confirm excluded scope stays excluded**

Verify there is no:

- enum UI
- label or description fields
- nested builder
- backend contract change
- raw JSON textarea fallback

**Step 3: Confirm tests remain logic-only**

Verify no DB tests or new heavyweight route tests were added.
