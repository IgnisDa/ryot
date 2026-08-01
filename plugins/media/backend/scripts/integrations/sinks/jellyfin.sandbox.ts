import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { MediaIntegrationAdapterResult } from "../../../imports/schemas";
import { executionStartedAt, SinkInput } from "../shared";
import { parseMediaServer } from "./shared";

export const manifest = defineManifest({
	kind: "script",
	name: "Jellyfin sink",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "integration.jellyfin-sink",
	capabilities: ["getCurrentIntegration"],
});

export default defineScript({
	manifest,
	input: SinkInput,
	output: MediaIntegrationAdapterResult,
	run: (input, host, execution) =>
		Effect.gen(function* () {
			const occurredAt = yield* executionStartedAt(execution);
			const integration = yield* host.getCurrentIntegration();
			return yield* parseMediaServer(
				"Jellyfin",
				input.rawBody,
				integration.providerSpecifics,
				occurredAt,
			);
		}),
});
