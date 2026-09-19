import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import { collectTraktApi, recoverMediaApiTask } from "./api-collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.trakt",
	name: "Collect Trakt API",
	capabilities: ["httpCall", "getPluginConfig", "artifact-read", "scratch"],
});
export default defineScript({
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
		}),
});
