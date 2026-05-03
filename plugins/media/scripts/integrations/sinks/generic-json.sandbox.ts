import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { MediaIntegrationAdapterResult } from "../../../imports/schemas";
import { failureResult, SinkInput } from "../shared";

export const manifest = defineManifest({
	kind: "activity",
	name: "Generic JSON sink",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "integration.generic-json",
	capabilities: ["getCurrentIntegration"],
});

export default defineActivity({
	manifest,
	input: SinkInput,
	output: MediaIntegrationAdapterResult,
	run: (_input, host) =>
		host
			.getCurrentIntegration()
			.pipe(
				Effect.as(
					failureResult("generic_json integration is not implemented in V2 yet", "source_fetch"),
				),
			),
});
