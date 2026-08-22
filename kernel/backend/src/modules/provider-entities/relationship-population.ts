import { SandboxRunError, mapDbErrorToSandbox } from "@ryot-app/contract/errors";
import type { AutomationPopulationContext } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	type EntityId,
	type SandboxProviderId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import type {
	ProviderDetailsRelatedEntity,
	ProviderDetailsRelatedEntityGroup,
} from "@ryot-app/sandbox-sdk/provider";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect } from "effect";

import { type LifecyclePlan, toLifecycleDispatchPlan } from "#lib/domain/lifecycle";
import type { LifecycleCommand } from "#lib/domain/lifecycle-command";
import { Database, mapDatabaseErrors, retryOnDeadlock } from "#lib/infrastructure/db/service";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import type { DefinitionSnapshot } from "#modules/definition-registry/service";
import { EntitiesRepository, providerEntityMutationLockKey } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { persistPlannedRelationshipSynchronization } from "./relationship-synchronization";

const commandFor = (
	command: LifecycleCommand,
	itemIdentity: ReadonlyArray<string>,
	population: AutomationPopulationContext,
): LifecycleCommand => ({
	...command,
	population,
	itemIdentity: stableStringify([command.itemIdentity, ...itemIdentity]),
});

export const syncRelatedEntityGroup = Effect.fn("syncRelatedEntityGroup")(function* (
	input: {
		command: LifecycleCommand;
		definitions: DefinitionSnapshot;
		population: AutomationPopulationContext;
		primaryEntityId: EntityId;
		primaryEntitySchemaSlug: EntitySchemaSlug;
		group: ProviderDetailsRelatedEntityGroup;
	} & ({ scope: "global" } | { scope: "user"; userId: UserId }),
) {
	const database = yield* Database;
	const entities = yield* EntitiesService;
	const repository = yield* EntitiesRepository;
	const pluginRuntime = yield* PluginRuntimeResolver;
	const relationshipDefinition =
		input.definitions.relationshipSchemas[input.group.relationshipSchemaSlug];
	if (!relationshipDefinition) {
		return yield* new SandboxRunError({
			kind: "script-failure",
			message: `Relationship schema not found: ${input.group.relationshipSchemaSlug}`,
		});
	}
	const relationshipSchema = {
		pluginId: relationshipDefinition.pluginId ?? null,
		propertiesSchema: relationshipDefinition.propertiesSchema,
		id: RelationshipSchemaSlug.make(relationshipDefinition.slug),
		sourceEntitySchemaSlug: relationshipDefinition.sourceEntitySchemaSlug
			? EntitySchemaSlug.make(relationshipDefinition.sourceEntitySchemaSlug)
			: null,
		targetEntitySchemaSlug: relationshipDefinition.targetEntitySchemaSlug
			? EntitySchemaSlug.make(relationshipDefinition.targetEntitySchemaSlug)
			: null,
	};
	const uniqueRelatedEntities = new Map<string, ProviderDetailsRelatedEntity>();
	for (const relatedEntity of input.group.entities) {
		uniqueRelatedEntities.set(
			`${relatedEntity.providerSlug}:${relatedEntity.externalId}`,
			relatedEntity,
		);
	}

	const resolvedRelatedEntities: Array<{
		properties: Record<string, unknown>;
		relatedEntity: ProviderDetailsRelatedEntity;
		schemaProvider: { providerId: SandboxProviderId; entitySchemaSlug: EntitySchemaSlug };
		lockInput: Parameters<typeof providerEntityMutationLockKey>[0];
	}> = [];
	for (const relatedEntity of uniqueRelatedEntities.values()) {
		const availableProvider =
			input.scope === "user"
				? yield* pluginRuntime.findProviderAvailableToUserBySlug(
						input.userId,
						relatedEntity.providerSlug,
					)
				: null;
		const persistedSchemaProvider =
			input.scope === "global"
				? yield* repository.findEntitySchemaProviderBySlug(relatedEntity.providerSlug)
				: null;
		const schemaProvider = availableProvider
			? ({
					providerId: availableProvider.id,
					entitySchemaSlug: EntitySchemaSlug.make(availableProvider.rootEntitySchemaSlug),
				} as const)
			: persistedSchemaProvider;
		if (!schemaProvider) {
			continue;
		}
		const sourceSchemaId =
			input.group.direction === "outgoing"
				? input.primaryEntitySchemaSlug
				: schemaProvider.entitySchemaSlug;
		const targetSchemaId =
			input.group.direction === "outgoing"
				? schemaProvider.entitySchemaSlug
				: input.primaryEntitySchemaSlug;
		if (
			relationshipSchema.sourceEntitySchemaSlug &&
			relationshipSchema.sourceEntitySchemaSlug !== sourceSchemaId
		) {
			return yield* new SandboxRunError({
				kind: "script-failure",
				message: `Relationship source schema does not match ${input.group.relationshipSchemaSlug}`,
			});
		}
		if (
			relationshipSchema.targetEntitySchemaSlug &&
			relationshipSchema.targetEntitySchemaSlug !== targetSchemaId
		) {
			return yield* new SandboxRunError({
				kind: "script-failure",
				message: `Relationship target schema does not match ${input.group.relationshipSchemaSlug}`,
			});
		}
		const properties = yield* parseAppSchemaProperties({
			kind: "Relationship",
			propertiesSchema: relationshipSchema.propertiesSchema,
			properties: relatedEntity.relationshipProperties ?? {},
		}).pipe(
			Effect.mapError(
				(error) => new SandboxRunError({ kind: "script-failure", message: error.message }),
			),
		);
		const lockInput = {
			externalId: relatedEntity.externalId,
			providerId: schemaProvider.providerId,
			entitySchemaSlug: schemaProvider.entitySchemaSlug,
			...(input.scope === "user"
				? { userId: input.userId, scope: "user" as const }
				: { scope: "global" as const }),
		};
		resolvedRelatedEntities.push({ lockInput, properties, relatedEntity, schemaProvider });
	}
	resolvedRelatedEntities.sort((left, right) =>
		providerEntityMutationLockKey(left.lockInput).localeCompare(
			providerEntityMutationLockKey(right.lockInput),
		),
	);

	const scope =
		input.scope === "user"
			? ({ scope: "user", userId: input.userId } as const)
			: ({ scope: "global" } as const);
	const itemIdentity = [
		"related-group",
		String(input.primaryEntityId),
		input.group.relationshipSchemaSlug,
		input.group.direction,
	];
	const committed = yield* retryOnDeadlock(
		mapDatabaseErrors(
			database.transaction((transaction) =>
				Effect.gen(function* () {
					const entityPlans: LifecyclePlan[] = [];
					const entries: Array<{ entityId: EntityId; properties: Record<string, unknown> }> = [];
					for (const { properties, relatedEntity, schemaProvider } of resolvedRelatedEntities) {
						const work = yield* entities.persistPlannedProviderUpsert({
							...scope,
							properties: {},
							populatedAt: null,
							updateExisting: false,
							name: relatedEntity.name,
							externalId: relatedEntity.externalId,
							providerId: schemaProvider.providerId,
							entitySchemaSlug: schemaProvider.entitySchemaSlug,
							lifecycle: commandFor(
								input.command,
								[...itemIdentity, relatedEntity.providerSlug, relatedEntity.externalId],
								input.population,
							),
						});
						entityPlans.push(...work.plans);
						entries.push({ properties, entityId: work.result.entity.id });
					}
					const relationshipWork = yield* persistPlannedRelationshipSynchronization({
						...scope,
						entries,
						direction: input.group.direction,
						anchorEntityId: input.primaryEntityId,
						synchronization: input.group.synchronization,
						relationshipSchemaSlug: relationshipSchema.id,
						relationshipSchemaPluginId: relationshipSchema.pluginId,
						onConflict:
							input.group.synchronization === "additive" ? "preserveExisting" : "replaceProperties",
						command: commandFor(input.command, itemIdentity, {
							...input.population,
							batch: {
								afterCount: 0,
								beforeCount: 0,
								isLeader: true,
								createdCount: 0,
								deletedCount: 0,
								updatedCount: 0,
								id: stableStringify([input.command.causation.executionId, ...itemIdentity]),
							},
						}),
					});
					return {
						entityPlans,
						result: relationshipWork.result,
						relationshipPlans: relationshipWork.plans,
					};
				}).pipe(Effect.provideService(Database, transaction)),
			),
		),
	).pipe(mapDbErrorToSandbox);
	return {
		result: committed.result,
		dispatch: [...committed.entityPlans, ...committed.relationshipPlans].map(
			toLifecycleDispatchPlan,
		),
	};
});
