import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import {
	buildMediaMonitoringSweepDocument,
	decodeMediaMonitoringSweep,
} from "../../media-monitoring-ryotql";
import {
	MediaMonitoringTargetsActivityInput,
	MediaMonitoringTargetsActivityOutput,
} from "../../workflows/schemas";

export const manifest = defineManifest({
	kind: "script",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "media-monitoring-targets",
	capabilities: ["executeRyotql"],
	name: "List media monitoring targets",
});

export default defineScript({
	manifest,
	input: MediaMonitoringTargetsActivityInput,
	output: MediaMonitoringTargetsActivityOutput,
	run: (input, host) =>
		host
			.executeRyotql(buildMediaMonitoringSweepDocument(input.page, input.limit))
			.pipe(Effect.map(decodeMediaMonitoringSweep)),
});
