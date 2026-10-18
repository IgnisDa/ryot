import { mapDbErrorToSandbox, SandboxRunError } from "@ryot-app/contract/errors";
import type { AutomationPopulationContext } from "@ryot-app/contract/modules/automations/lifecycle";
import { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	type EntityId,
	EntitySchemaSlug,
	type PluginId,
	RelationshipSchemaSlug,
	type SandboxProviderId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import type { ProviderDetailsChildEntity } from "@ryot-app/plugin-backend-sdk/provider";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { DateTime, Effect, Schema } from "effect";

import { populationLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleDispatchPlan } from "#modules/automations/lifecycle/planning";
import type { EntityRelationshipDefinitions } from "#modules/definitions/snapshot";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { retryOnDeadlock } from "#platform/db/errors";
import { DatabaseSession } from "#platform/db/session";

import { persistPlannedRelationshipSynchronization } from "./relationship-synchronization";

const ProcessedChildEntity = Schema.Struct({
	entity: ListedEntity,
	entitySchemaSlug: EntitySchemaSlug,
});

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

const relationshipBatch = (
	command: DomainLifecycleCommand,
	itemIdentity: ReadonlyArray<string>,
	population: AutomationPopulationContext,
): DomainLifecycleCommand => ({
	...populationLifecycleCommand(command, itemIdentity, {
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
	}),
	writeContext: command.writeContext,
});

export const writeChildEntitySet = Effect.fn("writeChildEntitySet")(function* (
	input: {
		beforeWrite?: Effect.Effect<void, SandboxRunError>;
		command: DomainLifecycleCommand;
		pluginId: PluginId;
		definitions: EntityRelationshipDefinitions;
		population: AutomationPopulationContext;
		syncExisting?: boolean;
		parentEntityId: EntityId;
		providerId: SandboxProviderId;
		parentEntitySchemaSlug: EntitySchemaSlug;
		expectedChildEntitySchemaSlug?: string | undefined;
		childEntities: ReadonlyArray<ProviderDetailsChildEntity>;
	} & ({ scope: "global" } | { scope: "user"; userId: UserId }),
) {
	const session = yield* DatabaseSession;
	const entities = yield* EntitiesService;
	const repository = yield* EntitiesRepository;
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
		? input.definitions.entitySchemas[
				definitionKey("entity", definitionOwner(input.pluginId), childEntitySchemaSlug)
			]
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
					definition.pluginId === input.pluginId &&
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
	const committed = yield* retryOnDeadlock(
		session.transaction(
			Effect.gen(function* () {
				yield* input.beforeWrite ?? Effect.void;
				if (input.childEntities.length > 0 && !childEntitySchemaSlug) {
					return yield* Effect.die("Validated child schema is missing");
				}
				const childEntities = childEntitySchemaSlug
					? input.childEntities.map((childEntity) => ({
							...scope,
							name: childEntity.name,
							providerId: input.providerId,
							externalId: childEntity.externalId,
							properties: childEntity.properties,
							updateExisting: input.syncExisting ?? false,
							populatedAt: DateTime.toDateUtc(DateTime.makeUnsafe(input.command.occurredAt)),
							entitySchema: {
								owner: definitionOwner(input.pluginId),
								slug: EntitySchemaSlug.make(childEntitySchemaSlug),
							},
							lifecycle: {
								...populationLifecycleCommand(
									input.command,
									["child", String(input.parentEntityId), childEntity.externalId],
									input.population,
								),
								writeContext: input.command.writeContext,
							},
						}))
					: [];
				const upserts = yield* entities.persistPlannedProviderUpserts({
					items: childEntities,
					batch: {
						command: { ...input.command, population: input.population },
						identity: ["children", String(input.parentEntityId), "entities"],
					},
				});
				const entityDispatch = upserts.dispatch;
				const processedChildren = upserts.results.map(({ entity }) => ({
					entity,
					entitySchemaSlug: entity.entitySchemaSlug,
				}));
				yield* repository.stampChildRelatedPopulated(
					processedChildren.map(({ entity }) => entity.id),
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
					: { result: [], dispatch: [] };
				return {
					entityDispatch,
					processedChildren,
					relationshipResults: relationshipWork.result,
					relationshipDispatch: relationshipWork.dispatch,
				};
			}),
		),
	).pipe(mapDbErrorToSandbox);
	return {
		processedChildren: committed.processedChildren,
		relationshipResults: committed.relationshipResults,
		dispatch: [...committed.entityDispatch, ...committed.relationshipDispatch],
	} satisfies ChildEntitySetWriteResult;
});
