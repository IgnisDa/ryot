import { SandboxRunError } from "@ryot-app/contract/errors";
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

import type { GlobalEntityReference } from "#modules/changes/changes";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { DatabaseSession } from "#platform/db/session";

import { makeProviderExecutionReads } from "./execution-reads";
import {
	commitPopulation,
	populationCommand,
	type PopulationOwner,
	upsertedEntity,
} from "./population";

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
				propertiesSchema: definition.propertiesSchema,
				id: RelationshipSchemaSlug.make(definition.slug),
				owner: definitionOwner(definition.pluginId ?? null),
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

/** The relationship from or to the primary entity, by the group's direction. */
const oriented = (
	direction: "incoming" | "outgoing",
	primary: GlobalEntityReference,
	related: GlobalEntityReference,
) =>
	direction === "outgoing"
		? { source: primary, target: related }
		: { source: related, target: primary };

/** Deletes the authoritative group's relationships whose other end no page kept. */
export const sweepRelatedEntityGroup = Effect.fn("sweepRelatedEntityGroup")(function* (input: {
	generation: string;
	groupIndex: number;
	pluginId: PluginId;
	userId: null | UserId;
	owner: PopulationOwner;
	primaryEntityId: EntityId;
	kept: ReadonlySet<EntityId>;
	command: DomainLifecycleCommand;
	population: AutomationPopulationContext;
	definitions: EntityRelationshipDefinitions;
	group: Pick<ProviderDetailsRelatedEntityGroup, "direction" | "relationshipSchemaSlug">;
}) {
	const relationshipSchema = yield* findRelationshipSchema(
		input.definitions,
		input.pluginId,
		input.group.relationshipSchemaSlug,
	);
	const primary = { kind: "existing" as const, entityId: input.primaryEntityId };
	const swept = yield* commitPopulation({
		owner: input.owner,
		generation: { generation: input.generation, entityId: input.primaryEntityId },
		command: populationCommand(
			input.command,
			pagedItemIdentity(input.primaryEntityId, input.group, input, "sweep"),
			input.population,
		),
		changes: {
			userId: input.userId,
			globalRelationships: [
				{
					relationships: [],
					paging: { kind: "sweep", kept: input.kept },
					selector: { anchor: primary, type: "anchored", direction: input.group.direction },
					relationshipSchema: { slug: relationshipSchema.id, owner: relationshipSchema.owner },
				},
			],
		},
	});
	return { superseded: swept === null };
});

/** Upserts one page of a related group's entities and their relationships to the primary entity. */
export const syncRelatedEntityGroup = Effect.fn("syncRelatedEntityGroup")(function* (input: {
	pluginId: PluginId;
	userId: null | UserId;
	owner: PopulationOwner;
	primaryEntityId: EntityId;
	paging: RelatedGroupPaging;
	command: DomainLifecycleCommand;
	population: AutomationPopulationContext;
	primaryEntitySchemaSlug: EntitySchemaSlug;
	definitions: EntityRelationshipDefinitions;
	group: Omit<ProviderDetailsRelatedEntityGroup, "coverage">;
}) {
	const session = yield* DatabaseSession;
	const reads = makeProviderExecutionReads(session);
	const relationshipSchema = yield* findRelationshipSchema(
		input.definitions,
		input.pluginId,
		input.group.relationshipSchemaSlug,
	);
	const uniqueRelatedEntities = new Map<string, ProviderDetailsRelatedEntity>();
	for (const relatedEntity of input.group.entities) {
		uniqueRelatedEntities.set(
			stableStringify([relatedEntity.providerSlug, relatedEntity.externalId]),
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

	const itemIdentity = pagedItemIdentity(
		input.primaryEntityId,
		input.group,
		input.paging,
		`page:${input.paging.pageIndex}`,
	);
	const relatedIdentity = ({ externalId, providerSlug }: ProviderDetailsRelatedEntity) =>
		stableStringify([input.command.itemIdentity, ...itemIdentity, providerSlug, externalId]);
	const owner = definitionOwner(input.pluginId);
	const primary = { kind: "existing" as const, entityId: input.primaryEntityId };
	const result = yield* commitPopulation({
		owner: input.owner,
		command: populationCommand(input.command, itemIdentity, input.population),
		generation: { entityId: input.primaryEntityId, generation: input.paging.generation },
		changes: {
			userId: input.userId,
			globalEntities: resolvedRelatedEntities.map(({ relatedEntity, schemaProvider }) => ({
				populatedAt: null,
				name: relatedEntity.name,
				externalId: relatedEntity.externalId,
				properties: relatedEntity.properties ?? {},
				itemIdentity: relatedIdentity(relatedEntity),
				entitySchema: { owner, slug: schemaProvider.entitySchemaSlug },
				provider: { updateExisting: false, providerId: schemaProvider.providerId },
			})),
			globalRelationships: [
				{
					paging: { kind: "page" },
					selector: { anchor: primary, type: "anchored", direction: input.group.direction },
					relationshipSchema: { slug: relationshipSchema.id, owner: relationshipSchema.owner },
					...(input.group.synchronization === "additive" ? { preserveExisting: true } : {}),
					relationships: resolvedRelatedEntities.map(
						({ properties, relatedEntity, schemaProvider }) => ({
							properties,
							...oriented(input.group.direction, primary, {
								kind: "upserted",
								externalId: relatedEntity.externalId,
								providerId: schemaProvider.providerId,
								entitySchema: { owner, slug: schemaProvider.entitySchemaSlug },
							}),
						}),
					),
				},
			],
		},
	});
	if (result === null) {
		return { superseded: true, relatedEntityIds: [] };
	}
	const related = yield* Effect.forEach(resolvedRelatedEntities, ({ relatedEntity }) =>
		upsertedEntity(result, relatedIdentity(relatedEntity)),
	);
	return { superseded: false, relatedEntityIds: related.map(({ id }) => id) };
});
