import { Activity, Workflow } from "@effect/workflow";
import { SandboxRunError, dieOnDbError } from "@ryot/contract/errors";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { encodeEntityUpdatedMessage } from "@ryot/contract/modules/entity-interest/messages";
import { Cause, DateTime, Effect, Schedule, Schema } from "effect";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import {
	dispatchLifecycleSubscriptions,
	LifecycleOccurrence,
} from "#modules/automations/lifecycle-dispatch";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";

import { EntityImportPayload } from "./entity-import-workflow";
import { buildLifecycleOccurrences } from "./lifecycle-occurrences";
import { EntityImportWorkflowOperations } from "./operations-workflow";
import {
	EntityDetailsChildEntity,
	EntityDetailsRelationshipGroup,
	decodeEntityDetailsResult,
	type PopulationMutationResult,
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

const REDIS_RETRY_SCHEDULE = Schedule.spaced("30 seconds");

type SynchronizeOptions = {
	entitySchemaSlug: string;
	mode: "initial" | "refresh";
	rootPreviouslyPopulated: boolean;
	childEntitySchemaSlugs?: Readonly<Record<string, string>>;
};

const ValidatedEntityDetails = Schema.Struct({
	name: Schema.String,
	properties: Schema.Unknown,
	childEntities: Schema.Array(EntityDetailsChildEntity),
	relatedEntityGroups: Schema.Array(EntityDetailsRelationshipGroup),
});

type ValidatedEntityDetails = typeof ValidatedEntityDetails.Type;

const GraphWriteResult = Schema.Struct({
	entity: ListedEntity,
	occurrences: Schema.Array(LifecycleOccurrence),
});

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

const writeRelatedEntities = Effect.fn("writeProviderRelatedEntities")(function* (
	payload: EntityImportPayload,
	entity: ListedEntity,
	groups: ReadonlyArray<EntityDetailsRelationshipGroup>,
) {
	return yield* Effect.forEach(groups, (group) =>
		syncRelatedEntityGroup({
			group,
			primaryEntityId: entity.id,
			primaryEntitySchemaId: payload.entitySchemaId,
		}).pipe(
			Effect.map((result) => ({
				entities: result.relatedEntityMutations,
				relationship: {
					outcome: result.outcome,
					anchorEntityId: entity.id,
					direction: group.direction,
					relationshipSchemaId: result.relationshipSchemaId,
				},
			})),
		),
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
		return { entities: [], relationships: [] } satisfies PopulationMutationResult;
	}
	return yield* processChildEntityTree({
		parentEntityId: entity.id,
		sandboxScriptId: payload.scriptId,
		childEntities: details.childEntities,
		syncExisting: options.mode === "refresh",
		parentEntitySchemaId: payload.entitySchemaId,
		parentEntitySchemaSlug: options.entitySchemaSlug,
		childEntitySchemaSlugs: options.childEntitySchemaSlugs,
	});
});

const writeEntityGraph = Effect.fn("writeProviderEntityGraph")(function* (
	payload: EntityImportPayload,
	details: ValidatedEntityDetails,
	executionId: string,
	options: SynchronizeOptions,
) {
	const entities = yield* EntitiesService;
	const runInTransaction = yield* TransactionRunner;

	return yield* Activity.make({
		error: SandboxRunError,
		success: GraphWriteResult,
		name: "write-entity-graph",
		execute: runInTransaction(
			Effect.gen(function* () {
				const initialOutcome = yield* entities.save({
					scope: "global",
					populatedAt: null,
					name: details.name,
					externalId: payload.externalId,
					properties: details.properties,
					sandboxScriptId: payload.scriptId,
					entitySchemaId: payload.entitySchemaId,
					onConflict: options.mode === "refresh" ? undefined : "replaceExisting",
				});
				const entity = initialOutcome.entity;
				const related = yield* writeRelatedEntities(payload, entity, details.relatedEntityGroups);
				const relatedRelationships = related.map((group) => group.relationship);
				const relatedEntityMutations = related.flatMap((group) => group.entities);
				const childMutations = yield* writeChildEntities(payload, entity, details, options);

				const populatedAt = yield* DateTime.nowAsDate;
				const finalOutcome = yield* entities.save({
					populatedAt,
					scope: "global",
					name: details.name,
					onConflict: "replaceExisting",
					properties: details.properties,
					externalId: payload.externalId,
					sandboxScriptId: payload.scriptId,
					entitySchemaId: payload.entitySchemaId,
				});
				const rootOutcome =
					finalOutcome.operation === "noop" && initialOutcome.operation === "create"
						? initialOutcome
						: finalOutcome;
				const mutations: PopulationMutationResult = {
					relationships: [...relatedRelationships, ...childMutations.relationships],
					entities: [
						{ outcome: rootOutcome, entitySchemaSlug: options.entitySchemaSlug },
						...relatedEntityMutations,
						...childMutations.entities,
					],
				};
				return {
					entity: finalOutcome.entity,
					occurrences: buildLifecycleOccurrences({
						mutations,
						executionId,
						origin: payload.origin,
						root: finalOutcome.entity,
						rootSchemaSlug: options.entitySchemaSlug,
						rootPreviouslyPopulated: options.rootPreviouslyPopulated,
					}),
				};
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
	const result = yield* writeEntityGraph(payload, details, executionId, options);
	for (const occurrence of result.occurrences) {
		yield* dispatchLifecycleSubscriptions(occurrence).pipe(
			dieOnDbError,
			Effect.mapError((error) => new SandboxRunError({ message: error.message })),
		);
	}
	yield* publishPrimaryEntity(result.entity);
	return result.entity;
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
			const runWithDb = yield* DbRunner;
			const repository = yield* EntitiesRepository;
			const entitySchema = yield* Activity.make({
				name: "load-provider-entity-schema",
				success: Schema.NullOr(Schema.Struct({ slug: Schema.String })),
				execute: runWithDb(repository.findEntitySchemaById(payload.entitySchemaId)).pipe(
					Effect.map((value) => (value ? { slug: value.slug } : null)),
					dieOnDbError,
				),
			});
			if (!entitySchema) {
				return yield* new SandboxRunError({ message: "Provider entity schema not found" });
			}
			return yield* synchronizeEntityGraph(payload, executionId, {
				mode: "initial",
				rootPreviouslyPopulated: false,
				entitySchemaSlug: entitySchema.slug,
			});
		}

		// Refresh reconciles stale children via `entitySchemaSlug`. Without it, a provider
		// returning no children would silently retain removed ones, so a refresh missing the
		// slug is a malformed payload rather than a recoverable failure.
		if (!payload.entitySchemaSlug) {
			return yield* Effect.die(
				"ProviderEntityPopulationWorkflow: entitySchemaSlug is required for refresh",
			);
		}

		const existing = yield* checkExistingEntity(payload);
		return yield* synchronizeEntityGraph(payload, executionId, {
			mode: "refresh",
			entitySchemaSlug: payload.entitySchemaSlug,
			childEntitySchemaSlugs: CHILD_ENTITY_SCHEMA_SLUGS,
			rootPreviouslyPopulated: existing?.populatedAt !== null && existing !== null,
		});
	},
);

export const ProviderEntityPopulationWorkflowDefinitionsLive =
	ProviderEntityPopulationWorkflow.toLayer(runProviderEntityPopulationWorkflow);
