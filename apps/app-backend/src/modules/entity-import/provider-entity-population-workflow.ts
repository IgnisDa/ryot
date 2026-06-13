import { Activity, Workflow } from "@effect/workflow";
import { SandboxRunError, dieOnDbError } from "@ryot/contract/errors";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { encodeEntityUpdatedMessage } from "@ryot/contract/modules/entity-interest/messages";
import { DateTime, Effect, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";

import { EntityImportPayload } from "./entity-import-workflow";
import { EntityImportWorkflowOperations } from "./operations-workflow";
import {
	EntityDetailsChildEntity,
	EntityDetailsRelationshipGroup,
	decodeEntityDetailsResult,
	processChildEntityTree,
} from "./population";
import { syncRelatedEntityGroup } from "./relationship-population";

// Child schema hierarchy for provider container types. Only consulted during
// refresh, where stale children must be reconciled even when the provider
// returns none this run (e.g. a show that dropped a season).
const CHILD_ENTITY_SCHEMA_SLUGS: Readonly<Record<string, string>> = {
	show: "show-season",
	podcast: "podcast-episode",
	"show-season": "show-episode",
};

type SynchronizeOptions = {
	entitySchemaSlug?: string;
	mode: "initial" | "refresh";
	childEntitySchemaSlugs?: Readonly<Record<string, string>>;
};

const ValidatedEntityDetails = Schema.Struct({
	name: Schema.String,
	properties: Schema.Unknown,
	childEntities: Schema.Array(EntityDetailsChildEntity),
	relatedEntityGroups: Schema.Array(EntityDetailsRelationshipGroup),
});

type ValidatedEntityDetails = typeof ValidatedEntityDetails.Type;

const checkExistingEntity = Effect.fn("checkExistingEntity")(function* (
	payload: EntityImportPayload,
) {
	const runWithDb = yield* DbRunner;
	const repository = yield* EntitiesRepository;

	return yield* Activity.make({
		name: "check-existing-entity",
		success: Schema.NullOr(ListedEntity),
		execute: runWithDb(
			repository.findGlobalEntityByExternalId({
				externalId: payload.externalId,
				sandboxScriptId: payload.scriptId,
				entitySchemaId: payload.entitySchemaId,
			}),
		).pipe(dieOnDbError),
	});
});

const validateEntityDetails = Effect.fn("validateEntityDetails")(function* (value: unknown) {
	return yield* Activity.make({
		error: SandboxRunError,
		success: ValidatedEntityDetails,
		name: "validate-entity-details",
		execute: Effect.gen(function* () {
			const details = yield* decodeEntityDetailsResult(value).pipe(
				Effect.mapError(
					(error) => new SandboxRunError({ message: `Invalid entity details: ${error.message}` }),
				),
			);

			return {
				name: details.name,
				properties: details.properties,
				childEntities: details.childEntities ?? [],
				relatedEntityGroups: details.relatedEntityGroups ?? [],
			};
		}),
	});
});

const writePrimaryEntity = Effect.fn("writeProviderPrimaryEntity")(function* (
	payload: EntityImportPayload,
	details: ValidatedEntityDetails,
	options: SynchronizeOptions,
) {
	const entities = yield* EntitiesService;

	return yield* Activity.make({
		success: ListedEntity,
		error: SandboxRunError,
		name: "write-primary-entity",
		execute: entities
			.save({
				scope: "global",
				populatedAt: null,
				name: details.name,
				onConflict: options.mode === "refresh" ? undefined : "replaceExisting",
				externalId: payload.externalId,
				properties: details.properties,
				sandboxScriptId: payload.scriptId,
				entitySchemaId: payload.entitySchemaId,
			})
			.pipe(
				dieOnDbError,
				Effect.mapError((error) => new SandboxRunError({ message: error.message })),
			),
	});
});

const writeRelatedEntities = Effect.fn("writeProviderRelatedEntities")(function* (
	payload: EntityImportPayload,
	entity: ListedEntity,
	groups: ReadonlyArray<EntityDetailsRelationshipGroup>,
) {
	yield* Effect.forEach(
		groups,
		(group) =>
			Activity.make({
				error: SandboxRunError,
				name: `sync-related-group-${group.relationshipSchemaSlug}-${group.direction}`,
				execute: syncRelatedEntityGroup({
					group,
					primaryEntityId: entity.id,
					primaryEntitySchemaId: payload.entitySchemaId,
				}),
			}),
		{ discard: true },
	);
});

const writeChildEntities = Effect.fn("writeProviderChildEntities")(function* (
	payload: EntityImportPayload,
	entity: ListedEntity,
	details: ValidatedEntityDetails,
	options: SynchronizeOptions,
) {
	if (
		details.childEntities.length === 0 &&
		(!options.entitySchemaSlug || !options.childEntitySchemaSlugs?.[options.entitySchemaSlug])
	) {
		return;
	}
	yield* processChildEntityTree({
		parentEntityId: entity.id,
		sandboxScriptId: payload.scriptId,
		childEntities: details.childEntities,
		syncExisting: options.mode === "refresh",
		parentEntitySchemaId: payload.entitySchemaId,
		parentEntitySchemaSlug: options.entitySchemaSlug,
		childEntitySchemaSlugs: options.childEntitySchemaSlugs,
	});
});

const markPrimaryEntityPopulated = Effect.fn("markProviderPrimaryEntityPopulated")(function* (
	payload: EntityImportPayload,
	details: ValidatedEntityDetails,
) {
	const redis = yield* RedisService;
	const entities = yield* EntitiesService;

	return yield* Activity.make({
		success: ListedEntity,
		error: SandboxRunError,
		name: "mark-primary-entity-populated",
		execute: Effect.gen(function* () {
			const populatedAt = yield* DateTime.nowAsDate;
			const saved = yield* entities
				.save({
					populatedAt,
					scope: "global",
					name: details.name,
					onConflict: "replaceExisting",
					properties: details.properties,
					externalId: payload.externalId,
					sandboxScriptId: payload.scriptId,
					entitySchemaId: payload.entitySchemaId,
				})
				.pipe(
					dieOnDbError,
					Effect.mapError((error) => new SandboxRunError({ message: error.message })),
				);
			yield* redis.publish(
				redisKeys.entityUpdatedChannel,
				encodeEntityUpdatedMessage(saved.id, "populated"),
			);
			return saved;
		}),
	});
});

const synchronizeEntityGraph = Effect.fn("synchronizeEntityGraph")(function* (
	payload: EntityImportPayload,
	executionId: string,
	options: SynchronizeOptions,
) {
	const operations = yield* EntityImportWorkflowOperations;
	const sandboxResult = yield* operations.processSandbox(payload, executionId);
	if (sandboxResult.error) {
		return yield* new SandboxRunError({ message: sandboxResult.error });
	}

	const details = yield* validateEntityDetails(sandboxResult.value);
	const entity = yield* writePrimaryEntity(payload, details, options);
	yield* writeRelatedEntities(payload, entity, details.relatedEntityGroups);
	yield* writeChildEntities(payload, entity, details, options);

	return yield* markPrimaryEntityPopulated(payload, details);
});

// `Workflow.make` requires a struct payload, so the ensure/refresh discriminator
// lives on `mode` with `entitySchemaSlug` optional at the schema level. Ensure callers
// omit it; refresh requires it (the handler dies otherwise, see below) so stale children
// are reconciled even when the provider returns none this run.
export const ProviderEntityPopulationPayload = Schema.Struct({
	...EntityImportPayload.fields,
	mode: Schema.Literal("ensure", "refresh"),
	entitySchemaSlug: Schema.optional(Schema.String),
});

export type ProviderEntityPopulationPayload = typeof ProviderEntityPopulationPayload.Type;

export const ProviderEntityPopulationWorkflow = Workflow.make({
	success: ListedEntity,
	error: SandboxRunError,
	name: "ProviderEntityPopulationWorkflow",
	payload: ProviderEntityPopulationPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

// Exported for unit testing only. Production callers must dispatch
// `ProviderEntityPopulationWorkflow` via the workflow engine; the
// workflow-boundaries test enforces that this handler is never imported
// by production modules.
export const runProviderEntityPopulationWorkflow = Effect.fn("runProviderEntityPopulationWorkflow")(
	function* (payload: ProviderEntityPopulationPayload, executionId: string) {
		if (payload.mode === "ensure") {
			const existing = yield* checkExistingEntity(payload);
			if (existing && existing.populatedAt !== null) {
				return existing;
			}
			return yield* synchronizeEntityGraph(payload, executionId, { mode: "initial" });
		}

		// Refresh reconciles stale children via `entitySchemaSlug`. Without it, a provider
		// returning no children would silently retain removed ones, so a refresh missing the
		// slug is a malformed payload rather than a recoverable failure.
		if (!payload.entitySchemaSlug) {
			return yield* Effect.die(
				"ProviderEntityPopulationWorkflow: entitySchemaSlug is required for refresh",
			);
		}

		return yield* synchronizeEntityGraph(payload, executionId, {
			mode: "refresh",
			entitySchemaSlug: payload.entitySchemaSlug,
			childEntitySchemaSlugs: CHILD_ENTITY_SCHEMA_SLUGS,
		});
	},
);

const ProviderEntityPopulationWorkflowLive = ProviderEntityPopulationWorkflow.toLayer(
	runProviderEntityPopulationWorkflow,
);

export const ProviderEntityPopulationWorkflowDefinitionsLive = ProviderEntityPopulationWorkflowLive;
