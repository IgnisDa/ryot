import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { MediaIntegrationAdapterResult } from "../../../imports/schemas";
import { SinkInput } from "../shared";
import { parseMediaServer } from "./shared";

export const manifest = defineManifest({
	kind: "script",
	name: "Jellyfin sink",
	slug: "integration.jellyfin-sink",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["getIntegration"],
});
export default defineScript({
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
