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

import type { LifecyclePlan } from "#lib/domain/lifecycle";
import type { LifecycleCommand } from "#lib/domain/lifecycle-command";
import { Database, mapDatabaseErrors, retryOnDeadlock } from "#lib/infrastructure/db/service";
import type { DefinitionSnapshot } from "#modules/definition-registry/service";
import { EntityMutationOutcome } from "#modules/entities/mutation-outcomes";
import { EntitiesService } from "#modules/entities/service";
import { RelationshipsService } from "#modules/relationships/service";

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

const logWarnings = (warnings: ReadonlyArray<unknown>, parentEntityId: EntityId) =>
	warnings.length === 0
		? Effect.void
		: Effect.logWarning("provider child population completed with automation warnings").pipe(
				Effect.annotateLogs({ warnings, parentEntityId, warningCount: warnings.length }),
			);

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
	const relationships = yield* RelationshipsService;
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
					const entityPlans: LifecyclePlan[] = [];
					const processedChildrenByIndex: Array<ProcessedChildEntity | undefined> = Array.from({
						length: input.childEntities.length,
					});
					for (const { index, childEntity } of orderedChildEntities) {
						if (!childEntitySchemaSlug) {
							return yield* Effect.die("Validated child schema is missing");
						}
						const work = yield* entities.persistPlannedProviderUpsert({
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
						});
						entityPlans.push(...work.plans);
						processedChildrenByIndex[index] = {
							entity: work.result.entity,
							entityOutcome: work.result.outcome,
							entitySchemaSlug: EntitySchemaSlug.make(childEntitySchemaSlug),
						};
					}
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
	const warnings = [
		...(yield* entities.executeCommittedPlans(committed.entityPlans).pipe(mapDbErrorToSandbox)),
		...(yield* relationships
			.executeCommittedPlans(committed.relationshipPlans)
			.pipe(mapDbErrorToSandbox)),
	];
	yield* logWarnings(warnings, input.parentEntityId);
	return {
		processedChildren: committed.processedChildren,
		relationshipResults: committed.relationshipResults,
	} satisfies ChildEntitySetWriteResult;
});
