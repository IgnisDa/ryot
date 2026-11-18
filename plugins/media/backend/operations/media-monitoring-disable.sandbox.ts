import { existingEntity } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import {
	MediaMonitoringDisableInput,
	MediaMonitoringOutput,
} from "../../shared/media-monitoring-operations";
import {
	alignedMediaMonitoringResults,
	queryMediaMonitoringTargets,
} from "./media-monitoring-shared";

export const manifest = defineManifest({
	kind: "operation",
	name: "Disable media monitoring",
	slug: "operation.media-monitoring-disable",
});

export default defineOperation({
	manifest,
	output: MediaMonitoringOutput,
	input: MediaMonitoringDisableInput,
	run: (input, host) =>
		Effect.gen(function* () {
			const targets = yield* queryMediaMonitoringTargets(input.entityIds, host.executeRyotql);
			const deletes = targets.flatMap(({ entityId, monitoringLibraryId }) =>
				monitoringLibraryId
					? [
							{
								relationshipSchemaSlug: "media-monitoring",
								source: existingEntity(EntityId.make(entityId)),
								target: existingEntity(EntityId.make(monitoringLibraryId)),
							},
						]
					: [],
			);
			const output = {
				results: alignedMediaMonitoringResults(input.entityIds, targets, () => false),
			};
			return deletes.length === 0
				? { output }
				: { output, changes: { relationships: { deletes } } };
		}),
});
