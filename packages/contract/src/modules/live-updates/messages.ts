import { Schema } from "effect";

import { EntityId } from "../../schema/brands";

export const EntityUpdatedReason = Schema.Literals([
	"populated",
	"translated",
	"enrichment-updated",
]);
export type EntityUpdatedReason = typeof EntityUpdatedReason.Type;

export const EntityUpdatedMessage = Schema.Struct({
	entityId: EntityId,
	reason: EntityUpdatedReason,
});
export type EntityUpdatedMessage = typeof EntityUpdatedMessage.Type;

export const EntityUpdatedFrame = Schema.Struct({
	...EntityUpdatedMessage.fields,
	type: Schema.Literal("entity-updated"),
});
export type EntityUpdatedFrame = typeof EntityUpdatedFrame.Type;

const DerivedDataUpdatedFrame = Schema.Struct({ type: Schema.Literal("derived-data-updated") });

export const LiveUpdateFrame = Schema.Union([EntityUpdatedFrame, DerivedDataUpdatedFrame]);
export type LiveUpdateFrame = typeof LiveUpdateFrame.Type;

export const LIVE_UPDATES_CONNECTED_EVENT = "connected";

export const MAX_INTEREST_ENTITY_IDS = 500;
export const MAX_FOREGROUND_ENTITY_IDS = 50;
export const MAX_POPULATE_ENTITY_IDS = 100;

export const PopulateEntitiesBody = Schema.Struct({
	priority: Schema.Literals(["interactive", "background"]),
	entityIds: Schema.Array(Schema.String).check(Schema.isMaxLength(MAX_POPULATE_ENTITY_IDS)),
});
export type PopulateEntitiesBody = typeof PopulateEntitiesBody.Type;
