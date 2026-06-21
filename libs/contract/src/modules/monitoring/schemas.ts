import { Schema } from "effect";

import { EntityId } from "../../schema/brands";

export const MonitoringStatus = Schema.Struct({
	entityId: EntityId,
	isMonitored: Schema.Boolean,
});

export type MonitoringStatus = typeof MonitoringStatus.Type;
