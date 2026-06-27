import type { AutomationRuleKind } from "@ryot/contract/modules/automations/schemas";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { stableStringify } from "@ryot/ts-utils/json";
import { generateId } from "better-auth";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { Effect, Match } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";
import { hasForbiddenGlobalRuleCapability } from "#modules/automations/capabilities";

import type { builtinSignalSchemas } from "./signal-schemas";

export const ensureBuiltinSignalSchema = Effect.fn(function* (
	input: ReturnType<typeof builtinSignalSchemas>[number],
) {
	const db = yield* CurrentDb;
	const [existing] = yield* dbEffect(() =>
		db
			.select()
			.from(schema.signalSchema)
			.where(and(eq(schema.signalSchema.slug, input.slug), isNull(schema.signalSchema.userId)))
			.limit(1),
	);
	if (existing) {
		if (
			stableStringify(existing.propertiesSchema) !== stableStringify(input.propertiesSchema) ||
			stableStringify(existing.audiencePolicy) !== stableStringify(input.audiencePolicy)
		) {
			return yield* Effect.die(new Error(`Built-in signal contract changed for ${input.slug}`));
		}
		yield* dbEffect(() =>
			db
				.update(schema.signalSchema)
				.set({
					isBuiltin: true,
					name: input.name,
					catalogState: input.catalogState,
				})
				.where(eq(schema.signalSchema.id, existing.id)),
		);
		return existing.id;
	}

	const id = generateId();
	yield* dbEffect(() =>
		db.insert(schema.signalSchema).values({
			id,
			isBuiltin: true,
			name: input.name,
			slug: input.slug,
			catalogState: input.catalogState,
			audiencePolicy: input.audiencePolicy,
			propertiesSchema: input.propertiesSchema,
		}),
	);
	return id;
});

export const ensureBuiltinAutomationRule = Effect.fn(function* (input: {
	name: string;
	sandboxScriptId: string;
	position?: number | undefined;
	metadata: Record<string, unknown>;
	kind?: AutomationRuleKind | undefined;
	operation: "create" | "update" | "delete";
	target: { kind: "entity" | "event" | "relationship"; id: string };
}) {
	const db = yield* CurrentDb;
	const [script] = yield* dbEffect(() =>
		db
			.select({ metadata: schema.sandboxScript.metadata })
			.from(schema.sandboxScript)
			.where(eq(schema.sandboxScript.id, input.sandboxScriptId))
			.limit(1),
	);
	if (!script) {
		return yield* Effect.die(new Error("Missing global detector sandbox script"));
	}
	if (hasForbiddenGlobalRuleCapability(script.metadata.allowedHostFunctions ?? [])) {
		return yield* Effect.die(new Error("Global automation rules cannot send notifications"));
	}
	const targetColumn = Match.value(input.target).pipe(
		Match.when({ kind: "entity" }, () => schema.automationRule.entitySchemaId),
		Match.when({ kind: "event" }, () => schema.automationRule.eventSchemaId),
		Match.when({ kind: "relationship" }, () => schema.automationRule.relationshipSchemaId),
		Match.exhaustive,
	);
	const [existing] = yield* dbEffect(() =>
		db
			.select({ id: schema.automationRule.id })
			.from(schema.automationRule)
			.where(
				and(
					isNull(schema.automationRule.userId),
					eq(targetColumn, input.target.id),
					eq(schema.automationRule.operation, input.operation),
					eq(schema.automationRule.sandboxScriptId, input.sandboxScriptId),
				),
			)
			.limit(1),
	);
	const values = {
		isActive: true,
		isBuiltin: true,
		name: input.name,
		metadata: input.metadata,
		operation: input.operation,
		position: input.position ?? null,
		kind: input.kind ?? ("subscription" as const),
	};
	if (existing) {
		yield* dbEffect(() =>
			db.update(schema.automationRule).set(values).where(eq(schema.automationRule.id, existing.id)),
		);
		return undefined;
	}
	yield* dbEffect(() =>
		db.insert(schema.automationRule).values({
			...values,
			sandboxScriptId: input.sandboxScriptId,
			eventSchemaId: input.target.kind === "event" ? input.target.id : null,
			entitySchemaId: input.target.kind === "entity" ? input.target.id : null,
			relationshipSchemaId: input.target.kind === "relationship" ? input.target.id : null,
		}),
	);
	return undefined;
});

export const ensureBuiltinEntitySchema = Effect.fn(function* (input: {
	slug: string;
	name: string;
	icon: string;
	accentColor: string;
	propertiesSchema: AppSchema;
}) {
	const db = yield* CurrentDb;
	const [existing] = yield* dbEffect(() =>
		db
			.select({ id: schema.entitySchema.id })
			.from(schema.entitySchema)
			.where(and(eq(schema.entitySchema.slug, input.slug), isNull(schema.entitySchema.userId)))
			.limit(1),
	);

	if (existing) {
		yield* dbEffect(() =>
			db
				.update(schema.entitySchema)
				.set({
					isBuiltin: true,
					name: input.name,
					icon: input.icon,
					accentColor: input.accentColor,
					propertiesSchema: input.propertiesSchema,
				})
				.where(eq(schema.entitySchema.id, existing.id)),
		);
		return existing.id;
	}

	const schemaId = generateId();
	yield* dbEffect(() =>
		db.insert(schema.entitySchema).values({
			id: schemaId,
			isBuiltin: true,
			name: input.name,
			slug: input.slug,
			icon: input.icon,
			accentColor: input.accentColor,
			propertiesSchema: input.propertiesSchema,
		}),
	);
	return schemaId;
});

export const ensureBuiltinEntitySchemaEventSchemas = Effect.fn(function* (input: {
	entitySchemaId: string;
	eventSchemas: Array<{ slug: string; name: string; propertiesSchema: AppSchema }>;
}) {
	const db = yield* CurrentDb;
	const expectedSlugs = input.eventSchemas.map((eventSchema) => eventSchema.slug);

	if (expectedSlugs.length === 0) {
		yield* dbEffect(() =>
			db
				.delete(schema.eventSchema)
				.where(
					and(
						eq(schema.eventSchema.entitySchemaId, input.entitySchemaId),
						isNull(schema.eventSchema.userId),
					),
				),
		);
	} else {
		yield* dbEffect(() =>
			db
				.delete(schema.eventSchema)
				.where(
					and(
						eq(schema.eventSchema.entitySchemaId, input.entitySchemaId),
						isNull(schema.eventSchema.userId),
						notInArray(schema.eventSchema.slug, expectedSlugs),
					),
				),
		);
	}

	for (const eventSchema of input.eventSchemas) {
		yield* dbEffect(() =>
			db.execute(
				sql`insert into "event_schema" (
						"id", "slug", "name", "entity_schema_id", "properties_schema", "is_builtin"
					) values (
						${generateId()}, ${eventSchema.slug}, ${eventSchema.name},
						${input.entitySchemaId}, ${JSON.stringify(eventSchema.propertiesSchema)}::jsonb, true
					)
						on conflict ("entity_schema_id", "slug")
						where "user_id" is null
						do update set
							"name" = excluded."name",
							"is_builtin" = true,
							"properties_schema" = excluded."properties_schema"`,
			),
		);
	}
});
