import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import { definitionOwnerPluginId } from "@ryot-app/contract/modules/plugins/references";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { Effect, Layer, Schema } from "effect";

import type { Changes } from "#modules/changes/changes";
import { ChangeSets } from "#modules/changes/service";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";

export type PopulationCommit = {
	readonly changes: Changes;
	readonly command: DomainLifecycleCommand;
};

type GlobalUpsert = NonNullable<Changes["globalEntities"]>[number];

/** The entity a fake commit stores for an upsert: `entity-<externalId>`, unless `id` names another. */
export const upsertedFixture = (
	item: GlobalUpsert,
	occurredAt: string,
	id: EntityId = EntityId.make(`entity-${item.externalId}`),
): Effect.Effect<ListedEntity> =>
	Schema.decodeUnknownEffect(Schema.Record(Schema.String, JsonValue))(item.properties).pipe(
		Effect.orDie,
		Effect.map((properties) => ({
			id,
			properties,
			name: item.name,
			createdAt: occurredAt,
			updatedAt: occurredAt,
			externalId: item.externalId,
			populatedAt: item.populatedAt,
			providerId: item.provider.providerId,
			entitySchemaSlug: item.entitySchema.slug,
			entitySchemaPluginId: definitionOwnerPluginId(item.entitySchema.owner),
		})),
	);

/**
 * `ChangeSets` whose `commit` hands each commit to `observe` and answers each global upsert with the
 * entity `entityOf` gives, under its item identity.
 */
export const populationCommitsLayer = (
	observe: (commit: PopulationCommit) => Effect.Effect<void>,
	entityOf: (item: GlobalUpsert, commit: PopulationCommit) => Effect.Effect<ListedEntity> = (
		item,
		{ command },
	) => upsertedFixture(item, command.occurredAt),
) =>
	Layer.mock(ChangeSets)({
		commit: (changes, command) =>
			Effect.gen(function* () {
				const commit = { changes, command };
				yield* observe(commit);
				return {
					merged: [],
					signals: [],
					cleared: [],
					deleted: [],
					outcomes: [],
					relationships: [],
					committed: { events: [] },
					entities: yield* Effect.forEach(changes.globalEntities ?? [], (item) =>
						Effect.map(entityOf(item, commit), (entity) => ({
							entity,
							itemIdentity: item.itemIdentity ?? "",
						})),
					),
				};
			}),
	});
