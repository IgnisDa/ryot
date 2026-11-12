import { mapDbErrorToSandbox, SandboxRunError } from "@ryot-app/contract/errors";
import type { AutomationPopulationContext } from "@ryot-app/contract/modules/automations/lifecycle";
import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	type EntityId,
	EntitySchemaSlug,
	type PluginId,
	RelationshipSchemaSlug,
	type SandboxProviderId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { parseAppSchemaProperties } from "@ryot-app/contract/schema/property-values";
import type { EntityRelationshipDefinitions } from "@ryot-app/definitions/snapshot";
import type {
	ProviderDetailsRelatedEntity,
	ProviderDetailsRelatedEntityGroup,
} from "@ryot-app/plugin-backend-sdk/provider";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect } from "effect";

import { populationLifecycleCommand } from "#modules/automations/lifecycle/command";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { retryOnDeadlock } from "#platform/db/errors";
import { DatabaseSession } from "#platform/db/session";

import { makeProviderExecutionReads } from "./execution-reads";
import { persistPlannedRelationshipPage } from "./relationship-synchronization";

type RelatedGroupPaging = { pageIndex: number; generation: string; groupIndex: number };

const pagedItemIdentity = (
	primaryEntityId: EntityId,
	group: Pick<ProviderDetailsRelatedEntityGroup, "direction" | "relationshipSchemaSlug">,
	paging: Pick<RelatedGroupPaging, "groupIndex">,
	step: string,
) => [
	"related-group",
	String(primaryEntityId),
	group.relationshipSchemaSlug,
	group.direction,
	`group:${paging.groupIndex}`,
	step,
];

const findRelationshipSchema = (
	definitions: EntityRelationshipDefinitions,
	pluginId: PluginId,
	slug: string,
) => {
	const definition =
		definitions.relationshipSchemas[definitionKey("relationship", definitionOwner(pluginId), slug)];
	return definition
		? Effect.succeed({
				pluginId: definition.pluginId ?? null,
				propertiesSchema: definition.propertiesSchema,
				id: RelationshipSchemaSlug.make(definition.slug),
				sourceEntitySchemaSlug: definition.sourceEntitySchemaSlug
					? EntitySchemaSlug.make(definition.sourceEntitySchemaSlug)
					: null,
				targetEntitySchemaSlug: definition.targetEntitySchemaSlug
					? EntitySchemaSlug.make(definition.targetEntitySchemaSlug)
					: null,
			})
		: Effect.fail(
				new SandboxRunError({
					kind: "script-failure",
					message: `Relationship schema not found: ${slug}`,
				}),
			);
};

const populationBatch = (population: AutomationPopulationContext, id: string) => ({
	...population,
	batch: {
		id,
		afterCount: 0,
		beforeCount: 0,
		isLeader: true,
		createdCount: 0,
		deletedCount: 0,
		updatedCount: 0,
	},
});

export const sweepRelatedEntityGroup = Effect.fn("sweepRelatedEntityGroup")(function* (
	input: ({ scope: "global" } | { scope: "user"; userId: UserId }) & {
		generation: string;
		groupIndex: number;
		pluginId: PluginId;
		primaryEntityId: EntityId;
		kept: ReadonlySet<EntityId>;
		command: DomainLifecycleCommand;
		population: AutomationPopulationContext;
		definitions: EntityRelationshipDefinitions;
		beforeWrite?: Effect.Effect<void, SandboxRunError>;
		group: Pick<ProviderDetailsRelatedEntityGroup, "direction" | "relationshipSchemaSlug">;
	},
) {
	const session = yield* DatabaseSession;
	const entitiesRepository = yield* EntitiesRepository;
	const relationshipSchema = yield* findRelationshipSchema(
		input.definitions,
		input.pluginId,
		input.group.relationshipSchemaSlug,
	);
	const scope =
		input.scope === "user"
			? ({ scope: "user", userId: input.userId } as const)
			: ({ scope: "global" } as const);
	const itemIdentity = pagedItemIdentity(input.primaryEntityId, input.group, input, "sweep");
	return yield* retryOnDeadlock(
		session.transaction(
			Effect.gen(function* () {
				yield* input.beforeWrite ?? Effect.void;
				if (
					!(yield* entitiesRepository.holdsRelatedPopulationGeneration(
						input.primaryEntityId,
						input.generation,
					))
				) {
					return { result: [], dispatch: [], superseded: true };
				}
				const work = yield* persistPlannedRelationshipPage({
					...scope,
					entries: [],
					direction: input.group.direction,
					anchorEntityId: input.primaryEntityId,
					paging: { kind: "sweep", kept: input.kept },
					relationshipSchemaSlug: relationshipSchema.id,
					relationshipSchemaPluginId: relationshipSchema.pluginId,
					command: {
						...populationLifecycleCommand(
							input.command,
							itemIdentity,
							populationBatch(
								input.population,
								stableStringify([input.command.causation.executionId, ...itemIdentity]),
							),
						),
						writeContext: input.command.writeContext,
					},
				});
				return { superseded: false, result: work.result, dispatch: work.dispatch };
			}),
		),
	).pipe(mapDbErrorToSandbox);
});

export const syncRelatedEntityGroup = Effect.fn("syncRelatedEntityGroup")(function* (
	input: ({ scope: "global" } | { scope: "user"; userId: UserId }) & {
		pluginId: PluginId;
		primaryEntityId: EntityId;
		paging: RelatedGroupPaging;
		command: DomainLifecycleCommand;
		population: AutomationPopulationContext;
		primaryEntitySchemaSlug: EntitySchemaSlug;
		definitions: EntityRelationshipDefinitions;
		beforeWrite?: Effect.Effect<void, SandboxRunError>;
		group: Omit<ProviderDetailsRelatedEntityGroup, "coverage">;
	},
) {
	const session = yield* DatabaseSession;
	const reads = makeProviderExecutionReads(session);
	const entities = yield* EntitiesService;
	const entitiesRepository = yield* EntitiesRepository;
	const relationshipSchema = yield* findRelationshipSchema(
		input.definitions,
		input.pluginId,
		input.group.relationshipSchemaSlug,
	);
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
	}> = [];
	const schemaProviderBySlug = new Map<
		string,
		(typeof resolvedRelatedEntities)[number]["schemaProvider"]
	>();
	const pin = input.command.writeContext?.pluginRevision;
	if (!pin) {
		return yield* new SandboxRunError({
			kind: "invalid-input",
			message: "Related population requires exact persisted plugin authority",
		});
	}
	const resolveSchemaProvider = Effect.fn(function* (providerSlug: string) {
		const memoized = schemaProviderBySlug.get(providerSlug);
		if (memoized !== undefined) {
			return memoized;
		}
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
	});
	for (const relatedEntity of uniqueRelatedEntities.values()) {
		const schemaProvider = yield* resolveSchemaProvider(relatedEntity.providerSlug);
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
		resolvedRelatedEntities.push({ properties, relatedEntity, schemaProvider });
	}

	const scope =
		input.scope === "user"
			? ({ scope: "user", userId: input.userId } as const)
			: ({ scope: "global" } as const);
	const paging = input.paging;
	const itemIdentity = pagedItemIdentity(
		input.primaryEntityId,
		input.group,
		paging,
		`page:${paging.pageIndex}`,
	);
	const committed = yield* retryOnDeadlock(
		session.transaction(
			Effect.gen(function* () {
				yield* input.beforeWrite ?? Effect.void;
				if (
					!(yield* entitiesRepository.holdsRelatedPopulationGeneration(
						input.primaryEntityId,
						paging.generation,
					))
				) {
					return {
						result: [],
						superseded: true,
						entityDispatch: [],
						relatedEntityIds: [],
						relationshipDispatch: [],
					};
				}
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
				const relationshipCommand = {
					...populationLifecycleCommand(
						input.command,
						itemIdentity,
						populationBatch(
							input.population,
							stableStringify([input.command.causation.executionId, ...itemIdentity]),
						),
					),
					writeContext: input.command.writeContext,
				};
				const relationshipWork = yield* persistPlannedRelationshipPage({
					...scope,
					entries,
					command: relationshipCommand,
					direction: input.group.direction,
					anchorEntityId: input.primaryEntityId,
					relationshipSchemaSlug: relationshipSchema.id,
					relationshipSchemaPluginId: relationshipSchema.pluginId,
					paging: { kind: "page", preserveExisting: input.group.synchronization === "additive" },
				});
				return {
					entityDispatch,
					superseded: false,
					result: relationshipWork.result,
					relationshipDispatch: relationshipWork.dispatch,
					relatedEntityIds: entries.map(({ entityId }) => entityId),
				};
			}),
		),
	).pipe(mapDbErrorToSandbox);
	return {
		result: committed.result,
		superseded: committed.superseded,
		relatedEntityIds: committed.relatedEntityIds,
		dispatch: [...committed.entityDispatch, ...committed.relationshipDispatch],
	};
});
