import { EventSchemaId, SandboxScriptId, SignalSchemaId } from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { generateId } from "better-auth";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect, TransactionRunner } from "#lib/infrastructure/db/service";
import { AutomationsService } from "#modules/automations/service";
import { SignalSchemasService } from "#modules/signals/service";

import { builtinEntitySchemas } from "./entity-schemas";
import {
	builtinEventAutomationRuleLinks,
	builtinSignalAutomationRuleLinks,
	builtinSandboxScripts,
	companySchemaSandboxScriptLinks,
	entitySchemaSandboxScriptLinks,
	fitnessSchemaSandboxScriptLinks,
	groupSchemaSandboxScriptLinks,
	personSchemaSandboxScriptLinks,
} from "./registry";
import { builtinRelationshipSchemas } from "./relationship-schemas";
import { builtinSignalSchemas } from "./signal-schemas";

const ensureBuiltinEntitySchema = Effect.fn(function* (input: {
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

const ensureBuiltinEntitySchemaEventSchemas = Effect.fn(function* (input: {
	entitySchemaId: string;
	eventSchemas: Array<{ slug: string; name: string; propertiesSchema: AppSchema }>;
}) {
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

const ensureBuiltinSandboxScript = Effect.fn(function* (input: {
	name: string;
	slug: string;
	source: string;
	compiledCode: string;
	compiledFormat: number;
	manifest: Record<string, unknown>;
}) {
	const db = yield* CurrentDb;
	const [existingScript] = yield* dbEffect(() =>
		db
			.select({ id: schema.sandboxScript.id })
			.from(schema.sandboxScript)
			.where(and(eq(schema.sandboxScript.slug, input.slug), isNull(schema.sandboxScript.userId)))
			.limit(1),
	);

	const scriptId = existingScript?.id ?? generateId();
	const values = {
		isBuiltin: true,
		name: input.name,
		source: input.source,
		metadata: input.manifest,
		compiledCode: input.compiledCode,
		compiledFormat: input.compiledFormat,
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

const linkScriptToEntitySchema = Effect.fn(function* (input: {
	entitySchemaId: string;
	sandboxScriptId: string;
}) {
	const db = yield* CurrentDb;
	const [existing] = yield* dbEffect(() =>
		db
			.select({ id: schema.entitySchemaSandboxScript.id })
			.from(schema.entitySchemaSandboxScript)
			.where(
				and(
					eq(schema.entitySchemaSandboxScript.entitySchemaId, input.entitySchemaId),
					eq(schema.entitySchemaSandboxScript.sandboxScriptId, input.sandboxScriptId),
				),
			)
			.limit(1),
	);

	if (existing) {
		return;
	}

	yield* dbEffect(() =>
		db.insert(schema.entitySchemaSandboxScript).values({
			entitySchemaId: input.entitySchemaId,
			sandboxScriptId: input.sandboxScriptId,
		}),
	);
});

const ensureBuiltinRelationshipSchema = Effect.fn(function* (input: {
	slug: string;
	name: string;
	propertiesSchema: AppSchema;
	sourceEntitySchemaId?: string | undefined;
	targetEntitySchemaId?: string | undefined;
}) {
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
		const scriptId = yield* ensureBuiltinSandboxScript(script);
		scriptIds.set(script.slug, scriptId);
	}

	for (const link of [
		...entitySchemaSandboxScriptLinks(),
		...fitnessSchemaSandboxScriptLinks(),
		...companySchemaSandboxScriptLinks(),
		...personSchemaSandboxScriptLinks(),
		...groupSchemaSandboxScriptLinks(),
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
	const eventSchemas = yield* dbEffect(() =>
		db
			.select({ id: schema.eventSchema.id, slug: schema.eventSchema.slug })
			.from(schema.eventSchema)
			.where(isNull(schema.eventSchema.userId)),
	);
	return { eventSchemas, scriptIds };
});

export class SeedService extends Effect.Service<SeedService>()("SeedService", {
	effect: Effect.gen(function* () {
		const runner = yield* TransactionRunner;
		const automations = yield* AutomationsService;
		const signalSchemas = yield* SignalSchemasService;
		const { eventSchemas, scriptIds } = yield* runner(seedInitialDatabase);
		for (const link of builtinEventAutomationRuleLinks()) {
			const scriptId = scriptIds.get(link.scriptSlug);
			if (!scriptId) {
				return yield* Effect.die(
					new Error(`Missing built-in event automation script for ${link.name}`),
				);
			}
			for (const eventSchema of eventSchemas.filter(({ slug }) => slug === link.eventSchemaSlug)) {
				yield* automations.ensureBuiltin({
					name: link.name,
					kind: link.kind,
					metadata: link.metadata,
					position: link.position,
					operation: "create",
					sandboxScriptId: SandboxScriptId.make(scriptId),
					target: { id: EventSchemaId.make(eventSchema.id), kind: "event_schema" },
				});
			}
		}
		const signalSchemaIds = new Map<string, SignalSchemaId>();
		for (const definition of builtinSignalSchemas()) {
			const signalSchema = yield* signalSchemas.ensureBuiltin(definition);
			signalSchemaIds.set(definition.slug, signalSchema.id);
		}
		for (const link of builtinSignalAutomationRuleLinks()) {
			const scriptId = scriptIds.get(link.scriptSlug);
			const signalSchemaId = signalSchemaIds.get(link.signalSchemaSlug);
			if (!scriptId || !signalSchemaId) {
				return yield* Effect.die(
					new Error(`Missing built-in automation references for ${link.name}`),
				);
			}
			yield* automations.ensureBuiltin({
				name: link.name,
				operation: "signal",
				kind: "subscription",
				sandboxScriptId: SandboxScriptId.make(scriptId),
				target: { id: SignalSchemaId.make(signalSchemaId), kind: "signal_schema" },
			});
		}
		return { done: true as const };
	}),
}) {}
