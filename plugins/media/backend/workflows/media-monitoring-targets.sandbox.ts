import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { executeRyotqlRecipe } from "@ryot-app/sandbox-sdk/ryotql";

import {
	MediaMonitoringTargetsActivityInput,
	MediaMonitoringTargetsActivityOutput,
} from "../contracts/workflows";
import { mediaMonitoringSweepRecipe } from "../lib/media-monitoring-ryotql";

export const manifest = defineManifest({
	kind: "script",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["executeRyotql"],
	slug: "media-monitoring-targets",
	name: "List media monitoring targets",
});

export default defineScript({
	manifest,
	input: MediaMonitoringTargetsActivityInput,
	output: MediaMonitoringTargetsActivityOutput,
	run: (input, host) =>
		executeRyotqlRecipe(host.executeRyotql, mediaMonitoringSweepRecipe(input.after, input.limit)),
});
