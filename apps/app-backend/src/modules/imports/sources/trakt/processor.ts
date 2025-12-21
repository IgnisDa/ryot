import { Effect } from "effect";

import { processMediaImport } from "../../media/import-processor";
import { importerConfig } from "../../runtime/importer-config";
import { getRequiredSourcePayloadString } from "../shared/source-payload";
import { adaptTraktData } from "./adapter";

export const processTraktImport = (input: {
	runId: string;
	userId: string;
	sourcePayload?: Record<string, unknown>;
}) =>
	processMediaImport({
		runId: input.runId,
		userId: input.userId,
		sourceName: "Trakt",
		adapterErrorFallback: "Failed to fetch data from Trakt",
		loadAdapterResult: Effect.gen(function* () {
			const username = getRequiredSourcePayloadString(input.sourcePayload, "username");
			if (!username) {
				return yield* Effect.fail("Import job is missing Trakt username");
			}
			const clientId = importerConfig.trakt.clientId;
			if (!clientId) {
				return yield* Effect.fail(
					"Trakt importer is not configured. Set SERVER_IMPORTER_TRAKT_CLIENT_ID.",
				);
			}
			return yield* adaptTraktData(username, clientId);
		}),
	});
