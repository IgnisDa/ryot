import { generateId } from "better-auth";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect, TransactionRunner } from "~/lib/db";
import * as schema from "~/lib/db/schema";

import type { AppSchema } from "../schema";
import { builtinEntitySchemas } from "./entity-schemas";
import {
	builtinEventSchemaTriggerLinks,
	builtinSandboxScripts,
	companySchemaScriptLinks,
	entitySchemaScriptLinks,
	fitnessSchemaScriptLinks,
	groupSchemaScriptLinks,
	personSchemaScriptLinks,
} from "./manifests";
import { builtinRelationshipSchemas } from "./relationship-schemas";

const ensureBuiltinEntitySchema = (input: {
	slug: string;
	name: string;
	icon: string;
	accentColor: string;
	propertiesSchema: AppSchema;
}) =>
	Effect.gen(function* () {
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

const ensureBuiltinEntitySchemaEventSchemas = (input: {
	entitySchemaId: string;
	eventSchemas: Array<{ slug: string; name: string; propertiesSchema: AppSchema }>;
}) =>
	Effect.gen(function* () {
		const db = yield* CurrentDb;
		const expectedSlugs = input.eventSchemas.map((s) => s.slug);

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

const ensureBuiltinSandboxScript = (input: {
	code: string;
	name: string;
	slug: string;
	metadata: Record<string, unknown>;
}) =>
	Effect.gen(function* () {
		const db = yield* CurrentDb;
		const [existingScript] = yield* dbEffect(() =>
			db
				.select({
					id: schema.sandboxScript.id,
					code: schema.sandboxScript.code,
					name: schema.sandboxScript.name,
					isBuiltin: schema.sandboxScript.isBuiltin,
				})
				.from(schema.sandboxScript)
				.where(and(eq(schema.sandboxScript.slug, input.slug), isNull(schema.sandboxScript.userId)))
				.limit(1),
		);

		const scriptId = existingScript?.id ?? generateId();
		const values = {
			isBuiltin: true,
			name: input.name,
			code: input.code,
			metadata: input.metadata,
		};

		if (existingScript) {
			yield* dbEffect(() =>
				db.update(schema.sandboxScript).set(values).where(eq(schema.sandboxScript.id, scriptId)),
			);
		} else {
			yield* dbEffect(() =>
				db.insert(schema.sandboxScript).values({ id: scriptId, slug: input.slug, ...values }),
			);
		}
		return scriptId;
	});

const linkScriptToEntitySchema = (input: { entitySchemaId: string; sandboxScriptId: string }) =>
	Effect.gen(function* () {
		const db = yield* CurrentDb;
		const [existing] = yield* dbEffect(() =>
			db
				.select({ id: schema.entitySchemaScript.id })
				.from(schema.entitySchemaScript)
				.where(
					and(
						eq(schema.entitySchemaScript.entitySchemaId, input.entitySchemaId),
						eq(schema.entitySchemaScript.sandboxScriptId, input.sandboxScriptId),
					),
				)
				.limit(1),
		);

		if (existing) {
			return;
		}

		yield* dbEffect(() =>
			db.insert(schema.entitySchemaScript).values({
				entitySchemaId: input.entitySchemaId,
				sandboxScriptId: input.sandboxScriptId,
			}),
		);
	});

const ensureBuiltinEventSchemaTrigger = (input: {
	name: string;
	phase: string;
	position: number;
	eventSchemaId: string;
	sandboxScriptId: string;
	metadata: Record<string, unknown>;
}) =>
	Effect.gen(function* () {
		const db = yield* CurrentDb;
		const [existing] = yield* dbEffect(() =>
			db
				.select({ id: schema.eventSchemaTrigger.id })
				.from(schema.eventSchemaTrigger)
				.where(
					and(
						isNull(schema.eventSchemaTrigger.userId),
						eq(schema.eventSchemaTrigger.eventSchemaId, input.eventSchemaId),
						eq(schema.eventSchemaTrigger.sandboxScriptId, input.sandboxScriptId),
					),
				)
				.limit(1),
		);

		if (existing) {
			yield* dbEffect(() =>
				db
					.update(schema.eventSchemaTrigger)
					.set({
						isActive: true,
						isBuiltin: true,
						name: input.name,
						phase: input.phase,
						position: input.position,
						metadata: input.metadata,
					})
					.where(eq(schema.eventSchemaTrigger.id, existing.id)),
			);
			return existing.id;
		}

		const triggerId = generateId();
		yield* dbEffect(() =>
			db.insert(schema.eventSchemaTrigger).values({
				id: triggerId,
				isActive: true,
				isBuiltin: true,
				name: input.name,
				phase: input.phase,
				position: input.position,
				metadata: input.metadata,
				eventSchemaId: input.eventSchemaId,
				sandboxScriptId: input.sandboxScriptId,
			}),
		);
		return triggerId;
	});

const ensureBuiltinRelationshipSchema = (input: {
	slug: string;
	name: string;
	propertiesSchema: AppSchema;
	sourceEntitySchemaId?: string;
	targetEntitySchemaId?: string;
}) =>
	Effect.gen(function* () {
		const db = yield* CurrentDb;
		const [existing] = yield* dbEffect(() =>
			db
				.select({ id: schema.relationshipSchema.id })
				.from(schema.relationshipSchema)
				.where(
					and(
						eq(schema.relationshipSchema.slug, input.slug),
						isNull(schema.relationshipSchema.userId),
					),
				)
				.limit(1),
		);

		if (existing) {
			yield* dbEffect(() =>
				db
					.update(schema.relationshipSchema)
					.set({
						isBuiltin: true,
						name: input.name,
						propertiesSchema: input.propertiesSchema,
						sourceEntitySchemaId: input.sourceEntitySchemaId ?? null,
						targetEntitySchemaId: input.targetEntitySchemaId ?? null,
					})
					.where(eq(schema.relationshipSchema.id, existing.id)),
			);
			return existing.id;
		}

		const schemaId = generateId();
		yield* dbEffect(() =>
			db.insert(schema.relationshipSchema).values({
				id: schemaId,
				isBuiltin: true,
				name: input.name,
				slug: input.slug,
				propertiesSchema: input.propertiesSchema,
				sourceEntitySchemaId: input.sourceEntitySchemaId ?? null,
				targetEntitySchemaId: input.targetEntitySchemaId ?? null,
			}),
		);
		return schemaId;
	});

const seedInitialDatabase = Effect.gen(function* () {
	yield* Effect.logInfo("Seeding entity schemas...");
	const db = yield* CurrentDb;

	const schemaIds = new Map<string, string>();
	for (const entitySchema of builtinEntitySchemas()) {
		const schemaId = yield* ensureBuiltinEntitySchema({
			slug: entitySchema.slug,
			name: entitySchema.name,
			icon: entitySchema.icon,
			accentColor: entitySchema.accentColor,
			propertiesSchema: entitySchema.propertiesSchema,
		});
		yield* ensureBuiltinEntitySchemaEventSchemas({
			entitySchemaId: schemaId,
			eventSchemas: entitySchema.eventSchemas,
		});
		schemaIds.set(entitySchema.slug, schemaId);
	}

	const scriptIds = new Map<string, string>();
	for (const script of builtinSandboxScripts()) {
		const scriptId = yield* ensureBuiltinSandboxScript({
			code: script.code,
			name: script.name,
			slug: script.slug,
			metadata: script.metadata,
		});
		scriptIds.set(script.slug, scriptId);
	}

	for (const link of [
		...entitySchemaScriptLinks(),
		...fitnessSchemaScriptLinks(),
		...companySchemaScriptLinks(),
		...personSchemaScriptLinks(),
		...groupSchemaScriptLinks(),
	]) {
		const entitySchemaId = schemaIds.get(link.schemaSlug);
		const scriptId = scriptIds.get(link.scriptSlug);

		if (!entitySchemaId) {
			return yield* Effect.die(new Error(`Missing schema id for ${link.schemaSlug}`));
		}
		if (!scriptId) {
			return yield* Effect.die(new Error(`Missing script id for ${link.scriptSlug}`));
		}

		yield* linkScriptToEntitySchema({
			entitySchemaId,
			sandboxScriptId: scriptId,
		});
	}

	for (const triggerLink of builtinEventSchemaTriggerLinks()) {
		const scriptId = scriptIds.get(triggerLink.scriptSlug);
		if (!scriptId) {
			return yield* Effect.die(
				new Error(`Missing script id for trigger script ${triggerLink.scriptSlug}`),
			);
		}

		const matchingEventSchemas = yield* dbEffect(() =>
			db
				.select({ id: schema.eventSchema.id })
				.from(schema.eventSchema)
				.where(
					and(
						eq(schema.eventSchema.slug, triggerLink.eventSchemaSlug),
						isNull(schema.eventSchema.userId),
					),
				),
		);

		for (const es of matchingEventSchemas) {
			yield* ensureBuiltinEventSchemaTrigger({
				eventSchemaId: es.id,
				phase: triggerLink.phase,
				sandboxScriptId: scriptId,
				name: triggerLink.triggerName,
				position: triggerLink.position,
				metadata: triggerLink.metadata,
			});
		}
	}

	yield* Effect.logInfo("Seeding relationship schemas...");

	for (const relationshipSchema of builtinRelationshipSchemas()) {
		const sourceEntitySchemaId = relationshipSchema.sourceEntitySchemaSlug
			? schemaIds.get(relationshipSchema.sourceEntitySchemaSlug)
			: undefined;
		const targetEntitySchemaId = relationshipSchema.targetEntitySchemaSlug
			? schemaIds.get(relationshipSchema.targetEntitySchemaSlug)
			: undefined;

		if (relationshipSchema.sourceEntitySchemaSlug && !sourceEntitySchemaId) {
			return yield* Effect.die(
				new Error(
					`Missing entity schema id for slug "${relationshipSchema.sourceEntitySchemaSlug}" (relationship schema: "${relationshipSchema.slug}")`,
				),
			);
		}
		if (relationshipSchema.targetEntitySchemaSlug && !targetEntitySchemaId) {
			return yield* Effect.die(
				new Error(
					`Missing entity schema id for slug "${relationshipSchema.targetEntitySchemaSlug}" (relationship schema: "${relationshipSchema.slug}")`,
				),
			);
		}

		yield* ensureBuiltinRelationshipSchema({
			slug: relationshipSchema.slug,
			name: relationshipSchema.name,
			propertiesSchema: relationshipSchema.propertiesSchema,
			sourceEntitySchemaId,
			targetEntitySchemaId,
		});
	}

	yield* Effect.logInfo("Entity schemas seeded successfully");
	return { done: true as const };
});

export class SeedService extends Effect.Service<SeedService>()("SeedService", {
	effect: Effect.gen(function* () {
		const runner = yield* TransactionRunner;
		yield* runner(seedInitialDatabase);
		return { done: true as const };
	}),
}) {}
