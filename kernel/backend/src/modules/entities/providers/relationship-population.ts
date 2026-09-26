import { SandboxRunError, mapDbErrorToSandbox } from "@ryot-app/contract/errors";
import type { AutomationPopulationContext } from "@ryot-app/contract/modules/automations/lifecycle";
import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	type EntityId,
	type SandboxProviderId,
	type UserId,
	type PluginId,
} from "@ryot-app/contract/schema/brands";
import type {
	ProviderDetailsRelatedEntity,
	ProviderDetailsRelatedEntityGroup,
} from "@ryot-app/sandbox-sdk/provider";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect } from "effect";

import { populationLifecycleCommand } from "#modules/automations/lifecycle/command";
import { parseAppSchemaProperties } from "#modules/definitions/properties/runtime";
import type { EntityRelationshipDefinitions } from "#modules/definitions/snapshot";
import { EntitiesRepository, providerEntityMutationLockKey } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { retryOnDeadlock } from "#platform/db/errors";
import { DatabaseSession } from "#platform/db/session";

import { makeProviderExecutionReads } from "./execution-reads";
import { persistPlannedRelationshipSynchronization } from "./relationship-synchronization";

export const syncRelatedEntityGroup = Effect.fn("syncRelatedEntityGroup")(function* (
	input: {
		command: DomainLifecycleCommand;
		pluginId: PluginId;
		definitions: EntityRelationshipDefinitions;
		population: AutomationPopulationContext;
		primaryEntityId: EntityId;
		primaryEntitySchemaSlug: EntitySchemaSlug;
		group: ProviderDetailsRelatedEntityGroup;
	} & ({ scope: "global" } | { scope: "user"; userId: UserId }),
) {
	const session = yield* DatabaseSession;
	const reads = makeProviderExecutionReads(session);
	const entities = yield* EntitiesService;
	const repository = yield* EntitiesRepository;
	const pluginRuntime = yield* PluginRuntimeResolver;
	const relationshipDefinition =
		input.definitions.relationshipSchemas[
			definitionKey(
				"relationship",
				definitionOwner(input.pluginId),
				input.group.relationshipSchemaSlug,
			)
		];
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
			stableStringify([
				input.scope,
				input.scope === "user" ? input.userId : null,
				input.pluginId,
				relatedEntity.providerSlug,
				relatedEntity.externalId,
			]),
			relatedEntity,
		);
	}

	const resolvedRelatedEntities: Array<{
		properties: Record<string, unknown>;
		relatedEntity: ProviderDetailsRelatedEntity;
		schemaProvider: { providerId: SandboxProviderId; entitySchemaSlug: EntitySchemaSlug };
		lockInput: Parameters<typeof providerEntityMutationLockKey>[0];
	}> = [];
	// One provider resolution per distinct slug, not per related entity: a details payload commonly
	// carries dozens of cast/crew members from the same provider.
	const schemaProviderBySlug = new Map<
		string,
		(typeof resolvedRelatedEntities)[number]["schemaProvider"] | null
	>();
	const resolveSchemaProvider = Effect.fn(function* (providerSlug: string) {
		const memoized = schemaProviderBySlug.get(providerSlug);
		if (memoized !== undefined) {
			return memoized;
		}
		const pin = input.command.writeContext?.pluginRevision;
		if (pin) {
			const provider = yield* reads.findPinnedProvider(
				{ slug: providerSlug, owner: definitionOwner(input.pluginId) },
				pin.revisionId,
			);
			if (!provider) {
				return yield* new SandboxRunError({
					kind: "script-failure",
					message: `Provider is not declared by the pinned owner: ${providerSlug}`,
				});
			}
			const resolved = {
				providerId: provider.id,
				entitySchemaSlug: EntitySchemaSlug.make(provider.rootEntitySchemaSlug),
			};
			schemaProviderBySlug.set(providerSlug, resolved);
			return resolved;
		}
		const availableProvider =
			input.scope === "user"
				? yield* pluginRuntime.findProviderAvailableToUserByReference(input.userId, {
						slug: providerSlug,
						owner: definitionOwner(input.pluginId),
					})
				: null;
		const persistedSchemaProvider =
			input.scope === "global"
				? yield* repository.findEntitySchemaProviderByReference({
						slug: providerSlug,
						owner: definitionOwner(input.pluginId),
					})
				: null;
		const resolved = availableProvider
			? ({
					providerId: availableProvider.id,
					entitySchemaSlug: EntitySchemaSlug.make(availableProvider.rootEntitySchemaSlug),
				} as const)
			: persistedSchemaProvider;
		schemaProviderBySlug.set(providerSlug, resolved);
		return resolved;
	});
	for (const relatedEntity of uniqueRelatedEntities.values()) {
		const schemaProvider = yield* resolveSchemaProvider(relatedEntity.providerSlug);
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
			entitySchemaPluginId: input.pluginId,
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
		session.transaction(
			Effect.gen(function* () {
				const upserts = yield* entities.persistPlannedProviderUpserts({
					batch: {
						identity: [...itemIdentity, "entities"],
						command: { ...input.command, population: input.population },
					},
					items: resolvedRelatedEntities.map(({ relatedEntity, schemaProvider }) => ({
						...scope,
						populatedAt: null,
						updateExisting: false,
						name: relatedEntity.name,
						externalId: relatedEntity.externalId,
						providerId: schemaProvider.providerId,
						properties: relatedEntity.properties ?? {},
						entitySchema: {
							slug: schemaProvider.entitySchemaSlug,
							owner: definitionOwner(input.pluginId),
						},
						lifecycle: {
							...populationLifecycleCommand(
								input.command,
								[...itemIdentity, relatedEntity.providerSlug, relatedEntity.externalId],
								input.population,
							),
							writeContext: input.command.writeContext,
						},
					})),
				});
				const entityDispatch = upserts.dispatch;
				const entries: Array<{ entityId: EntityId; properties: Record<string, unknown> }> = [];
				for (const [index, { properties }] of resolvedRelatedEntities.entries()) {
					const result = upserts.results[index];
					if (!result) {
						return yield* Effect.die("Planned related entity upsert is missing its result");
					}
					entries.push({ properties, entityId: result.entity.id });
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
					command: {
						...populationLifecycleCommand(input.command, itemIdentity, {
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
						writeContext: input.command.writeContext,
					},
				});
				return {
					entityDispatch,
					result: relationshipWork.result,
					relationshipDispatch: relationshipWork.dispatch,
				};
			}),
		),
	).pipe(mapDbErrorToSandbox);
	return {
		result: committed.result,
		dispatch: [...committed.entityDispatch, ...committed.relationshipDispatch],
	};
});
