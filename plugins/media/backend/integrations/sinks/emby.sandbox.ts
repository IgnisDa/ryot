import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

import { captureIntegrationRecords } from "../artifacts";
import { IntegrationArtifactOutput } from "../schemas";
import { executionStartedAt, SinkInput } from "../shared";
import { findEmbyShow } from "./emby-episode";
import { parseMediaServer } from "./shared";

export const manifest = defineManifest({
	kind: "script",
	name: "Emby sink",
	slug: "integration.emby",
});

export default defineScript({
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
				"Emby",
				input.rawBody,
				integration.providerSpecifics,
				occurredAt,
				(payload) => findEmbyShow(payload, host),
			);
		}).pipe(Effect.flatMap((result) => captureIntegrationRecords(manifest.slug, result))),
});
