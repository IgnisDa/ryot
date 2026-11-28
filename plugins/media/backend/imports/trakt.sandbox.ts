import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import { collectTraktApi, recoverMediaApiTask } from "./api-collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";

export const manifest = defineManifest({
	kind: "script",
	activity: true,
	slug: "import.trakt",
	name: "Collect Trakt API",
});
export default defineActivity({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input, host) =>
		Effect.gen(function* () {
			const config = yield* host.getPluginConfig({ required: ["traktClientId"] });
			const clientId = config["traktClientId"];
			if (typeof clientId !== "string" || !clientId) {
				throw new Error("Trakt importer is not configured");
			}
			return yield* collectTraktApi(input, clientId, host).pipe(
				Effect.catch((error) => recoverMediaApiTask(input, error, "Trakt")),
			);
		}).pipe(Effect.map((output) => ({ output }))),
});
