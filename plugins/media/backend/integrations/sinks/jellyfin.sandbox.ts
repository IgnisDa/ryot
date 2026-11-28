import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import { captureIntegrationRecords } from "../artifacts";
import { IntegrationArtifactOutput } from "../schemas";
import { executionStartedAt, SinkInput } from "../shared";
import { findJellyfinShow } from "./jellyfin-episode";
import { parseMediaServer } from "./shared";

export const manifest = defineManifest({
	kind: "script",
	activity: true,
	name: "Jellyfin sink",
	slug: "integration.jellyfin-sink",
});

export default defineActivity({
	manifest,
	input: SinkInput,
	output: IntegrationArtifactOutput,
	run: (input, host, execution) =>
		Effect.gen(function* () {
			if ("ingestionConfirmation" in input) {
				return { failures: [], entityGroups: [] };
			}
			const occurredAt = yield* executionStartedAt(execution);
			const integration = yield* host.getCurrentIntegration();
			return yield* parseMediaServer(
				"Jellyfin",
				input.rawBody,
				integration.providerSpecifics,
				occurredAt,
				(payload, provider) => findJellyfinShow(payload, provider, host),
			);
		}).pipe(
			Effect.flatMap((result) => captureIntegrationRecords(manifest.slug, result)),
			Effect.map((output) => ({ output })),
		),
});
