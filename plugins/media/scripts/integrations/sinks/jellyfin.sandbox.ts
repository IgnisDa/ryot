import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { MediaIntegrationAdapterResult } from "../../../imports/schemas";
import { SinkInput } from "../shared";
import { parseMediaServer } from "./shared";

export const manifest = defineManifest({
	kind: "activity",
	name: "Jellyfin sink",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["getIntegration"],
	slug: "integration.jellyfin-sink",
});

export default defineActivity({
	manifest,
	input: SinkInput,
	output: MediaIntegrationAdapterResult,
	run: (input, host) =>
		host
			.getIntegration()
			.pipe(
				Effect.flatMap((integration) =>
					parseMediaServer("Jellyfin", input.rawBody, integration.providerSpecifics),
				),
			),
});
