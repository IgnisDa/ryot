import { Schema } from "effect";

import { EntityId } from "../../schema/brands";

export const MediaMonitoringStatus = Schema.Struct({
	entityId: EntityId,
	isMediaMonitored: Schema.Boolean,
});

export type MediaMonitoringStatus = typeof MediaMonitoringStatus.Type;
