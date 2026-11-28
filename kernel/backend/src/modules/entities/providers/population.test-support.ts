import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import { definitionOwnerPluginId } from "@ryot-app/contract/modules/plugins/references";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { Effect, Schema } from "effect";

import {
	type RecordedCommit,
	recordingChangeSets,
} from "#modules/changes/change-sets.test-support";
import type { Changes } from "#modules/changes/changes";
import { emptyCommitResult } from "#modules/changes/receipts";

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
	observe: (commit: RecordedCommit) => Effect.Effect<void>,
	entityOf: (item: GlobalUpsert, commit: RecordedCommit) => Effect.Effect<ListedEntity> = (
		item,
		{ command },
	) => upsertedFixture(item, command.occurredAt),
) =>
	recordingChangeSets((commit) =>
		Effect.gen(function* () {
			yield* observe(commit);
			return {
				...emptyCommitResult,
				entities: yield* Effect.forEach(commit.changes.globalEntities ?? [], (item) =>
					Effect.map(entityOf(item, commit), (entity) => ({
						entity,
						itemIdentity: item.itemIdentity ?? "",
					})),
				),
			};
		}),
	);
