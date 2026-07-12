import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineOperation } from "@ryot/sandbox-sdk/operation";

import { MediaMonitoringOutput, MediaMonitoringStatusInput } from "../../operations/schemas";
import {
	alignedMediaMonitoringResults,
	queryMediaMonitoringTargets,
} from "./media-monitoring-shared";

export const manifest = defineManifest({
	kind: "operation",
	name: "Media monitoring status",
	capabilities: ["executeQueryEngine"],
	slug: "operation.media-monitoring-status",
	requiredAppConfigKeys: [],
});

export default defineOperation({
	manifest,
	input: MediaMonitoringStatusInput,
	output: MediaMonitoringOutput,
	run: (input, host) =>
		queryMediaMonitoringTargets(input.entityIds, host.executeQueryEngine).pipe(
			Effect.map((targets) => ({
				results: alignedMediaMonitoringResults(
					input.entityIds,
					targets,
					(target) => target.monitoringLibraryId !== null,
				),
			})),
		),
});
