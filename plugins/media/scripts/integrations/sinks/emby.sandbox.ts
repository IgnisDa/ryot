import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { MediaIntegrationAdapterResult } from "../../../imports/schemas";
import { SinkInput } from "../shared";
import { parseMediaServer } from "./shared";

export const manifest = defineManifest({
	kind: "activity",
	name: "Emby sink",
	slug: "integration.emby",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["getCurrentIntegration"],
});

export default defineActivity({
	manifest,
	input: SinkInput,
	output: MediaIntegrationAdapterResult,
	run: (input, host) =>
		host
			.getCurrentIntegration()
			.pipe(
				Effect.flatMap((integration) =>
					parseMediaServer("Emby", input.rawBody, integration.providerSpecifics),
				),
			),
});
