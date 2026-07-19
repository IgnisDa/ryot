import type { Effect } from "@ryot-app/sandbox-sdk/effect";
import { executeRyotqlRecipe, type RyotQLDocument } from "@ryot-app/sandbox-sdk/ryotql";

import type { MediaMonitoringResult } from "../contracts/operations";
import { mediaMonitoringTargetsRecipe } from "../lib/media-monitoring-ryotql";

export const queryMediaMonitoringTargets = (
	entityIds: readonly string[],
	executeRyotql: (document: RyotQLDocument) => Effect.Effect<unknown, unknown>,
) => executeRyotqlRecipe(executeRyotql, mediaMonitoringTargetsRecipe(entityIds));

export const alignedMediaMonitoringResults = (
	entityIds: readonly string[],
	targets: readonly { entityId: string; monitoringLibraryId: string | null }[],
	isMediaMonitored: (target: { monitoringLibraryId: string | null }) => boolean,
): MediaMonitoringResult[] => {
	const targetById = new Map(targets.map((target) => [target.entityId, target]));
	return entityIds.map((entityId) => {
		const target = targetById.get(entityId);
		return target
			? { entityId, status: "found", isMediaMonitored: isMediaMonitored(target) }
			: { entityId, status: "notFound" };
	});
};
