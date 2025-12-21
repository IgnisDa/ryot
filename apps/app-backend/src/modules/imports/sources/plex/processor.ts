import { Effect } from "effect";

import { processMediaImport } from "../../media/import-processor";
import {
	getOptionalSourcePayloadBoolean,
	getRequiredSourcePayloadString,
} from "../shared/source-payload";
import { adaptPlexData } from "./adapter";

export const processPlexImport = (input: {
	runId: string;
	userId: string;
	sourcePayload?: Record<string, unknown>;
}) =>
	processMediaImport({
		runId: input.runId,
		userId: input.userId,
		sourceName: "Plex",
		adapterErrorFallback: "Failed to fetch data from Plex",
		loadAdapterResult: Effect.gen(function* () {
			const apiKey = getRequiredSourcePayloadString(input.sourcePayload, "apiKey");
			const apiUrl = getRequiredSourcePayloadString(input.sourcePayload, "apiUrl");
			const allowInsecureConnections = getOptionalSourcePayloadBoolean(
				input.sourcePayload,
				"allowInsecureConnections",
			);
			if (!apiKey || !apiUrl) {
				return yield* Effect.fail("Import job is missing Plex credentials");
			}
			return yield* adaptPlexData({ apiKey, apiUrl, allowInsecureConnections });
		}),
	});
