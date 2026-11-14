import type { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import type { ExecutionRequest } from "@ryot-app/plugin-backend-sdk/ryotql";
import { executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";

import type { MediaMonitoringResult } from "../../shared/media-monitoring-operations";
import { mediaMonitoringTargetsRecipe } from "../lib/media-monitoring-ryotql";

export const queryMediaMonitoringTargets = (
	entityIds: readonly string[],
	executeRyotql: (request: ExecutionRequest) => Effect.Effect<unknown, SandboxHostError>,
) =>
	executeRyotqlRecipe(executeRyotql, mediaMonitoringTargetsRecipe({ kind: "self" }), {
		entityIds: entityIds,
	});
export const alignedMediaMonitoringResults = (
	entityIds: readonly string[],
	targets: readonly { entityId: string; monitoringLibraryId: null | string }[],
	isMediaMonitored: (target: { monitoringLibraryId: null | string }) => boolean,
): MediaMonitoringResult[] => {
	const targetById = new Map(targets.map((target) => [target.entityId, target]));
	return entityIds.map((entityId) => {
		const target = targetById.get(entityId);
		return target
			? { entityId, status: "found", isMediaMonitored: isMediaMonitored(target) }
			: { entityId, status: "notFound" };
	});
};
