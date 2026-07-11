import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { AdapterResult, SinkInput } from "../shared";
import { parseMediaServer } from "./shared";

export const manifest = defineManifest({
	kind: "script",
	name: "Emby sink",
	slug: "integration.emby",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["getIntegration"],
});
export default defineScript({
	manifest,
	input: SinkInput,
	output: AdapterResult,
	run: (input, host) =>
		host
			.getIntegration()
			.pipe(
				Effect.flatMap((integration) =>
					parseMediaServer("Emby", input.rawBody, integration.providerSpecifics),
				),
			),
});
