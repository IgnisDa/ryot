import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { executeRyotqlRecipe } from "@ryot-app/sandbox-sdk/ryotql";

import { mediaMonitoringSweepRecipe } from "../../media-monitoring-ryotql";
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
		executeRyotqlRecipe(host.executeRyotql, mediaMonitoringSweepRecipe(input.after, input.limit)),
});
