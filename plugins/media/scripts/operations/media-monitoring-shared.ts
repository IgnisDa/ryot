import { Effect } from "@ryot/sandbox-sdk/effect";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";

import { buildMediaMonitoringTargetsQuery, mediaMonitoringRows } from "../../media-monitoring";
import type { MediaMonitoringResult } from "../../operations/schemas";

export const queryMediaMonitoringTargets = (
	entityIds: readonly string[],
	executeQueryEngine: (document: JsonValue) => Effect.Effect<unknown, unknown>,
) =>
	executeQueryEngine(buildMediaMonitoringTargetsQuery(entityIds)).pipe(
		Effect.map(mediaMonitoringRows),
	);

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
