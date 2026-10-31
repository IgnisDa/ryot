import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	orientRelationship,
	relationshipEnds,
} from "@ryot-app/contract/modules/relationships/orientation";
import type { EntityId, RelationshipSchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

type RelationshipEntry = { entityId: EntityId; properties: Record<string, unknown> };

export const persistPlannedRelationshipSynchronization = Effect.fn(
	"persistPlannedRelationshipSynchronization",
)(function* (
	input: ({ scope: "global" } | { scope: "user"; userId: UserId }) & {
		anchorEntityId: EntityId;
		command: DomainLifecycleCommand;
		direction: "incoming" | "outgoing";
		relationshipSchemaPluginId: null | string;
		entries: ReadonlyArray<RelationshipEntry>;
		synchronization: "additive" | "authoritative";
		relationshipSchemaSlug: RelationshipSchemaSlug;
		onConflict: "preserveExisting" | "replaceProperties";
	},
) {
	const relationships = yield* RelationshipsService;
	const repository = yield* RelationshipsRepository;
	const scope =
		input.scope === "user"
			? ({ scope: "user", userId: input.userId } as const)
			: ({ scope: "global" } as const);
	const selector = {
		type: "anchored" as const,
		direction: input.direction,
		anchorEntityId: input.anchorEntityId,
	};
	const entries = new Map(input.entries.map((entry) => [entry.entityId, entry]));

	if (input.synchronization === "additive" || input.onConflict === "preserveExisting") {
		const existing = yield* repository.listRelationshipsForReconciliation({
			...scope,
			...selector,
			relationshipSchemaSlug: input.relationshipSchemaSlug,
			relationshipSchemaPluginId: input.relationshipSchemaPluginId ?? null,
		});
		for (const relationship of existing) {
			const relatedEntityId = relationship[`${relationshipEnds(input.direction).related}EntityId`];
			if (entries.has(relatedEntityId) || input.synchronization === "additive") {
				entries.set(relatedEntityId, {
					entityId: relatedEntityId,
					properties: relationship.properties,
				});
			}
		}
	}

	const group = {
		selector,
		relationshipSchema: {
			slug: input.relationshipSchemaSlug,
			owner: definitionOwner(input.relationshipSchemaPluginId),
		},
		relationships: [...entries.values()].map(({ entityId, properties }) =>
			Object.assign(orientRelationship(input.direction, input.anchorEntityId, entityId), {
				properties,
			}),
		),
	};
	return yield* relationships.persistPlannedReconciliation([group], input.command, scope);
});

export const persistPlannedRelationshipPage = Effect.fn("persistPlannedRelationshipPage")(
	function* (
		input: ({ scope: "global" } | { scope: "user"; userId: UserId }) & {
			generation: string;
			kind: "page" | "sweep";
			anchorEntityId: EntityId;
			preserveExisting: boolean;
			command: DomainLifecycleCommand;
			direction: "incoming" | "outgoing";
			relationshipSchemaPluginId: null | string;
			entries: ReadonlyArray<RelationshipEntry>;
			relationshipSchemaSlug: RelationshipSchemaSlug;
		},
	) {
		const relationships = yield* RelationshipsService;
		const scope =
			input.scope === "user"
				? ({ scope: "user", userId: input.userId } as const)
				: ({ scope: "global" } as const);
		return yield* relationships.persistPlannedReconciliation(
			[
				{
					selector: {
						type: "anchored",
						direction: input.direction,
						anchorEntityId: input.anchorEntityId,
					},
					generation: {
						kind: input.kind,
						value: input.generation,
						preserveExisting: input.preserveExisting,
					},
					relationshipSchema: {
						slug: input.relationshipSchemaSlug,
						owner: definitionOwner(input.relationshipSchemaPluginId),
					},
					relationships: input.entries.map(({ entityId, properties }) =>
						Object.assign(orientRelationship(input.direction, input.anchorEntityId, entityId), {
							properties,
						}),
					),
				},
			],
			input.command,
			scope,
		);
	},
);
