import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import type { EntityId, RelationshipSchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

type RelationshipEntry = { entityId: EntityId; properties: Record<string, unknown> };

export const persistPlannedRelationshipSynchronization = Effect.fn(
	"persistPlannedRelationshipSynchronization",
)(function* (
	input: {
		command: DomainLifecycleCommand;
		anchorEntityId: EntityId;
		direction: "incoming" | "outgoing";
		synchronization: "additive" | "authoritative";
		relationshipSchemaSlug: RelationshipSchemaSlug;
		onConflict: "preserveExisting" | "replaceProperties";
		relationshipSchemaPluginId: string | null;
		entries: ReadonlyArray<RelationshipEntry>;
	} & ({ scope: "global" } | { scope: "user"; userId: UserId }),
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
			const relatedEntityId =
				input.direction === "outgoing" ? relationship.targetEntityId : relationship.sourceEntityId;
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
		relationships: [...entries.values()].map(({ entityId, properties }) => ({
			properties,
			sourceEntityId: input.direction === "outgoing" ? input.anchorEntityId : entityId,
			targetEntityId: input.direction === "outgoing" ? entityId : input.anchorEntityId,
		})),
	};
	return yield* relationships.persistPlannedReconciliation([group], input.command, scope);
});
