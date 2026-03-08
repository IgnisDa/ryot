# Event Schema Slice Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the minimum `event_schema` management slice so users can list and create event schemas for their own custom entity schemas from the existing custom facet page.

**Architecture:** Add a dedicated backend `event-schemas` module that mirrors the existing `entity-schemas` route/repository/service structure and gates all access through the parent entity schema. On the frontend, add a small `event-schemas` feature module for form/model/query helpers and integrate it inline under each custom entity schema card without adding routes or broader tracker behavior.

**Tech Stack:** Hono, Zod, Drizzle ORM, React 19, TanStack Query, TanStack Router, Mantine, Bun test, Turbo

---

### Task 1: Backend event-schema validation and access helpers

**Files:**
- Create: `apps/app-backend/src/modules/event-schemas/service.ts`
- Create: `apps/app-backend/src/modules/event-schemas/service.test.ts`
- Create: `apps/app-backend/src/modules/event-schemas/access.ts`
- Create: `apps/app-backend/src/modules/event-schemas/access.test.ts`

**Step 1: Write the failing service tests**

Create `apps/app-backend/src/modules/event-schemas/service.test.ts` with coverage for trimmed names, trimmed entity schema ids, slug normalization, and flat object properties parsing:

```ts
import { describe, expect, it } from "bun:test";
import {
	parseEventSchemaPropertiesSchema,
	resolveEventSchemaCreateInput,
	resolveEventSchemaEntitySchemaId,
	resolveEventSchemaName,
} from "./service";

describe("resolveEventSchemaName", () => {
	it("trims the provided name", () => {
		expect(resolveEventSchemaName("  Tasting  ")).toBe("Tasting");
	});
});

describe("parseEventSchemaPropertiesSchema", () => {
	it("accepts a flat properties map", () => {
		expect(
			parseEventSchemaPropertiesSchema({
				rating: { type: "number" },
				notes: { type: "string" },
			}),
		).toEqual({
			rating: { type: "number" },
			notes: { type: "string" },
		});
	});
});

describe("resolveEventSchemaCreateInput", () => {
	it("returns normalized payload", () => {
		expect(
			resolveEventSchemaCreateInput({
				name: "  Tasting  ",
				slug: "  My Tasting  ",
				propertiesSchema: { rating: { type: "number" } },
			}),
		).toEqual({
			name: "Tasting",
			slug: "my-tasting",
			propertiesSchema: { rating: { type: "number" } },
		});
	});
});
```

**Step 2: Write the failing access-helper tests**

Create `apps/app-backend/src/modules/event-schemas/access.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { resolveCustomEntitySchemaAccess } from "./access";

describe("resolveCustomEntitySchemaAccess", () => {
	it("returns not_found when entity schema is missing", () => {
		expect(resolveCustomEntitySchemaAccess(undefined)).toEqual({
			error: "not_found",
		});
	});

	it("returns builtin when entity schema is built-in", () => {
		expect(
			resolveCustomEntitySchemaAccess({
				id: "schema-1",
				userId: null,
				isBuiltin: true,
			}),
		).toEqual({ error: "builtin" });
	});
	
	it("returns the entity schema when it is custom", () => {
		const entitySchema = {
			id: "schema-1",
			userId: "user-1",
			isBuiltin: false,
		};

		expect(resolveCustomEntitySchemaAccess(entitySchema)).toEqual({
			entitySchema,
		});
	});
});
```

**Step 3: Run the new backend tests to verify they fail**

Run: `bun test 'src/modules/event-schemas/service.test.ts' 'src/modules/event-schemas/access.test.ts'`

Workdir: `apps/app-backend`

Expected: FAIL with missing module or missing symbol errors.

**Step 4: Write the minimal implementation**

Create `apps/app-backend/src/modules/event-schemas/service.ts` by mirroring `entity-schemas/service.ts`, but keep it DRY by reusing shared property-schema validation rules:

```ts
import { resolveRequiredSlug, resolveRequiredString } from "~/lib/slug";
import { parsePropertySchemaInput } from "../property-schemas/service";
import type { AppSchema } from "@ryot/ts-utils";

export type EventSchemaPropertiesShape = AppSchema;

export const resolveEventSchemaName = (name: string) =>
	resolveRequiredString(name, "Event schema name");

export const resolveEventSchemaEntitySchemaId = (entitySchemaId: string) =>
	resolveRequiredString(entitySchemaId, "Entity schema id");

export const resolveEventSchemaSlug = (input: { name: string; slug?: string }) =>
	resolveRequiredSlug({
		name: input.name,
		slug: input.slug,
		label: "Event schema",
	});

export const parseEventSchemaPropertiesSchema = (input: unknown) =>
	parsePropertySchemaInput(input, {
		schemaLabel: "Event schema properties schema",
		propertiesLabel: "Event schema properties",
	});

export const resolveEventSchemaCreateInput = (input: {
	name: string;
	slug?: string;
	propertiesSchema: unknown;
}) => {
	const name = resolveEventSchemaName(input.name);
	const slug = resolveEventSchemaSlug({ name, slug: input.slug });
	const propertiesSchema = parseEventSchemaPropertiesSchema(
		input.propertiesSchema,
	);

	return { name, slug, propertiesSchema };
};
```

Create `apps/app-backend/src/modules/event-schemas/access.ts` with a helper matching the facets pattern:

```ts
export const entitySchemaNotFoundError = "Entity schema not found";
export const customEntitySchemaError =
	"Built-in entity schemas do not support event schemas";

type EntitySchemaScope = {
	id: string;
	userId: string | null;
	isBuiltin: boolean;
};

export const resolveCustomEntitySchemaAccess = (
	entitySchema: EntitySchemaScope | undefined,
) => {
	if (!entitySchema) return { error: "not_found" as const };
	if (entitySchema.isBuiltin) return { error: "builtin" as const };

	return { entitySchema };
};
```

**Step 5: Run the backend tests again**

Run: `bun test 'src/modules/event-schemas/service.test.ts' 'src/modules/event-schemas/access.test.ts'`

Workdir: `apps/app-backend`

Expected: PASS

**Step 6: Commit**

```bash
git add 'apps/app-backend/src/modules/event-schemas/service.ts' 'apps/app-backend/src/modules/event-schemas/service.test.ts' 'apps/app-backend/src/modules/event-schemas/access.ts' 'apps/app-backend/src/modules/event-schemas/access.test.ts'
git commit -m "feat: add event schema validation and access helpers

Attribution: OpenCode | Model: gpt-5.4"
```

### Task 2: Backend event-schema repository, route contracts, and API mounting

**Files:**
- Create: `apps/app-backend/src/modules/event-schemas/repository.ts`
- Create: `apps/app-backend/src/modules/event-schemas/schemas.ts`
- Create: `apps/app-backend/src/modules/event-schemas/routes.ts`
- Modify: `apps/app-backend/src/app/api.ts`
- Create: `apps/app-backend/src/modules/property-schemas/schemas.ts`

**Step 1: Add the repository helper for entity-schema scope**

Extend `apps/app-backend/src/modules/entity-schemas/repository.ts` with a scope lookup that routes can reuse:

```ts
export const getEntitySchemaScopeForUser = async (input: {
	userId: string;
	entitySchemaId: string;
}) => {
	const [foundEntitySchema] = await db
		.select({
			id: entitySchema.id,
			userId: entitySchema.userId,
			isBuiltin: entitySchema.isBuiltin,
		})
		.from(entitySchema)
		.where(
			and(
				eq(entitySchema.id, input.entitySchemaId),
				eq(entitySchema.userId, input.userId),
			),
		)
		.limit(1);

	return foundEntitySchema;
};
```

**Step 2: Write the shared property-schema route contracts and event-schema route contracts**

Create `apps/app-backend/src/modules/event-schemas/schemas.ts` with shapes parallel to `entity-schemas/schemas.ts`:

```ts
import { z } from "zod";
import { dataSchema } from "~/lib/openapi";
import {
	createNameWithOptionalSlugSchema,
	nonEmptyTrimmedStringSchema,
} from "~/lib/zod/base";
import {
	createPropertySchemaInputSchema,
	createPropertySchemaObjectSchema,
} from "../property-schemas/schemas";

export const listedEventSchemaSchema = z.object({
	id: z.string(),
	name: z.string(),
	slug: z.string(),
	entitySchemaId: z.string(),
	propertiesSchema: createPropertySchemaObjectSchema(
		"Event schema properties must contain at least one property",
	),
});

export const listEventSchemasQuery = z.object({
	entitySchemaId: nonEmptyTrimmedStringSchema,
});

export const createEventSchemaBody = createNameWithOptionalSlugSchema({
	entitySchemaId: nonEmptyTrimmedStringSchema,
	propertiesSchema: createPropertySchemaInputSchema(
		"Event schema properties must contain at least one property",
	),
});

export const listEventSchemasResponseSchema = dataSchema(
	z.array(listedEventSchemaSchema),
);

export const createEventSchemaResponseSchema = dataSchema(
	listedEventSchemaSchema,
);
```

**Step 3: Write the event-schema repository**

Create `apps/app-backend/src/modules/event-schemas/repository.ts`:

```ts
import { and, asc, eq } from "drizzle-orm";
import { db } from "~/db";
import { eventSchema } from "~/db/schema";
import type { EventSchemaPropertiesShape } from "./service";

export const listEventSchemasByEntitySchemaForUser = async (input: {
	userId: string;
	entitySchemaId: string;
}) => {
	const rows = await db
		.select({
			id: eventSchema.id,
			name: eventSchema.name,
			slug: eventSchema.slug,
			entitySchemaId: eventSchema.entitySchemaId,
			propertiesSchema: eventSchema.propertiesSchema,
		})
		.from(eventSchema)
		.where(
			and(
				eq(eventSchema.userId, input.userId),
				eq(eventSchema.entitySchemaId, input.entitySchemaId),
			),
		)
		.orderBy(asc(eventSchema.name), asc(eventSchema.createdAt));

	return rows.map((row) => ({
		...row,
		propertiesSchema: row.propertiesSchema as EventSchemaPropertiesShape,
	}));
};
```

Also add `getEventSchemaBySlugForUser` and `createEventSchemaForUser` following the existing entity-schema repository style.

**Step 4: Write the routes**

Create `apps/app-backend/src/modules/event-schemas/routes.ts` mirroring the entity-schema route flow:

- validate `entitySchemaId`
- resolve entity-schema access through `getEntitySchemaScopeForUser` + `resolveCustomEntitySchemaAccess`
- pre-check duplicate slug by `(userId, entitySchemaId, slug)`
- catch the `event_schema_user_entity_schema_slug_unique` constraint defensively

Use these route behaviors:

- `GET /event-schemas?entitySchemaId=...`
- `POST /event-schemas`
- `404` for missing entity schema
- `400` for built-in entity schema or invalid payload

**Step 5: Mount the new backend API**

Modify `apps/app-backend/src/app/api.ts`:

```ts
import { eventSchemasApi } from "~/modules/event-schemas/routes";

export const baseApp = new OpenAPIHono<{ Variables: MaybeAuthType }>()
	// ...existing routes...
	.route("/entity-schemas", entitySchemasApi)
	.route("/event-schemas", eventSchemasApi);
```

**Step 6: Run targeted backend tests and typecheck**

Run: `bun test 'src/modules/event-schemas/service.test.ts' 'src/modules/event-schemas/access.test.ts' && bun run typecheck`

Workdir: `apps/app-backend`

Expected: PASS

**Step 7: Commit**

```bash
git add 'apps/app-backend/src/modules/event-schemas/repository.ts' 'apps/app-backend/src/modules/event-schemas/schemas.ts' 'apps/app-backend/src/modules/event-schemas/routes.ts' 'apps/app-backend/src/app/api.ts' 'apps/app-backend/src/modules/entity-schemas/repository.ts'
git commit -m "feat: add event schema api routes

Attribution: OpenCode | Model: gpt-5.4"
```

### Task 3: Frontend event-schema feature helpers and pure tests

**Files:**
- Create: `apps/app-frontend/src/features/event-schemas/form.ts`
- Create: `apps/app-frontend/src/features/event-schemas/form.test.ts`
- Create: `apps/app-frontend/src/features/event-schemas/model.ts`
- Create: `apps/app-frontend/src/features/event-schemas/model.test.ts`
- Create: `apps/app-frontend/src/features/event-schemas/hooks.ts`
- Create: `apps/app-frontend/src/features/event-schemas/use-form.ts`
- Create: `apps/app-frontend/src/features/event-schemas/properties-builder.tsx`

**Step 1: Write the failing form tests**

Create `apps/app-frontend/src/features/event-schemas/form.test.ts` by mirroring the entity-schema tests with `entitySchemaId` in the payload:

```ts
import { describe, expect, it } from "bun:test";
import {
	buildEventSchemaFormValues,
	buildEventSchemaPropertiesSchema,
	createEventSchemaFormSchema,
	toCreateEventSchemaPayload,
} from "./form";

describe("buildEventSchemaFormValues", () => {
	it("returns default values with one property row", () => {
		const values = buildEventSchemaFormValues();
		expect(values.name).toBe("");
		expect(values.slug).toBe("");
		expect(values.properties).toHaveLength(1);
	});
});

describe("toCreateEventSchemaPayload", () => {
	it("trims values and includes entitySchemaId", () => {
		expect(
			toCreateEventSchemaPayload(
				{
					name: "  Tasting  ",
					slug: " tasting ",
					properties: [
						{ id: "rating", key: "rating", type: "number", required: true },
					],
				},
				"entity-schema-1",
			),
		).toEqual({
			name: "Tasting",
			slug: "tasting",
			entitySchemaId: "entity-schema-1",
			propertiesSchema: {
				rating: { type: "number", required: true },
			},
		});
	});
});
```

**Step 2: Write the failing model tests**

Create `apps/app-frontend/src/features/event-schemas/model.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { getEntityEventSchemaViewState } from "./model";

describe("getEntityEventSchemaViewState", () => {
	it("returns empty when an entity schema has no event schemas", () => {
		expect(getEntityEventSchemaViewState([])).toEqual({ type: "empty" });
	});

	it("returns sorted event schemas when present", () => {
		const state = getEntityEventSchemaViewState([
			{ id: "2", name: "Progress", slug: "progress", entitySchemaId: "e1", propertiesSchema: {} },
			{ id: "1", name: "Finished", slug: "finished", entitySchemaId: "e1", propertiesSchema: {} },
		]);

		expect(state.type).toBe("list");
		if (state.type !== "list") throw new Error("Expected list state");
		expect(state.eventSchemas.map((schema) => schema.slug)).toEqual([
			"finished",
			"progress",
		]);
	});
});
```

**Step 3: Run the frontend package tests to verify they fail**

Run: `bun run turbo test --filter='@ryot/app-frontend'`

Workdir: `/Users/diptesh/Desktop/Code/ryot`

Expected: FAIL with missing files or unresolved imports.

**Step 4: Write the minimal frontend feature implementation**

Create `apps/app-frontend/src/features/event-schemas/form.ts` by mirroring `entity-schemas/form.ts` and reusing the same flat property-row builder logic, but rename helpers, switch payloads from `facetId` to `entitySchemaId`, and submit `propertiesSchema` as an object.

Create `apps/app-frontend/src/features/event-schemas/model.ts` with:

```ts
import type { AppSchema } from "@ryot/ts-utils";

export interface AppEventSchema {
	id: string;
	name: string;
	slug: string;
	entitySchemaId: string;
	propertiesSchema: AppSchema;
}

export function sortEventSchemas(eventSchemas: AppEventSchema[]) {
	return [...eventSchemas].sort((a, b) => {
		if (a.name !== b.name) return a.name.localeCompare(b.name);
		return a.slug.localeCompare(b.slug);
	});
}

export function getEntityEventSchemaViewState(eventSchemas: AppEventSchema[]) {
	if (eventSchemas.length === 0) return { type: "empty" as const };

	return {
		type: "list" as const,
		eventSchemas: sortEventSchemas(eventSchemas),
	};
}
```

Create `hooks.ts`, `use-form.ts`, and `properties-builder.tsx` by following the existing entity-schema feature patterns exactly.

**Step 5: Run the frontend package tests again**

Run: `bun run turbo test --filter='@ryot/app-frontend'`

Workdir: `/Users/diptesh/Desktop/Code/ryot`

Expected: PASS

**Step 6: Commit**

```bash
git add 'apps/app-frontend/src/features/event-schemas/form.ts' 'apps/app-frontend/src/features/event-schemas/form.test.ts' 'apps/app-frontend/src/features/event-schemas/model.ts' 'apps/app-frontend/src/features/event-schemas/model.test.ts' 'apps/app-frontend/src/features/event-schemas/hooks.ts' 'apps/app-frontend/src/features/event-schemas/use-form.ts' 'apps/app-frontend/src/features/event-schemas/properties-builder.tsx'
git commit -m "feat: add frontend event schema helpers

Attribution: OpenCode | Model: gpt-5.4"
```

### Task 4: Integrate event schemas into the custom facet page

**Files:**
- Modify: `apps/app-frontend/src/routes/_protected/tracking/$facetSlug.tsx`
- Create: `apps/app-frontend/src/features/event-schemas/section.tsx`

**Step 1: Extract the event-schema UI section to keep the route file under 500 lines**

Create `apps/app-frontend/src/features/event-schemas/section.tsx` for the inline event-schema list/create UI. Keep it scoped to a single entity schema card.

Start from this component shape:

```tsx
import { Button, Code, Group, Loader, Modal, Paper, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useCallback, useState } from "react";
import {
	EntitySchemaPropertiesBuilder,
	useCreateEventSchemaForm,
	useEventSchemaMutations,
	useEventSchemasQuery,
} from "./...";

export function EventSchemasSection(props: {
	entitySchemaId: string;
	entitySchemaName: string;
}) {
	// query event schemas for props.entitySchemaId
	// show empty state, list, modal create flow
	// invalidate only this entity schema's event-schema query on success
}
```

Use compact copy:

- section label: `Event schemas`
- empty state title: `No event schemas yet`
- action label: `Add event schema`

**Step 2: Wire the section into each entity schema card**

Update `apps/app-frontend/src/routes/_protected/tracking/$facetSlug.tsx` so the existing entity schema card rendering becomes:

```tsx
<Paper key={entitySchema.id} p="lg" withBorder radius="md">
	<Stack gap="md">
		<Group justify="space-between" align="flex-start">
			<Stack gap={2}>
				<Text fw={600}>{entitySchema.name}</Text>
				<Code>{entitySchema.slug}</Code>
			</Stack>
			<Text c="dimmed" size="sm">
				{propertyCount} {propertyCount === 1 ? "property" : "properties"}
			</Text>
		</Group>

		<EventSchemasSection
			entitySchemaId={entitySchema.id}
			entitySchemaName={entitySchema.name}
		/>
	</Stack>
</Paper>
```

Do not change the built-in facet read-only behavior.

**Step 3: Run frontend tests and typecheck**

Run: `bun run turbo test --filter='@ryot/app-frontend' && bun run turbo typecheck --filter='@ryot/app-frontend'`

Workdir: `/Users/diptesh/Desktop/Code/ryot`

Expected: PASS

**Step 4: Commit**

```bash
git add 'apps/app-frontend/src/routes/_protected/tracking/$facetSlug.tsx' 'apps/app-frontend/src/features/event-schemas/section.tsx'
git commit -m "feat: show event schema management on custom facet page

Attribution: OpenCode | Model: gpt-5.4"
```

### Task 5: Final verification

**Files:**
- Verify only

**Step 1: Run backend tests for the new pure logic**

Run: `bun test 'src/modules/event-schemas/service.test.ts' 'src/modules/event-schemas/access.test.ts'`

Workdir: `apps/app-backend`

Expected: PASS

**Step 2: Run backend package verification**

Run: `bun run turbo test --filter='@ryot/app-backend' && bun run turbo typecheck --filter='@ryot/app-backend'`

Workdir: `/Users/diptesh/Desktop/Code/ryot`

Expected: PASS

**Step 3: Run frontend package verification**

Run: `bun run turbo test --filter='@ryot/app-frontend' && bun run turbo typecheck --filter='@ryot/app-frontend'`

Workdir: `/Users/diptesh/Desktop/Code/ryot`

Expected: PASS

**Step 4: Review git diff for scope**

Run: `git diff --stat`

Workdir: `/Users/diptesh/Desktop/Code/ryot`

Expected: Only `event-schemas` slice files plus the necessary route/API integration changes.

**Step 5: Commit the verification checkpoint**

```bash
git commit --allow-empty -m "chore: verify event schema slice

Attribution: OpenCode | Model: gpt-5.4"
```
