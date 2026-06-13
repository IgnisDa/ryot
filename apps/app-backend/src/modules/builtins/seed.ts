import { RelationshipSchemaId } from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { generateId } from "better-auth";
import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect, TransactionRunner } from "#lib/infrastructure/db/service";

import { builtinEntitySchemas } from "./entity-schemas";
import { builtinMediaEntitySchemaSlugs } from "./media-schema-slugs";
import { builtinSandboxScripts } from "./registry";
import {
	builtinEventAutomationRuleLinks,
	companySchemaSandboxScriptLinks,
	entitySchemaSandboxScriptLinks,
	fitnessSchemaSandboxScriptLinks,
	groupSchemaSandboxScriptLinks,
	personSchemaSandboxScriptLinks,
} from "./registry-links";
import { builtinRelationshipSchemas } from "./relationship-schemas";
import {
	ensureBuiltinAutomationRule,
	ensureBuiltinEntitySchema,
	ensureBuiltinEntitySchemaEventSchemas,
	ensureBuiltinSignalSchema,
} from "./seed-schema-helpers";
import { builtinSignalSchemas } from "./signal-schemas";

const ensureBuiltinSandboxScript = Effect.fn(function* (input: {
	code: string;
	name: string;
	slug: string;
	metadata: Record<string, unknown>;
}) {
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
		const scriptId = yield* ensureBuiltinSandboxScript({
			code: script.code,
			name: script.name,
			slug: script.slug,
			metadata: script.metadata,
		});
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

	for (const ruleLink of builtinEventAutomationRuleLinks()) {
		const scriptId = scriptIds.get(ruleLink.scriptSlug);
		if (!scriptId) {
			return yield* Effect.die(
				new Error(`Missing script id for automation script ${ruleLink.scriptSlug}`),
			);
		}

		const matchingEventSchemas = yield* dbEffect(() =>
			db
				.select({ id: schema.eventSchema.id })
				.from(schema.eventSchema)
				.where(
					and(
						eq(schema.eventSchema.slug, ruleLink.eventSchemaSlug),
						isNull(schema.eventSchema.userId),
					),
				),
		);

		for (const es of matchingEventSchemas) {
			yield* ensureBuiltinAutomationRule({
				kind: ruleLink.kind,
				name: ruleLink.name,
				operation: "create",
				sandboxScriptId: scriptId,
				position: ruleLink.position,
				metadata: ruleLink.metadata,
				target: { kind: "event", id: es.id },
			});
		}
	}

	yield* Effect.logInfo("Seeding relationship schemas...");

	const relationshipSchemaIds = new Map<string, string>();
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

		const relationshipSchemaId = yield* ensureBuiltinRelationshipSchema({
			sourceEntitySchemaId,
			targetEntitySchemaId,
			slug: relationshipSchema.slug,
			name: relationshipSchema.name,
			propertiesSchema: relationshipSchema.propertiesSchema,
		});
		relationshipSchemaIds.set(relationshipSchema.slug, relationshipSchemaId);
	}

	const mediaMonitoringRelationshipSchemaId = relationshipSchemaIds.get("media-monitoring");
	if (!mediaMonitoringRelationshipSchemaId) {
		return yield* Effect.die(new Error("Missing media-monitoring relationship schema"));
	}
	const signalSchemaIds = new Map<string, string>();
	for (const signalSchema of builtinSignalSchemas(
		RelationshipSchemaId.make(mediaMonitoringRelationshipSchemaId),
	)) {
		const signalSchemaId = yield* ensureBuiltinSignalSchema(signalSchema);
		signalSchemaIds.set(signalSchema.slug, signalSchemaId);
	}

	const reviewSignalSchemaId = signalSchemaIds.get("review.created");
	const reviewDetectorScriptId = scriptIds.get("automation.review-created");
	if (!reviewSignalSchemaId || !reviewDetectorScriptId) {
		return yield* Effect.die(new Error("Missing review-created automation dependency"));
	}
	const reviewEventSchemas = yield* dbEffect(() =>
		db
			.select({ id: schema.eventSchema.id })
			.from(schema.eventSchema)
			.where(and(eq(schema.eventSchema.slug, "review"), isNull(schema.eventSchema.userId))),
	);
	for (const eventSchema of reviewEventSchemas) {
		yield* ensureBuiltinAutomationRule({
			operation: "create",
			name: "Review Created Detector",
			sandboxScriptId: reviewDetectorScriptId,
			target: { kind: "event", id: eventSchema.id },
			metadata: { signalSchemaId: reviewSignalSchemaId },
		});
	}

	const workoutSchemaId = schemaIds.get("workout");
	const workoutSignalSchemaId = signalSchemaIds.get("workout.created");
	const workoutDetectorScriptId = scriptIds.get("automation.workout-created");
	if (!workoutSchemaId || !workoutSignalSchemaId || !workoutDetectorScriptId) {
		return yield* Effect.die(new Error("Missing workout-created automation dependency"));
	}
	yield* ensureBuiltinAutomationRule({
		operation: "create",
		name: "Workout Created Detector",
		sandboxScriptId: workoutDetectorScriptId,
		target: { kind: "entity", id: workoutSchemaId },
		metadata: { signalSchemaId: workoutSignalSchemaId },
	});

	const mediaEntityDetectorScriptId = scriptIds.get("automation.media-entity-changed");
	const mediaRelationshipDetectorScriptId = scriptIds.get("automation.media-relationship-changed");
	const mediaSignals = {
		status: signalSchemaIds.get("media.status.changed"),
		episodeName: signalSchemaIds.get("media.episode.name.changed"),
		releaseDate: signalSchemaIds.get("media.release-date.changed"),
		contentCount: signalSchemaIds.get("media.content-count.changed"),
		episodeImages: signalSchemaIds.get("media.episode.images.changed"),
	};
	if (
		!mediaEntityDetectorScriptId ||
		!mediaRelationshipDetectorScriptId ||
		Object.values(mediaSignals).some((id) => !id)
	) {
		return yield* Effect.die(new Error("Missing media automation dependency"));
	}
	for (const slug of [...builtinMediaEntitySchemaSlugs, "show-episode", "podcast-episode"]) {
		const entitySchemaId = schemaIds.get(slug);
		if (!entitySchemaId) {
			return yield* Effect.die(new Error(`Missing media entity schema: ${slug}`));
		}
		yield* ensureBuiltinAutomationRule({
			operation: "update",
			metadata: { signals: mediaSignals },
			sandboxScriptId: mediaEntityDetectorScriptId,
			target: { kind: "entity", id: entitySchemaId },
			name: `Media Entity Changed Detector (${slug})`,
		});
	}

	const relationshipDetectorRules: Array<{
		slug: string;
		detector: string;
		signalSlug: string;
		operations: ReadonlyArray<"create" | "update" | "delete">;
	}> = [
		{
			detector: "season-count",
			slug: "show-to-show-season",
			signalSlug: "media.season-count.changed",
			operations: ["create", "update", "delete"] as const,
		},
		{
			detector: "episode-discovery",
			slug: "show-season-to-show-episode",
			signalSlug: "media.episode.discovered",
			operations: ["create", "update", "delete"] as const,
		},
		{
			detector: "episode-discovery",
			slug: "podcast-to-podcast-episode",
			signalSlug: "media.episode.discovered",
			operations: ["create", "update", "delete"] as const,
		},
	];
	for (const definition of builtinRelationshipSchemas()) {
		if (
			!["person", "company"].includes(definition.sourceEntitySchemaSlug ?? "") ||
			!definition.targetEntitySchemaSlug
		) {
			continue;
		}
		const targetSlug = definition.targetEntitySchemaSlug;
		const targetKind = targetSlug.endsWith("-group") ? "media-group" : "media";
		const signalSlug = `${definition.sourceEntitySchemaSlug}.${targetKind}.associated`;
		if (!signalSchemaIds.has(signalSlug)) {
			continue;
		}
		relationshipDetectorRules.push({
			signalSlug,
			slug: definition.slug,
			detector: "association",
			operations: ["create", "update"] as const,
		});
	}
	for (const rule of relationshipDetectorRules) {
		const relationshipSchemaId = relationshipSchemaIds.get(rule.slug);
		const signalSchemaId = signalSchemaIds.get(rule.signalSlug);
		if (!relationshipSchemaId || !signalSchemaId) {
			return yield* Effect.die(new Error(`Missing relationship detector dependency: ${rule.slug}`));
		}
		for (const operation of rule.operations) {
			yield* ensureBuiltinAutomationRule({
				operation,
				sandboxScriptId: mediaRelationshipDetectorScriptId,
				metadata: { detector: rule.detector, signalSchemaId },
				target: { kind: "relationship", id: relationshipSchemaId },
				name: `Media Relationship Changed Detector (${rule.slug}:${operation})`,
			});
		}
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
