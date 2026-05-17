import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import { batchMediaImportResult } from "../../imports/helpers";
import { MediaImportAdapterBatch, TraktImportParserInput } from "../../imports/schemas";
import { adaptTraktData } from "../../imports/trakt";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.trakt",
	name: "Fetch Trakt import",
	requiredSystemConfigKeys: [],
	requiredPluginConfigKeys: ["traktClientId"],
	capabilities: ["httpCall", "getPluginConfig"],
});

export default defineScript({
	manifest,
	input: TraktImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input, host) =>
		Effect.gen(function* () {
			const { traktClientId: clientId } = yield* host.getPluginConfig(["traktClientId"]);
			if (typeof clientId !== "string" || !clientId) {
				throw new Error("Trakt importer is not configured. Set RYOT_PLUGIN_MEDIA_TRAKT_CLIENT_ID.");
			}
			const result = yield* adaptTraktData(input.username, clientId, host);
			return batchMediaImportResult(result, input.start, input.limit);
		}),
});
