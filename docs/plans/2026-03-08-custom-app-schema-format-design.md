# Custom App Schema Format Design

**Date:** 2026-03-08

**Goal:** Replace Zod's JSON Schema format with a simplified custom app schema format for entity property definitions. This eliminates unnecessary complexity (regex patterns, `$schema` metadata) and provides a frontend-friendly format that supports the full feature set needed for both user-created and seeded entity schemas.

**Problem:** Current approach uses Zod's `toJSONSchema()` which generates verbose JSON Schema with patterns, metadata, and validation rules that aren't needed for storage. The backend validation is also overly restrictive (exactly 2 keys, must have `type: "object"` at top level).

**Solution:** Define a custom app schema format that captures only what we need: types, nullability, required fields, arrays, and nested objects. Create bidirectional converters between Zod schemas and app schemas in `@ryot/ts-utils`.

---

## Custom Schema Format

### TypeScript Types

```typescript
type AppSchema = Record<string, AppPropertyDefinition>;

type AppPropertyDefinition = 
  | AppPrimitiveProperty
  | AppArrayProperty
  | AppObjectProperty;

type AppPrimitiveProperty = {
  type: "string" | "number" | "integer" | "boolean" | "date";
  nullable?: true;
  required?: true;
};

type AppArrayProperty = {
  type: "array";
  items: AppPropertyDefinition;
  nullable?: true;
  required?: true;
};

type AppObjectProperty = {
  type: "object";
  properties: Record<string, AppPropertyDefinition>;
  nullable?: true;
  required?: true;
};
```

### Supported Types

**Primitives:**
- `string` - Text values
- `number` - Floating point numbers
- `integer` - Whole numbers (distinct from number)
- `boolean` - True/false values
- `date` - ISO date strings (YYYY-MM-DD)

**Complex:**
- `array` - Lists of items (with `items` definition)
- `object` - Nested structures (with `properties` map)

**Modifiers:**
- `nullable: true` - Field can be null/undefined
- `required: true` - Field is required (absence of this means optional)

### Storage Format

**Top-level schema** is a flat properties map (implicit object):
```typescript
{
  title: { type: "string", required: true },
  pages: { type: "integer", nullable: true },
  rating: { type: "number", nullable: true }
}
```

**Nested objects** use explicit `type: "object"` with `properties`:
```typescript
{
  people: {
    type: "array",
    items: {
      type: "object",
      properties: {
        role: { type: "string" },
        source: { type: "string" },
        identifier: { type: "string" }
      }
    }
  }
}
```

### Example: Book Schema

```typescript
{
  title: { type: "string", required: true },
  pages: { type: "integer", nullable: true },
  isCompilation: { type: "boolean", nullable: true },
  genres: {
    type: "array",
    items: { type: "string" }
  },
  people: {
    type: "array",
    items: {
      type: "object",
      properties: {
        role: { type: "string" },
        source: { type: "string" },
        identifier: { type: "string" }
      }
    }
  }
}
```

---

## Conversion Logic

### New File: `libs/ts-utils/src/app-schema.ts`

**Exports:**
1. `toAppSchema(zodSchema: z.ZodType): AppSchema` - Convert Zod → App Schema
2. `fromAppSchema(appSchema: AppSchema): z.ZodType` - Convert App Schema → Zod
3. TypeScript types for the schema format

### Zod → App Schema Rules

| Zod Schema | App Schema |
|------------|------------|
| `z.string()` | `{ type: "string" }` |
| `z.number()` | `{ type: "number" }` |
| `z.number().int()` | `{ type: "integer" }` |
| `z.boolean()` | `{ type: "boolean" }` |
| `z.string().date()` | `{ type: "date" }` |
| `z.iso.datetime()` | `{ type: "date" }` |
| `z.array(T)` | `{ type: "array", items: toAppSchema(T) }` |
| `z.object({ k: T })` | `{ type: "object", properties: { k: toAppSchema(T) } }` |
| `.nullish()` / `.nullable()` / `.optional()` | Adds `nullable: true` |
| Top-level `z.object()` | Unwraps to properties map only |

### App Schema → Zod Rules

| App Schema | Zod Schema |
|------------|------------|
| `{ type: "string" }` | `z.string()` |
| `{ type: "number" }` | `z.number()` |
| `{ type: "integer" }` | `z.number().int()` |
| `{ type: "boolean" }` | `z.boolean()` |
| `{ type: "date" }` | `z.string().date()` |
| `{ type: "array", items: T }` | `z.array(fromAppSchema(T))` |
| `{ type: "object", properties: P }` | `z.object(mapProperties(P))` |
| `nullable: true` | `.nullish()` |
| `required: true` | No `.nullish()` (field is required) |
| Top-level properties map | Wraps in `z.object({ ... })` |

---

## Migration Points

### Backend Changes

**1. `libs/ts-utils/src/app-schema.ts`** (NEW)
- Implement `toAppSchema()` converter
- Implement `fromAppSchema()` converter
- Export TypeScript types

**2. `apps/app-backend/src/lib/zod/base.ts`**
- Replace `toStableJsonSchema()` with `toAppSchema()` from `@ryot/ts-utils`
- Keep other helpers unchanged

**3. `apps/app-backend/src/lib/zod/media/*.ts`**
- Update `bookPropertiesJsonSchema` to use `toAppSchema(bookPropertiesSchema)`
- Update `animePropertiesJsonSchema` to use `toAppSchema(animePropertiesSchema)`
- Update `mangaPropertiesJsonSchema` to use `toAppSchema(mangaPropertiesSchema)`
- Update event schemas similarly

**4. `apps/app-backend/src/modules/entity-schemas/service.ts`**
- Update `parseEntitySchemaPropertiesSchema()`:
  - Accept string or object
  - Parse JSON if string
  - Validate it's a properties map (record of property definitions)
  - Validate each property has valid `type` field
  - Remove `type: "object"` top-level check
  - Remove exactly-2-keys restriction
- Update `EntitySchemaPropertiesShape` type to match new format
- Remove `isEntitySchemaPropertiesShape()` or update to validate new format

**5. `apps/app-backend/src/modules/entity-schemas/schemas.ts`**
- Update `entitySchemaPropertiesObjectSchema` to validate app schema format
- Keep union with string for JSON input

**6. `apps/app-backend/src/modules/entity-schemas/service.test.ts`**
- Update test fixtures to use new format
- Update assertions

**7. `apps/app-backend/package.json`**
- Add `@ryot/ts-utils` dependency if not present

### Frontend Changes

**1. `apps/app-frontend/src/features/entity-schemas/form.ts`**
- Update `buildEntitySchemaPropertiesSchema()` to produce app schema format
- Remove wrapping `{ type: "object", properties: {...} }`
- Keep property-level `required` flag instead of top-level `required` array

**2. `apps/app-frontend/src/features/entity-schemas/model.ts`**
- Update `AppEntitySchema.propertiesSchema` type to `Record<string, unknown>`

**3. `apps/app-frontend/src/features/entity-schemas/form.test.ts`**
- Update test assertions for new format
- Remove `type: "object"` from expected values

**4. `apps/app-frontend/package.json`**
- Add `@ryot/ts-utils` dependency if not present

---

## Validation Changes

### Backend: `parseEntitySchemaPropertiesSchema()`

**New validation rules:**
1. Input can be string (JSON) or object
2. If string, parse as JSON
3. Result must be a plain object (properties map)
4. Each key is a property name
5. Each value must be a valid property definition:
   - Has `type` field
   - If `type` is primitive: one of `string`, `number`, `integer`, `boolean`, `date`
   - If `type` is `array`: must have `items` field
   - If `type` is `object`: must have `properties` field (nested properties map)
   - Optional `nullable: true` or `required: true` modifiers

**Removed checks:**
- Top-level `type: "object"` requirement
- Exactly 2 keys (`type` + `properties`)
- `isEntitySchemaPropertiesShape()` strict shape validation

---

## Example Before/After

### Before (Zod JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "releasedOn": {
      "type": "string",
      "format": "date",
      "pattern": "^(?:(?:\\d\\d[2468][048]...)$"
    },
    "pages": {
      "type": "number"
    }
  },
  "required": ["releasedOn"],
  "additionalProperties": false
}
```

### After (App Schema)

```json
{
  "releasedOn": {
    "type": "date",
    "required": true
  },
  "pages": {
    "type": "integer",
    "nullable": true
  }
}
```

---

## Benefits

1. **Simpler format** - No regex patterns, no `$schema` metadata, no `additionalProperties`
2. **Frontend-friendly** - Direct property map, easier to build UIs from
3. **Smaller payloads** - Less data to store and transfer
4. **Type-safe converters** - Bidirectional Zod ↔ App Schema conversion in shared library
5. **Full feature support** - Handles nested objects, arrays, nullability, all primitive types
6. **Backend flexibility** - Removes overly strict validation (exactly 2 keys, etc.)

---

## Non-Goals / Out of Scope

- **No data migration** - Assuming fresh DB, seed scripts will populate with new format
- **No enum support yet** - Can be added later if needed
- **No validation rules** - Min/max, regex patterns, etc. not stored in schema (Zod handles at runtime)
- **No JSON Schema compatibility** - This is a custom format, not standard JSON Schema
