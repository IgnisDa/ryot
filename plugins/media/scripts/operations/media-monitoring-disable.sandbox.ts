import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineOperation } from "@ryot/sandbox-sdk/operation";

import { MediaMonitoringDisableInput, MediaMonitoringOutput } from "../../operations/schemas";
import {
	alignedMediaMonitoringResults,
	queryMediaMonitoringTargets,
} from "./media-monitoring-shared";

export const manifest = defineManifest({
	kind: "operation",
	name: "Disable media monitoring",
	slug: "operation.media-monitoring-disable",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["executeQueryEngine", "changeUserRelationships"],
});

export default defineOperation({
	manifest,
	input: MediaMonitoringDisableInput,
	output: MediaMonitoringOutput,
	run: (input, host) =>
		Effect.gen(function* () {
			const targets = yield* queryMediaMonitoringTargets(input.entityIds, host.executeQueryEngine);
			const deletes = targets.flatMap(({ entityId, monitoringLibraryId }) =>
				monitoringLibraryId
					? [
							{
								sourceEntityId: entityId,
								targetEntityId: monitoringLibraryId,
								relationshipSchemaSlug: "media-monitoring",
							},
						]
					: [],
			);
			if (deletes.length > 0) {
				yield* host.changeUserRelationships([{ creates: [], deletes }]);
			}
			return {
				results: alignedMediaMonitoringResults(input.entityIds, targets, () => false),
			};
		}),
});
