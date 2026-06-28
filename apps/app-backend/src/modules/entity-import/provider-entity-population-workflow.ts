import { Activity, Workflow } from "@effect/workflow";
import { SandboxRunError, dieOnDbError } from "@ryot/contract/errors";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { encodeEntityUpdatedMessage } from "@ryot/contract/modules/entity-interest/messages";
import { type EntityId, EntitySchemaId } from "@ryot/contract/schema/brands";
import type {
	ProviderDetailsChildEntity,
	ProviderDetailsRelatedEntityGroup,
} from "@ryot/sandbox-sdk/provider";
import { Cause, DateTime, Effect, Schedule, Schema } from "effect";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import {
	ProviderDetailsChildEntitySchema,
	ProviderDetailsRelatedEntityGroupSchema,
	decodeProviderDetailsResult,
} from "#modules/sandbox/provider-contracts";

import { EntityImportPayload } from "./entity-import-workflow";
import { EntityImportWorkflowOperations } from "./operations-workflow";
import { writeChildEntitySet } from "./population";
import { syncRelatedEntityGroup } from "./relationship-population";

// Child schema hierarchy for provider container types. Only consulted during
// refresh, where stale children must be reconciled even when the provider
// returns none this run (e.g. a show that dropped a season).
const CHILD_ENTITY_SCHEMA_SLUGS: Readonly<Record<string, string>> = {
	show: "show-season",
	podcast: "podcast-episode",
	"show-season": "show-episode",
};

const REDIS_RETRY_SCHEDULE = Schedule.spaced("30 seconds");

type SynchronizeOptions = {
	entitySchemaSlug?: string;
	mode: "initial" | "refresh";
	childEntitySchemaSlugs?: Readonly<Record<string, string>>;
};

const ValidatedEntityDetails = Schema.Struct({
	name: Schema.String,
	properties: Schema.Unknown,
	childEntities: Schema.Array(ProviderDetailsChildEntitySchema),
	relatedEntityGroups: Schema.Array(ProviderDetailsRelatedEntityGroupSchema),
});

type ValidatedEntityDetails = typeof ValidatedEntityDetails.Type;

const ProcessedChildEntities = Schema.Array(
	Schema.Struct({ entity: ListedEntity, entitySchemaId: EntitySchemaId }),
);

type ChildEntitySetScope = {
	parentEntityId: EntityId;
	parentExternalId: string;
	parentEntitySchemaId: EntitySchemaId;
	parentEntitySchemaSlug?: string | undefined;
	childEntities: ReadonlyArray<ProviderDetailsChildEntity>;
};

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
			const details = yield* decodeProviderDetailsResult(value).pipe(
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

const upsertRootEntity = Effect.fn("upsertProviderRootEntity")(function* (
	payload: EntityImportPayload,
	details: ValidatedEntityDetails,
	options: SynchronizeOptions,
) {
	const entities = yield* EntitiesService;
	const runInTransaction = yield* TransactionRunner;

	return yield* Activity.make({
		success: ListedEntity,
		error: SandboxRunError,
		name: "upsert-root-entity",
		// A brand-new or not-yet-populated entity is written with a null populatedAt so
		// children can reference it before the final stamp activity; refresh preserves an
		// already-populated entity until then. Initial population replaces the skeleton.
		execute: runInTransaction(
			entities.upsert({
				populatedAt: null,
				name: details.name,
				externalId: payload.externalId,
				properties: details.properties,
				sandboxScriptId: payload.scriptId,
				entitySchemaId: payload.entitySchemaId,
				updateExisting: options.mode !== "refresh",
			}),
		).pipe(
			dieOnDbError,
			Effect.mapError((error) => new SandboxRunError({ message: error.message })),
		),
	});
});

const syncRelatedEntityGroupScope = Effect.fn("syncProviderRelatedEntityGroupScope")(function* (
	payload: EntityImportPayload,
	entity: ListedEntity,
	group: ProviderDetailsRelatedEntityGroup,
	index: number,
) {
	const runInTransaction = yield* TransactionRunner;

	return yield* Activity.make({
		error: SandboxRunError,
		success: Schema.Void,
		name: `sync-related-entity-group:${index}:${group.relationshipSchemaSlug}`,
		execute: runInTransaction(
			syncRelatedEntityGroup({
				group,
				primaryEntityId: entity.id,
				primaryEntitySchemaId: payload.entitySchemaId,
			}),
		).pipe(
			dieOnDbError,
			Effect.mapError((error) => new SandboxRunError({ message: error.message })),
		),
	});
});

const writeChildEntitySetScope = Effect.fn("writeChildEntitySetScope")(function* (
	payload: EntityImportPayload,
	options: SynchronizeOptions,
	scope: ChildEntitySetScope,
) {
	const runInTransaction = yield* TransactionRunner;

	return yield* Activity.make({
		error: SandboxRunError,
		success: ProcessedChildEntities,
		name: `write-child-entity-set:${scope.parentExternalId}`,
		execute: runInTransaction(
			writeChildEntitySet({
				childEntities: scope.childEntities,
				sandboxScriptId: payload.scriptId,
				parentEntityId: scope.parentEntityId,
				syncExisting: options.mode === "refresh",
				parentEntitySchemaId: scope.parentEntitySchemaId,
				parentEntitySchemaSlug: scope.parentEntitySchemaSlug,
				childEntitySchemaSlugs: options.childEntitySchemaSlugs,
			}),
		).pipe(
			dieOnDbError,
			Effect.mapError((error) => new SandboxRunError({ message: error.message })),
		),
	});
});

const stampRootPopulatedAt = Effect.fn("stampProviderRootPopulatedAt")(function* (
	payload: EntityImportPayload,
	details: ValidatedEntityDetails,
	entity: ListedEntity,
) {
	const entities = yield* EntitiesService;
	const runInTransaction = yield* TransactionRunner;

	return yield* Activity.make({
		success: ListedEntity,
		error: SandboxRunError,
		name: "stamp-root-populated-at",
		execute: runInTransaction(
			Effect.gen(function* () {
				const populatedAt = yield* DateTime.nowAsDate;
				return yield* entities.update({
					populatedAt,
					name: details.name,
					entityId: entity.id,
					properties: details.properties,
					entitySchemaId: payload.entitySchemaId,
				});
			}),
		).pipe(
			dieOnDbError,
			Effect.mapError((error) => new SandboxRunError({ message: error.message })),
		),
	});
});

const publishPrimaryEntity = Effect.fn("publishProviderPrimaryEntity")(function* (
	entity: ListedEntity,
) {
	const redis = yield* RedisService;

	yield* Activity.make({
		error: SandboxRunError,
		name: "publish-primary-entity",
		execute: redis
			.publish(redisKeys.entityUpdatedChannel, encodeEntityUpdatedMessage(entity.id, "populated"))
			.pipe(
				Effect.asVoid,
				Effect.sandbox,
				Effect.retry({
					schedule: REDIS_RETRY_SCHEDULE,
					while: (cause) => !Cause.isInterrupted(cause),
				}),
				Effect.unsandbox,
			),
	});
});

const shouldWriteChildEntitySet = (options: SynchronizeOptions, scope: ChildEntitySetScope) =>
	scope.childEntities.length > 0 ||
	(!!scope.parentEntitySchemaSlug &&
		!!options.childEntitySchemaSlugs?.[scope.parentEntitySchemaSlug]);

const writeChildEntityScopes = Effect.fn("writeChildEntityScopes")(function* (
	payload: EntityImportPayload,
	options: SynchronizeOptions,
	rootScope: ChildEntitySetScope,
) {
	const pending: ChildEntitySetScope[] = [rootScope];
	let scope: ChildEntitySetScope | undefined;
	while ((scope = pending.shift()) !== undefined) {
		if (!shouldWriteChildEntitySet(options, scope)) {
			continue;
		}
		const processed = yield* writeChildEntitySetScope(payload, options, scope);
		for (const [index, childEntity] of scope.childEntities.entries()) {
			const child = processed[index];
			if (!child) {
				continue;
			}
			pending.push({
				parentEntityId: child.entity.id,
				parentExternalId: childEntity.externalId,
				parentEntitySchemaId: child.entitySchemaId,
				childEntities: childEntity.childEntities ?? [],
				parentEntitySchemaSlug: childEntity.entitySchemaSlug,
			});
		}
	}
});

const synchronizeEntityGraph = Effect.fn("synchronizeEntityGraph")(function* (
	payload: EntityImportPayload,
	executionId: string,
	options: SynchronizeOptions,
) {
	const operations = yield* EntityImportWorkflowOperations;
	const sandboxResult = yield* operations.processSandbox(payload, executionId);
	if (sandboxResult.error) {
		return yield* new SandboxRunError({ message: sandboxResult.error.message });
	}

	const details = yield* validateEntityDetails(sandboxResult.value);
	const entity = yield* upsertRootEntity(payload, details, options);
	yield* Effect.forEach(
		details.relatedEntityGroups,
		(group, index) => syncRelatedEntityGroupScope(payload, entity, group, index),
		{ discard: true },
	);
	yield* writeChildEntityScopes(payload, options, {
		parentEntityId: entity.id,
		parentExternalId: payload.externalId,
		childEntities: details.childEntities,
		parentEntitySchemaId: payload.entitySchemaId,
		parentEntitySchemaSlug: options.entitySchemaSlug,
	});
	const stamped = yield* stampRootPopulatedAt(payload, details, entity);
	yield* publishPrimaryEntity(stamped);
	return stamped;
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
