import { SandboxRunError, mapDbErrorToSandbox } from "@ryot-app/contract/errors";
import type { AutomationPopulationContext } from "@ryot-app/contract/modules/automations/lifecycle";
import { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import {
	EntitySchemaSlug,
	type EntityId,
	RelationshipSchemaSlug,
	type SandboxProviderId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import type { ProviderDetailsChildEntity } from "@ryot-app/sandbox-sdk/provider";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { DateTime, Effect, Schema } from "effect";

import { LifecycleDispatchPlan, toLifecycleDispatchPlan } from "#lib/domain/lifecycle";
import type { LifecycleCommand } from "#lib/domain/lifecycle-command";
import { Database, mapDatabaseErrors, retryOnDeadlock } from "#lib/infrastructure/db/service";
import type { DefinitionSnapshot } from "#modules/definition-registry/snapshot";
import { EntityMutationOutcome } from "#modules/entities/mutation-outcomes";
import { EntitiesService } from "#modules/entities/service";

import { persistPlannedRelationshipSynchronization } from "./relationship-synchronization";

export const ProcessedChildEntity = Schema.Struct({
	entity: ListedEntity,
	entitySchemaSlug: EntitySchemaSlug,
	entityOutcome: EntityMutationOutcome,
});

export type ProcessedChildEntity = typeof ProcessedChildEntity.Type;

const RelationshipReconciliationResult = Schema.Struct({
	created: Schema.Finite,
	updated: Schema.Finite,
	deleted: Schema.Finite,
	upserted: Schema.Finite,
});

export const ChildEntitySetWriteResult = Schema.Struct({
	dispatch: Schema.Array(LifecycleDispatchPlan),
	processedChildren: Schema.Array(ProcessedChildEntity),
	relationshipResults: Schema.Array(RelationshipReconciliationResult),
});

export type ChildEntitySetWriteResult = typeof ChildEntitySetWriteResult.Type;

const commandFor = (
	command: LifecycleCommand,
	itemIdentity: ReadonlyArray<string>,
	population: AutomationPopulationContext,
): LifecycleCommand => ({
	...command,
	population,
	itemIdentity: stableStringify([command.itemIdentity, ...itemIdentity]),
});

const relationshipBatch = (
	command: LifecycleCommand,
	itemIdentity: ReadonlyArray<string>,
	population: AutomationPopulationContext,
): LifecycleCommand =>
	commandFor(command, itemIdentity, {
		...population,
		batch: {
			afterCount: 0,
			beforeCount: 0,
			isLeader: true,
			createdCount: 0,
			deletedCount: 0,
			updatedCount: 0,
			id: stableStringify([command.causation.executionId, ...itemIdentity]),
		},
	});

export const writeChildEntitySet = Effect.fn("writeChildEntitySet")(function* (
	input: {
		command: LifecycleCommand;
		definitions: DefinitionSnapshot;
		population: AutomationPopulationContext;
		syncExisting?: boolean;
		parentEntityId: EntityId;
		providerId: SandboxProviderId;
		parentEntitySchemaSlug: EntitySchemaSlug;
		expectedChildEntitySchemaSlug?: string | undefined;
		childEntities: ReadonlyArray<ProviderDetailsChildEntity>;
	} & ({ scope: "global" } | { scope: "user"; userId: UserId }),
) {
	const database = yield* Database;
	const entities = yield* EntitiesService;
	const childSchemaSlugs = new Set(
		input.childEntities.map(({ entitySchemaSlug }) => entitySchemaSlug),
	);
	if (childSchemaSlugs.size > 1) {
		return yield* new SandboxRunError({
			kind: "script-failure",
			message: "Child entities must use one entity schema",
		});
	}
	const rowChildEntitySchemaSlug = input.childEntities[0]?.entitySchemaSlug;
	if (
		rowChildEntitySchemaSlug &&
		input.expectedChildEntitySchemaSlug &&
		input.expectedChildEntitySchemaSlug !== rowChildEntitySchemaSlug
	) {
		return yield* new SandboxRunError({
			kind: "script-failure",
			message: `Child entity schema does not match declared schema: ${rowChildEntitySchemaSlug} !== ${input.expectedChildEntitySchemaSlug}`,
		});
	}
	const childEntitySchemaSlug = input.expectedChildEntitySchemaSlug ?? rowChildEntitySchemaSlug;
	const childEntitySchema = childEntitySchemaSlug
		? input.definitions.entitySchemas[childEntitySchemaSlug]
		: undefined;
	if (childEntitySchemaSlug && !childEntitySchema) {
		return yield* new SandboxRunError({
			kind: "script-failure",
			message: `Child entity schema not found: ${childEntitySchemaSlug}`,
		});
	}
	const relationshipDefinition = childEntitySchemaSlug
		? Object.values(input.definitions.relationshipSchemas).find(
				(definition) =>
					definition.sourceEntitySchemaSlug === input.parentEntitySchemaSlug &&
					definition.targetEntitySchemaSlug === childEntitySchemaSlug,
			)
		: undefined;
	if (childEntitySchemaSlug && !relationshipDefinition) {
		return yield* new SandboxRunError({
			kind: "script-failure",
			message: `Child relationship schema not found: ${input.parentEntitySchemaSlug} -> ${childEntitySchemaSlug}`,
		});
	}

	const scope =
		input.scope === "user"
			? ({ scope: "user", userId: input.userId } as const)
			: ({ scope: "global" } as const);
	const orderedChildEntities = input.childEntities
		.map((childEntity, index) => ({ index, childEntity }))
		.sort((left, right) => left.childEntity.externalId.localeCompare(right.childEntity.externalId));
	const committed = yield* retryOnDeadlock(
		mapDatabaseErrors(
			database.transaction((transaction) =>
				Effect.gen(function* () {
					if (orderedChildEntities.length > 0 && !childEntitySchemaSlug) {
						return yield* Effect.die("Validated child schema is missing");
					}
					const childEntities = childEntitySchemaSlug
						? orderedChildEntities.map(({ childEntity }) => ({
								...scope,
								name: childEntity.name,
								providerId: input.providerId,
								externalId: childEntity.externalId,
								properties: childEntity.properties,
								updateExisting: input.syncExisting ?? false,
								entitySchemaSlug: EntitySchemaSlug.make(childEntitySchemaSlug),
								populatedAt: DateTime.toDateUtc(DateTime.makeUnsafe(input.command.occurredAt)),
								lifecycle: commandFor(
									input.command,
									["child", String(input.parentEntityId), childEntity.externalId],
									input.population,
								),
							}))
						: [];
					const upserts = yield* entities.persistPlannedProviderUpserts({
						items: childEntities,
						batch: {
							command: { ...input.command, population: input.population },
							identity: ["children", String(input.parentEntityId), "entities"],
						},
					});
					const processedChildrenByIndex: Array<ProcessedChildEntity | undefined> = Array.from({
						length: input.childEntities.length,
					});
					for (const [position, { index }] of orderedChildEntities.entries()) {
						const result = upserts.results[position];
						if (!result || !childEntitySchemaSlug) {
							return yield* Effect.die("Planned child entity upsert is missing its result");
						}
						processedChildrenByIndex[index] = {
							entity: result.entity,
							entityOutcome: result.outcome,
							entitySchemaSlug: EntitySchemaSlug.make(childEntitySchemaSlug),
						};
					}
					const entityPlans = upserts.plans;
					const processedChildren = processedChildrenByIndex.flatMap((child) =>
						child ? [child] : [],
					);
					const relationshipWork = relationshipDefinition
						? yield* persistPlannedRelationshipSynchronization({
								...scope,
								direction: "outgoing",
								onConflict: "preserveExisting",
								synchronization: "authoritative",
								anchorEntityId: input.parentEntityId,
								relationshipSchemaPluginId: relationshipDefinition.pluginId ?? null,
								relationshipSchemaSlug: RelationshipSchemaSlug.make(relationshipDefinition.slug),
								entries: processedChildren.map((child) => ({
									properties: {},
									entityId: child.entity.id,
								})),
								command: relationshipBatch(
									input.command,
									["children", String(input.parentEntityId), relationshipDefinition.slug],
									input.population,
								),
							})
						: { plans: [], result: [] };
					return {
						entityPlans,
						processedChildren,
						relationshipPlans: relationshipWork.plans,
						relationshipResults: relationshipWork.result,
					};
				}).pipe(Effect.provideService(Database, transaction)),
			),
		),
	).pipe(mapDbErrorToSandbox);
	return {
		processedChildren: committed.processedChildren,
		relationshipResults: committed.relationshipResults,
		dispatch: [...committed.entityPlans, ...committed.relationshipPlans].map(
			toLifecycleDispatchPlan,
		),
	} satisfies ChildEntitySetWriteResult;
});
