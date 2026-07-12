import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { batchMediaImportResult } from "../../imports/helpers";
import { MediaImportAdapterBatch, TraktImportParserInput } from "../../imports/schemas";
import { adaptTraktData } from "../../imports/trakt";

export const manifest = defineManifest({
	kind: "activity",
	name: "Fetch Trakt import",
	slug: "activity.import.trakt",
	capabilities: ["httpCall", "getPluginConfigValue"],
	requiredPluginConfigKeys: ["traktClientId"],
	requiredSystemConfigKeys: [],
});

export default defineActivity({
	manifest,
	input: TraktImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input, host) =>
		Effect.gen(function* () {
			const clientId = yield* host.getPluginConfigValue("traktClientId");
			if (typeof clientId !== "string" || !clientId) {
				throw new Error("Trakt importer is not configured. Set RYOT_PLUGIN_MEDIA_TRAKT_CLIENT_ID.");
			}
			const result = yield* adaptTraktData(input.username, clientId, host);
			return batchMediaImportResult(result, input.start, input.limit);
		}),
});
