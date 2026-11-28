import { AutomationEntityDraft } from "@ryot-app/contract/modules/automations/lifecycle";
import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import type { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Schema } from "effect";

import { EntitiesRepository } from "./repository";

type DraftSource = Pick<
	ListedEntity,
	| "name"
	| "properties"
	| "providerId"
	| "externalId"
	| "populatedAt"
	| "entitySchemaSlug"
	| "entitySchemaPluginId"
>;

/** The draft an automation sees of an entity; fails when its properties are not JSON. */
export const automationEntityDraft = (entity: DraftSource) =>
	Schema.decodeUnknownEffect(AutomationEntityDraft)({
		name: entity.name,
		properties: entity.properties,
		providerId: entity.providerId,
		externalId: entity.externalId,
		populatedAt: entity.populatedAt,
		entitySchemaSlug: entity.entitySchemaSlug,
		entitySchemaPluginId: entity.entitySchemaPluginId,
	});

/** The drafts of the user's visible entities among `entityIds`, read in one statement. */
export const automationEntityDrafts = Effect.fn("automationEntityDrafts")(function* (
	userId: UserId,
	entityIds: ReadonlyArray<EntityId>,
) {
	const entities = yield* (yield* EntitiesRepository).getByIdsForUser({ userId, entityIds });
	return new Map(
		yield* Effect.forEach(entities, ([id, entity]) =>
			automationEntityDraft(entity).pipe(
				Effect.map((draft) => [id, draft] as const),
				Effect.orDie,
			),
		),
	);
});
