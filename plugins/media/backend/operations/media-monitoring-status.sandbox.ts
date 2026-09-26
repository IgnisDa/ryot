import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";

import { MediaMonitoringOutput, MediaMonitoringStatusInput } from "../contracts/operations";
import {
	alignedMediaMonitoringResults,
	queryMediaMonitoringTargets,
} from "./media-monitoring-shared";

export const manifest = defineManifest({
	kind: "operation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Media monitoring status",
	capabilities: ["executeRyotql"],
	slug: "operation.media-monitoring-status",
});

export default defineOperation({
	manifest,
	output: MediaMonitoringOutput,
	input: MediaMonitoringStatusInput,
	run: (input, host) =>
		queryMediaMonitoringTargets(input.entityIds, host.executeRyotql).pipe(
			Effect.map((targets) => ({
				results: alignedMediaMonitoringResults(
					input.entityIds,
					targets,
					(target) => target.monitoringLibraryId !== null,
				),
			})),
		),
});
