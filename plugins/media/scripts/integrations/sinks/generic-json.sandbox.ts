import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { AdapterResult, failureResult, SinkInput } from "../shared";

export const manifest = defineManifest({
	kind: "script",
	name: "Generic JSON sink",
	slug: "integration.generic-json",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["getIntegration"],
});
export default defineScript({
	manifest,
	input: SinkInput,
	output: AdapterResult,
	run: (_input, host) =>
		host
			.getIntegration()
			.pipe(
				Effect.as(
					failureResult("generic_json integration is not implemented in V2 yet", "source_fetch"),
				),
			),
});
