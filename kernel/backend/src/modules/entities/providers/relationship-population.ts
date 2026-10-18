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
import type {
	ProviderDetailsRelatedEntity,
	ProviderDetailsRelatedEntityGroup,
} from "@ryot-app/plugin-backend-sdk/provider";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect } from "effect";

import { populationLifecycleCommand } from "#modules/automations/lifecycle/command";
import { parseAppSchemaProperties } from "#modules/definitions/properties/runtime";
import type { EntityRelationshipDefinitions } from "#modules/definitions/snapshot";
import { EntitiesService } from "#modules/entities/service";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { retryOnDeadlock } from "#platform/db/errors";
import { DatabaseSession } from "#platform/db/session";

import { makeProviderExecutionReads } from "./execution-reads";
import { persistPlannedRelationshipPage } from "./relationship-synchronization";

type RelatedGroupPaging = { generation: string; groupIndex: number; pageIndex: number };

const pagedItemIdentity = (
	primaryEntityId: EntityId,
	group: Pick<ProviderDetailsRelatedEntityGroup, "relationshipSchemaSlug" | "direction">,
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

export const claimRelatedGroupGeneration = Effect.fn("claimRelatedGroupGeneration")(
	function* (input: {
		beforeWrite?: Effect.Effect<void, SandboxRunError>;
		generation: string;
		startedAt: Date;
		pluginId: PluginId;
		primaryEntityId: EntityId;
		definitions: EntityRelationshipDefinitions;
		group: Pick<ProviderDetailsRelatedEntityGroup, "relationshipSchemaSlug" | "direction">;
	}) {
		const session = yield* DatabaseSession;
		const repository = yield* RelationshipsRepository;
		const relationshipSchema = yield* findRelationshipSchema(
			input.definitions,
			input.pluginId,
			input.group.relationshipSchemaSlug,
		);
		yield* session.transaction(
			Effect.andThen(
				input.beforeWrite ?? Effect.void,
				repository.claimRelationshipSyncGeneration(
					{
						direction: input.group.direction,
						anchorEntityId: input.primaryEntityId,
						relationshipSchemaSlug: relationshipSchema.id,
						relationshipSchemaPluginId: relationshipSchema.pluginId,
					},
					input.generation,
					input.startedAt,
				),
			),
		);
	},
);

export const sweepRelatedEntityGroup = Effect.fn("sweepRelatedEntityGroup")(function* (
	input: {
		beforeWrite?: Effect.Effect<void, SandboxRunError>;
		generation: string;
		groupIndex: number;
		pluginId: PluginId;
		command: DomainLifecycleCommand;
		primaryEntityId: EntityId;
		population: AutomationPopulationContext;
		definitions: EntityRelationshipDefinitions;
		group: Pick<ProviderDetailsRelatedEntityGroup, "relationshipSchemaSlug" | "direction">;
	} & ({ scope: "global" } | { scope: "user"; userId: UserId }),
) {
	const session = yield* DatabaseSession;
	const repository = yield* RelationshipsRepository;
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
				const holds = yield* repository.holdsRelationshipSyncGeneration(
					{
						direction: input.group.direction,
						anchorEntityId: input.primaryEntityId,
						relationshipSchemaSlug: relationshipSchema.id,
						relationshipSchemaPluginId: relationshipSchema.pluginId,
					},
					input.generation,
				);
				if (!holds) {
					return { result: [], dispatch: [], superseded: true };
				}
				const work = yield* persistPlannedRelationshipPage({
					...scope,
					entries: [],
					kind: "sweep",
					preserveExisting: false,
					generation: input.generation,
					direction: input.group.direction,
					anchorEntityId: input.primaryEntityId,
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
	input: {
		beforeWrite?: Effect.Effect<void, SandboxRunError>;
		command: DomainLifecycleCommand;
		pluginId: PluginId;
		definitions: EntityRelationshipDefinitions;
		population: AutomationPopulationContext;
		primaryEntityId: EntityId;
		primaryEntitySchemaSlug: EntitySchemaSlug;
		group: Omit<ProviderDetailsRelatedEntityGroup, "continuation">;
		paging: RelatedGroupPaging;
	} & ({ scope: "global" } | { scope: "user"; userId: UserId }),
) {
	const session = yield* DatabaseSession;
	const reads = makeProviderExecutionReads(session);
	const entities = yield* EntitiesService;
	const relationships = yield* RelationshipsRepository;
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
	const groupKey = {
		direction: input.group.direction,
		anchorEntityId: input.primaryEntityId,
		relationshipSchemaSlug: relationshipSchema.id,
		relationshipSchemaPluginId: relationshipSchema.pluginId,
	};
	const committed = yield* retryOnDeadlock(
		session.transaction(
			Effect.gen(function* () {
				yield* input.beforeWrite ?? Effect.void;
				if (!(yield* relationships.holdsRelationshipSyncGeneration(groupKey, paging.generation))) {
					return { result: [], superseded: true, entityDispatch: [], relationshipDispatch: [] };
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
					kind: "page",
					command: relationshipCommand,
					generation: paging.generation,
					direction: input.group.direction,
					anchorEntityId: input.primaryEntityId,
					relationshipSchemaSlug: relationshipSchema.id,
					relationshipSchemaPluginId: relationshipSchema.pluginId,
					preserveExisting: input.group.synchronization === "additive",
				});
				return {
					entityDispatch,
					superseded: false,
					result: relationshipWork.result,
					relationshipDispatch: relationshipWork.dispatch,
				};
			}),
		),
	).pipe(mapDbErrorToSandbox);
	return {
		result: committed.result,
		superseded: committed.superseded,
		dispatch: [...committed.entityDispatch, ...committed.relationshipDispatch],
	};
});
